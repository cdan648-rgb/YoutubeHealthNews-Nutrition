/**
 * Ranking eligible papers.
 *
 * What this is NOT: a claim that the highest-scoring paper is the most important, the most
 * popular, or the best science. There is no such ranking, and asserting one would be
 * dishonest — so the score is an explicit, weighted editorial preference, every component
 * is stored alongside the number in `research_sources.score_components`, and the ranked
 * position and pool size are stored with it. Anyone can later see exactly why a paper was
 * chosen and disagree with the weights.
 *
 * Five components, each normalised to 0–1 before weighting:
 *
 *   recency            0.30  a health site reports new work; half-life 120 days
 *   journalTier        0.25  from automation_settings.journal_tiers, editable without a deploy
 *   citationVelocity   0.20  citations per month, log-compressed
 *   topicalFit         0.20  overlap with the seeded category keywords
 *   accessibility      0.05  a reader can actually open an open-access paper
 *
 * Two deliberate properties. Citation velocity is compressed hard, because a linear reading
 * would let one much-cited paper dominate every other consideration for months — and a
 * citation count is partly a measure of age and of field size, not only of quality. And an
 * unknown citation count scores as the neutral midpoint rather than as zero, so a provider
 * that does not report counts (PubMed's esummary does not) is not silently penalised.
 */
import type { ResearchCandidate } from './types';

export const WEIGHTS = {
  recency: 0.3,
  journalTier: 0.25,
  citationVelocity: 0.2,
  topicalFit: 0.2,
  accessibility: 0.05,
} as const;

export type ComponentName = keyof typeof WEIGHTS;

/** Journal tiers as stored in `internal.automation_settings.journal_tiers`. */
export type JournalTiers = {
  readonly tier2?: readonly string[];
  readonly tier3?: readonly string[];
  readonly default?: number;
};

export type ScoreComponent = {
  /** The measured input, before normalisation. Kept so the number can be re-derived. */
  readonly raw: number | string | boolean | null;
  readonly normalized: number;
  readonly weight: number;
  readonly contribution: number;
  readonly note?: string;
};

export type ScoreBreakdown = {
  readonly total: number;
  readonly components: Readonly<Record<ComponentName, ScoreComponent>>;
  /** How many eligible candidates this paper was compared against. */
  readonly poolSize: number;
  /** 1-based position after sorting. Recorded because "rank 1 of 3" and "1 of 40" differ. */
  readonly rank: number;
  readonly scoredAt: string;
  /** Stated in the stored record so the reading of it is never left to the reader. */
  readonly disclaimer: string;
};

const DISCLAIMER =
  'Editorial preference score, not a measure of scientific importance. Weighted sum of recency, journal tier, citation velocity, topical fit and accessibility; weights are ours and are configurable.';

/** Days between two ISO dates. Both are plain dates, so no timezone is involved. */
function daysBetween(fromDate: string, toDate: string): number {
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return Number.NaN;
  return Math.round((to - from) / 86_400_000);
}

/** Exponential decay, half its value every 120 days. 0 days → 1.0, 120 → 0.5, 365 → ~0.12. */
export function recencyScore(publicationDate: string | null, today: string): ScoreComponent {
  const weight = WEIGHTS.recency;
  if (publicationDate === null) {
    return { raw: null, normalized: 0, weight, contribution: 0, note: 'no publication date' };
  }
  const age = daysBetween(publicationDate, today);
  if (Number.isNaN(age)) {
    return { raw: publicationDate, normalized: 0, weight, contribution: 0, note: 'unparseable' };
  }
  const normalized = Math.min(1, Math.max(0, 2 ** (-Math.max(0, age) / 120)));
  return { raw: age, normalized, weight, contribution: normalized * weight, note: 'days old' };
}

/** Fold a journal name for comparison: case, punctuation and a leading article. */
function foldJournal(name: string): string {
  return name
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Journal tier.
 *
 * Matched on the folded name rather than the ISSN because the configured list is
 * human-edited and names are what an operator can be expected to type correctly. Tier 3
 * scores 1.0, tier 2 scores 0.6, everything else takes the configured default — 1 of 3,
 * i.e. 0.33 — so an unlisted journal is ranked below a listed one without being excluded.
 */
export function journalTierScore(
  journal: string | null,
  tiers: JournalTiers | null,
): ScoreComponent {
  const weight = WEIGHTS.journalTier;
  const fallbackTier = tiers?.default ?? 1;

  if (journal === null || journal.trim() === '') {
    const normalized = fallbackTier / 3;
    return { raw: null, normalized, weight, contribution: normalized * weight, note: 'no journal' };
  }

  const folded = foldJournal(journal);
  const matches = (list: readonly string[] | undefined) =>
    (list ?? []).some((entry) => foldJournal(entry) === folded);

  const tier = matches(tiers?.tier3) ? 3 : matches(tiers?.tier2) ? 2 : fallbackTier;
  const normalized = Math.min(1, Math.max(0, tier / 3));
  return {
    raw: journal,
    normalized,
    weight,
    contribution: normalized * weight,
    note: `tier ${tier}`,
  };
}

/**
 * Citations per month since publication, log-compressed.
 *
 * `log10(1 + velocity) / log10(21)` saturates at 20 citations/month, which is exceptional.
 * A null count is unknown rather than zero and scores 0.5 — see the note at the top.
 */
export function citationVelocityScore(
  citedByCount: number | null,
  publicationDate: string | null,
  today: string,
): ScoreComponent {
  const weight = WEIGHTS.citationVelocity;
  if (citedByCount === null || publicationDate === null) {
    return {
      raw: null,
      normalized: 0.5,
      weight,
      contribution: 0.5 * weight,
      note: 'unknown; scored as neutral, not zero',
    };
  }
  const months = Math.max(1, daysBetween(publicationDate, today) / 30.44);
  const velocity = citedByCount / months;
  const normalized = Math.min(1, Math.log10(1 + velocity) / Math.log10(21));
  return {
    raw: Number(velocity.toFixed(3)),
    normalized,
    weight,
    contribution: normalized * weight,
    note: 'citations per month',
  };
}

/** Fold Vietnamese and English text to bare comparison tokens. */
function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length > 3),
  );
}

/**
 * Topical fit against the seeded category keywords.
 *
 * The fraction of distinct category keywords that appear in the title, abstract or provider
 * keywords, saturating at a quarter of them — requiring more than that would reward papers
 * that happen to sprawl across our whole taxonomy rather than papers that fit one part of it
 * well. A candidate matching nothing scores 0, which in practice excludes it.
 */
export function topicalFitScore(
  candidate: ResearchCandidate,
  categoryKeywords: readonly string[],
): ScoreComponent {
  const weight = WEIGHTS.topicalFit;
  const wanted = [
    ...new Set(categoryKeywords.map((keyword) => keyword.toLowerCase().trim())),
  ].filter((keyword) => keyword !== '');
  if (wanted.length === 0) {
    return {
      raw: null,
      normalized: 0.5,
      weight,
      contribution: 0.5 * weight,
      note: 'no keywords configured',
    };
  }

  const haystack = [candidate.title, candidate.abstract ?? '', ...candidate.keywords]
    .join(' ')
    .toLowerCase();
  const haystackTokens = tokens(haystack);

  const matched = wanted.filter((keyword) =>
    keyword.includes(' ')
      ? haystack.includes(keyword)
      : // Token equality for single words, so "magie" does not match "magiestrasse".
        haystackTokens.has(keyword),
  );

  const saturation = Math.max(1, Math.ceil(wanted.length / 4));
  const normalized = Math.min(1, matched.length / saturation);
  return {
    raw: matched.length,
    normalized,
    weight,
    contribution: normalized * weight,
    note: `${matched.length}/${wanted.length} keywords; saturates at ${saturation}`,
  };
}

/** Open access means the reader can check the source themselves. Small weight, real value. */
export function accessibilityScore(isOpenAccess: boolean | null): ScoreComponent {
  const weight = WEIGHTS.accessibility;
  const normalized = isOpenAccess === true ? 1 : isOpenAccess === false ? 0 : 0.5;
  return {
    raw: isOpenAccess,
    normalized,
    weight,
    contribution: normalized * weight,
    note: isOpenAccess === null ? 'unknown' : isOpenAccess ? 'open access' : 'paywalled',
  };
}

export type ScoreContext = {
  readonly today: string;
  readonly journalTiers: JournalTiers | null;
  readonly categoryKeywords: readonly string[];
};

export type ScoredCandidate = {
  readonly candidate: ResearchCandidate;
  readonly score: number;
  readonly breakdown: ScoreBreakdown;
};

function round(value: number): number {
  return Number(value.toFixed(6));
}

/** Score one candidate. `poolSize` and `rank` are filled in by `rankCandidates`. */
export function scoreCandidate(
  candidate: ResearchCandidate,
  context: ScoreContext,
): Omit<ScoredCandidate, 'breakdown'> & {
  readonly breakdown: Omit<ScoreBreakdown, 'poolSize' | 'rank'>;
} {
  const components = {
    recency: recencyScore(candidate.publicationDate, context.today),
    journalTier: journalTierScore(candidate.journal, context.journalTiers),
    citationVelocity: citationVelocityScore(
      candidate.citedByCount,
      candidate.publicationDate,
      context.today,
    ),
    topicalFit: topicalFitScore(candidate, context.categoryKeywords),
    accessibility: accessibilityScore(candidate.isOpenAccess),
  } as const;

  const total = round(
    Object.values(components).reduce((sum, component) => sum + component.contribution, 0),
  );

  return {
    candidate,
    score: total,
    breakdown: { total, components, scoredAt: context.today, disclaimer: DISCLAIMER },
  };
}

/**
 * Rank every candidate, highest first.
 *
 * Ties break on publication date and then on title, so the ordering is total and the same
 * input always produces the same output. A non-deterministic ranking would make the
 * "highest score was chosen" assertion untestable.
 */
export function rankCandidates(
  candidates: readonly ResearchCandidate[],
  context: ScoreContext,
): readonly ScoredCandidate[] {
  const scored = candidates.map((candidate) => scoreCandidate(candidate, context));

  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    const rightDate = right.candidate.publicationDate ?? '';
    const leftDate = left.candidate.publicationDate ?? '';
    if (rightDate !== leftDate) return rightDate < leftDate ? -1 : 1;
    return left.candidate.title.localeCompare(right.candidate.title);
  });

  return scored.map((entry, index) => ({
    candidate: entry.candidate,
    score: entry.score,
    breakdown: { ...entry.breakdown, poolSize: scored.length, rank: index + 1 },
  }));
}
