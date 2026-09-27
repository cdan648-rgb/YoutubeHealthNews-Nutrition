/**
 * Which papers may become an article at all.
 *
 * Scoring decides which of several acceptable papers to use. This decides what is
 * acceptable, and it runs first — a high score must never be able to rescue a paper that
 * should not be written about. Each rejection carries a stable reason code so a dry spell
 * can be explained from `job_logs` without re-running anything.
 */
import type { ResearchCandidate } from './types';
import { looksLikeDoi } from './types';

/** An abstract shorter than this cannot support a 700-word article without invention. */
export const MIN_ABSTRACT_CHARS = 600;

/**
 * Preprint servers.
 *
 * `SRC:MED` already excludes preprints at Europe PMC, but Crossref indexes them as
 * journal articles, so the name check is the line that actually holds for that provider.
 * A paper that has not been peer reviewed is not a basis for health reporting, however
 * interesting it is.
 */
const PREPRINT_SERVERS =
  /\b(?:biorxiv|medrxiv|arxiv|chemrxiv|ssrn|research\s*square|preprints?\.org|osf\s+preprints|authorea)\b/i;

/**
 * Article kinds that have no findings of their own to report.
 *
 * A retraction or correction notice is the dangerous one: its abstract discusses a finding
 * in the past tense, and an article written from it would report the retracted claim as
 * news. Editorials and letters are excluded because their abstracts are opinion.
 */
const EXCLUDED_TITLE_PATTERNS: readonly { pattern: RegExp; reason: string }[] = [
  { pattern: /^retracti(?:on|ng)\b/i, reason: 'retraction_notice' },
  { pattern: /^(?:erratum|corrigendum|correction)\b/i, reason: 'correction_notice' },
  { pattern: /^(?:expression of concern|withdrawn)\b/i, reason: 'concern_notice' },
  {
    pattern: /^(?:editorial|comment on|reply to|response to|letter to the editor)\b/i,
    reason: 'editorial',
  },
  { pattern: /^(?:author correction|publisher correction)\b/i, reason: 'correction_notice' },
];

const EXCLUDED_PUB_TYPES: readonly { type: string; reason: string }[] = [
  { type: 'retracted publication', reason: 'retracted' },
  { type: 'retraction of publication', reason: 'retraction_notice' },
  { type: 'published erratum', reason: 'correction_notice' },
  { type: 'editorial', reason: 'editorial' },
  { type: 'comment', reason: 'editorial' },
  { type: 'letter', reason: 'editorial' },
  { type: 'news', reason: 'not_research' },
  { type: 'preprint', reason: 'preprint' },
  { type: 'posted-content', reason: 'preprint' },
  { type: 'case reports', reason: 'case_report' },
];

/**
 * Subjects that must never reach automatic generation.
 *
 * The same ground as the pipeline's restricted topics, applied a stage earlier: the
 * restricted-topic gate routes an article to human review, but there is no reason to spend
 * a generation call on a paper that is certain to be held there. Matched against title and
 * abstract, so a paediatric dosing trial is dropped before it is ever written about.
 */
const OFF_LIMITS: readonly { pattern: RegExp; reason: string }[] = [
  {
    pattern: /\b(?:dose[-\s]?(?:finding|escalation|ranging)|dosing\s+regimen)\b/i,
    reason: 'dosing_protocol',
  },
  {
    pattern: /\b(?:neonat|infant|paediatric|pediatric)\w*\b.{0,40}\b(?:dose|dosing|dosage)\b/i,
    reason: 'paediatric_dosing',
  },
  {
    pattern: /\b(?:pregnan\w+|gestation\w*)\b.{0,40}\b(?:dose|dosing|supplement\w*|treatment)\b/i,
    reason: 'pregnancy_advice',
  },
  {
    pattern:
      /\b(?:chemotherapy|immunotherapy|radiotherapy)\b.{0,40}\b(?:regimen|protocol|versus|vs\.?)\b/i,
    reason: 'cancer_treatment_choice',
  },
  { pattern: /\bdrug[-\s]drug\s+interaction/i, reason: 'drug_interaction' },
];

export type EligibilityVerdict =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly reason: string; readonly detail?: string };

export type EligibilityOptions = {
  /** Today, so recency is evaluated against the caller's clock rather than the host's. */
  readonly today: string;
  /** Oldest acceptable publication date, inclusive. */
  readonly earliestDate: string;
};

export function checkEligibility(
  candidate: ResearchCandidate,
  options: EligibilityOptions,
): EligibilityVerdict {
  const abstract = candidate.abstract ?? '';
  if (abstract.length < MIN_ABSTRACT_CHARS) {
    return {
      eligible: false,
      reason: 'abstract_too_short',
      detail: `${abstract.length} chars, need ${MIN_ABSTRACT_CHARS}`,
    };
  }

  if (candidate.publicationDate === null) {
    return { eligible: false, reason: 'no_publication_date' };
  }
  if (candidate.publicationDate < options.earliestDate) {
    return {
      eligible: false,
      reason: 'too_old',
      detail: `${candidate.publicationDate} < ${options.earliestDate}`,
    };
  }
  // A date in the future is a metadata error, not a scoop.
  if (candidate.publicationDate > options.today) {
    return { eligible: false, reason: 'future_dated', detail: candidate.publicationDate };
  }

  // A DOI is not strictly required — the URL hash dedups DOI-less records — but a malformed
  // one means the metadata cannot be trusted enough to cite.
  if (candidate.doi !== null && !looksLikeDoi(candidate.doi)) {
    return { eligible: false, reason: 'malformed_doi', detail: candidate.doi };
  }

  if (candidate.journal === null || candidate.journal.trim() === '') {
    return { eligible: false, reason: 'no_journal' };
  }
  if (PREPRINT_SERVERS.test(candidate.journal)) {
    return { eligible: false, reason: 'preprint', detail: candidate.journal };
  }

  for (const { pattern, reason } of EXCLUDED_TITLE_PATTERNS) {
    if (pattern.test(candidate.title)) return { eligible: false, reason, detail: candidate.title };
  }
  for (const { type, reason } of EXCLUDED_PUB_TYPES) {
    if (candidate.publicationTypes.includes(type)) return { eligible: false, reason, detail: type };
  }

  if (candidate.language !== null && !/^(?:eng|en)\b/i.test(candidate.language)) {
    return { eligible: false, reason: 'language_not_supported', detail: candidate.language };
  }

  const haystack = `${candidate.title}\n${abstract}`;
  for (const { pattern, reason } of OFF_LIMITS) {
    const match = pattern.exec(haystack);
    if (match !== null) return { eligible: false, reason, detail: match[0].slice(0, 80) };
  }

  if (candidate.authors.length === 0) {
    return { eligible: false, reason: 'no_authors' };
  }

  return { eligible: true };
}

export type FilterResult = {
  readonly eligible: readonly ResearchCandidate[];
  readonly rejected: readonly {
    readonly candidate: ResearchCandidate;
    readonly reason: string;
    readonly detail?: string;
  }[];
};

export function filterCandidates(
  candidates: readonly ResearchCandidate[],
  options: EligibilityOptions,
): FilterResult {
  const eligible: ResearchCandidate[] = [];
  const rejected: FilterResult['rejected'][number][] = [];

  for (const candidate of candidates) {
    const verdict = checkEligibility(candidate, options);
    if (verdict.eligible) {
      eligible.push(candidate);
    } else {
      rejected.push({
        candidate,
        reason: verdict.reason,
        ...(verdict.detail === undefined ? {} : { detail: verdict.detail }),
      });
    }
  }
  return { eligible, rejected };
}

/**
 * Collapse candidates that are the same paper seen by different providers.
 *
 * Keyed on normalised DOI, then PMID, then PMCID, then the normalised source URL — the same
 * four keys the database enforces, so an in-memory collision and a constraint violation
 * mean the same thing. When two providers describe one paper, the fields are merged rather
 * than one record discarded: Europe PMC has the abstract, Crossref may have the citation
 * count, PubMed has the identifiers.
 */
export function mergeDuplicates(
  candidates: readonly ResearchCandidate[],
): readonly ResearchCandidate[] {
  const byKey = new Map<string, ResearchCandidate>();
  const order: string[] = [];

  const keysOf = (candidate: ResearchCandidate): string[] => {
    const keys: string[] = [];
    if (candidate.doi !== null) keys.push(`doi:${candidate.doi}`);
    if (candidate.externalIds.pmid !== undefined) keys.push(`pmid:${candidate.externalIds.pmid}`);
    if (candidate.externalIds.pmcid !== undefined)
      keys.push(`pmcid:${candidate.externalIds.pmcid}`);
    keys.push(`url:${candidate.sourceUrl.replace(/\/+$/, '').toLowerCase()}`);
    return keys;
  };

  for (const candidate of candidates) {
    const keys = keysOf(candidate);
    const existingKey = keys.find((key) => byKey.has(key));

    if (existingKey === undefined) {
      const primary = keys[0] as string;
      byKey.set(primary, candidate);
      order.push(primary);
      for (const key of keys) byKey.set(key, candidate);
      continue;
    }

    const existing = byKey.get(existingKey) as ResearchCandidate;
    const merged: ResearchCandidate = {
      ...existing,
      abstract:
        (existing.abstract?.length ?? 0) >= (candidate.abstract?.length ?? 0)
          ? existing.abstract
          : candidate.abstract,
      doi: existing.doi ?? candidate.doi,
      journal: existing.journal ?? candidate.journal,
      issn: existing.issn ?? candidate.issn,
      publicationDate: existing.publicationDate ?? candidate.publicationDate,
      authors:
        existing.authors.length >= candidate.authors.length ? existing.authors : candidate.authors,
      citedByCount: Math.max(existing.citedByCount ?? 0, candidate.citedByCount ?? 0) || null,
      isOpenAccess: existing.isOpenAccess ?? candidate.isOpenAccess,
      externalIds: { ...candidate.externalIds, ...existing.externalIds },
      publicationTypes: [...new Set([...existing.publicationTypes, ...candidate.publicationTypes])],
      keywords: [...new Set([...existing.keywords, ...candidate.keywords])],
      language: existing.language ?? candidate.language,
    };

    for (const key of [...keysOf(existing), ...keysOf(merged), ...keysOf(candidate)]) {
      byKey.set(key, merged);
    }
  }

  const seen = new Set<ResearchCandidate>();
  const result: ResearchCandidate[] = [];
  for (const key of order) {
    const candidate = byKey.get(key);
    if (candidate !== undefined && !seen.has(candidate)) {
      seen.add(candidate);
      result.push(candidate);
    }
  }
  return result;
}
