/**
 * Eligibility and deduplication.
 *
 * Eligibility runs before scoring, so a paper a high score cannot rescue is dropped here.
 * The dangerous cases are the ones a naive filter passes: a retraction notice whose abstract
 * discusses a finding in the past tense, a preprint that Crossref labels a journal article,
 * a paediatric dosing trial. Each has a test that asserts the specific reason code, so a
 * later change that stops catching one fails loudly.
 */
import { describe, expect, it } from 'vitest';
import {
  checkEligibility,
  filterCandidates,
  mergeDuplicates,
  MIN_ABSTRACT_CHARS,
} from './eligibility';
import type { ResearchCandidate } from './types';

const TODAY = '2026-09-27';
const EARLIEST = '2026-01-01';

function candidate(overrides: Partial<ResearchCandidate> = {}): ResearchCandidate {
  return {
    provider: 'europepmc',
    title: 'A randomized trial of magnesium supplementation in adults with hypertension',
    abstract: 'x'.repeat(MIN_ABSTRACT_CHARS + 50),
    doi: '10.1000/abc123',
    sourceUrl: 'https://europepmc.org/article/MED/40000001',
    journal: 'Nutrients',
    issn: '2072-6643',
    publicationDate: '2026-06-15',
    authors: [{ name: 'A Researcher' }],
    citedByCount: 5,
    isOpenAccess: true,
    externalIds: { pmid: '40000001' },
    publicationTypes: ['journal article', 'randomized controlled trial'],
    keywords: ['magnesium', 'hypertension'],
    language: 'eng',
    ...overrides,
  };
}

describe('checkEligibility', () => {
  it('accepts a well-formed recent trial', () => {
    expect(checkEligibility(candidate(), { today: TODAY, earliestDate: EARLIEST })).toEqual({
      eligible: true,
    });
  });

  it('rejects a too-short abstract', () => {
    const verdict = checkEligibility(candidate({ abstract: 'too short' }), {
      today: TODAY,
      earliestDate: EARLIEST,
    });
    expect(verdict).toMatchObject({ eligible: false, reason: 'abstract_too_short' });
  });

  it('rejects a paper older than the window', () => {
    const verdict = checkEligibility(candidate({ publicationDate: '2019-01-01' }), {
      today: TODAY,
      earliestDate: EARLIEST,
    });
    expect(verdict).toMatchObject({ eligible: false, reason: 'too_old' });
  });

  it('rejects a future-dated paper as a metadata error', () => {
    const verdict = checkEligibility(candidate({ publicationDate: '2027-01-01' }), {
      today: TODAY,
      earliestDate: EARLIEST,
    });
    expect(verdict).toMatchObject({ eligible: false, reason: 'future_dated' });
  });

  it('rejects a retraction notice by title', () => {
    const verdict = checkEligibility(
      candidate({ title: 'Retraction: Effects of vitamin D on mortality' }),
      { today: TODAY, earliestDate: EARLIEST },
    );
    expect(verdict).toMatchObject({ eligible: false, reason: 'retraction_notice' });
  });

  it('rejects a retracted paper by publication type', () => {
    const verdict = checkEligibility(
      candidate({ publicationTypes: ['journal article', 'retracted publication'] }),
      { today: TODAY, earliestDate: EARLIEST },
    );
    expect(verdict).toMatchObject({ eligible: false, reason: 'retracted' });
  });

  it('rejects a preprint by journal name', () => {
    const verdict = checkEligibility(candidate({ journal: 'medRxiv' }), {
      today: TODAY,
      earliestDate: EARLIEST,
    });
    expect(verdict).toMatchObject({ eligible: false, reason: 'preprint' });
  });

  it('rejects an editorial', () => {
    const verdict = checkEligibility(candidate({ publicationTypes: ['editorial'] }), {
      today: TODAY,
      earliestDate: EARLIEST,
    });
    expect(verdict).toMatchObject({ eligible: false, reason: 'editorial' });
  });

  it('rejects a non-English paper', () => {
    const verdict = checkEligibility(candidate({ language: 'fre' }), {
      today: TODAY,
      earliestDate: EARLIEST,
    });
    expect(verdict).toMatchObject({ eligible: false, reason: 'language_not_supported' });
  });

  it('rejects a malformed DOI', () => {
    const verdict = checkEligibility(candidate({ doi: 'not-a-doi' }), {
      today: TODAY,
      earliestDate: EARLIEST,
    });
    expect(verdict).toMatchObject({ eligible: false, reason: 'malformed_doi' });
  });

  it('rejects an off-limits paediatric dosing trial before it can be scored', () => {
    const verdict = checkEligibility(
      candidate({
        title: 'Optimal vitamin D dosing in paediatric patients',
        abstract:
          'This trial evaluated paediatric dosing of vitamin D across infant cohorts. '.repeat(10),
      }),
      { today: TODAY, earliestDate: EARLIEST },
    );
    expect(verdict).toMatchObject({ eligible: false, reason: 'paediatric_dosing' });
  });

  it('rejects a cancer-treatment-choice comparison', () => {
    const verdict = checkEligibility(
      candidate({
        title: 'Chemotherapy regimen A versus B in metastatic disease',
        abstract:
          'We compared one chemotherapy regimen versus another for progression-free survival. '.repeat(
            8,
          ),
      }),
      { today: TODAY, earliestDate: EARLIEST },
    );
    expect(verdict).toMatchObject({ eligible: false, reason: 'cancer_treatment_choice' });
  });

  it('rejects a paper with no authors', () => {
    const verdict = checkEligibility(candidate({ authors: [] }), {
      today: TODAY,
      earliestDate: EARLIEST,
    });
    expect(verdict).toMatchObject({ eligible: false, reason: 'no_authors' });
  });

  it('allows a DOI-less paper (URL hash still dedups it)', () => {
    const verdict = checkEligibility(candidate({ doi: null }), {
      today: TODAY,
      earliestDate: EARLIEST,
    });
    expect(verdict.eligible).toBe(true);
  });
});

describe('filterCandidates', () => {
  it('splits eligible from rejected and records reasons', () => {
    const result = filterCandidates(
      [candidate(), candidate({ title: 'Retraction: something', doi: '10.1000/z' })],
      { today: TODAY, earliestDate: EARLIEST },
    );
    expect(result.eligible).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toBe('retraction_notice');
  });
});

describe('mergeDuplicates', () => {
  it('collapses the same paper seen by two providers, on DOI', () => {
    const epmc = candidate({
      provider: 'europepmc',
      abstract: 'x'.repeat(700),
      citedByCount: null,
    });
    const crossref = candidate({
      provider: 'crossref',
      abstract: 'y'.repeat(400),
      citedByCount: 42,
      sourceUrl: 'https://doi.org/10.1000/abc123',
      externalIds: {},
    });

    const merged = mergeDuplicates([epmc, crossref]);
    expect(merged).toHaveLength(1);
    // The longer abstract and the known citation count both survive the merge.
    expect(merged[0]?.abstract?.length).toBe(700);
    expect(merged[0]?.citedByCount).toBe(42);
  });

  it('collapses on PMID when DOIs differ (preprint vs published is left to the trigram check)', () => {
    const a = candidate({ doi: '10.1/a', externalIds: { pmid: '999' } });
    const b = candidate({ doi: '10.1/b', externalIds: { pmid: '999' }, sourceUrl: 'https://x/2' });
    expect(mergeDuplicates([a, b])).toHaveLength(1);
  });

  it('keeps genuinely distinct papers apart', () => {
    const a = candidate({ doi: '10.1/a', externalIds: { pmid: '1' }, sourceUrl: 'https://x/1' });
    const b = candidate({ doi: '10.1/b', externalIds: { pmid: '2' }, sourceUrl: 'https://x/2' });
    expect(mergeDuplicates([a, b])).toHaveLength(2);
  });
});
