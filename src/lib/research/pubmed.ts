/**
 * PubMed (NCBI E-utilities) — the third provider.
 *
 * `esummary` returns identifiers, journal, dates and publication types but **no abstract**
 * at all; that was measured, not assumed, and the captured fixture shows it. Since a
 * candidate without an abstract has nothing to write from, a naive PubMed provider would
 * contribute only ineligible candidates.
 *
 * So the abstract comes from Europe PMC, by PMID, in one batched call. That is cheaper and
 * simpler than adding an `efetch` XML parser, and it keeps abstract extraction in exactly
 * one place — which matters, because the abstract is the entire factual basis of a research
 * article and two parsers for it would be two ways to get it subtly wrong.
 *
 * Its value is different from Europe PMC's despite the shared abstract source: PubMed's
 * relevance ranking over `[title/abstract]` surfaces different papers than Europe PMC's
 * citation ordering, and a candidate pool of one provider's opinion is a narrower pool.
 */
import type {
  CandidateAuthor,
  CandidateProvider,
  CandidateQuery,
  ResearchCandidate,
} from './types';
import { hydrateAbstractsByPmid, userAgent } from './europepmc';
import { normalizeDoi } from './types';

const ESEARCH = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi';
const ESUMMARY = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi';

const MONTHS: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

/**
 * Parse a PubMed date.
 *
 * `sortpubdate` is `"2026/03/01 00:00"` and is preferred when present. `pubdate` is looser:
 * `"2026 Mar"`, `"2026"`, `"2026 Mar-Apr"`. A missing month or day widens to the first,
 * which biases recency downward — the safe direction.
 */
export function parsePubmedDate(input: {
  readonly sortpubdate?: string;
  readonly epubdate?: string;
  readonly pubdate?: string;
}): string | null {
  const sortable = input.sortpubdate ?? '';
  const slashes = /^(\d{4})\/(\d{2})\/(\d{2})/.exec(sortable);
  if (slashes !== null) return `${slashes[1]}-${slashes[2]}-${slashes[3]}`;

  for (const raw of [input.epubdate, input.pubdate]) {
    if (raw === undefined || raw === '') continue;
    const match = /^(\d{4})(?:\s+([A-Za-z]{3})[A-Za-z]*)?(?:\s+(\d{1,2}))?/.exec(raw.trim());
    if (match === null) continue;
    const month = match[2] === undefined ? '01' : (MONTHS[match[2].toLowerCase()] ?? '01');
    const day = match[3] === undefined ? '01' : match[3].padStart(2, '0');
    return `${match[1]}-${month}-${day}`;
  }
  return null;
}

type EsummaryRecord = {
  uid?: string;
  title?: string;
  fulljournalname?: string;
  source?: string;
  issn?: string;
  essn?: string;
  pubdate?: string;
  epubdate?: string;
  sortpubdate?: string;
  authors?: { name?: string; authtype?: string }[];
  articleids?: { idtype?: string; value?: string }[];
  pubtype?: string[];
  lang?: string[];
};

type EsummaryResponse = {
  result?: Record<string, EsummaryRecord | string[]> & { uids?: string[] };
};
type EsearchResponse = { esearchresult?: { idlist?: string[] } };

function articleId(record: EsummaryRecord, type: string): string | undefined {
  const found = record.articleids?.find((id) => id.idtype === type)?.value;
  return found === undefined || found === '' ? undefined : found;
}

function authors(record: EsummaryRecord): CandidateAuthor[] {
  return (record.authors ?? [])
    .filter((author) => author.authtype === undefined || author.authtype === 'Author')
    .map((author) => ({ name: (author.name ?? '').trim() }))
    .filter((author) => author.name !== '');
}

export function parseEsearchIds(payload: unknown): readonly string[] {
  return ((payload as EsearchResponse).esearchresult?.idlist ?? []).filter((id) => id !== '');
}

/** Parse `esummary` into candidates with `abstract: null` — hydration fills that in. */
export function parseEsummaryResponse(payload: unknown): readonly ResearchCandidate[] {
  const result = (payload as EsummaryResponse).result;
  if (result === undefined) return [];
  const uids = result.uids ?? [];

  const candidates: ResearchCandidate[] = [];
  for (const uid of uids) {
    const record = result[uid];
    if (record === undefined || Array.isArray(record)) continue;

    const title = record.title?.replace(/\.$/, '').trim();
    if (title === undefined || title === '') continue;

    const pmid = record.uid ?? uid;
    const pmcid = articleId(record, 'pmc');
    const doi = normalizeDoi(articleId(record, 'doi'));

    candidates.push({
      provider: 'pubmed',
      title,
      abstract: null,
      doi,
      sourceUrl: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      journal: record.fulljournalname ?? record.source ?? null,
      issn: record.issn ?? record.essn ?? null,
      publicationDate: parsePubmedDate(record),
      authors: authors(record),
      // esummary has no citation count. `null` is honest; the score treats it as unknown
      // rather than as zero, so a PubMed candidate is not penalised for the gap.
      citedByCount: null,
      isOpenAccess: pmcid === undefined ? null : true,
      externalIds: { pmid, ...(pmcid === undefined ? {} : { pmcid }) },
      publicationTypes: (record.pubtype ?? []).map((type) => type.toLowerCase()),
      keywords: [],
      language: record.lang?.[0] ?? null,
    });
  }
  return candidates;
}

/**
 * Merge hydrated Europe PMC data into PubMed candidates.
 *
 * The PubMed record wins on identity (it is what we searched) and Europe PMC wins on the
 * fields PubMed does not have. Exported so the merge is testable without any network.
 */
export function mergeHydrated(
  candidates: readonly ResearchCandidate[],
  hydrated: ReadonlyMap<string, ResearchCandidate>,
): readonly ResearchCandidate[] {
  return candidates.map((candidate) => {
    const pmid = candidate.externalIds.pmid;
    const extra = pmid === undefined ? undefined : hydrated.get(pmid);
    if (extra === undefined) return candidate;
    return {
      ...candidate,
      abstract: candidate.abstract ?? extra.abstract,
      doi: candidate.doi ?? extra.doi,
      journal: candidate.journal ?? extra.journal,
      issn: candidate.issn ?? extra.issn,
      citedByCount: candidate.citedByCount ?? extra.citedByCount,
      isOpenAccess: candidate.isOpenAccess ?? extra.isOpenAccess,
      keywords: candidate.keywords.length > 0 ? candidate.keywords : extra.keywords,
      publicationTypes:
        candidate.publicationTypes.length > 0 ? candidate.publicationTypes : extra.publicationTypes,
    };
  });
}

type Fetcher = typeof globalThis.fetch;

export function createPubmedProvider(options?: {
  readonly fetchImpl?: Fetcher;
}): CandidateProvider {
  const doFetch = options?.fetchImpl ?? globalThis.fetch;

  const json = async (url: URL): Promise<unknown> => {
    const response = await doFetch(url, {
      headers: { 'user-agent': userAgent(), accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`PubMed request failed: HTTP ${response.status}`);
    return response.json();
  };

  return {
    name: 'pubmed',
    async search(query: CandidateQuery) {
      const terms = query.terms.map((term) => `${term}[title/abstract]`).join(' OR ');
      const dateRange = `${query.fromDate.replace(/-/g, '/')}:${query.toDate.replace(/-/g, '/')}[dp]`;

      const searchUrl = new URL(ESEARCH);
      searchUrl.searchParams.set('db', 'pubmed');
      searchUrl.searchParams.set('term', `(${terms}) AND (${dateRange}) AND (english[lang])`);
      searchUrl.searchParams.set('retmode', 'json');
      searchUrl.searchParams.set('retmax', String(Math.min(query.limit, 50)));
      searchUrl.searchParams.set('sort', 'relevance');

      const ids = parseEsearchIds(await json(searchUrl));
      if (ids.length === 0) return [];

      const summaryUrl = new URL(ESUMMARY);
      summaryUrl.searchParams.set('db', 'pubmed');
      summaryUrl.searchParams.set('id', ids.join(','));
      summaryUrl.searchParams.set('retmode', 'json');

      const candidates = parseEsummaryResponse(await json(summaryUrl)).filter((candidate) => {
        const date = candidate.publicationDate;
        return date !== null && date >= query.fromDate && date <= query.toDate;
      });

      const hydrated = await hydrateAbstractsByPmid(
        candidates
          .map((candidate) => candidate.externalIds.pmid)
          .filter((pmid): pmid is string => pmid !== undefined),
        options,
      );
      return mergeHydrated(candidates, hydrated);
    },
  };
}
