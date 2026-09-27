/**
 * Vietnamese-aware slug and fingerprint helpers.
 *
 * These MUST agree character-for-character with their SQL counterparts
 * `internal.fold_vietnamese` and `internal.title_fingerprint`, because a title
 * fingerprint computed here is compared against one computed by a generated column
 * in Postgres. The same mapping table is therefore asserted on both sides: see
 * `src/lib/slug.test.ts` and `supabase/tests/01_schema_helpers_and_seeds.sql`,
 * which use identical inputs and expectations.
 *
 * Note we do NOT use String.normalize('NFD') + combining-mark stripping. That
 * approach also folds `đ` incorrectly (it has no decomposition) and would diverge
 * from the SQL `translate()` mapping. An explicit table is less clever and
 * verifiably identical across the two languages.
 */

/** Source characters, in the same order as the SQL `translate()` call. */
const VIETNAMESE_SOURCE =
  'áàảãạăắằẳẵặâấầẩẫậ' +
  'éèẻẽẹêếềểễệ' +
  'íìỉĩị' +
  'óòỏõọôốồổỗộơớờởỡợ' +
  'úùủũụưứừửữự' +
  'ýỳỷỹỵ' +
  'đ';

/** Replacement characters, positionally aligned with VIETNAMESE_SOURCE. */
const VIETNAMESE_TARGET =
  'aaaaaaaaaaaaaaaaa' +
  'eeeeeeeeeee' +
  'iiiii' +
  'ooooooooooooooooo' +
  'uuuuuuuuuuu' +
  'yyyyy' +
  'd';

const FOLD_MAP: ReadonlyMap<string, string> = new Map(
  [...VIETNAMESE_SOURCE].map((char, index) => [char, VIETNAMESE_TARGET[index] ?? char]),
);

/* istanbul ignore next -- a mismatch here is a programming error, caught at import */
if (VIETNAMESE_SOURCE.length !== VIETNAMESE_TARGET.length) {
  throw new Error('Vietnamese fold table is misaligned: source and target lengths differ');
}

/**
 * Lowercase and strip Vietnamese diacritics, including `đ` → `d`.
 * Equivalent to SQL `internal.fold_vietnamese`.
 */
export function foldVietnamese(input: string): string {
  let out = '';
  for (const char of input.toLowerCase()) {
    out += FOLD_MAP.get(char) ?? char;
  }
  return out;
}

/**
 * Normalised comparison form of a title, used for soft duplicate detection.
 * Equivalent to SQL `internal.title_fingerprint`.
 */
export function titleFingerprint(input: string): string {
  return foldVietnamese(input)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * A URL slug: folded, hyphenated, and matching the database CHECK constraint
 * `^[a-z0-9]+(-[a-z0-9]+)*$`.
 *
 * `maxLength` trims on a word boundary so a slug never ends mid-syllable, which
 * matters for readability in Vietnamese where a trailing fragment reads as a
 * different word.
 */
export function slugify(input: string, maxLength = 80): string {
  const base = titleFingerprint(input).replace(/\s+/g, '-');
  if (base.length <= maxLength) return base;

  const trimmed = base.slice(0, maxLength);
  const lastHyphen = trimmed.lastIndexOf('-');
  return (lastHyphen > 0 ? trimmed.slice(0, lastHyphen) : trimmed).replace(/-+$/, '');
}

/** Whether a string satisfies the database's slug CHECK constraint. */
export function isValidSlug(value: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value);
}

/**
 * Episode number from a channel title, e.g. "Số 133: …" → 133.
 *
 * The channel is inconsistent about placement — most titles lead with "Số 133:"
 * but some trail with "… Số 126" — so the number is matched anywhere. Returns null
 * when there is no episode marker, which is normal for the channel's older
 * non-numbered videos.
 */
export function extractEpisodeNumber(title: string): number | null {
  const match = /\bs(?:ố|o)\s*(\d{1,4})\b/i.exec(foldVietnamese(title));
  if (!match?.[1]) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
