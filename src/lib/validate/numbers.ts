/**
 * Numeric traceability.
 *
 * The single highest-value check in the gate. A language model asked to write about health
 * will happily produce a plausible statistic that appears nowhere in its input, and a
 * fabricated number is far more damaging than fabricated prose because readers treat it as
 * evidence. So every number in a generated article must be traceable to the source
 * description or to a verified reference, or the article fails.
 *
 * Two hard-won details shape the implementation.
 *
 * First, the detector must be Unicode-aware. JavaScript's `\b` is ASCII-only, so
 * `/\d+\s*g\b/` matches "126 gọi" — the boundary falls between "g" and "ọ" because "ọ" is
 * not an ASCII word character. A naive dosage or unit check therefore flags ordinary
 * Vietnamese prose. Every pattern here ends in a `\p{L}` lookahead.
 *
 * Second, a bare multiplier is as dangerous as a dosage. The source channel's own
 * description of the breathing episode claims a clearance effect "gấp 15 lần" — fifteen
 * times stronger. A units-only check waves that straight through, which is exactly the
 * failure this module exists to prevent.
 */

/** Units that make a number a measurement rather than a count. */
const UNITS = [
  'mg',
  'mcg',
  'µg',
  'g',
  'kg',
  'ml',
  'l',
  'IU',
  'đơn vị',
  'lần',
  '%',
  'phút',
  'giờ',
  'ngày',
  'tuần',
  'tháng',
  'năm',
  'tuổi',
  'calo',
  'kcal',
] as const;

const UNIT_PATTERN = new RegExp(
  String.raw`(\d+(?:[.,]\d+)?)\s*(${UNITS.join('|')})(?![\p{L}\d])`,
  'giu',
);

/** Any number of two digits or more, which is where invented statistics live. */
const BARE_NUMBER_PATTERN = /(?<![\p{L}\d.,])(\d{2,}(?:[.,]\d+)?)(?![\p{L}\d])/gu;

/**
 * Spelled-out multipliers. Vietnamese expresses these as words at least as often as
 * digits, so a digit-only check misses half of them.
 */
const WORD_MULTIPLIERS = [
  'gấp đôi',
  'gấp ba',
  'gấp bốn',
  'gấp năm',
  'gấp mười',
  'một nửa',
  'hai lần',
  'ba lần',
  'phân nửa',
] as const;

export type NumericClaim = {
  /** The numeral or phrase as written. */
  readonly text: string;
  /** Normalised for comparison: decimal separator unified, whitespace collapsed. */
  readonly normalised: string;
  readonly kind: 'measurement' | 'bare' | 'word-multiplier';
};

/** Normalise so "1.500" and "1,500" compare equal; Vietnamese uses both conventions. */
function normaliseNumber(value: string): string {
  return value.replace(/[.,]/g, '').trim().toLowerCase();
}

/** Every numeric claim in a piece of text. */
export function extractNumericClaims(text: string): NumericClaim[] {
  const claims: NumericClaim[] = [];
  const seen = new Set<string>();

  const add = (raw: string, kind: NumericClaim['kind']) => {
    const normalised = kind === 'word-multiplier' ? raw.toLowerCase() : normaliseNumber(raw);
    const key = `${kind}:${normalised}`;
    if (normalised === '' || seen.has(key)) return;
    seen.add(key);
    claims.push({ text: raw.trim(), normalised, kind });
  };

  for (const match of text.matchAll(UNIT_PATTERN)) {
    if (match[1] !== undefined) add(match[1], 'measurement');
  }
  for (const match of text.matchAll(BARE_NUMBER_PATTERN)) {
    if (match[1] !== undefined) add(match[1], 'bare');
  }
  for (const phrase of WORD_MULTIPLIERS) {
    if (text.toLowerCase().includes(phrase)) add(phrase, 'word-multiplier');
  }

  return claims;
}

/**
 * Numbers that need no source.
 *
 * Deliberately narrow. Years, the breathing counts that name the technique, and small
 * ordinals are structural rather than evidential; anything else must be traceable.
 */
const ALLOWED_WITHOUT_SOURCE = new Set([
  // Recent and near-future years, which appear as dates rather than findings.
  ...Array.from({ length: 12 }, (_, i) => String(2018 + i)),
  // "Thở 4-7-8" — the numbers are the technique's name, and the source says them.
  '478',
]);

export type TraceabilityResult = {
  readonly untraceable: readonly NumericClaim[];
  readonly checked: number;
};

/**
 * Check every numeric claim in `body` against the permitted sources.
 *
 * `sources` is normally the cleaned video description plus the text of every verified
 * reference. A claim counts as traceable when its normalised form appears in any of them,
 * which is deliberately lenient about surrounding wording and strict about the number
 * itself: we are checking provenance, not phrasing.
 */
export function checkNumericTraceability(
  body: string,
  sources: readonly string[],
): TraceabilityResult {
  const haystack = sources.map((source) => source.toLowerCase()).join('\n');
  const normalisedHaystack = normaliseNumber(haystack);
  const claims = extractNumericClaims(body);
  const untraceable: NumericClaim[] = [];

  for (const claim of claims) {
    if (ALLOWED_WITHOUT_SOURCE.has(claim.normalised)) continue;

    const found =
      claim.kind === 'word-multiplier'
        ? haystack.includes(claim.normalised)
        : // Compare against both the raw and digit-stripped haystack so "1.500" in the
          // body matches "1500" in the source and vice versa.
          haystack.includes(claim.normalised) || normalisedHaystack.includes(claim.normalised);

    if (!found) untraceable.push(claim);
  }

  return { untraceable, checked: claims.length };
}
