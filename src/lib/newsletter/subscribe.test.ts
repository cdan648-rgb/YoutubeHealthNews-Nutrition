/**
 * The signup use case, against the in-memory fake client.
 *
 * The properties under test are the ones a client-side insert could never guarantee: the
 * honeypot drops bots silently, the response is identical for known and unknown addresses
 * (no enumeration), an active address is never re-mailed, and the rate limit trips after the
 * configured burst.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { subscribe } from './subscribe';
import type { EmailProvider } from './provider';
import { FakeInternalClient } from '../../../tests/helpers/fake-newsletter-client';
import type { InternalClient } from '@/lib/supabase/service';

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

const BASE = {
  honeypot: null,
  turnstileToken: 'tok',
  ip: '203.0.113.9',
  userAgent: 'test',
  source: 'test',
} as const;

function deps(client: FakeInternalClient, provider: EmailProvider) {
  return {
    client: client as unknown as InternalClient,
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
  it('creates a pending subscriber and sends one confirmation for a new address', async () => {
    const client = new FakeInternalClient({ subscribers: [] });
    const provider = sentProvider();
    const outcome = await subscribe(
      { ...BASE, email: 'New.Person@example.com' },
      deps(client, provider),
    );

    expect(outcome).toEqual({ status: 'ok' });
    const rows = client.rowsOf('subscribers');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('pending');
    expect(rows[0]?.confirm_token_hash).toMatch(/^[0-9a-f]{64}$/);
    // The unsubscribe hash is set deterministically from the row id after insert.
    expect(rows[0]?.unsubscribe_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(provider.sends).toEqual(['new.person@example.com']);
  });

  it('drops a honeypot submission silently with a success-shaped answer', async () => {
    const client = new FakeInternalClient({ subscribers: [] });
    const provider = sentProvider();
    const outcome = await subscribe(
      { ...BASE, email: 'bot@example.com', honeypot: 'ACME Inc' },
      deps(client, provider),
    );
    expect(outcome).toEqual({ status: 'ok' });
    expect(client.rowsOf('subscribers')).toHaveLength(0);
    expect(provider.sends).toHaveLength(0);
  });

  it('rejects a malformed address', async () => {
    const client = new FakeInternalClient();
    const outcome = await subscribe(
      { ...BASE, email: 'not-an-email' },
      deps(client, sentProvider()),
    );
    expect(outcome.status).toBe('invalid');
  });

  it('gives the SAME neutral answer for an already-active address, and does not re-mail', async () => {
    const client = new FakeInternalClient({
      subscribers: [
        {
          id: 'existing',
          email: 'a@example.com',
          email_normalized: 'a@example.com',
          status: 'active',
          unsubscribe_token_hash: 'x',
          consent_text_version: 'v',
        },
      ],
    });
    const provider = sentProvider();
    const outcome = await subscribe({ ...BASE, email: 'a@example.com' }, deps(client, provider));

    expect(outcome).toEqual({ status: 'ok' });
    expect(provider.sends).toHaveLength(0); // no email to an already-confirmed address
  });

  it('re-arms confirmation for a pending address without creating a duplicate row', async () => {
    const client = new FakeInternalClient({
      subscribers: [
        {
          id: 'pending-1',
          email: 'p@example.com',
          email_normalized: 'p@example.com',
          status: 'pending',
          unsubscribe_token_hash: 'x',
          consent_text_version: 'v',
        },
      ],
    });
    const provider = sentProvider();
    await subscribe({ ...BASE, email: 'p@example.com' }, deps(client, provider));

    expect(client.rowsOf('subscribers')).toHaveLength(1);
    expect(provider.sends).toEqual(['p@example.com']);
  });

  it('treats a Gmail alias as the same person (no duplicate)', async () => {
    const client = new FakeInternalClient({
      subscribers: [
        {
          id: 'g',
          email: 'person@gmail.com',
          email_normalized: 'person@gmail.com',
          status: 'active',
          unsubscribe_token_hash: 'x',
          consent_text_version: 'v',
        },
      ],
    });
    const outcome = await subscribe(
      { ...BASE, email: 'p.e.r.s.o.n+news@gmail.com' },
      deps(client, sentProvider()),
    );
    expect(outcome).toEqual({ status: 'ok' });
    expect(client.rowsOf('subscribers')).toHaveLength(1);
  });

  it('rate-limits after the configured burst from one IP', async () => {
    const client = new FakeInternalClient({ subscribers: [] });
    const provider = sentProvider();
    const results = [];
    for (let i = 0; i < 7; i += 1) {
      results.push(
        await subscribe(
          { ...BASE, email: `u${i}@example.com`, ip: '198.51.100.1' },
          deps(client, provider),
        ),
      );
    }
    // The 6th and 7th attempts within the window are limited (max 5).
    expect(results.filter((r) => r.status === 'rate_limited').length).toBeGreaterThanOrEqual(2);
  });

  it('blocks when Turnstile is configured and fails', async () => {
    const client = new FakeInternalClient({ subscribers: [] });
    const outcome = await subscribe(
      { ...BASE, email: 'x@example.com' },
      {
        client: client as unknown as InternalClient,
        provider: sentProvider(),
        verify: () => Promise.resolve({ ok: false as const, reason: 'bad' }),
      },
    );
    expect(outcome).toEqual({ status: 'blocked', reason: 'bad' });
    expect(client.rowsOf('subscribers')).toHaveLength(0);
  });
});
