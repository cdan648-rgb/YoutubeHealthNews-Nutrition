/**
 * The signup use case, against the in-memory newsletter gateway.
 *
 * The properties under test are the ones a client-side insert could never guarantee: the
 * honeypot drops bots silently, the response is identical for known and unknown addresses
 * (no enumeration), an active address is never re-mailed, the rate limit trips after the
 * configured burst, and — the reason for the recent production bug — a Gmail address is
 * accepted through the gateway without ever touching the private `internal` schema.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { subscribe } from './subscribe';
import type { EmailProvider } from './provider';
import { fakeNewsletterGateway } from '../../../tests/helpers/fake-newsletter-gateway';

function sentProvider(): EmailProvider & { sends: string[] } {
  const sends: string[] = [];
  return {
    name: 'test',
    configured: true,
    sends,
    send: (message) => {
      sends.push(message.to);
      return Promise.resolve({ outcome: 'sent', providerMessageId: 'm' });
    },
  };
}

/** A provider that pretends Resend is not configured — the production default before setup. */
function notConfiguredProvider(): EmailProvider & { sends: string[] } {
  const sends: string[] = [];
  return {
    name: 'disabled',
    configured: false,
    sends,
    send: () => Promise.resolve({ outcome: 'not_configured', error: 'RESEND_API_KEY is not set' }),
  };
}

const BASE = {
  honeypot: null,
  turnstileToken: 'tok',
  ip: '203.0.113.9',
  userAgent: 'test',
  source: 'test',
} as const;

function deps(gateway: ReturnType<typeof fakeNewsletterGateway>, provider: EmailProvider) {
  return {
    gateway,
    provider,
    verify: () => Promise.resolve({ ok: true as const, skipped: false }),
  };
}

beforeEach(() => {
  process.env.IP_HASH_SALT = 'salt';
  process.env.NEWSLETTER_TOKEN_SECRET = 'secret';
});
afterEach(() => {
  delete process.env.IP_HASH_SALT;
  delete process.env.NEWSLETTER_TOKEN_SECRET;
});

describe('subscribe', () => {
  it('creates a pending subscriber and sends one confirmation for a new Gmail address', async () => {
    const gateway = fakeNewsletterGateway();
    const provider = sentProvider();
    const outcome = await subscribe(
      { ...BASE, email: 'New.Person@gmail.com' },
      deps(gateway, provider),
    );

    // The exact failure the production bug produced was a "server error" masquerading as
    // "invalid email" on the mobile modal. This case exists to make sure a legitimate
    // Gmail address is never rejected by the signup path itself.
    expect(outcome).toEqual({ status: 'ok' });
    expect(gateway.subscribers).toHaveLength(1);
    expect(gateway.subscribers[0]?.status).toBe('pending');
    expect(gateway.subscribers[0]?.confirmTokenHash).toMatch(/^[0-9a-f]{64}$/);
    // The unsubscribe hash is set deterministically from the row id after insert.
    expect(gateway.subscribers[0]?.unsubscribeTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(provider.sends).toEqual(['new.person@gmail.com']);
  });

  it('drops a honeypot submission silently with a success-shaped answer', async () => {
    const gateway = fakeNewsletterGateway();
    const provider = sentProvider();
    const outcome = await subscribe(
      { ...BASE, email: 'bot@example.com', honeypot: 'ACME Inc' },
      deps(gateway, provider),
    );
    expect(outcome).toEqual({ status: 'ok' });
    expect(gateway.subscribers).toHaveLength(0);
    expect(provider.sends).toHaveLength(0);
  });

  it('rejects a malformed address', async () => {
    const gateway = fakeNewsletterGateway();
    const outcome = await subscribe(
      { ...BASE, email: 'not-an-email' },
      deps(gateway, sentProvider()),
    );
    expect(outcome.status).toBe('invalid');
  });

  it('gives the SAME neutral answer for an already-active address, and does not re-mail', async () => {
    const gateway = fakeNewsletterGateway([
      { id: 'existing', email: 'a@example.com', status: 'active' },
    ]);
    const provider = sentProvider();
    const outcome = await subscribe({ ...BASE, email: 'a@example.com' }, deps(gateway, provider));

    expect(outcome).toEqual({ status: 'ok' });
    expect(provider.sends).toHaveLength(0); // no email to an already-confirmed address
  });

  it('re-arms confirmation for a pending address without creating a duplicate row', async () => {
    const gateway = fakeNewsletterGateway([
      { id: 'pending-1', email: 'p@example.com', status: 'pending' },
    ]);
    const provider = sentProvider();
    await subscribe({ ...BASE, email: 'p@example.com' }, deps(gateway, provider));

    expect(gateway.subscribers).toHaveLength(1);
    expect(provider.sends).toEqual(['p@example.com']);
  });

  it('treats a Gmail alias as the same person (no duplicate)', async () => {
    const gateway = fakeNewsletterGateway([
      { id: 'g', email: 'person@gmail.com', status: 'active' },
    ]);
    const outcome = await subscribe(
      { ...BASE, email: 'p.e.r.s.o.n+news@gmail.com' },
      deps(gateway, sentProvider()),
    );
    expect(outcome).toEqual({ status: 'ok' });
    expect(gateway.subscribers).toHaveLength(1);
  });

  it('rate-limits after the configured burst from one IP', async () => {
    const gateway = fakeNewsletterGateway();
    const provider = sentProvider();
    const results = [];
    for (let i = 0; i < 7; i += 1) {
      results.push(
        await subscribe(
          { ...BASE, email: `u${i}@example.com`, ip: '198.51.100.1' },
          deps(gateway, provider),
        ),
      );
    }
    // The 6th and 7th attempts within the window are limited (max 5).
    expect(results.filter((r) => r.status === 'rate_limited').length).toBeGreaterThanOrEqual(2);
  });

  it('blocks when Turnstile is configured and fails', async () => {
    const gateway = fakeNewsletterGateway();
    const outcome = await subscribe(
      { ...BASE, email: 'x@example.com' },
      {
        gateway,
        provider: sentProvider(),
        verify: () => Promise.resolve({ ok: false as const, reason: 'bad' }),
      },
    );
    expect(outcome).toEqual({ status: 'blocked', reason: 'bad' });
    expect(gateway.subscribers).toHaveLength(0);
  });

  it('still returns ok when Resend is not configured, and logs the send failure', async () => {
    // This is the "optional provider absent" degradation path: signup is captured, the
    // confirmation email is a clean not_configured, and the person is never told the
    // account is broken. Nothing about the list is lost until Resend is set up.
    const gateway = fakeNewsletterGateway();
    const provider = notConfiguredProvider();
    const outcome = await subscribe(
      { ...BASE, email: 'later@example.com' },
      deps(gateway, provider),
    );
    expect(outcome).toEqual({ status: 'ok' });
    expect(gateway.subscribers).toHaveLength(1);
    expect(gateway.sendFailures.some((row) => row.level === 'warn')).toBe(true);
  });
});
