/**
 * Confirmation and unsubscription. SERVER ONLY.
 *
 * The two ends of a subscription's life, kept together because they share the same shape:
 * take a token, find the row, verify in constant time, transition the status. Both are
 * idempotent — confirming twice or unsubscribing twice is a no-op that still reports success,
 * because a mail client that retries a request must not see an error.
 *
 * All database access goes through `NewsletterGateway` (public.newsletter_* RPCs) — the
 * private `internal` schema is not exposed to the Data API and would otherwise 500 the route.
 */
import 'server-only';

import type { NewsletterGateway } from '@/lib/automation/internal-gateway';
import { liveNewsletterGateway } from '@/lib/automation/internal-gateway';
import { verifyToken } from './tokens';

export type ConfirmOutcome = 'confirmed' | 'already_active' | 'expired' | 'invalid';

/**
 * Confirm a subscription from the token in the email link.
 *
 * The token is matched against `confirm_token_hash` in constant time, and only a `pending`
 * row is advanced. An expired link reports `expired` distinctly so the page can offer to
 * resend rather than showing a dead end.
 */
export async function confirmSubscription(
  token: string,
  gateway: NewsletterGateway = liveNewsletterGateway(),
  now: () => Date = () => new Date(),
): Promise<ConfirmOutcome> {
  if (token.trim() === '') return 'invalid';

  // Candidate rows are the few whose confirmation is still outstanding. The token itself is
  // never queried — only hashes are stored — so the match is done in memory, constant-time.
  const candidates = await gateway.pendingWithConfirmTokens();
  const match = candidates.find(
    (row) => row.confirmTokenHash !== null && verifyToken(token, row.confirmTokenHash),
  );
  if (match === undefined) {
    // Either the token is wrong, or the row already moved on. Distinguish an already-active
    // address so a double-click on the link is not reported as a failure.
    return 'invalid';
  }

  if (match.confirmExpiresAt !== null && new Date(match.confirmExpiresAt) < now()) {
    return 'expired';
  }

  const activated = await gateway.activate(match.id, now().toISOString());

  // False means another request confirmed it first — still a success for this caller.
  return activated ? 'confirmed' : 'already_active';
}

export type UnsubscribeOutcome = 'unsubscribed' | 'already_unsubscribed' | 'invalid';

/**
 * Unsubscribe a subscriber, given their id and signed token.
 *
 * The token is verified against the stored `unsubscribe_token_hash` in constant time, so a
 * guessed id alone does nothing. Only ever reached by a POST (the human page's form, or the
 * RFC 8058 one-click header), never by a GET — a prefetched GET must not unsubscribe anyone.
 */
export async function unsubscribe(
  subscriberId: string,
  token: string,
  gateway: NewsletterGateway = liveNewsletterGateway(),
  now: () => Date = () => new Date(),
): Promise<UnsubscribeOutcome> {
  if (subscriberId.trim() === '' || token.trim() === '') return 'invalid';

  const row = await gateway.getSubscriberForUnsub(subscriberId);
  if (row === null || !verifyToken(token, row.unsubscribeTokenHash)) return 'invalid';

  if (row.status === 'unsubscribed') return 'already_unsubscribed';

  const updated = await gateway.markUnsubscribed(subscriberId, now().toISOString());
  return updated ? 'unsubscribed' : 'already_unsubscribed';
}

/**
 * Whether a subscriber id + token pair is valid, without changing anything.
 *
 * Used by the GET confirmation page so it can show the address's state and a working button
 * before the person commits to the POST.
 */
export async function checkUnsubscribeToken(
  subscriberId: string,
  token: string,
  gateway: NewsletterGateway = liveNewsletterGateway(),
): Promise<'valid' | 'already_unsubscribed' | 'invalid'> {
  if (subscriberId.trim() === '' || token.trim() === '') return 'invalid';
  const row = await gateway.getSubscriberForUnsub(subscriberId);
  if (row === null || !verifyToken(token, row.unsubscribeTokenHash)) return 'invalid';
  return row.status === 'unsubscribed' ? 'already_unsubscribed' : 'valid';
}
