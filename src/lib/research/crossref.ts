/**
 * Crossref — the secondary provider.
 *
 * Covers journals Europe PMC does not index, and supplies `is-referenced-by-count` for
 * citation velocity. Two properties of the real responses (recorded in the fixtures) drive
 * everything here:
 *
 *   Abstracts are JATS XML. The first captured record begins `<jats:p>Hypomagnesemia is a
 *   characteristic feature of many diseases …`. Left as-is, those tags would reach the
 *   generator as source text and then the copy-overlap check as noise.
 *
 *   Abstracts are often thin — 394 characters in that same record — and the catalogue is
 *   unfiltered by quality: the top-scoring bibliographic match for "magnesium deficiency
 *   randomized" was a Russian-language practice journal. Crossref therefore contributes
 *   candidates; the journal-tier and topical-fit components decide whether one is used.
 */
import type {
  CandidateAuthor,
  CandidateProvider,
  CandidateQuery,
  ResearchCandidate,
} from './types';
import { normalizeDoi, widenDate } from './types';
import { userAgent } from './europepmc';

const ENDPOINT = 'https://api.crossref.org/works';

/**
 * Strip JATS markup from an abstract.
 *
 * Tag removal only — no entity decoding beyond the five XML predefined entities, because
 * anything more elaborate belongs to an HTML parser and this text is about to be read by a
 * language model, not rendered. The leading "Abstract" label many publishers include is
 * dropped too, since it is not part of the abstract.
 */
export function stripJats(input: string | undefined): string | null {
  if (input === undefined) return null;
  const text = input
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .replace(/^\s*abstract[:.\s]*/i, '')
    .trim();
  return text === '' ? null : text;
}

type CrossrefItem = {
  DOI?: string;
  title?: string[];
  abstract?: string;
  'container-title'?: string[];
  ISSN?: string[];
  author?: { given?: string; family?: string; name?: string; affiliation?: { name?: string }[] }[];
  issued?: { 'date-parts'?: number[][] };
  published?: { 'date-parts'?: number[][] };
  'is-referenced-by-count'?: number;
  type?: string;
  subject?: string[];
  language?: string;
  license?: { URL?: string }[];
};

type CrossrefResponse = { message?: { items?: CrossrefItem[] } };

function authors(item: CrossrefItem): CandidateAuthor[] {
  return (item.author ?? [])
    .map((author) => {
      const name =
        author.given !== undefined && author.family !== undefined
          ? `${author.given} ${author.family}`
          : (author.name ?? author.family ?? '');
      const affiliation = author.affiliation?.[0]?.name;
      return affiliation === undefined ? { name } : { name, affiliation };
    })
    .filter((author) => author.name !== '');
}

/**
 * Open access, as far as Crossref can tell.
 *
 * A Creative Commons licence URL is good evidence; its absence is not evidence of the
 * opposite, so this returns null rather than false when there is no licence at all.
 */
function openAccess(item: CrossrefItem): boolean | null {
  const licenses = item.license ?? [];
  if (licenses.length === 0) return null;
  return licenses.some((license) => /creativecommons\.org/i.test(license.URL ?? ''));
}

export function parseItem(item: CrossrefItem): ResearchCandidate | null {
  const title = item.title?.[0]?.replace(/\s+/g, ' ').trim();
  const doi = normalizeDoi(item.DOI);
  if (title === undefined || title === '' || doi === null) return null;

  const parts = item.published?.['date-parts']?.[0] ?? item.issued?.['date-parts']?.[0] ?? [];

  return {
    provider: 'crossref',
    title,
    abstract: stripJats(item.abstract),
    doi,
    sourceUrl: `https://doi.org/${doi}`,
    journal: item['container-title']?.[0] ?? null,
    issn: item.ISSN?.[0] ?? null,
    publicationDate: widenDate(parts),
    authors: authors(item),
    citedByCount:
      typeof item['is-referenced-by-count'] === 'number' ? item['is-referenced-by-count'] : null,
    isOpenAccess: openAccess(item),
    externalIds: {},
    publicationTypes: item.type === undefined ? [] : [item.type.toLowerCase()],
    keywords: item.subject ?? [],
    language: item.language ?? null,
  };
}

export function parseWorksResponse(
  payload: unknown,
  bounds?: { readonly fromDate: string; readonly toDate: string },
): readonly ResearchCandidate[] {
  const items = (payload as CrossrefResponse).message?.items ?? [];
  const candidates: ResearchCandidate[] = [];
  for (const item of items) {
    const candidate = parseItem(item);
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

export function createCrossrefProvider(options?: {
  readonly fetchImpl?: Fetcher;
}): CandidateProvider {
  const doFetch = options?.fetchImpl ?? globalThis.fetch;

  return {
    name: 'crossref',
    async search(query: CandidateQuery) {
      const url = new URL(ENDPOINT);
      // Crossref's bibliographic search takes prose, not Lucene, so the quoting the other
      // providers need is stripped here rather than passed through as literal characters.
      url.searchParams.set('query.bibliographic', query.terms.join(' ').replace(/"/g, ''));
      url.searchParams.set(
        'filter',
        [
          `from-pub-date:${query.fromDate}`,
          `until-pub-date:${query.toDate}`,
          'type:journal-article',
          'has-abstract:true',
        ].join(','),
      );
      url.searchParams.set('rows', String(Math.min(query.limit, 100)));
      url.searchParams.set(
        'select',
        'DOI,title,abstract,container-title,ISSN,author,issued,published,is-referenced-by-count,type,subject,license,language',
      );
      const contact = process.env.RESEARCH_CONTACT_EMAIL;
      // The "polite pool": Crossref gives contactable clients better rate limits.
      if (contact !== undefined && contact !== '') url.searchParams.set('mailto', contact);

      const response = await doFetch(url, {
        headers: { 'user-agent': userAgent(), accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`Crossref search failed: HTTP ${response.status}`);
      return parseWorksResponse(await response.json(), {
        fromDate: query.fromDate,
        toDate: query.toDate,
      });
    },
  };
}
