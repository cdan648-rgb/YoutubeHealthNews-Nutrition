/**
 * Confirmation and unsubscription. SERVER ONLY.
 *
 * The two ends of a subscription's life, kept together because they share the same shape:
 * take a token, find the row, verify in constant time, transition the status. Both are
 * idempotent — confirming twice or unsubscribing twice is a no-op that still reports success,
 * because a mail client that retries a request must not see an error.
 */
import 'server-only';

import type { InternalClient } from '@/lib/supabase/service';
import { internalClient } from '@/lib/supabase/service';
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
  client: InternalClient = internalClient(),
  now: () => Date = () => new Date(),
): Promise<ConfirmOutcome> {
  if (token.trim() === '') return 'invalid';

  // Candidate rows are the few whose confirmation is still outstanding. The token itself is
  // never queried — only hashes are stored — so the match is done in memory, constant-time.
  const { data, error } = await client
    .from('subscribers')
    .select('id, status, confirm_token_hash, confirm_expires_at')
    .eq('status', 'pending')
    .not('confirm_token_hash', 'is', null);
  if (error !== null) throw new Error(`confirm lookup failed: ${error.message}`);

  const match = (data ?? []).find(
    (row) => row.confirm_token_hash !== null && verifyToken(token, row.confirm_token_hash),
  );
  if (match === undefined) {
    // Either the token is wrong, or the row already moved on. Distinguish an already-active
    // address so a double-click on the link is not reported as a failure.
    return 'invalid';
  }

  if (match.confirm_expires_at !== null && new Date(match.confirm_expires_at) < now()) {
    return 'expired';
  }

  const update = await client
    .from('subscribers')
    .update({
      status: 'active',
      confirmed_at: now().toISOString(),
      subscribed_at: now().toISOString(),
      // Burn the confirmation token so the link cannot be replayed.
      confirm_token_hash: null,
    })
    .eq('id', match.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (update.error !== null) throw new Error(`confirm update failed: ${update.error.message}`);

  // A null result means another request confirmed it first — still a success for this caller.
  return update.data === null ? 'already_active' : 'confirmed';
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
  client: InternalClient = internalClient(),
  now: () => Date = () => new Date(),
): Promise<UnsubscribeOutcome> {
  if (subscriberId.trim() === '' || token.trim() === '') return 'invalid';

  const { data, error } = await client
    .from('subscribers')
    .select('id, status, unsubscribe_token_hash')
    .eq('id', subscriberId)
    .maybeSingle();
  if (error !== null) throw new Error(`unsubscribe lookup failed: ${error.message}`);
  if (data === null || !verifyToken(token, data.unsubscribe_token_hash)) return 'invalid';

  if (data.status === 'unsubscribed') return 'already_unsubscribed';

  const update = await client
    .from('subscribers')
    .update({ status: 'unsubscribed', unsubscribed_at: now().toISOString() })
    .eq('id', subscriberId)
    .neq('status', 'unsubscribed');
  if (update.error !== null) throw new Error(`unsubscribe update failed: ${update.error.message}`);
  return 'unsubscribed';
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
  client: InternalClient = internalClient(),
): Promise<'valid' | 'already_unsubscribed' | 'invalid'> {
  if (subscriberId.trim() === '' || token.trim() === '') return 'invalid';
  const { data } = await client
    .from('subscribers')
    .select('status, unsubscribe_token_hash')
    .eq('id', subscriberId)
    .maybeSingle();
  if (data === null || data === undefined || !verifyToken(token, data.unsubscribe_token_hash)) {
    return 'invalid';
  }
  return data.status === 'unsubscribed' ? 'already_unsubscribed' : 'valid';
}
