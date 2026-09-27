/**
 * Newsletter delivery: campaign creation, fan-out and the send state machine. SERVER ONLY.
 *
 * Called by the scheduler's notify stage after a successful publication. Every guarantee
 * here is about never sending a duplicate, because a duplicate email is the failure a reader
 * actually notices and resents:
 *
 *   One campaign per article — `newsletter_campaigns.article_id` is unique, so a retried
 *   notify cannot start a second send-out.
 *
 *   One send per (campaign, subscriber) — the unique constraint, plus a generated
 *   idempotency key, so fan-out is safe to run twice.
 *
 *   The send state machine is queued -> sending -> sent, and it prefers a missed email to a
 *   duplicate: the transition to `sending` is a guarded UPDATE that only one caller can win,
 *   the provider is called exactly once per won row, and a row left in `sending` (a crash
 *   between the call and recording its result) becomes `unknown` after a timeout and is
 *   NEVER retried. Retries read only `queued`.
 *
 * The daily cap is a hard stop, not a throttle: when the day's send count reaches
 * `daily_send_cap`, the drain logs `email_quota_reached` and leaves the rest queued for the
 * next run rather than flooding a rate-limited provider with failures.
 */
import 'server-only';

import type { InternalClient } from '@/lib/supabase/service';
import { internalClient, serviceClient } from '@/lib/supabase/service';
import { startOfHanoiDay } from '@/lib/time';
import { absoluteUrl, articlePath } from '@/lib/site';
import type { EmailProvider } from './provider';
import { createEmailProvider } from './provider';
import { campaignEmail } from './templates';
import { signSubscriberToken } from './tokens';

/** A row in `sending` older than this is assumed lost and marked `unknown`. */
const SENDING_TIMEOUT_MINUTES = 15;

/** Safety limit on rows processed in one drain, so a route handler stays inside its budget. */
const DRAIN_BATCH = 200;

export type CampaignArticle = {
  title: string;
  dek: string;
  slug: string;
  isFactCheck: boolean;
  articleType: 'youtube' | 'research';
};

export type SendDeps = {
  readonly provider?: EmailProvider;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
  /**
   * How to load the article for a campaign. Injected so the send path is testable without a
   * `public`-schema client; production uses the service-role reader below.
   */
  readonly loadArticle?: (
    campaignId: string,
    client: InternalClient,
  ) => Promise<CampaignArticle | null>;
};

/**
 * Create the campaign for an article and fan out one queued send per active subscriber.
 *
 * Idempotent: a second call finds the existing campaign and inserts no duplicate sends. The
 * scheduler calls this and it is safe under the same retries as every other notify step.
 */
export async function queueCampaign(
  articleId: string,
  client: InternalClient = internalClient(),
  deps: SendDeps = {},
): Promise<void> {
  // One campaign per article. A returned row means we created it; null means it already
  // existed, in which case fan-out has already happened and we go straight to draining.
  const created = await client
    .from('newsletter_campaigns')
    .insert({ article_id: articleId })
    .select('id')
    .maybeSingle();

  let campaignId: string;
  if (created.error !== null) {
    if (created.error.code !== '23505') {
      throw new Error(`campaign insert failed: ${created.error.message}`);
    }
    const existing = await client
      .from('newsletter_campaigns')
      .select('id')
      .eq('article_id', articleId)
      .maybeSingle();
    if (existing.data === null) throw new Error('campaign vanished after conflict');
    campaignId = existing.data.id;
  } else {
    if (created.data === null) throw new Error('campaign insert returned no row');
    campaignId = created.data.id;
    await fanOut(campaignId, client);
  }

  await drainCampaign(campaignId, client, deps);
}

/** Insert a queued send for every active subscriber that does not already have one. */
async function fanOut(campaignId: string, client: InternalClient): Promise<void> {
  const subscribers = await client.from('subscribers').select('id').eq('status', 'active');
  if (subscribers.error !== null)
    throw new Error(`fanOut read failed: ${subscribers.error.message}`);

  const rows = (subscribers.data ?? []).map((subscriber) => ({
    campaign_id: campaignId,
    subscriber_id: subscriber.id,
  }));
  if (rows.length === 0) return;

  // ON CONFLICT is implicit via the unique (campaign_id, subscriber_id); ignore duplicates so
  // a re-run adds only subscribers who joined since.
  const inserted = await client
    .from('newsletter_sends')
    .upsert(rows, { onConflict: 'campaign_id,subscriber_id', ignoreDuplicates: true });
  if (inserted.error !== null) throw new Error(`fanOut insert failed: ${inserted.error.message}`);

  const total = await client
    .from('newsletter_sends')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId);
  await client
    .from('newsletter_campaigns')
    .update({ total_queued: total.count ?? rows.length, started_at: new Date().toISOString() })
    .eq('id', campaignId);
}

/**
 * How many emails have been sent (or attempted and now in-flight/unknown) today.
 *
 * Counts everything that consumed provider quota this Hanoi day, so the cap protects a
 * rate-limited free tier rather than only counting confirmed successes.
 */
async function sentToday(client: InternalClient, now: Date): Promise<number> {
  const since = startOfHanoiDay(now).toISOString();
  const { count } = await client
    .from('newsletter_sends')
    .select('id', { count: 'exact', head: true })
    .gte('attempted_at', since)
    .in('status', ['sent', 'sending', 'unknown']);
  return count ?? 0;
}

/**
 * Send the queued rows for a campaign, up to the day's remaining quota.
 *
 * Safe to call repeatedly: it reclaims stale in-flight rows, then processes only `queued`
 * ones. Exported so a manual re-drive or a future scheduled sweep can call it directly.
 */
export async function drainCampaign(
  campaignId: string,
  client: InternalClient = internalClient(),
  deps: SendDeps = {},
): Promise<{ sent: number; failed: number; quotaReached: boolean }> {
  const now = deps.now ?? (() => new Date());
  const provider = deps.provider ?? createEmailProvider(deps.fetchImpl);

  await reclaimStale(campaignId, client, now());

  const cap = await dailySendCap(client);
  let remaining =
    cap === null ? Number.POSITIVE_INFINITY : Math.max(0, cap - (await sentToday(client, now())));

  let sent = 0;
  let failed = 0;
  let quotaReached = false;

  const queued = await client
    .from('newsletter_sends')
    .select('id, subscriber_id')
    .eq('campaign_id', campaignId)
    .eq('status', 'queued')
    .limit(DRAIN_BATCH);
  if (queued.error !== null) throw new Error(`drain read failed: ${queued.error.message}`);

  const article = await (deps.loadArticle ?? loadArticleFromDb)(campaignId, client);

  for (const row of queued.data ?? []) {
    if (remaining <= 0) {
      quotaReached = true;
      break;
    }

    // Win the row: only one caller can move it out of 'queued'. A lost race (0 rows) means
    // another drain already took it, so skip.
    const claim = await client
      .from('newsletter_sends')
      .update({ status: 'sending', attempted_at: now().toISOString() })
      .eq('id', row.id)
      .eq('status', 'queued')
      .select('id')
      .maybeSingle();
    if (claim.error !== null) throw new Error(`send claim failed: ${claim.error.message}`);
    if (claim.data === null) continue;

    remaining -= 1;

    const subscriber = await client
      .from('subscribers')
      .select('email, unsubscribe_token_hash')
      .eq('id', row.subscriber_id)
      .maybeSingle();

    if (subscriber.data === null || article === null) {
      await client
        .from('newsletter_sends')
        .update({ status: 'failed', error: { reason: 'missing_subscriber_or_article' } })
        .eq('id', row.id);
      failed += 1;
      continue;
    }

    // Signed, per-subscriber unsubscribe links. The token is a deterministic HMAC of the id,
    // so it is reproducible here without storing anything in the clear.
    const token = signSubscriberToken(row.subscriber_id);
    const query = `u=${row.subscriber_id}&t=${encodeURIComponent(token)}`;

    const message = campaignEmail({
      title: article.title,
      dek: article.dek,
      articleUrl: absoluteUrl(articlePath(article)),
      // The human-facing landing page: a GET here only shows a confirm button (R23).
      unsubscribeUrl: absoluteUrl(`/huy-dang-ky?${query}`),
      isFactCheck: article.isFactCheck,
      isResearch: article.articleType === 'research',
    });

    const result = await provider.send({
      to: subscriber.data.email,
      subject: message.subject,
      html: message.html,
      text: message.text,
      // The machine one-click endpoint: a POST by RFC 8058, so link prefetch cannot trip it.
      listUnsubscribeUrl: absoluteUrl(`/api/newsletter/unsubscribe?${query}`),
      listUnsubscribePost: true,
      idempotencyKey: row.id,
    });

    if (result.outcome === 'sent') {
      await client
        .from('newsletter_sends')
        .update({
          status: 'sent',
          sent_at: now().toISOString(),
          provider_message_id: result.providerMessageId,
          attempt_count: 1,
        })
        .eq('id', row.id);
      sent += 1;
    } else {
      // A provider that is not configured, or a hard failure: record it and stop consuming
      // quota — every subsequent send would fail identically.
      await client
        .from('newsletter_sends')
        .update({ status: 'failed', attempt_count: 1, error: { reason: result.error } })
        .eq('id', row.id);
      failed += 1;
      await client.from('job_logs').insert({
        level: 'error',
        code: 'email_send_failed',
        stage: 'campaign',
        message: result.error,
        context: { campaignId, sendId: row.id },
      });
      if (result.outcome === 'not_configured') break;
    }
  }

  if (quotaReached) {
    await client.from('job_logs').insert({
      level: 'warn',
      code: 'email_quota_reached',
      stage: 'campaign',
      message: `daily send cap reached; ${(queued.data ?? []).length - sent - failed} left queued`,
      context: { campaignId },
    });
  }

  await updateCampaignTotals(campaignId, client);
  return { sent, failed, quotaReached };
}

/** Mark in-flight rows that outlived the timeout as `unknown` — never retried. */
async function reclaimStale(campaignId: string, client: InternalClient, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - SENDING_TIMEOUT_MINUTES * 60 * 1000).toISOString();
  const stale = await client
    .from('newsletter_sends')
    .update({ status: 'unknown', error: { reason: 'sending_timed_out' } })
    .eq('campaign_id', campaignId)
    .eq('status', 'sending')
    .lt('attempted_at', cutoff)
    .select('id');
  if (stale.error !== null) throw new Error(`reclaimStale failed: ${stale.error.message}`);
}

async function dailySendCap(client: InternalClient): Promise<number | null> {
  const { data } = await client.from('automation_settings').select('daily_send_cap').maybeSingle();
  return data?.daily_send_cap ?? null;
}

async function loadArticleFromDb(
  campaignId: string,
  client: InternalClient,
): Promise<CampaignArticle | null> {
  const campaign = await client
    .from('newsletter_campaigns')
    .select('article_id')
    .eq('id', campaignId)
    .maybeSingle();
  if (campaign.data === null) return null;

  const { data } = await serviceClient()
    .from('articles')
    .select('title, dek, slug, is_fact_check, article_type')
    .eq('id', campaign.data.article_id)
    .maybeSingle();
  if (data === null || data === undefined) return null;

  return {
    title: data.title,
    dek: data.dek,
    slug: data.slug,
    isFactCheck: data.is_fact_check,
    articleType: data.article_type,
  };
}

async function updateCampaignTotals(campaignId: string, client: InternalClient): Promise<void> {
  const sentCount = await client
    .from('newsletter_sends')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('status', 'sent');
  const openCount = await client
    .from('newsletter_sends')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .in('status', ['queued', 'sending']);

  await client
    .from('newsletter_campaigns')
    .update({
      total_sent: sentCount.count ?? 0,
      // A campaign is complete once nothing is left queued or in-flight.
      ...(openCount.count === 0 ? { completed_at: new Date().toISOString() } : {}),
    })
    .eq('id', campaignId);
}
