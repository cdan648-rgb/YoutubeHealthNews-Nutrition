/**
 * Confirmation and unsubscription, against the fake newsletter gateway.
 *
 * The two properties that matter: both are token-verified in constant time (a guessed id
 * alone does nothing), and both are idempotent (a double click reports success, never an
 * error). Confirmation also distinguishes an expired link so the page can offer to resend.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkUnsubscribeToken, confirmSubscription, unsubscribe } from './lifecycle';
import { generateToken, hashToken, signSubscriberToken, unsubscribeTokenHash } from './tokens';
import { fakeNewsletterGateway } from '../../../tests/helpers/fake-newsletter-gateway';

const NOW = new Date('2026-09-28T00:00:00Z');

beforeEach(() => {
  process.env.NEWSLETTER_TOKEN_SECRET = 'secret';
});
afterEach(() => {
  delete process.env.NEWSLETTER_TOKEN_SECRET;
});

describe('confirmSubscription', () => {
  function pendingGateway(token: string, expires: string) {
    return fakeNewsletterGateway([
      {
        id: 'p1',
        email: 'p@example.com',
        status: 'pending',
        confirmTokenHash: hashToken(token),
        confirmExpiresAt: expires,
      },
    ]);
  }

  it('confirms a pending subscriber and burns the token', async () => {
    const token = generateToken();
    const gateway = pendingGateway(token, '2026-10-01T00:00:00Z');
    const outcome = await confirmSubscription(token, gateway, () => NOW);
    expect(outcome).toBe('confirmed');
    const row = gateway.subscribers[0];
    expect(row?.status).toBe('active');
    expect(row?.confirmedAt).toBe(NOW.toISOString());
    expect(row?.confirmTokenHash).toBeNull();
  });

  it('is idempotent: a second confirm of a now-active row is not an error', async () => {
    const token = generateToken();
    const gateway = pendingGateway(token, '2026-10-01T00:00:00Z');
    await confirmSubscription(token, gateway, () => NOW);
    // The token was burned, so the second attempt no longer matches any pending row.
    const second = await confirmSubscription(token, gateway, () => NOW);
    expect(second).toBe('invalid');
    expect(gateway.subscribers[0]?.status).toBe('active');
  });

  it('reports an expired link distinctly', async () => {
    const token = generateToken();
    const gateway = pendingGateway(token, '2026-09-01T00:00:00Z'); // before NOW
    expect(await confirmSubscription(token, gateway, () => NOW)).toBe('expired');
  });

  it('rejects an unknown token', async () => {
    const gateway = pendingGateway(generateToken(), '2026-10-01T00:00:00Z');
    expect(await confirmSubscription('wrong-token', gateway, () => NOW)).toBe('invalid');
  });
});

describe('unsubscribe', () => {
  function activeGateway() {
    return fakeNewsletterGateway([
      {
        id: 'sub-1',
        email: 'a@example.com',
        status: 'active',
        unsubscribeTokenHash: unsubscribeTokenHash('sub-1'),
      },
    ]);
  }

  it('unsubscribes with a valid signed token', async () => {
    const gateway = activeGateway();
    const outcome = await unsubscribe('sub-1', signSubscriberToken('sub-1'), gateway, () => NOW);
    expect(outcome).toBe('unsubscribed');
    const row = gateway.subscribers[0];
    expect(row?.status).toBe('unsubscribed');
    expect(row?.unsubscribedAt).toBe(NOW.toISOString());
  });

  it('rejects a valid id with the wrong token (no IDOR)', async () => {
    const gateway = activeGateway();
    const outcome = await unsubscribe('sub-1', 'forged-token', gateway, () => NOW);
    expect(outcome).toBe('invalid');
    expect(gateway.subscribers[0]?.status).toBe('active');
  });

  it('is idempotent for an already-unsubscribed row', async () => {
    const gateway = activeGateway();
    const token = signSubscriberToken('sub-1');
    await unsubscribe('sub-1', token, gateway, () => NOW);
    expect(await unsubscribe('sub-1', token, gateway, () => NOW)).toBe('already_unsubscribed');
  });
});

describe('checkUnsubscribeToken', () => {
  it('validates without changing state', async () => {
    const gateway = fakeNewsletterGateway([
      {
        id: 'sub-1',
        email: 'a@example.com',
        status: 'active',
        unsubscribeTokenHash: unsubscribeTokenHash('sub-1'),
      },
    ]);
    expect(await checkUnsubscribeToken('sub-1', signSubscriberToken('sub-1'), gateway)).toBe(
      'valid',
    );
    expect(await checkUnsubscribeToken('sub-1', 'bad', gateway)).toBe('invalid');
    expect(gateway.subscribers[0]?.status).toBe('active');
  });
});
