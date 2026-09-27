/**
 * Scoring.
 *
 * The score is an explicit editorial preference, not a claim of importance, so the tests
 * assert three things: that each component behaves monotonically the way its rationale says,
 * that the ranking is total and deterministic (the "highest score was chosen" claim must be
 * testable), and that every component and the rank travel into the stored breakdown so a
 * pick can be audited.
 */
import { describe, expect, it } from 'vitest';
import {
  accessibilityScore,
  citationVelocityScore,
  journalTierScore,
  rankCandidates,
  recencyScore,
  scoreCandidate,
  topicalFitScore,
  WEIGHTS,
  type JournalTiers,
} from './score';
import type { ResearchCandidate } from './types';

const TODAY = '2026-09-27';

const TIERS: JournalTiers = {
  tier3: ['New England Journal of Medicine', 'The Lancet'],
  tier2: ['Diabetes Care', 'American Journal of Clinical Nutrition'],
  default: 1,
};

function candidate(overrides: Partial<ResearchCandidate> = {}): ResearchCandidate {
  return {
    provider: 'europepmc',
    title: 'Magnesium and metabolic health',
    abstract: 'Magnesium supports insulin sensitivity and metabolic health in adults.',
    doi: '10.1/x',
    sourceUrl: 'https://europepmc.org/article/MED/1',
    journal: 'Nutrients',
    issn: '2072-6643',
    publicationDate: '2026-06-15',
    authors: [{ name: 'A' }],
    citedByCount: 5,
    isOpenAccess: true,
    externalIds: {},
    publicationTypes: ['journal article'],
    keywords: ['magnesium'],
    language: 'eng',
    ...overrides,
  };
}

describe('recencyScore', () => {
  it('decays: newer scores higher', () => {
    const recent = recencyScore('2026-09-01', TODAY).normalized;
    const older = recencyScore('2026-03-01', TODAY).normalized;
    expect(recent).toBeGreaterThan(older);
  });

  it('halves roughly every 120 days', () => {
    const at120 = recencyScore('2026-05-30', TODAY).normalized; // 120 days before
    expect(at120).toBeCloseTo(0.5, 1);
  });

  it('a missing date scores zero', () => {
    expect(recencyScore(null, TODAY).normalized).toBe(0);
  });
});

describe('journalTierScore', () => {
  it('tier 3 > tier 2 > default', () => {
    const t3 = journalTierScore('New England Journal of Medicine', TIERS).normalized;
    const t2 = journalTierScore('Diabetes Care', TIERS).normalized;
    const other = journalTierScore('Some Local Journal', TIERS).normalized;
    expect(t3).toBeGreaterThan(t2);
    expect(t2).toBeGreaterThan(other);
  });

  it('matches on folded name, ignoring "The" and punctuation', () => {
    expect(journalTierScore('lancet', TIERS).normalized).toBe(
      journalTierScore('The Lancet', TIERS).normalized,
    );
  });

  it('falls back to the configured default when tiers are absent', () => {
    const score = journalTierScore('Anything', null);
    expect(score.normalized).toBeCloseTo(1 / 3, 5);
  });
});

describe('citationVelocityScore', () => {
  it('an unknown count scores as neutral, not zero', () => {
    const unknown = citationVelocityScore(null, '2026-06-15', TODAY);
    expect(unknown.normalized).toBe(0.5);
    expect(unknown.note).toMatch(/neutral/);
  });

  it('more citations per month scores higher, but saturates', () => {
    const low = citationVelocityScore(2, '2026-06-15', TODAY).normalized;
    const high = citationVelocityScore(40, '2026-06-15', TODAY).normalized;
    const extreme = citationVelocityScore(400, '2026-06-15', TODAY).normalized;
    expect(high).toBeGreaterThan(low);
    expect(extreme).toBeLessThanOrEqual(1);
    expect(extreme - high).toBeLessThan(high - low); // compression
  });
});

describe('topicalFitScore', () => {
  const keywords = ['magnesium', 'insulin', 'thyroid', 'osteoporosis', 'microbiome'];

  it('a matching paper scores above a non-matching one', () => {
    const hit = topicalFitScore(candidate({ title: 'Magnesium and insulin resistance' }), keywords);
    const miss = topicalFitScore(
      candidate({ title: 'Astronomy of distant galaxies', abstract: 'stars', keywords: [] }),
      keywords,
    );
    expect(hit.normalized).toBeGreaterThan(miss.normalized);
    expect(miss.normalized).toBe(0);
  });

  it('does not match a keyword as a substring of a longer word', () => {
    const score = topicalFitScore(
      candidate({ title: 'Study of magnesiumlike alloys', abstract: 'metallurgy', keywords: [] }),
      ['magnesium'],
    );
    expect(score.normalized).toBe(0);
  });
});

describe('accessibilityScore', () => {
  it('open access > unknown > paywalled', () => {
    expect(accessibilityScore(true).normalized).toBeGreaterThan(
      accessibilityScore(null).normalized,
    );
    expect(accessibilityScore(null).normalized).toBeGreaterThan(
      accessibilityScore(false).normalized,
    );
  });
});

describe('scoreCandidate', () => {
  it('total is the sum of weighted contributions, and weights sum to 1', () => {
    const total = Object.values(WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBeCloseTo(1, 6);

    const scored = scoreCandidate(candidate(), {
      today: TODAY,
      journalTiers: TIERS,
      categoryKeywords: ['magnesium'],
    });
    const sum = Object.values(scored.breakdown.components).reduce(
      (acc, component) => acc + component.contribution,
      0,
    );
    expect(scored.score).toBeCloseTo(sum, 6);
  });

  it('carries a disclaimer that the score is not a measure of importance', () => {
    const scored = scoreCandidate(candidate(), {
      today: TODAY,
      journalTiers: TIERS,
      categoryKeywords: ['magnesium'],
    });
    expect(scored.breakdown.disclaimer).toMatch(/not a measure of scientific importance/i);
  });
});

describe('rankCandidates', () => {
  const context = { today: TODAY, journalTiers: TIERS, categoryKeywords: ['magnesium', 'insulin'] };

  it('orders highest score first and records rank and pool size', () => {
    const strong = candidate({
      doi: '10.1/strong',
      title: 'Magnesium and insulin sensitivity',
      journal: 'The Lancet',
      publicationDate: '2026-09-20',
      isOpenAccess: true,
    });
    const weak = candidate({
      doi: '10.1/weak',
      title: 'Unrelated topic entirely',
      abstract: 'nothing relevant',
      journal: 'Obscure Bulletin',
      publicationDate: '2026-02-01',
      isOpenAccess: false,
      keywords: [],
    });

    const ranked = rankCandidates([weak, strong], context);
    expect(ranked[0]?.candidate.doi).toBe('10.1/strong');
    expect(ranked[0]?.breakdown.rank).toBe(1);
    expect(ranked[0]?.breakdown.poolSize).toBe(2);
    expect(ranked[1]?.breakdown.rank).toBe(2);
  });

  it('is deterministic: ties break on date then title', () => {
    const a = candidate({ doi: '10.1/a', title: 'AAA', publicationDate: '2026-06-15' });
    const b = candidate({ doi: '10.1/b', title: 'BBB', publicationDate: '2026-06-15' });
    const first = rankCandidates([a, b], context).map((entry) => entry.candidate.doi);
    const second = rankCandidates([b, a], context).map((entry) => entry.candidate.doi);
    expect(first).toEqual(second);
  });
});
