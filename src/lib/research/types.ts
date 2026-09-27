/**
 * The normalised research candidate.
 *
 * Every provider maps its own response onto this one shape, so scoring, eligibility and
 * deduplication never need to know where a paper came from. The `provider` field is kept
 * for the audit trail rather than for logic.
 *
 * Deliberately close to `public.research_sources`: the claim step writes these fields
 * almost straight through, and the generated columns in the database (normalised DOI, URL
 * hash, title fingerprint) derive from them, so a candidate cannot carry an identifier
 * that disagrees with the key stored for it.
 */

export const PROVIDERS = ['europepmc', 'crossref', 'pubmed'] as const;
export type Provider = (typeof PROVIDERS)[number];

export type CandidateAuthor = {
  readonly name: string;
  readonly affiliation?: string;
};

export type ResearchCandidate = {
  readonly provider: Provider;
  readonly title: string;
  /** The text the article is written from. A candidate without one is ineligible. */
  readonly abstract: string | null;
  readonly doi: string | null;
  /** A landing page on a host the reference allowlist accepts. */
  readonly sourceUrl: string;
  readonly journal: string | null;
  readonly issn: string | null;
  /** ISO date. Partial provider dates are widened to the first of the month or year. */
  readonly publicationDate: string | null;
  /** Ordered — author order is meaningful in academic citation. */
  readonly authors: readonly CandidateAuthor[];
  readonly citedByCount: number | null;
  readonly isOpenAccess: boolean | null;
  readonly externalIds: { readonly pmid?: string; readonly pmcid?: string };
  /** Provider publication types, lower-cased. Used by the eligibility filter. */
  readonly publicationTypes: readonly string[];
  /** Provider keywords or MeSH terms. Feeds the topical-fit score. */
  readonly keywords: readonly string[];
  readonly language: string | null;
};

/**
 * A provider, as the selector sees it.
 *
 * One method, injected rather than imported, so the whole selection path runs offline in
 * tests against the recorded fixtures and the test suite makes no network request.
 */
export type CandidateProvider = {
  readonly name: Provider;
  search(input: CandidateQuery): Promise<readonly ResearchCandidate[]>;
};

export type CandidateQuery = {
  /** Topic terms, already quoted where they are phrases. */
  readonly terms: readonly string[];
  /** Inclusive ISO date bounds on publication. */
  readonly fromDate: string;
  readonly toDate: string;
  readonly limit: number;
};

/**
 * Normalise a DOI.
 *
 * Deliberately a character-for-character port of `internal.normalize_doi`, including its
 * lack of a shape check. That function generates `research_sources.doi_normalized`, which
 * is the unique key — so if this disagreed with it, the in-memory duplicate check and the
 * database constraint would classify the same pair of papers differently, and the
 * disagreement would only ever show up as a confusing "duplicate" that the pre-check
 * missed. A shape check belongs in eligibility, where it is `looksLikeDoi` below.
 */
export function normalizeDoi(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const stripped = raw
    .trim()
    .toLowerCase()
    .replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*|info:doi\/)/, '')
    .trim();
  return stripped === '' ? null : stripped;
}

/** Whether a normalised DOI has the registrant-prefix shape every real DOI has. */
export function looksLikeDoi(normalized: string | null): boolean {
  return normalized !== null && /^10\.\d{4,9}\/\S+$/.test(normalized);
}

/**
 * Widen a partial provider date to a full ISO date.
 *
 * Crossref gives `[2026]`, `[2026, 7]` or `[2026, 7, 20]`; PubMed gives `"2026 Mar"`. A
 * year-only date becomes 1 January, which makes the recency score pessimistic rather than
 * optimistic — the safe direction, since it never promotes an old paper.
 */
export function widenDate(parts: readonly number[]): string | null {
  const [year, month, day] = parts;
  if (year === undefined || year < 1500 || year > 2200) return null;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${year}-${pad(month ?? 1)}-${pad(day ?? 1)}`;
}
