/**
 * Research-source selection: the fallback that runs after a dry spell.
 *
 * The order of operations is the whole design, and it is: **claim, then generate.** Nothing
 * is spent on a paper until the database has confirmed the row is ours, because the
 * alternative — generate, then discover the paper was already taken — pays for an article
 * that must be thrown away, and pays again on the next retry.
 *
 * Deliberately NOT claimed here: that the chosen paper is the most important, most popular
 * or best new research on anything. No such ranking exists. `score.ts` computes an explicit
 * editorial preference, every component of it is stored on the row, and so are the pool size
 * and the rank — so the pick is auditable and arguable rather than presented as a fact.
 *
 * Every step degrades rather than throws. A provider that is down contributes nothing; a
 * pool that yields no eligible paper returns null, which records `no_source` and leaves the
 * streak climbing. Publishing nothing is always an acceptable outcome.
 */
import 'server-only';

import { toJsonObject } from '@/lib/json';
import { liveGateway, type AutomationGateway } from '@/lib/automation/internal-gateway';
import { publicClient } from '@/lib/supabase/server';

/** The slice of the automation gateway research selection needs. */
export type ResearchGateway = Pick<AutomationGateway, 'getSettings' | 'claimResearchSource'>;
import { addHanoiDays, hanoiDate, type HanoiDate } from '@/lib/time';
import { createEuropePmcProvider } from './europepmc';
import { createCrossrefProvider } from './crossref';
import { createPubmedProvider } from './pubmed';
import { filterCandidates, mergeDuplicates } from './eligibility';
import { rankCandidates, type JournalTiers, type ScoredCandidate } from './score';
import type { CandidateProvider, ResearchCandidate } from './types';

/** How far back a paper may have been published to still count as new work. */
export const DEFAULT_LOOKBACK_DAYS = 240;

/**
 * How many ranked candidates to try claiming before giving up.
 *
 * Each rejected candidate costs one database round trip and nothing else — no generation
 * has happened yet — so this can be generous. Ten is the plan's figure and is enough to
 * absorb a whole page of papers we have already written about.
 */
export const MAX_CLAIM_ATTEMPTS = 10;

/** Per-provider request budget. Three providers × 25 is a pool of up to 75 before merging. */
const PER_PROVIDER_LIMIT = 25;

export type ClaimedPaper = {
  readonly id: string;
  readonly title: string;
  readonly score: number;
  readonly rank: number;
  readonly poolSize: number;
};

export type SelectionLog = (entry: {
  readonly code: string;
  readonly level?: 'info' | 'warn' | 'error';
  readonly message?: string;
  readonly context?: Record<string, unknown>;
}) => Promise<void> | void;

export type SelectDeps = {
  readonly providers?: readonly CandidateProvider[];
  /** Hanoi date the decision belongs to. Defaults to today in the publishing timezone. */
  readonly today?: HanoiDate;
  readonly lookbackDays?: number;
  readonly maxClaimAttempts?: number;
  readonly log?: SelectionLog;
  /** Injected so the whole path is testable without a database. */
  readonly loadTopics?: () => Promise<TopicConfig>;
  /** The gateway to the private schema. Injected in tests; defaults to the live one. */
  readonly gateway?: ResearchGateway;
};

export type TopicConfig = {
  /** Search terms, already Lucene-quoted where they are phrases. */
  readonly terms: readonly string[];
  /** Every keyword across the active categories, for the topical-fit score. */
  readonly keywords: readonly string[];
  readonly journalTiers: JournalTiers | null;
};

/**
 * Search terms, derived from the seeded taxonomy rather than hard-coded.
 *
 * The categories already encode what this publication covers, and their `keywords` column
 * feeds the research topical-fit score — so using the same list for retrieval means the
 * papers we look for and the papers we score well are defined in one place, editable
 * without a deploy.
 *
 * Only multi-word keywords are quoted; a bare word must not be, or Lucene treats the quotes
 * as part of the term.
 */
export function buildTerms(keywords: readonly string[], limit = 24): readonly string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const keyword of keywords) {
    const trimmed = keyword.trim();
    if (trimmed.length < 3) continue;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    terms.push(trimmed.includes(' ') ? `"${trimmed}"` : trimmed);
    if (terms.length >= limit) break;
  }
  return terms;
}

/**
 * English search terms for the seeded Vietnamese categories.
 *
 * The taxonomy is Vietnamese and the literature is English, so the category keywords cannot
 * be used verbatim for retrieval. This map is the bridge, and it lives next to the
 * categories it translates rather than in the database, because it is a property of how the
 * three APIs are queried rather than of the publication's editorial structure.
 */
export const CATEGORY_SEARCH_TERMS: Readonly<Record<string, readonly string[]>> = {
  'vi-chat-vitamin': [
    'magnesium',
    'zinc',
    '"vitamin D"',
    '"vitamin B12"',
    'selenium',
    'iron deficiency',
    '"micronutrient deficiency"',
  ],
  'dinh-duong-chuyen-hoa': [
    '"insulin resistance"',
    '"metabolic syndrome"',
    '"dietary pattern"',
    '"ultra-processed food"',
    '"intermittent fasting"',
  ],
  'noi-tiet-hormone': ['thyroid', 'cortisol', 'testosterone', '"insulin secretion"', 'menopause'],
  'mien-dich-nhiem-trung-ung-thu': [
    '"cancer screening"',
    'immunotherapy',
    'vaccination',
    '"gut immunity"',
    '"cancer prevention"',
  ],
  'tieu-hoa-gan-than': [
    '"gut microbiome"',
    '"fatty liver"',
    '"chronic kidney disease"',
    '"irritable bowel"',
  ],
  'co-xuong-khop-van-dong': ['osteoarthritis', 'osteoporosis', 'sarcopenia', '"physical activity"'],
  'phong-ngua-tam-than': [
    '"sleep quality"',
    'meditation',
    '"slow breathing"',
    '"stress reduction"',
  ],
};

async function loadTopicsFromDatabase(gateway: ResearchGateway): Promise<TopicConfig> {
  const categories = await publicClient()
    .from('categories')
    .select('slug, keywords')
    .eq('is_active', true)
    .order('sort_order');

  const slugs = (categories.data ?? []).map((row) => row.slug);
  const keywords = (categories.data ?? []).flatMap((row) => row.keywords ?? []);

  const settings = await gateway.getSettings();
  const tiers = settings.journalTiers;

  // Interleave one term per category rather than taking the first category's whole list, so
  // a single dry day cannot search only for vitamins.
  const perCategory = slugs.map((slug) => CATEGORY_SEARCH_TERMS[slug] ?? []);
  const interleaved: string[] = [];
  for (let index = 0; index < Math.max(...perCategory.map((list) => list.length), 0); index += 1) {
    for (const list of perCategory) {
      const term = list[index];
      if (term !== undefined) interleaved.push(term);
    }
  }

  return {
    terms: buildTerms(interleaved),
    keywords,
    journalTiers:
      tiers !== null && typeof tiers === 'object' && !Array.isArray(tiers) ? tiers : null,
  };
}

/** Gather from every provider. A provider that fails contributes nothing and is logged. */
async function gather(
  providers: readonly CandidateProvider[],
  query: { terms: readonly string[]; fromDate: string; toDate: string },
  log: SelectionLog,
): Promise<readonly ResearchCandidate[]> {
  const settled = await Promise.allSettled(
    providers.map((provider) => provider.search({ ...query, limit: PER_PROVIDER_LIMIT })),
  );

  const candidates: ResearchCandidate[] = [];
  for (const [index, result] of settled.entries()) {
    const name = providers[index]?.name ?? 'unknown';
    if (result.status === 'fulfilled') {
      candidates.push(...result.value);
      continue;
    }
    await log({
      code: 'research_provider_failed',
      level: 'warn',
      message: `${name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
      context: { provider: name },
    });
  }
  return candidates;
}

/**
 * Try to claim, in rank order, until one succeeds.
 *
 * `duplicate` and `similar` both mean "someone already has this paper", so both advance to
 * the next candidate. Exported for the tests, which drive it with a stub claim function to
 * assert the ordering and the stop condition.
 */
export async function claimBestAvailable(
  ranked: readonly ScoredCandidate[],
  claim: (
    scored: ScoredCandidate,
  ) => Promise<{ readonly id: string | null; readonly outcome: string }>,
  options: { readonly maxAttempts: number; readonly log: SelectionLog },
): Promise<ClaimedPaper | null> {
  let attempts = 0;

  for (const scored of ranked) {
    if (attempts >= options.maxAttempts) break;
    attempts += 1;

    const { id, outcome } = await claim(scored);
    if (outcome === 'claimed' && id !== null) {
      return {
        id,
        title: scored.candidate.title,
        score: scored.score,
        rank: scored.breakdown.rank,
        poolSize: scored.breakdown.poolSize,
      };
    }

    await options.log({
      code: 'research_candidate_taken',
      level: 'info',
      message: `rank ${scored.breakdown.rank} skipped: ${outcome}`,
      context: {
        outcome,
        doi: scored.candidate.doi,
        provider: scored.candidate.provider,
        rank: scored.breakdown.rank,
      },
    });
  }
  return null;
}

/**
 * The entry point the scheduler calls.
 *
 * Returns the claimed paper, or null when nothing eligible could be claimed — which the
 * caller records as `no_source`, leaving the streak to keep climbing.
 */
export async function claimResearchSource(deps: SelectDeps = {}): Promise<ClaimedPaper | null> {
  const gateway = deps.gateway ?? liveGateway();
  const log: SelectionLog = deps.log ?? (() => undefined);
  const today = deps.today ?? hanoiDate(new Date());
  const lookback = deps.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const fromDate = addHanoiDays(today, -lookback);

  const topics = await (deps.loadTopics ?? (() => loadTopicsFromDatabase(gateway)))();
  if (topics.terms.length === 0) {
    await log({
      code: 'research_none_found',
      level: 'warn',
      message: 'no search terms configured for any active category',
    });
    return null;
  }

  const providers =
    deps.providers ??
    ([
      createEuropePmcProvider(),
      createCrossrefProvider(),
      createPubmedProvider(),
    ] as readonly CandidateProvider[]);

  const gathered = await gather(providers, { terms: topics.terms, fromDate, toDate: today }, log);
  const merged = mergeDuplicates(gathered);
  const { eligible, rejected } = filterCandidates(merged, { today, earliestDate: fromDate });

  await log({
    code: 'research_pool_assembled',
    level: 'info',
    message: `${gathered.length} retrieved, ${merged.length} distinct, ${eligible.length} eligible`,
    context: {
      retrieved: gathered.length,
      distinct: merged.length,
      eligible: eligible.length,
      // Counts per reason rather than the rejected titles: enough to explain a dry spell
      // without copying other people's abstracts into our logs.
      rejected: rejected.reduce<Record<string, number>>((counts, entry) => {
        counts[entry.reason] = (counts[entry.reason] ?? 0) + 1;
        return counts;
      }, {}),
    },
  });

  if (eligible.length === 0) {
    await log({
      code: 'research_none_found',
      level: 'warn',
      message: 'no eligible paper in the candidate pool',
    });
    return null;
  }

  const ranked = rankCandidates(eligible, {
    today,
    journalTiers: topics.journalTiers,
    categoryKeywords: topics.keywords,
  });

  const claimed = await claimBestAvailable(
    ranked,
    (scored) => gateway.claimResearchSource(toJsonObject(toClaimPayload(scored))),
    { maxAttempts: deps.maxClaimAttempts ?? MAX_CLAIM_ATTEMPTS, log },
  );

  if (claimed === null) {
    await log({
      code: 'research_none_found',
      level: 'warn',
      message: `all ${Math.min(ranked.length, deps.maxClaimAttempts ?? MAX_CLAIM_ATTEMPTS)} attempted candidates were already taken`,
    });
  }
  return claimed;
}

/**
 * The JSON payload the claim function takes.
 *
 * Kept as its own exported function so a test can assert that the score components really
 * do travel to the database — an unauditable pick would defeat the point of computing them.
 */
export function toClaimPayload(scored: ScoredCandidate): Record<string, unknown> {
  const { candidate } = scored;
  return {
    title: candidate.title,
    doi: candidate.doi,
    source_url: candidate.sourceUrl,
    journal: candidate.journal,
    issn: candidate.issn,
    publication_date: candidate.publicationDate,
    abstract: candidate.abstract,
    is_open_access: candidate.isOpenAccess,
    cited_by_count: candidate.citedByCount,
    authors: candidate.authors,
    external_ids: candidate.externalIds,
    score: scored.score,
    score_components: { ...scored.breakdown, provider: candidate.provider },
  };
}
