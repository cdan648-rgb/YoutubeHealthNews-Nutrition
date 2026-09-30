/**
 * Reconciliation unit tests.
 *
 * These pin the body-ref ↔ references contract at the deterministic layer, independent of the
 * model: a well-formed draft is untouched, a citation with a real verified source behind it is
 * kept or recovered, and a citation with nothing behind it is stripped rather than invented.
 */
import { describe, expect, it } from 'vitest';
import type { Block, Reference } from '@/lib/domain/blocks';
import { reconcileReferences } from './reconcile';

const REF_A: Reference = {
  label: '1',
  title: 'Magnesium in diet',
  publisher: 'MedlinePlus',
  url: 'https://medlineplus.gov/ency/article/002423.htm',
};
const REF_B: Reference = {
  label: '2',
  title: 'Minerals',
  publisher: 'MedlinePlus',
  url: 'https://medlineplus.gov/minerals.html',
};

const para = (attribution: 'general' | 'speaker' | 'established', ref?: number): Block =>
  ref === undefined
    ? { t: 'p', text: 'Một đoạn văn giải thích vai trò của khoáng chất trong cơ thể.', attribution }
    : {
        t: 'p',
        text: 'Một đoạn văn giải thích vai trò của khoáng chất trong cơ thể.',
        attribution,
        ref,
      };

describe('reconcileReferences — no-op cases', () => {
  it('leaves a draft whose every ref resolves exactly as it is', () => {
    const body: Block[] = [para('general'), para('established', 0), para('established', 1)];
    const result = reconcileReferences(body, [REF_A, REF_B], []);
    expect(result.changed).toBe(false);
    expect(result.references).toStrictEqual([REF_A, REF_B]);
    expect(result.body).toStrictEqual(body);
  });

  it('treats references=[] with no citations as valid and untouched', () => {
    const body: Block[] = [para('general'), para('speaker')];
    const result = reconcileReferences(body, [], []);
    expect(result.changed).toBe(false);
    expect(result.references).toStrictEqual([]);
    expect(result.body).toStrictEqual(body);
  });

  it('accepts a citation of index 0 against a single reference (zero-based)', () => {
    const body: Block[] = [para('established', 0)];
    const result = reconcileReferences(body, [REF_A], []);
    expect(result.changed).toBe(false);
    expect(result.body[0]).toStrictEqual(para('established', 0));
  });
});

describe('reconcileReferences — stripping unsupported citations (no verified source)', () => {
  it('strips established+ref markers when references and pool are both empty', () => {
    // The 2026-09-30 shape: body cites ref 0 and ref 1, references is [], no verified pool.
    const body: Block[] = [para('established', 1), para('general'), para('established', 0)];
    const result = reconcileReferences(body, [], []);
    expect(result.changed).toBe(true);
    // No source was invented: the references array stays empty.
    expect(result.references).toStrictEqual([]);
    // The two citations are demoted to plain prose with no ref.
    expect(result.body[0]).toStrictEqual(para('general'));
    expect(result.body[2]).toStrictEqual(para('general'));
    expect(result.body.every((block) => !('ref' in block && block.ref !== undefined))).toBe(true);
  });

  it('demotes a cited pull quote with a dangling ref to a paraphrase', () => {
    const body: Block[] = [
      { t: 'pull_quote', text: 'Một câu diễn giải ngắn gọn về nội dung.', kind: 'cited', ref: 3 },
    ];
    const result = reconcileReferences(body, [REF_A], []);
    expect(result.changed).toBe(true);
    expect(result.body[0]).toStrictEqual({
      t: 'pull_quote',
      text: 'Một câu diễn giải ngắn gọn về nội dung.',
      kind: 'paraphrase',
    });
  });

  it('keeps in-range refs and strips only the out-of-range one, without inventing sources', () => {
    const body: Block[] = [para('established', 0), para('established', 5)];
    const result = reconcileReferences(body, [REF_A], []);
    expect(result.changed).toBe(true);
    // The model's real reference is preserved, not replaced.
    expect(result.references).toStrictEqual([REF_A]);
    expect(result.body[0]).toStrictEqual(para('established', 0));
    expect(result.body[1]).toStrictEqual(para('general'));
  });
});

describe('reconcileReferences — recovering a dropped references array from the verified pool', () => {
  it('adopts the pool when the body cites into an empty references array', () => {
    const body: Block[] = [para('established', 0), para('established', 1)];
    const result = reconcileReferences(body, [], [REF_A, REF_B]);
    expect(result.changed).toBe(true);
    // Both refs now resolve against the adopted pool.
    expect(result.references).toHaveLength(2);
    expect(result.references.map((r) => r.url)).toStrictEqual([REF_A.url, REF_B.url]);
    // Labels are renumbered to their array position.
    expect(result.references.map((r) => r.label)).toStrictEqual(['1', '2']);
    expect(result.body).toStrictEqual(body);
  });

  it('adopts the pool but still strips refs that exceed it', () => {
    const body: Block[] = [para('established', 0), para('established', 5)];
    const result = reconcileReferences(body, [], [REF_A]);
    expect(result.changed).toBe(true);
    expect(result.references).toHaveLength(1);
    expect(result.body[0]).toStrictEqual(para('established', 0));
    // ref 5 has no verified source even after adoption → stripped.
    expect(result.body[1]).toStrictEqual(para('general'));
  });

  it('does not adopt the pool when the model already supplied its own references', () => {
    // Partial references present (length 1) plus an out-of-range ref: keep the model's own
    // reference, strip the dangler — never silently swap in a different source list.
    const body: Block[] = [para('established', 0), para('established', 2)];
    const result = reconcileReferences(body, [REF_A], [REF_B]);
    expect(result.references).toStrictEqual([REF_A]);
    expect(result.body[1]).toStrictEqual(para('general'));
  });
});
