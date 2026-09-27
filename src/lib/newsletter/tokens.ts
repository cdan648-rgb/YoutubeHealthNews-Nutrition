/**
 * Newsletter tokens and consent hashing. SERVER ONLY.
 *
 * Two token kinds, both stored only as a SHA-256 digest so a leaked table yields no working
 * link:
 *
 *   confirm      single-use, short-lived, proves the address owner asked to subscribe
 *   unsubscribe  stable (it rides in every email), single-purpose, never expires
 *
 * The raw token is a 32-byte URL-safe random string. It exists only in the email and in the
 * request that comes back; the database never sees it. Verification hashes the incoming
 * token and compares digests in constant time — a plain `===` on a secret leaks its length
 * and prefix through timing, and the fix is three lines.
 *
 * Consent IPs are HMAC'd, not hashed. The whole IPv4 space brute-forces against a plain
 * SHA-256 in seconds, so a bare hash is not anonymisation; the HMAC key (`IP_HASH_SALT`)
 * lives in server env only.
 */
import 'server-only';

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** A 32-byte URL-safe random token. Base64url has no characters needing escaping in a URL. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** The stored form of a token. Only this is ever written to the database. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Constant-time comparison of a presented token against a stored digest.
 *
 * Hashing the candidate first means even the length comparison is constant-time with
 * respect to the stored secret. A malformed stored digest (wrong length) returns false
 * rather than throwing.
 */
export function verifyToken(candidate: string, storedHash: string): boolean {
  const candidateHash = createHash('sha256').update(candidate, 'utf8').digest();
  let stored: Buffer;
  try {
    stored = Buffer.from(storedHash, 'hex');
  } catch {
    return false;
  }
  if (stored.length !== candidateHash.length) return false;
  return timingSafeEqual(candidateHash, stored);
}

/**
 * HMAC of a client IP for the consent record and rate limiting.
 *
 * Returns null when no salt is configured rather than falling back to a plain hash: a
 * reversible "anonymised" IP is worse than storing nothing, because it looks safe and is
 * not. Callers treat null as "no IP evidence captured".
 */
export function hashIp(ip: string | null): string | null {
  const salt = process.env.IP_HASH_SALT;
  if (salt === undefined || salt === '' || ip === null || ip === '') return null;
  return createHmac('sha256', salt).update(ip, 'utf8').digest('hex');
}

/**
 * A stable, deterministic unsubscribe token for a subscriber.
 *
 * The unsubscribe link rides in every email and the database stores only its hash, so the
 * token cannot be random-and-discarded — it has to be reconstructable at send time. An HMAC
 * of the subscriber's id is exactly that: stable, unguessable without the key, and never
 * stored in the clear. The link carries the id plus this token; the route recomputes the
 * hash and compares. `unsubscribe_token_hash` on the row is `hashToken()` of this value.
 *
 * The key is `NEWSLETTER_TOKEN_SECRET`, falling back to `IP_HASH_SALT` so a single secret
 * suffices in simple deployments. The last-resort dev constant keeps local signup working
 * without any secret; it is never secure and a real secret must be set in production.
 */
function subscriberSecret(): string {
  return (
    process.env.NEWSLETTER_TOKEN_SECRET ??
    process.env.IP_HASH_SALT ??
    'dev-insecure-newsletter-secret-set-NEWSLETTER_TOKEN_SECRET'
  );
}

export function signSubscriberToken(subscriberId: string): string {
  return createHmac('sha256', subscriberSecret()).update(subscriberId, 'utf8').digest('base64url');
}

/** The stored hash for a subscriber's unsubscribe token. */
export function unsubscribeTokenHash(subscriberId: string): string {
  return hashToken(signSubscriberToken(subscriberId));
}

/** The consent-text version a signup agreed to. Bumped when the copy materially changes. */
export const CONSENT_TEXT_VERSION = '2026-09-v1';
