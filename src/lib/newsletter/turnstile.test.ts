/**
 * Turnstile verification, including its deliberate degrade-when-unconfigured behaviour.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { verifyTurnstile } from './turnstile';

function jsonFetch(body: unknown, status = 200): typeof fetch {
  return () => Promise.resolve(new Response(JSON.stringify(body), { status }));
}

describe('verifyTurnstile', () => {
  afterEach(() => {
    delete process.env.TURNSTILE_SECRET_KEY;
  });

  it('skips (and says so) when no secret is configured', async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    const result = await verifyTurnstile(null, null, jsonFetch({}));
    expect(result).toEqual({ ok: true, skipped: true });
  });

  it('rejects a missing token when a secret IS configured', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    const result = await verifyTurnstile(null, null, jsonFetch({ success: true }));
    expect(result).toEqual({ ok: false, reason: 'missing_token' });
  });

  it('passes a valid token', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    const result = await verifyTurnstile('tok', '203.0.113.1', jsonFetch({ success: true }));
    expect(result).toEqual({ ok: true, skipped: false });
  });

  it('rejects an invalid token with the provider error codes', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    const result = await verifyTurnstile(
      'tok',
      null,
      jsonFetch({ success: false, 'error-codes': ['bad'] }),
    );
    expect(result).toEqual({ ok: false, reason: 'bad' });
  });

  it('fails closed when the verification service is unreachable', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    const throwing = (() => Promise.reject(new Error('down'))) as unknown as typeof fetch;
    const result = await verifyTurnstile('tok', null, throwing);
    expect(result.ok).toBe(false);
  });
});
