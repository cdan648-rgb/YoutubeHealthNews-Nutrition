/**
 * Selection — the claim-before-generate path, and the end-to-end assembly.
 *
 * The whole point of the design is that nothing is spent on a paper before the database
 * confirms it is ours, and that a taken paper advances to the next candidate rather than
 * failing the run. Both are asserted here with stub providers and a stub claim function, so
 * no network call and no database call happens.
 */
import { describe, expect, it, vi } from 'vitest';
import { buildTerms, claimBestAvailable, claimResearchSource, toClaimPayload } from './select';
import { rankCandidates, type ScoredCandidate } from './score';
import type { CandidateProvider, ResearchCandidate } from './types';
import type { HanoiDate } from '@/lib/time';

const TODAY = '2026-09-27' as HanoiDate;

function candidate(overrides: Partial<ResearchCandidate> = {}): ResearchCandidate {
  return {
    provider: 'europepmc',
    title: 'Magnesium and metabolic health in adults: a randomized controlled trial',
    abstract: 'Magnesium supplementation improved insulin sensitivity in this cohort. '.repeat(12),
    doi: '10.1000/base',
    sourceUrl: 'https://europepmc.org/article/MED/1',
    journal: 'Nutrients',
    issn: '2072-6643',
    publicationDate: '2026-06-15',
    authors: [{ name: 'A Researcher' }],
    citedByCount: 8,
    isOpenAccess: true,
    externalIds: { pmid: '1' },
    publicationTypes: ['journal article'],
    keywords: ['magnesium'],
    language: 'eng',
    ...overrides,
  };
}

function ranked(candidates: readonly ResearchCandidate[]): readonly ScoredCandidate[] {
  return rankCandidates(candidates, {
    today: TODAY,
    journalTiers: null,
    categoryKeywords: ['magnesium'],
  });
}

function stubProvider(
  name: CandidateProvider['name'],
  results: readonly ResearchCandidate[],
): CandidateProvider {
  return { name, search: () => Promise.resolve(results) };
}

describe('buildTerms', () => {
  it('quotes phrases but not single words, and de-duplicates', () => {
    const terms = buildTerms(['magnesium', 'vitamin D', 'magnesium', 'ab']);
    expect(terms).toContain('magnesium');
    expect(terms).toContain('"vitamin D"');
    expect(terms.filter((term) => term === 'magnesium')).toHaveLength(1);
    // Terms shorter than 3 chars are dropped.
    expect(terms).not.toContain('ab');
  });
});

describe('claimBestAvailable', () => {
  it('claims the first candidate the database accepts', async () => {
    const scored = ranked([candidate({ doi: '10.1000/a' }), candidate({ doi: '10.1000/b' })]);
    const claim = vi.fn(() => Promise.resolve({ id: 'row-1', outcome: 'claimed' }));

    const result = await claimBestAvailable(scored, claim, {
      maxAttempts: 10,
      log: () => undefined,
    });
    expect(result?.id).toBe('row-1');
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it('advances past taken papers (duplicate, then similar) to the first free one', async () => {
    const scored = ranked([
      candidate({
        doi: '10.1000/a',
        title: 'Zzz first by score',
        journal: 'The Lancet',
        publicationDate: '2026-09-25',
      }),
      candidate({ doi: '10.1000/b', publicationDate: '2026-09-10' }),
      candidate({ doi: '10.1000/c', publicationDate: '2026-09-05' }),
    ]);
    const outcomes = ['duplicate', 'similar', 'claimed'];
    let call = 0;
    const claim = vi.fn(() => {
      const outcome = outcomes[call] ?? 'duplicate';
      call += 1;
      return Promise.resolve({ id: outcome === 'claimed' ? 'row-c' : null, outcome });
    });

    const result = await claimBestAvailable(scored, claim, {
      maxAttempts: 10,
      log: () => undefined,
    });
    expect(result?.id).toBe('row-c');
    expect(claim).toHaveBeenCalledTimes(3);
  });

  it('gives up after maxAttempts without claiming anything', async () => {
    const scored = ranked([
      candidate({ doi: '10.1000/a' }),
      candidate({ doi: '10.1000/b', sourceUrl: 'https://x/2', externalIds: { pmid: '2' } }),
      candidate({ doi: '10.1000/c', sourceUrl: 'https://x/3', externalIds: { pmid: '3' } }),
    ]);
    const claim = vi.fn(() => Promise.resolve({ id: null, outcome: 'duplicate' }));

    const result = await claimBestAvailable(scored, claim, {
      maxAttempts: 2,
      log: () => undefined,
    });
    expect(result).toBeNull();
    expect(claim).toHaveBeenCalledTimes(2); // stopped at the cap, did not try the third
  });
});

describe('toClaimPayload', () => {
  it('carries the score components so the pick is auditable', () => {
    const scored = ranked([candidate()])[0] as ScoredCandidate;
    const payload = toClaimPayload(scored);
    expect(payload.score).toBe(scored.score);
    expect(payload.score_components).toMatchObject({ rank: 1, poolSize: 1 });
    expect((payload.score_components as { provider: string }).provider).toBe('europepmc');
    expect(payload.external_ids).toEqual({ pmid: '1' });
  });
});

describe('claimResearchSource (assembly)', () => {
  const topics = {
    terms: ['magnesium'],
    keywords: ['magnesium'],
    journalTiers: null,
  };

  it('gathers, merges, filters, ranks and claims — no network, no db', async () => {
    // Same paper from two providers (shared PMID) plus one ineligible preprint.
    const shared = candidate({ doi: '10.1000/shared', externalIds: { pmid: '100' } });
    const crossrefCopy = candidate({
      provider: 'crossref',
      doi: '10.1000/shared',
      externalIds: {},
      sourceUrl: 'https://doi.org/10.1000/shared',
      citedByCount: 30,
    });
    const preprint = candidate({
      doi: '10.1000/pre',
      journal: 'bioRxiv',
      externalIds: { pmid: '200' },
      sourceUrl: 'https://x/pre',
    });

    const claims: unknown[] = [];
    const client = {
      rpc: vi.fn((_name: string, args: { p: unknown }) => {
        claims.push(args.p);
        return Promise.resolve({ data: [{ id: 'claimed-row', outcome: 'claimed' }], error: null });
      }),
    } as never;

    const result = await claimResearchSource(client, {
      today: TODAY,
      providers: [
        stubProvider('europepmc', [shared, preprint]),
        stubProvider('crossref', [crossrefCopy]),
      ],
      loadTopics: () => Promise.resolve(topics),
    });

    expect(result?.id).toBe('claimed-row');
    // The preprint was filtered out, and the two copies merged, so exactly one claim was made.
    expect(claims).toHaveLength(1);
  });

  it('returns null when the pool has nothing eligible', async () => {
    const client = { rpc: vi.fn() } as never;
    const preprintOnly = candidate({ journal: 'medRxiv' });

    const result = await claimResearchSource(client, {
      today: TODAY,
      providers: [stubProvider('europepmc', [preprintOnly])],
      loadTopics: () => Promise.resolve(topics),
    });
    expect(result).toBeNull();
  });

  it('a provider that throws contributes nothing and does not sink the run', async () => {
    const good = candidate({ doi: '10.1000/good' });
    const bad: CandidateProvider = {
      name: 'crossref',
      search: () => Promise.reject(new Error('provider down')),
    };
    const logged: string[] = [];
    const client = {
      rpc: vi.fn(() => Promise.resolve({ data: [{ id: 'row', outcome: 'claimed' }], error: null })),
    } as never;

    const result = await claimResearchSource(client, {
      today: TODAY,
      providers: [stubProvider('europepmc', [good]), bad],
      loadTopics: () => Promise.resolve(topics),
      log: (entry) => {
        logged.push(entry.code);
      },
    });

    expect(result?.id).toBe('row');
    expect(logged).toContain('research_provider_failed');
  });

  it('returns null (records no_source) when every candidate is already taken', async () => {
    const client = {
      rpc: vi.fn(() =>
        Promise.resolve({ data: [{ id: null, outcome: 'duplicate' }], error: null }),
      ),
    } as never;

    const result = await claimResearchSource(client, {
      today: TODAY,
      providers: [stubProvider('europepmc', [candidate()])],
      loadTopics: () => Promise.resolve(topics),
    });
    expect(result).toBeNull();
  });
});
