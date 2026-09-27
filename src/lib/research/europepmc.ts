/**
 * Europe PMC — the primary candidate provider.
 *
 * One keyless call returns everything the pipeline needs: abstract, DOI, PMID, PMCID,
 * journal title, ISSN, `citedByCount`, open-access flag, publication types and MeSH terms.
 * The other two providers exist to widen coverage, not because this one is insufficient.
 *
 * Two measured facts shape the query builder, both recorded in
 * `tests/fixtures/research/README.md`:
 *
 *   Lucene precedence is the real trap. `EXT_ID:a OR EXT_ID:b OR EXT_ID:c AND SRC:MED`
 *   returns ONE hit, because it parses as `a OR b OR (c AND SRC:MED)`. Parenthesised, the
 *   same three ids return three. Every clause built here is therefore wrapped, which is
 *   also the likeliest explanation for the "the date filter leaks old records" note in the
 *   plan: six probes of `FIRST_PDATE:[… TO …]` returned zero out-of-range records today.
 *
 *   `SRC:MED` excludes preprints structurally. Preprints come back as `source: "PPR"` with
 *   no journal title at all, so restricting the source is a cleaner exclusion than pattern
 *   matching server names — though `eligibility.ts` still checks the name as a second line.
 *
 * Dates are re-checked in code regardless. That costs one comparison and means a change in
 * the remote filter's behaviour degrades into "fewer candidates", never into "an eight-year
 * old paper published as news".
 */
import type {
  CandidateAuthor,
  CandidateProvider,
  CandidateQuery,
  ResearchCandidate,
} from './types';
import { normalizeDoi } from './types';

const ENDPOINT = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';

/**
 * Identifies us to Europe PMC, Crossref and NCBI.
 *
 * All three ask for a contactable agent, and all three throttle anonymous traffic harder.
 * The address is the operator's, supplied by env so it is not baked into the source.
 */
export function userAgent(): string {
  const contact = process.env.RESEARCH_CONTACT_EMAIL;
  const suffix = contact === undefined || contact === '' ? '' : `; mailto:${contact}`;
  return `SucKhoeGiaiMa/1.0 (+https://github.com/; research fallback${suffix})`;
}

/** Wrap a clause in parentheses. See the precedence note above — this is not cosmetic. */
function group(clause: string): string {
  return `(${clause})`;
}

export function buildQuery(input: CandidateQuery): string {
  const terms = input.terms.length === 0 ? ['health'] : input.terms;
  return [
    group(terms.join(' OR ')),
    group('SRC:MED'),
    group(`FIRST_PDATE:[${input.fromDate} TO ${input.toDate}]`),
    group('HAS_ABSTRACT:Y'),
    group('LANG:eng'),
  ].join(' AND ');
}

type EpmcAuthor = {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  authorAffiliationDetailsList?: { authorAffiliation?: { affiliation?: string }[] };
};

type EpmcResult = {
  id?: string;
  source?: string;
  pmid?: string;
  pmcid?: string;
  doi?: string;
  title?: string;
  authorList?: { author?: EpmcAuthor[] };
  authorString?: string;
  journalInfo?: { journal?: { title?: string; issn?: string; essn?: string } };
  abstractText?: string;
  language?: string;
  pubTypeList?: { pubType?: string[] };
  keywordList?: { keyword?: string[] };
  meshHeadingList?: { meshHeading?: { descriptorName?: string }[] };
  isOpenAccess?: string;
  citedByCount?: number;
  firstPublicationDate?: string;
};

type EpmcResponse = { hitCount?: number; resultList?: { result?: EpmcResult[] } };

/** A stable landing page. `europepmc.org` is on the reference allowlist; a bare DOI is not always. */
function landingUrl(result: EpmcResult): string {
  if (result.pmid !== undefined && result.pmid !== '') {
    return `https://europepmc.org/article/MED/${result.pmid}`;
  }
  if (result.doi !== undefined && result.doi !== '') return `https://doi.org/${result.doi}`;
  return `https://europepmc.org/article/${result.source ?? 'MED'}/${result.id ?? ''}`;
}

function authors(result: EpmcResult): CandidateAuthor[] {
  const list = result.authorList?.author ?? [];
  if (list.length > 0) {
    return list.map((author) => {
      const name =
        author.firstName !== undefined && author.lastName !== undefined
          ? `${author.firstName} ${author.lastName}`
          : (author.fullName ?? '');
      const affiliation = author.authorAffiliationDetailsList?.authorAffiliation?.[0]?.affiliation;
      return affiliation === undefined ? { name } : { name, affiliation };
    });
  }
  // `resultType=lite` omits authorList but keeps authorString ("Siegel RL, Wagle NS, …").
  const fallback = result.authorString ?? '';
  return fallback === ''
    ? []
    : fallback
        .replace(/\.$/, '')
        .split(',')
        .map((name) => ({ name: name.trim() }))
        .filter((author) => author.name !== '');
}

export function parseResult(result: EpmcResult): ResearchCandidate | null {
  const title = result.title?.replace(/\.$/, '').trim();
  if (title === undefined || title === '') return null;

  const journal = result.journalInfo?.journal;
  const mesh = (result.meshHeadingList?.meshHeading ?? [])
    .map((heading) => heading.descriptorName)
    .filter((name): name is string => name !== undefined);

  const pmid = result.pmid;
  const pmcid = result.pmcid;

  return {
    provider: 'europepmc',
    title,
    abstract: result.abstractText ?? null,
    doi: normalizeDoi(result.doi),
    sourceUrl: landingUrl(result),
    journal: journal?.title ?? null,
    issn: journal?.issn ?? journal?.essn ?? null,
    publicationDate: result.firstPublicationDate ?? null,
    authors: authors(result),
    citedByCount: typeof result.citedByCount === 'number' ? result.citedByCount : null,
    isOpenAccess: result.isOpenAccess === undefined ? null : result.isOpenAccess === 'Y',
    externalIds: {
      ...(pmid !== undefined && pmid !== '' ? { pmid } : {}),
      ...(pmcid !== undefined && pmcid !== '' ? { pmcid } : {}),
    },
    publicationTypes: (result.pubTypeList?.pubType ?? []).map((type) => type.toLowerCase()),
    keywords: [...(result.keywordList?.keyword ?? []), ...mesh],
    language: result.language ?? null,
  };
}

/** Shared parse + local date re-check. Exported so the fixtures can drive it directly. */
export function parseSearchResponse(
  payload: unknown,
  bounds?: { readonly fromDate: string; readonly toDate: string },
): readonly ResearchCandidate[] {
  const response = payload as EpmcResponse;
  const results = response.resultList?.result ?? [];
  const candidates: ResearchCandidate[] = [];

  for (const result of results) {
    // Preprints are excluded at the source, but a server-side default could change and
    // this check cannot.
    if (result.source === 'PPR') continue;
    const candidate = parseResult(result);
    if (candidate === null) continue;
    if (bounds !== undefined) {
      const date = candidate.publicationDate;
      if (date === null || date < bounds.fromDate || date > bounds.toDate) continue;
    }
    candidates.push(candidate);
  }
  return candidates;
}

type Fetcher = typeof globalThis.fetch;

export function createEuropePmcProvider(options?: {
  readonly fetchImpl?: Fetcher;
}): CandidateProvider {
  const doFetch = options?.fetchImpl ?? globalThis.fetch;

  return {
    name: 'europepmc',
    async search(query) {
      const url = new URL(ENDPOINT);
      url.searchParams.set('query', buildQuery(query));
      url.searchParams.set('format', 'json');
      url.searchParams.set('resultType', 'core');
      url.searchParams.set('pageSize', String(Math.min(query.limit, 100)));
      // Citation count is a fact about reception, not a ranking of worth; it orders the
      // request only so the page we retrieve is not arbitrary. The real ordering is done
      // by `score.ts` over all candidates from all providers.
      url.searchParams.set('sort', 'CITED desc');

      const response = await doFetch(url, {
        headers: { 'user-agent': userAgent(), accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`Europe PMC search failed: HTTP ${response.status}`);
      }
      return parseSearchResponse(await response.json(), {
        fromDate: query.fromDate,
        toDate: query.toDate,
      });
    },
  };
}

/**
 * Fill in abstracts for records found elsewhere, by PMID.
 *
 * PubMed's `esummary` carries no abstract (measured — see the fixtures README), so a
 * PubMed candidate would otherwise always be ineligible. One batched, parenthesised
 * `EXT_ID` query hydrates the whole page.
 */
export async function hydrateAbstractsByPmid(
  pmids: readonly string[],
  options?: { readonly fetchImpl?: Fetcher },
): Promise<Map<string, ResearchCandidate>> {
  const unique = [...new Set(pmids.filter((pmid) => pmid !== ''))].slice(0, 25);
  const hydrated = new Map<string, ResearchCandidate>();
  if (unique.length === 0) return hydrated;

  const doFetch = options?.fetchImpl ?? globalThis.fetch;
  const url = new URL(ENDPOINT);
  url.searchParams.set('query', group(unique.map((pmid) => `EXT_ID:${pmid}`).join(' OR ')));
  url.searchParams.set('format', 'json');
  url.searchParams.set('resultType', 'core');
  url.searchParams.set('pageSize', String(unique.length));

  const response = await doFetch(url, {
    headers: { 'user-agent': userAgent(), accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Europe PMC hydration failed: HTTP ${response.status}`);

  for (const candidate of parseSearchResponse(await response.json())) {
    const pmid = candidate.externalIds.pmid;
    if (pmid !== undefined) hydrated.set(pmid, candidate);
  }
  return hydrated;
}
