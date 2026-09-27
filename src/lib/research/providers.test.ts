/**
 * Provider parsers, tested against the real captured payloads.
 *
 * Every fixture in `tests/fixtures/research/` was returned by the live API on 2026-09-27,
 * so these tests exercise the actual shapes — JATS abstracts, missing PubMed abstracts,
 * `resultType=lite` author strings, preprint `source: "PPR"` records — rather than a tidied
 * idea of them. The parsers were written from these captures, so a failure here means the
 * shape changed under us, which is exactly what a fixture test should surface.
 */
import { describe, expect, it } from 'vitest';
import { loadResearchFixture } from '../../../tests/fixtures';
import { buildQuery, parseResult, parseSearchResponse, createEuropePmcProvider } from './europepmc';
import { parseWorksResponse, stripJats, createCrossrefProvider } from './crossref';
import { parseEsearchIds, parseEsummaryResponse, parsePubmedDate, mergeHydrated } from './pubmed';
import type { CandidateQuery, ResearchCandidate } from './types';

const QUERY: CandidateQuery = {
  terms: ['magnesium', '"vitamin D"'],
  fromDate: '2026-03-01',
  toDate: '2026-09-27',
  limit: 25,
};

/** A fetch that returns one JSON payload regardless of URL. */
function stubFetch(payload: unknown, status = 200): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
}

describe('Europe PMC', () => {
  it('every clause in the query is parenthesised', () => {
    // The measured precedence trap: an un-grouped `EXT_ID:a OR EXT_ID:b AND SRC:MED` drops
    // to one hit. Each clause must be wrapped for the AND to bind across all of them.
    const query = buildQuery(QUERY);
    expect(query).toContain('(magnesium OR "vitamin D")');
    expect(query).toContain('(SRC:MED)');
    expect(query).toContain('(FIRST_PDATE:[2026-03-01 TO 2026-09-27])');
    expect(query).toContain('(HAS_ABSTRACT:Y)');
    // No bare clause: everything between ANDs is a parenthesised group.
    for (const clause of query.split(' AND ')) {
      expect(clause.startsWith('(')).toBe(true);
      expect(clause.endsWith(')')).toBe(true);
    }
  });

  it('parses core records into the normalised shape', () => {
    const candidates = parseSearchResponse(loadResearchFixture('europepmc-search'));
    expect(candidates.length).toBeGreaterThan(15);

    const first = candidates[0] as ResearchCandidate;
    expect(first.provider).toBe('europepmc');
    expect(first.title.length).toBeGreaterThan(10);
    expect(first.abstract).not.toBeNull();
    expect(first.doi).toMatch(/^10\./);
    expect(first.journal).not.toBeNull();
    expect(first.publicationDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(first.authors.length).toBeGreaterThan(0);
    // The DOI is lower-cased and de-prefixed, matching internal.normalize_doi.
    expect(first.doi).toBe(first.doi?.toLowerCase());
  });

  it('carries PMID and PMCID through when present', () => {
    const candidates = parseSearchResponse(loadResearchFixture('europepmc-search'));
    const withPmcid = candidates.find((candidate) => candidate.externalIds.pmcid !== undefined);
    expect(withPmcid).toBeDefined();
    expect(withPmcid?.externalIds.pmid).toMatch(/^\d+$/);
    expect(withPmcid?.externalIds.pmcid).toMatch(/^PMC\d+$/);
  });

  it('drops preprint (PPR) records even when they arrive', () => {
    const preprints = parseSearchResponse(loadResearchFixture('europepmc-preprints'));
    // The preprint fixture is entirely SRC:PPR, so the parser must yield nothing.
    expect(preprints).toHaveLength(0);
  });

  it('re-checks dates locally and drops out-of-range records', () => {
    // Every captured record is in range, so a tight bound that excludes them all proves the
    // local filter runs rather than trusting the server.
    const candidates = parseSearchResponse(loadResearchFixture('europepmc-search'), {
      fromDate: '2020-01-01',
      toDate: '2020-12-31',
    });
    expect(candidates).toHaveLength(0);
  });

  it('parseResult returns null for a titleless record', () => {
    expect(parseResult({ doi: '10.1/x', abstractText: 'body' })).toBeNull();
  });

  it('hydration payload maps PMID → candidate', () => {
    const hydrated = parseSearchResponse(loadResearchFixture('europepmc-by-pmid'));
    expect(hydrated.length).toBeGreaterThan(0);
    for (const candidate of hydrated) {
      expect(candidate.externalIds.pmid).toMatch(/^\d+$/);
      expect(candidate.abstract).not.toBeNull();
    }
  });

  it('search() applies the date re-check end to end', async () => {
    const provider = createEuropePmcProvider({
      fetchImpl: stubFetch(loadResearchFixture('europepmc-search')),
    });
    const candidates = await provider.search(QUERY);
    for (const candidate of candidates) {
      expect(candidate.publicationDate).not.toBeNull();
      expect(candidate.publicationDate! >= QUERY.fromDate).toBe(true);
      expect(candidate.publicationDate! <= QUERY.toDate).toBe(true);
    }
  });

  it('throws on a non-2xx response', async () => {
    const provider = createEuropePmcProvider({ fetchImpl: stubFetch({}, 503) });
    await expect(provider.search(QUERY)).rejects.toThrow(/HTTP 503/);
  });
});

describe('Crossref', () => {
  it('strips JATS markup from abstracts', () => {
    expect(stripJats('<jats:p>Hypomagnesemia is common.</jats:p>')).toBe(
      'Hypomagnesemia is common.',
    );
    expect(stripJats('<jats:title>Abstract</jats:title><jats:p>Body text here.</jats:p>')).toBe(
      'Body text here.',
    );
    expect(stripJats('Plain &amp; simple')).toBe('Plain & simple');
    expect(stripJats(undefined)).toBeNull();
    expect(stripJats('<jats:p></jats:p>')).toBeNull();
  });

  it('parses works into the normalised shape', () => {
    const candidates = parseWorksResponse(loadResearchFixture('crossref-works'));
    expect(candidates.length).toBeGreaterThan(5);
    const first = candidates[0] as ResearchCandidate;
    expect(first.provider).toBe('crossref');
    expect(first.doi).toMatch(/^10\./);
    expect(first.sourceUrl).toBe(`https://doi.org/${first.doi}`);
    // The abstract must be plain text, not XML — no residual tags.
    expect(first.abstract).not.toMatch(/<[^>]+>/);
  });

  it('drops records with no DOI (they cannot be cited or deduped by DOI)', () => {
    const candidates = parseWorksResponse({
      message: { items: [{ title: ['No DOI here'], abstract: 'x'.repeat(700) }] },
    });
    expect(candidates).toHaveLength(0);
  });

  it('open access is a Creative Commons licence, unknown otherwise', () => {
    const cc = parseWorksResponse({
      message: {
        items: [
          {
            DOI: '10.1/a',
            title: ['CC paper'],
            license: [{ URL: 'https://creativecommons.org/licenses/by/4.0/' }],
          },
        ],
      },
    });
    expect(cc[0]?.isOpenAccess).toBe(true);

    const noLicense = parseWorksResponse({
      message: { items: [{ DOI: '10.1/b', title: ['No licence'] }] },
    });
    expect(noLicense[0]?.isOpenAccess).toBeNull();
  });

  it('search() strips quoting that Lucene providers need', async () => {
    let capturedUrl = '';
    const fetchImpl = ((url: URL | string) => {
      capturedUrl = url.toString();
      return Promise.resolve(
        new Response(JSON.stringify(loadResearchFixture('crossref-works')), { status: 200 }),
      );
    }) as typeof fetch;

    await createCrossrefProvider({ fetchImpl }).search(QUERY);
    // The double quotes around "vitamin D" must not reach Crossref's prose search. Read the
    // decoded query.bibliographic value rather than the raw string, since URLSearchParams
    // encodes the space between the terms as '+'.
    const term = new URL(capturedUrl).searchParams.get('query.bibliographic') ?? '';
    expect(term).not.toContain('"');
    expect(term).toContain('vitamin D');
  });
});

describe('PubMed', () => {
  it('extracts ids from esearch', () => {
    const ids = parseEsearchIds(loadResearchFixture('pubmed-esearch'));
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => /^\d+$/.test(id))).toBe(true);
  });

  it('esummary parses to candidates with no abstract yet', () => {
    const candidates = parseEsummaryResponse(loadResearchFixture('pubmed-esummary'));
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.provider).toBe('pubmed');
      expect(candidate.externalIds.pmid).toMatch(/^\d+$/);
      // esummary genuinely carries no abstract — hydration fills this later.
      expect(candidate.abstract).toBeNull();
    }
  });

  it('reads DOI and PMCID out of the articleids array', () => {
    const candidates = parseEsummaryResponse(loadResearchFixture('pubmed-esummary'));
    const withDoi = candidates.find((candidate) => candidate.doi !== null);
    expect(withDoi?.doi).toMatch(/^10\./);
  });

  it('parses the several PubMed date formats', () => {
    expect(parsePubmedDate({ sortpubdate: '2026/03/01 00:00' })).toBe('2026-03-01');
    expect(parsePubmedDate({ pubdate: '2026 Mar' })).toBe('2026-03-01');
    expect(parsePubmedDate({ pubdate: '2026 Mar-Apr' })).toBe('2026-03-01');
    expect(parsePubmedDate({ pubdate: '2026' })).toBe('2026-01-01');
    expect(parsePubmedDate({ pubdate: '2026 Dec 15' })).toBe('2026-12-15');
    expect(parsePubmedDate({})).toBeNull();
  });

  it('merges hydrated abstracts by PMID, keeping the PubMed identity', () => {
    const base = parseEsummaryResponse(loadResearchFixture('pubmed-esummary'));
    const hydration = parseSearchResponse(loadResearchFixture('europepmc-by-pmid'));
    const byPmid = new Map(
      hydration.map((candidate) => [candidate.externalIds.pmid ?? '', candidate] as const),
    );

    const merged = mergeHydrated(base, byPmid);
    const filled = merged.find((candidate) => byPmid.has(candidate.externalIds.pmid ?? ''));
    expect(filled?.abstract).not.toBeNull();
    // Identity stays PubMed's; only the missing fields come from Europe PMC.
    expect(filled?.provider).toBe('pubmed');
  });
});
