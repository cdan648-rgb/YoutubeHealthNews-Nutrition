/**
 * Deterministic body-normalisation tests.
 *
 * These prove the normaliser turns the structural and attribution gaps that used to block a
 * publish into free, deterministic corrections — and that it invents nothing.
 */
import { describe, expect, it } from 'vitest';
import type { Block } from './blocks';
import { normalizeBody } from './normalize';

const count = (blocks: readonly Block[], type: Block['t']) =>
  blocks.filter((b) => b.t === type).length;

describe('normalizeBody — render-critical markers', () => {
  it('inserts a missing source note, video embed and disclaimer for a YouTube article', () => {
    const body: Block[] = [
      { t: 'h2', text: 'Mở đầu' },
      {
        t: 'p',
        text: 'Một đoạn nội dung giải thích chủ đề của bài viết cho người đọc.',
        attribution: 'general',
      },
    ];
    const out = normalizeBody(body, 'youtube');
    expect(count(out, 'source_note')).toBe(1);
    expect(count(out, 'video_embed')).toBe(1);
    expect(count(out, 'disclaimer')).toBe(1);
    // Disclaimer is last; source note is near the top.
    expect(out[out.length - 1]?.t).toBe('disclaimer');
    expect(out.slice(0, 2).some((b) => b.t === 'source_note')).toBe(true);
  });

  it('de-duplicates repeated markers to exactly one', () => {
    const body: Block[] = [
      { t: 'source_note' },
      { t: 'source_note' },
      {
        t: 'p',
        text: 'Một đoạn nội dung đủ dài để coi là một đoạn văn thực thụ.',
        attribution: 'general',
      },
      { t: 'disclaimer' },
      { t: 'disclaimer' },
    ];
    const out = normalizeBody(body, 'youtube');
    expect(count(out, 'source_note')).toBe(1);
    expect(count(out, 'disclaimer')).toBe(1);
  });
});

describe('normalizeBody — unsupported citations become honest prose', () => {
  it('demotes an established paragraph with no ref to general', () => {
    const body: Block[] = [
      { t: 'source_note' },
      {
        t: 'p',
        text: 'Một tuyên bố được trình bày như sự thật đã xác lập nhưng không có nguồn.',
        attribution: 'established',
      },
      { t: 'disclaimer' },
    ];
    const out = normalizeBody(body, 'youtube');
    const p = out.find((b) => b.t === 'p');
    expect(p?.t === 'p' && p.attribution).toBe('general');
    expect(p && 'ref' in p).toBe(false);
  });

  it('demotes a cited pull quote with no ref to a paraphrase', () => {
    const body: Block[] = [
      { t: 'source_note' },
      {
        t: 'pull_quote',
        text: 'Một câu trích được cho là dẫn nguồn nhưng không trỏ tới đâu.',
        kind: 'cited',
      },
      { t: 'disclaimer' },
    ];
    const out = normalizeBody(body, 'youtube');
    const q = out.find((b) => b.t === 'pull_quote');
    expect(q?.t === 'pull_quote' && q.kind).toBe('paraphrase');
  });
});

describe('normalizeBody — research corrections', () => {
  it('strips a video embed, downgrades a speaker attribution, and adds the caution callout', () => {
    const body: Block[] = [
      { t: 'source_note' },
      { t: 'video_embed' },
      {
        t: 'p',
        text: 'Một đoạn bị gán nhầm cho người nói trong khi đây là bài nghiên cứu.',
        attribution: 'speaker',
      },
      { t: 'disclaimer' },
    ];
    const out = normalizeBody(body, 'research');
    expect(count(out, 'video_embed')).toBe(0);
    expect(out.some((b) => b.t === 'p' && b.attribution === 'speaker')).toBe(false);
    expect(out.some((b) => b.t === 'callout' && b.tone === 'caution')).toBe(true);
  });
});
