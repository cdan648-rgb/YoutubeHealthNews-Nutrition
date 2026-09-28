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
 *
 * Every database call goes through `NewsletterGateway` (public.newsletter_* RPCs), NOT the
 * private `internal` schema directly, because that schema is intentionally not exposed to
 * the Data API — a direct `internalClient()` .from() call would 500 with "Invalid schema:
 * internal" the moment the notify stage runs in production.
 */
import 'server-only';

import type { NewsletterGateway } from '@/lib/automation/internal-gateway';
import { liveNewsletterGateway } from '@/lib/automation/internal-gateway';
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
   * gateway that knows about the articles table. Production uses the gateway's join RPC.
   */
  readonly loadArticle?: (
    campaignId: string,
    gateway: NewsletterGateway,
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
  gateway: NewsletterGateway = liveNewsletterGateway(),
  deps: SendDeps = {},
): Promise<void> {
  // One campaign per article. `created` distinguishes the fresh row from a returned existing
  // one; on `false` fan-out already happened and we skip straight to draining.
  const handle = await gateway.campaignGetOrCreate(articleId);
  if (handle.created) {
    await fanOut(handle.id, gateway);
  }
  await drainCampaign(handle.id, gateway, deps);
}

/** Insert a queued send for every active subscriber that does not already have one. */
async function fanOut(campaignId: string, gateway: NewsletterGateway): Promise<void> {
  const subscriberIds = await gateway.activeSubscriberIds();
  if (subscriberIds.length === 0) {
    await gateway.campaignSetStarted(campaignId, 0);
    return;
  }
  await gateway.fanoutSends(campaignId, subscriberIds);
  await gateway.campaignSetStarted(campaignId, subscriberIds.length);
}

/**
 * Send the queued rows for a campaign, up to the day's remaining quota.
 *
 * Safe to call repeatedly: it reclaims stale in-flight rows, then processes only `queued`
 * ones. Exported so a manual re-drive or a future scheduled sweep can call it directly.
 */
export async function drainCampaign(
  campaignId: string,
  gateway: NewsletterGateway = liveNewsletterGateway(),
  deps: SendDeps = {},
): Promise<{ sent: number; failed: number; quotaReached: boolean }> {
  const now = deps.now ?? (() => new Date());
  const provider = deps.provider ?? createEmailProvider(deps.fetchImpl);

  const cutoff = new Date(now().getTime() - SENDING_TIMEOUT_MINUTES * 60 * 1000).toISOString();
  await gateway.reclaimStale(campaignId, cutoff);

  const cap = await gateway.dailySendCap();
  const since = startOfHanoiDay(now()).toISOString();
  let remaining =
    cap === null
      ? Number.POSITIVE_INFINITY
      : Math.max(0, cap - (await gateway.sentTodayCount(since)));

  let sent = 0;
  let failed = 0;
  let quotaReached = false;

  const queued = await gateway.queuedBatch(campaignId, DRAIN_BATCH);

  const article = await (deps.loadArticle ?? loadArticleViaGateway)(campaignId, gateway);

  for (const row of queued) {
    if (remaining <= 0) {
      quotaReached = true;
      break;
    }

    // Win the row: only one caller can move it out of 'queued'. A lost race means another
    // drain already took it, so skip.
    const claimed = await gateway.claimSend(row.id, now().toISOString());
    if (!claimed) continue;

    remaining -= 1;

    const subscriber = await gateway.subscriberForSend(row.subscriberId);
    if (subscriber === null || article === null) {
      await gateway.markSendFailed(row.id, 'missing_subscriber_or_article');
      failed += 1;
      continue;
    }

    // Signed, per-subscriber unsubscribe links. The token is a deterministic HMAC of the id,
    // so it is reproducible here without storing anything in the clear.
    const token = signSubscriberToken(row.subscriberId);
    const query = `u=${row.subscriberId}&t=${encodeURIComponent(token)}`;

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
      to: subscriber.email,
      subject: message.subject,
      html: message.html,
      text: message.text,
      // The machine one-click endpoint: a POST by RFC 8058, so link prefetch cannot trip it.
      listUnsubscribeUrl: absoluteUrl(`/api/newsletter/unsubscribe?${query}`),
      listUnsubscribePost: true,
      idempotencyKey: row.id,
    });

    if (result.outcome === 'sent') {
      // Provider may not return an id (e.g. in dev); pass empty rather than null so the RPC's
      // stored column is a plain string. The observable behaviour of a delivered send is
      // unchanged: id is a receipt, not a correctness signal.
      await gateway.markSendSent(row.id, result.providerMessageId ?? '', now().toISOString());
      sent += 1;
    } else {
      // A provider that is not configured, or a hard failure: record it and stop consuming
      // quota — every subsequent send would fail identically.
      await gateway.markSendFailed(row.id, result.error);
      failed += 1;
      await gateway.log('error', 'email_send_failed', 'campaign', result.error, {
        campaignId,
        sendId: row.id,
      });
      if (result.outcome === 'not_configured') break;
    }
  }

  if (quotaReached) {
    await gateway.log(
      'warn',
      'email_quota_reached',
      'campaign',
      `daily send cap reached; ${queued.length - sent - failed} left queued`,
      { campaignId },
    );
  }

  await gateway.updateCampaignTotals(campaignId);
  return { sent, failed, quotaReached };
}

async function loadArticleViaGateway(
  campaignId: string,
  gateway: NewsletterGateway,
): Promise<CampaignArticle | null> {
  const row = await gateway.loadArticleForCampaign(campaignId);
  if (row === null) return null;
  return {
    title: row.title,
    dek: row.dek,
    slug: row.slug,
    isFactCheck: row.isFactCheck,
    articleType: row.articleType,
  };
}
