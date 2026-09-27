/**
 * Email normalisation must agree with `internal.normalize_email` exactly.
 *
 * The database generates the unique `email_normalized` column from that SQL; this TS twin is
 * used to look a subscriber up before insert. If they disagreed, a lookup would miss and the
 * insert would then hit the unique constraint — "already subscribed" surfacing as an error.
 * These cases mirror the SQL's documented behaviour.
 */
import { describe, expect, it } from 'vitest';
import { normalizeEmailAddress } from './normalize';

describe('normalizeEmailAddress', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmailAddress('  A.B@Example.COM ')).toBe('a.b@example.com');
  });

  it('strips a +tag subaddress at every provider', () => {
    expect(normalizeEmailAddress('user+news@example.com')).toBe('user@example.com');
    expect(normalizeEmailAddress('user+a+b@example.com')).toBe('user@example.com');
  });

  it('folds Gmail dots and canonicalises googlemail.com', () => {
    expect(normalizeEmailAddress('a.b.c@gmail.com')).toBe('abc@gmail.com');
    expect(normalizeEmailAddress('a.b@googlemail.com')).toBe('ab@gmail.com');
    expect(normalizeEmailAddress('a.b+tag@gmail.com')).toBe('ab@gmail.com');
  });

  it('keeps dots significant at non-Gmail providers', () => {
    expect(normalizeEmailAddress('a.b@example.com')).toBe('a.b@example.com');
  });

  it('leaves an address with no @ untouched but lowercased', () => {
    expect(normalizeEmailAddress('NOT-AN-EMAIL')).toBe('not-an-email');
  });
});
