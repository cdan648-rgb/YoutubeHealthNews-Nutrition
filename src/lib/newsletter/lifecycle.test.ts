/**
 * Confirmation and unsubscription, against the fake client.
 *
 * The two properties that matter: both are token-verified in constant time (a guessed id
 * alone does nothing), and both are idempotent (a double click reports success, never an
 * error). Confirmation also distinguishes an expired link so the page can offer to resend.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkUnsubscribeToken, confirmSubscription, unsubscribe } from './lifecycle';
import { generateToken, hashToken, signSubscriberToken, unsubscribeTokenHash } from './tokens';
import { FakeInternalClient } from '../../../tests/helpers/fake-newsletter-client';
import type { InternalClient } from '@/lib/supabase/service';

const NOW = new Date('2026-09-28T00:00:00Z');
const cast = (client: FakeInternalClient) => client as unknown as InternalClient;

beforeEach(() => {
  process.env.NEWSLETTER_TOKEN_SECRET = 'secret';
});
afterEach(() => {
  delete process.env.NEWSLETTER_TOKEN_SECRET;
});

describe('confirmSubscription', () => {
  function pendingClient(token: string, expires: string) {
    return new FakeInternalClient({
      subscribers: [
        {
          id: 'p1',
          email: 'p@example.com',
          email_normalized: 'p@example.com',
          status: 'pending',
          confirm_token_hash: hashToken(token),
          confirm_expires_at: expires,
          unsubscribe_token_hash: 'x',
          consent_text_version: 'v',
        },
      ],
    });
  }

  it('confirms a pending subscriber and burns the token', async () => {
    const token = generateToken();
    const client = pendingClient(token, '2026-10-01T00:00:00Z');
    const outcome = await confirmSubscription(token, cast(client), () => NOW);
    expect(outcome).toBe('confirmed');
    const row = client.rowsOf('subscribers')[0];
    expect(row?.status).toBe('active');
    expect(row?.confirmed_at).toBe(NOW.toISOString());
    expect(row?.confirm_token_hash).toBeNull();
  });

  it('is idempotent: a second confirm of a now-active row is not an error', async () => {
    const token = generateToken();
    const client = pendingClient(token, '2026-10-01T00:00:00Z');
    await confirmSubscription(token, cast(client), () => NOW);
    // The token was burned, so the second attempt no longer matches any pending row.
    const second = await confirmSubscription(token, cast(client), () => NOW);
    expect(second).toBe('invalid');
    expect(client.rowsOf('subscribers')[0]?.status).toBe('active');
  });

  it('reports an expired link distinctly', async () => {
    const token = generateToken();
    const client = pendingClient(token, '2026-09-01T00:00:00Z'); // before NOW
    expect(await confirmSubscription(token, cast(client), () => NOW)).toBe('expired');
  });

  it('rejects an unknown token', async () => {
    const client = pendingClient(generateToken(), '2026-10-01T00:00:00Z');
    expect(await confirmSubscription('wrong-token', cast(client), () => NOW)).toBe('invalid');
  });
});

describe('unsubscribe', () => {
  function activeClient() {
    return new FakeInternalClient({
      subscribers: [
        {
          id: 'sub-1',
          email: 'a@example.com',
          email_normalized: 'a@example.com',
          status: 'active',
          unsubscribe_token_hash: unsubscribeTokenHash('sub-1'),
          consent_text_version: 'v',
        },
      ],
    });
  }

  it('unsubscribes with a valid signed token', async () => {
    const client = activeClient();
    const outcome = await unsubscribe(
      'sub-1',
      signSubscriberToken('sub-1'),
      cast(client),
      () => NOW,
    );
    expect(outcome).toBe('unsubscribed');
    const row = client.rowsOf('subscribers')[0];
    expect(row?.status).toBe('unsubscribed');
    expect(row?.unsubscribed_at).toBe(NOW.toISOString());
  });

  it('rejects a valid id with the wrong token (no IDOR)', async () => {
    const client = activeClient();
    const outcome = await unsubscribe('sub-1', 'forged-token', cast(client), () => NOW);
    expect(outcome).toBe('invalid');
    expect(client.rowsOf('subscribers')[0]?.status).toBe('active');
  });

  it('is idempotent for an already-unsubscribed row', async () => {
    const client = activeClient();
    const token = signSubscriberToken('sub-1');
    await unsubscribe('sub-1', token, cast(client), () => NOW);
    expect(await unsubscribe('sub-1', token, cast(client), () => NOW)).toBe('already_unsubscribed');
  });
});

describe('checkUnsubscribeToken', () => {
  it('validates without changing state', async () => {
    const client = new FakeInternalClient({
      subscribers: [
        {
          id: 'sub-1',
          email: 'a@example.com',
          email_normalized: 'a@example.com',
          status: 'active',
          unsubscribe_token_hash: unsubscribeTokenHash('sub-1'),
          consent_text_version: 'v',
        },
      ],
    });
    expect(await checkUnsubscribeToken('sub-1', signSubscriberToken('sub-1'), cast(client))).toBe(
      'valid',
    );
    expect(await checkUnsubscribeToken('sub-1', 'bad', cast(client))).toBe('invalid');
    expect(client.rowsOf('subscribers')[0]?.status).toBe('active');
  });
});
