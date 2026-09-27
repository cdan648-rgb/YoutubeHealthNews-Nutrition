/**
 * Token and consent-hashing primitives.
 *
 * These are the security core of the newsletter: a mistake here either lets a guessed link
 * work or stores a reversible IP. The tests pin the properties that matter — tokens are only
 * ever stored hashed, comparison is by digest, and the unsubscribe token is deterministic so
 * it can be rebuilt at send time.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  generateToken,
  hashIp,
  hashToken,
  signSubscriberToken,
  unsubscribeTokenHash,
  verifyToken,
} from './tokens';

describe('confirm/unsubscribe tokens', () => {
  it('generates distinct, URL-safe tokens', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThan(30);
  });

  it('verifies a token against its own hash and rejects others', () => {
    const token = generateToken();
    const hash = hashToken(token);
    expect(verifyToken(token, hash)).toBe(true);
    expect(verifyToken(generateToken(), hash)).toBe(false);
  });

  it('the stored hash is not the token', () => {
    const token = generateToken();
    expect(hashToken(token)).not.toBe(token);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a malformed stored hash without throwing', () => {
    expect(verifyToken('anything', 'not-hex')).toBe(false);
  });
});

describe('signed subscriber tokens', () => {
  beforeEach(() => {
    process.env.NEWSLETTER_TOKEN_SECRET = 'test-secret-value';
  });
  afterEach(() => {
    delete process.env.NEWSLETTER_TOKEN_SECRET;
  });

  it('is deterministic for a given id (so it can be rebuilt at send time)', () => {
    expect(signSubscriberToken('id-1')).toBe(signSubscriberToken('id-1'));
    expect(signSubscriberToken('id-1')).not.toBe(signSubscriberToken('id-2'));
  });

  it('the stored hash matches the token the link will carry', () => {
    const token = signSubscriberToken('id-1');
    expect(verifyToken(token, unsubscribeTokenHash('id-1'))).toBe(true);
  });

  it('changes with the secret, so a leaked hash is not portable', () => {
    const withA = signSubscriberToken('id-1');
    process.env.NEWSLETTER_TOKEN_SECRET = 'a-different-secret';
    expect(signSubscriberToken('id-1')).not.toBe(withA);
  });
});

describe('hashIp', () => {
  const OLD = process.env.IP_HASH_SALT;
  afterEach(() => {
    if (OLD === undefined) delete process.env.IP_HASH_SALT;
    else process.env.IP_HASH_SALT = OLD;
  });

  it('returns null when no salt is set — never a reversible plain hash', () => {
    delete process.env.IP_HASH_SALT;
    expect(hashIp('203.0.113.5')).toBeNull();
  });

  it('returns null for a null IP even with a salt', () => {
    process.env.IP_HASH_SALT = 'salt';
    expect(hashIp(null)).toBeNull();
  });

  it('is stable for one IP and differs across IPs', () => {
    process.env.IP_HASH_SALT = 'salt';
    expect(hashIp('203.0.113.5')).toBe(hashIp('203.0.113.5'));
    expect(hashIp('203.0.113.5')).not.toBe(hashIp('203.0.113.6'));
  });
});
