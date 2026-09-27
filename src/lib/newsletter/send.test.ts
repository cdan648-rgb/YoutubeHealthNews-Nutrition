/**
 * Campaign fan-out and the send state machine.
 *
 * These are the duplicate-prevention guarantees, tested against the fake client with an
 * injected provider so no email is sent: one campaign per article, one send per subscriber,
 * a re-drive that sends nothing twice, a daily cap that stops rather than floods, and a
 * stale in-flight row that becomes `unknown` and is never retried.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { drainCampaign, queueCampaign, type CampaignArticle, type SendDeps } from './send';
import type { EmailProvider } from './provider';
import { FakeInternalClient } from '../../../tests/helpers/fake-newsletter-client';
import type { InternalClient } from '@/lib/supabase/service';

const ARTICLE: CampaignArticle = {
  title: 'Magie và cơ thể',
  dek: 'Tóm tắt ngắn về magie.',
  slug: 'magie',
  isFactCheck: false,
  articleType: 'youtube',
};

function countingProvider(behaviour: 'sent' | 'fail' | 'not_configured' = 'sent') {
  const sends: string[] = [];
  const provider: EmailProvider = {
    name: 'test',
    configured: behaviour !== 'not_configured',
    send: (message) => {
      sends.push(message.to);
      if (behaviour === 'sent') return Promise.resolve({ outcome: 'sent', providerMessageId: 'm' });
      if (behaviour === 'not_configured')
        return Promise.resolve({ outcome: 'not_configured', error: 'disabled' });
      return Promise.resolve({ outcome: 'failed', error: 'boom' });
    },
  };
  return { provider, sends };
}

function activeSubscribers(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `sub-${i}`,
    email: `s${i}@example.com`,
    email_normalized: `s${i}@example.com`,
    status: 'active',
    unsubscribe_token_hash: 'x',
    consent_text_version: 'v',
  }));
}

function seed(subscribers: number, cap = 90) {
  return new FakeInternalClient({
    subscribers: activeSubscribers(subscribers).concat([
      // one non-active subscriber that must be excluded from fan-out
      {
        id: 'unsub',
        email: 'gone@example.com',
        email_normalized: 'gone@example.com',
        status: 'unsubscribed',
        unsubscribe_token_hash: 'x',
        consent_text_version: 'v',
      },
    ]),
    automation_settings: [{ id: true, daily_send_cap: cap }],
  });
}

function deps(
  _client: FakeInternalClient,
  provider: EmailProvider,
  extra: Partial<SendDeps> = {},
): SendDeps {
  return {
    provider,
    loadArticle: () => Promise.resolve(ARTICLE),
    ...extra,
  };
}

beforeEach(() => {
  process.env.NEWSLETTER_TOKEN_SECRET = 'secret';
});
afterEach(() => {
  delete process.env.NEWSLETTER_TOKEN_SECRET;
});

describe('queueCampaign', () => {
  it('creates one campaign, fans out only active subscribers, and sends each once', async () => {
    const client = seed(3);
    const { provider, sends } = countingProvider();
    await queueCampaign('article-1', client as unknown as InternalClient, deps(client, provider));

    expect(client.rowsOf('newsletter_campaigns')).toHaveLength(1);
    // 3 active subscribers → 3 sends; the unsubscribed one is excluded.
    expect(sends).toHaveLength(3);
    const sendRows = client.rowsOf('newsletter_sends');
    expect(sendRows).toHaveLength(3);
    expect(sendRows.every((r) => r.status === 'sent')).toBe(true);
  });

  it('is idempotent: a second call creates no second campaign and sends nothing again', async () => {
    const client = seed(3);
    const first = countingProvider();
    await queueCampaign(
      'article-1',
      client as unknown as InternalClient,
      deps(client, first.provider),
    );
    const second = countingProvider();
    await queueCampaign(
      'article-1',
      client as unknown as InternalClient,
      deps(client, second.provider),
    );

    expect(client.rowsOf('newsletter_campaigns')).toHaveLength(1);
    expect(second.sends).toHaveLength(0); // nothing left queued
  });

  it('marks the campaign complete when every send resolves', async () => {
    const client = seed(2);
    const { provider } = countingProvider();
    await queueCampaign('article-1', client as unknown as InternalClient, deps(client, provider));
    expect(client.rowsOf('newsletter_campaigns')[0]?.completed_at).toBeTruthy();
    expect(client.rowsOf('newsletter_campaigns')[0]?.total_sent).toBe(2);
  });
});

describe('daily send cap', () => {
  it('stops at the cap and leaves the rest queued rather than flooding', async () => {
    const client = seed(5, 2); // cap of 2, five subscribers
    const { provider, sends } = countingProvider();
    const result = await drainViaQueue(client, provider);

    expect(sends).toHaveLength(2);
    expect(result.quotaReached).toBe(true);
    const queued = client.rowsOf('newsletter_sends').filter((r) => r.status === 'queued');
    expect(queued).toHaveLength(3);
    // The quota event is logged.
    expect(client.rowsOf('job_logs').some((l) => l.code === 'email_quota_reached')).toBe(true);
  });

  async function drainViaQueue(client: FakeInternalClient, provider: EmailProvider) {
    await queueCampaign('article-1', client as unknown as InternalClient, {
      provider,
      loadArticle: () => Promise.resolve(ARTICLE),
    });
    // queueCampaign fans out and drains once; return the campaign's drain summary by draining
    // again (which does nothing more but reports quotaReached deterministically).
    const campaignId = String(client.rowsOf('newsletter_campaigns')[0]?.id);
    return drainCampaign(campaignId, client as unknown as InternalClient, {
      provider,
      loadArticle: () => Promise.resolve(ARTICLE),
    });
  }
});

describe('failure handling', () => {
  it('stops consuming quota when the provider is not configured', async () => {
    const client = seed(4);
    const { provider, sends } = countingProvider('not_configured');
    await queueCampaign('article-1', client as unknown as InternalClient, deps(client, provider));
    // First send returns not_configured and the drain stops — the rest stay queued.
    expect(sends).toHaveLength(1);
    expect(client.rowsOf('newsletter_sends').filter((r) => r.status === 'queued')).toHaveLength(3);
    expect(client.rowsOf('job_logs').some((l) => l.code === 'email_send_failed')).toBe(true);
  });
});

describe('stale in-flight reclamation', () => {
  it('marks a sending row older than the timeout as unknown, and never retries it', async () => {
    const client = seed(0);
    // A campaign with one send stuck in 'sending' well past the 15-minute timeout.
    client
      .rowsOf('newsletter_campaigns')
      .push({ id: 'camp-1', article_id: 'a', total_queued: 1, total_sent: 0 });
    client.rowsOf('newsletter_sends').push({
      id: 'send-1',
      campaign_id: 'camp-1',
      subscriber_id: 'sub-x',
      status: 'sending',
      attempted_at: '2026-09-27T00:00:00Z',
      attempt_count: 1,
      idempotency_key: 'camp-1:sub-x',
    });

    const { provider, sends } = countingProvider();
    const result = await drainCampaign('camp-1', client as unknown as InternalClient, {
      provider,
      loadArticle: () => Promise.resolve(ARTICLE),
      now: () => new Date('2026-09-28T00:00:00Z'),
    });

    expect(client.rowsOf('newsletter_sends')[0]?.status).toBe('unknown');
    // A missed email is preferred to a duplicate: the unknown row is not re-sent.
    expect(sends).toHaveLength(0);
    expect(result.sent).toBe(0);
  });
});
