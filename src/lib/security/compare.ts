/**
 * Constant-time string comparison for shared secrets.
 *
 * `a === b` on a secret leaks its length and, in principle, its prefix through timing. The
 * exposure through an HTTP handler is small but the fix is three lines, so there is no
 * reason to accept it.
 *
 * Lengths are compared through the digest rather than up front: hashing first means even the
 * length comparison is constant-time with respect to the secret.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

export function timingSafeEqualString(left: string, right: string): boolean {
  // Equal-length digests, so timingSafeEqual never throws on a length mismatch.
  const a = createHash('sha256').update(left, 'utf8').digest();
  const b = createHash('sha256').update(right, 'utf8').digest();
  return timingSafeEqual(a, b);
}
