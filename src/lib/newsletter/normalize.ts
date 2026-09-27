/**
 * Email normalisation, in lockstep with `internal.normalize_email`.
 *
 * The database generates `subscribers.email_normalized` from that SQL function, and it is a
 * UNIQUE column. This is the TypeScript twin used to look a subscriber up by their normalised
 * address before insertion. The two MUST agree character for character: if this folded an
 * address differently from the column, a lookup would miss an existing row and the insert
 * would then hit the unique constraint — a confusing failure for what is really "already
 * subscribed". So the rules here mirror the SQL exactly:
 *
 *   lowercase and trim; strip a "+tag" subaddress everywhere; and for Gmail/Googlemail only,
 *   drop dots in the local part and canonicalise the domain to gmail.com. Dots are
 *   significant at other providers, so folding them everywhere would merge different people.
 */

export function normalizeEmailAddress(input: string): string {
  const lowered = input.trim().toLowerCase();
  const at = lowered.indexOf('@');
  if (at === -1) return lowered;

  let local = lowered.slice(0, at);
  let domain = lowered.slice(at + 1);

  // Subaddressing: keep everything before the first '+'.
  const plus = local.indexOf('+');
  if (plus !== -1) local = local.slice(0, plus);

  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.replace(/\./g, '');
    domain = 'gmail.com';
  }

  return `${local}@${domain}`;
}
