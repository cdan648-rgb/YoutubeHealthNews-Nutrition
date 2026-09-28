/**
 * Campaign fan-out and the send state machine.
 *
 * These are the duplicate-prevention guarantees, tested against a fake gateway with an
 * injected provider so no email is sent: one campaign per article, one send per subscriber,
 * a re-drive that sends nothing twice, a daily cap that stops rather than floods, and a
 * stale in-flight row that becomes `unknown` and is never retried.
 *
 * The gateway calls the same public.newsletter_* RPCs the production live gateway uses, so
 * this exercise covers the wiring that would 500 if the send path ever reached back to the
 * private `internal` schema through PostgREST.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { drainCampaign, queueCampaign, type CampaignArticle, type SendDeps } from './send';
import type { EmailProvider } from './provider';
import {
  fakeNewsletterGateway,
  type FakeNewsletterGateway,
  type SubscriberSeed,
} from '../../../tests/helpers/fake-newsletter-gateway';

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

function activeSubscribers(n: number): SubscriberSeed[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `sub-${i}`,
    email: `s${i}@example.com`,
    status: 'active' as const,
  }));
}

function seed(subscribers: number, cap: number | null = 90): FakeNewsletterGateway {
  const gateway = fakeNewsletterGateway([
    ...activeSubscribers(subscribers),
    // one non-active subscriber that must be excluded from fan-out
    { id: 'unsub', email: 'gone@example.com', status: 'unsubscribed' },
  ]);
  gateway.setDailySendCap(cap);
  return gateway;
}

function deps(
  _gateway: FakeNewsletterGateway,
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
    const gateway = seed(3);
    const { provider, sends } = countingProvider();
    await queueCampaign('article-1', gateway, deps(gateway, provider));

    expect(gateway.campaigns).toHaveLength(1);
    // 3 active subscribers → 3 sends; the unsubscribed one is excluded.
    expect(sends).toHaveLength(3);
    expect(gateway.sends).toHaveLength(3);
    expect(gateway.sends.every((r) => r.status === 'sent')).toBe(true);
  });

  it('is idempotent: a second call creates no second campaign and sends nothing again', async () => {
    const gateway = seed(3);
    const first = countingProvider();
    await queueCampaign('article-1', gateway, deps(gateway, first.provider));
    const second = countingProvider();
    await queueCampaign('article-1', gateway, deps(gateway, second.provider));

    expect(gateway.campaigns).toHaveLength(1);
    expect(second.sends).toHaveLength(0); // nothing left queued
  });

  it('marks the campaign complete when every send resolves', async () => {
    const gateway = seed(2);
    const { provider } = countingProvider();
    await queueCampaign('article-1', gateway, deps(gateway, provider));
    expect(gateway.campaigns[0]?.completedAt).toBeTruthy();
    expect(gateway.campaigns[0]?.totalSent).toBe(2);
  });
});

describe('daily send cap', () => {
  it('stops at the cap and leaves the rest queued rather than flooding', async () => {
    const gateway = seed(5, 2); // cap of 2, five subscribers
    const { provider, sends } = countingProvider();
    const result = await drainViaQueue(gateway, provider);

    expect(sends).toHaveLength(2);
    expect(result.quotaReached).toBe(true);
    const queued = gateway.sends.filter((r) => r.status === 'queued');
    expect(queued).toHaveLength(3);
    // The quota event is logged.
    expect(gateway.logs.some((l) => l.code === 'email_quota_reached')).toBe(true);
  });

  async function drainViaQueue(gateway: FakeNewsletterGateway, provider: EmailProvider) {
    await queueCampaign('article-1', gateway, {
      provider,
      loadArticle: () => Promise.resolve(ARTICLE),
    });
    // queueCampaign fans out and drains once; return the campaign's drain summary by draining
    // again (which does nothing more but reports quotaReached deterministically).
    const campaignId = gateway.campaigns[0]?.id ?? '';
    return drainCampaign(campaignId, gateway, {
      provider,
      loadArticle: () => Promise.resolve(ARTICLE),
    });
  }
});

describe('failure handling', () => {
  it('stops consuming quota when the provider is not configured', async () => {
    const gateway = seed(4);
    const { provider, sends } = countingProvider('not_configured');
    await queueCampaign('article-1', gateway, deps(gateway, provider));
    // First send returns not_configured and the drain stops — the rest stay queued.
    expect(sends).toHaveLength(1);
    expect(gateway.sends.filter((r) => r.status === 'queued')).toHaveLength(3);
    expect(gateway.logs.some((l) => l.code === 'email_send_failed')).toBe(true);
  });
});

describe('stale in-flight reclamation', () => {
  it('marks a sending row older than the timeout as unknown, and never retries it', async () => {
    const gateway = seed(0);
    // A campaign with one send stuck in 'sending' well past the 15-minute timeout.
    gateway.campaigns.push({
      id: 'camp-1',
      articleId: 'a',
      totalQueued: 1,
      totalSent: 0,
      startedAt: null,
      completedAt: null,
    });
    gateway.sends.push({
      id: 'send-1',
      campaignId: 'camp-1',
      subscriberId: 'sub-x',
      status: 'sending',
      attemptedAt: '2026-09-27T00:00:00Z',
      sentAt: null,
      providerMessageId: null,
      attemptCount: 1,
      error: null,
    });

    const { provider, sends } = countingProvider();
    const result = await drainCampaign('camp-1', gateway, {
      provider,
      loadArticle: () => Promise.resolve(ARTICLE),
      now: () => new Date('2026-09-28T00:00:00Z'),
    });

    expect(gateway.sends[0]?.status).toBe('unknown');
    // A missed email is preferred to a duplicate: the unknown row is not re-sent.
    expect(sends).toHaveLength(0);
    expect(result.sent).toBe(0);
  });
});
