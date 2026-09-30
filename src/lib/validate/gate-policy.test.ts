/**
 * The tolerant-publishing policy.
 *
 * These pin the redesigned severities so a normal, imperfect article publishes and only a
 * genuinely unsafe or unusable one is blocked. Each case asserts on the SEVERITY the gate
 * assigns, not merely that an issue exists — a rule that quietly became hard again would fail
 * here rather than in production on a Hanoi morning.
 */
import { describe, expect, it } from 'vitest';
import type { Block } from '@/lib/domain/blocks';
import { hardFailureCodes, validateArticle, type GateInput } from './gate';

const CATEGORY_SLUGS = ['vi-chat-vitamin'];
const ALLOWED_HOSTS = ['medlineplus.gov'];

/** `n` distinct filler words, none of which appear in the source. */
const filler = (n: number): string => Array.from({ length: n }, (_, i) => `noi${i % 50}`).join(' ');
/** `n` distinct words for a deliberately shared run. */
const run = (n: number): string => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

function base(body: Block[], overrides: Partial<GateInput> = {}): GateInput {
  return {
    title: 'Một tiêu đề đủ dài cho bài viết sức khoẻ',
    dek: 'Một câu tóm tắt đủ dài cho bài viết, giải thích ngắn gọn nội dung mà người đọc sẽ tìm thấy bên trong.',
    slug: 'bai-viet-suc-khoe-thu-nghiem',
    categorySlug: 'vi-chat-vitamin',
    body,
    references: [],
    sourceText: 'Tư liệu nguồn không trùng với bài viết ở đây.',
    sourceTitle: 'Số 100: Một chủ đề',
    allowedCategorySlugs: CATEGORY_SLUGS,
    allowedReferenceHosts: ALLOWED_HOSTS,
    ...overrides,
  };
}

/** A minimal, structurally-clean body whose word count is `n + 2` ("Theo video"). */
function bodyWords(n: number): Block[] {
  return [
    { t: 'source_note' },
    { t: 'p', text: filler(n), attribution: 'general' },
    { t: 'p', text: 'Theo video', attribution: 'speaker' },
    { t: 'disclaimer' },
  ];
}

function codesWithSeverity(input: GateInput) {
  const report = validateArticle(input);
  return {
    report,
    hard: hardFailureCodes(report),
    soft: report.issues.filter((i) => i.severity === 'soft').map((i) => i.code),
  };
}

describe('word-count policy', () => {
  it.each([
    [300, 'hard'],
    [349, 'hard'],
    [350, 'soft'],
    [450, 'soft'],
    [550, 'soft'],
    [900, 'clean'],
    [1700, 'clean'],
    [2000, 'softlong'],
    [2700, 'hardlong'],
  ] as const)('a %i-word article is classified %s', (words, expected) => {
    const { report, hard, soft } = codesWithSeverity(base(bodyWords(words - 2)));
    expect(report.stats.wordCount).toBe(words);
    if (expected === 'hard') expect(hard).toContain('too_short');
    if (expected === 'hardlong') expect(hard).toContain('too_long');
    if (expected === 'soft') {
      expect(hard).not.toContain('too_short');
      expect(soft).toContain('short_article');
    }
    if (expected === 'softlong') {
      expect(hard).not.toContain('too_long');
      expect(soft).toContain('long_article');
    }
    if (expected === 'clean') {
      expect(hard).toStrictEqual([]);
      expect(soft).not.toContain('short_article');
      expect(soft).not.toContain('long_article');
    }
  });
});

describe('copy-overlap policy', () => {
  /** A body whose first paragraph opens with a shared run, then unique filler. */
  const bodyWithRun = (shared: string): Block[] => [
    { t: 'source_note' },
    { t: 'p', text: `${shared} ${filler(400)}`, attribution: 'general' },
    { t: 'p', text: 'Theo video', attribution: 'speaker' },
    { t: 'disclaimer' },
  ];
  const withSource = (shared: string) =>
    base(bodyWithRun(shared), { sourceText: `${shared} phần còn lại của tư liệu nguồn` });

  it('does not flag a 12-word shared run at all', () => {
    const { hard, soft } = codesWithSeverity(withSource(run(12)));
    expect(hard).not.toContain('copy_overlap');
    expect(soft).not.toContain('copy_overlap');
  });

  it('warns (does not block) on a 13-word shared run', () => {
    const { hard, report } = codesWithSeverity(withSource(run(13)));
    expect(hard).not.toContain('copy_overlap');
    expect(report.issues.some((i) => i.code === 'copy_overlap' && i.severity === 'soft')).toBe(
      true,
    );
  });

  it('warns (does not block) on a 20-word shared run', () => {
    const { hard, report } = codesWithSeverity(withSource(run(20)));
    expect(hard).not.toContain('copy_overlap');
    expect(report.issues.some((i) => i.code === 'copy_overlap' && i.severity === 'soft')).toBe(
      true,
    );
  });

  it('hard-fails a very long verbatim run', () => {
    const { hard } = codesWithSeverity(withSource(run(35)));
    expect(hard).toContain('copy_overlap');
  });

  it('hard-fails an article that is largely lifted (high copied ratio)', () => {
    // The whole body is the source, so both the longest run and the copied ratio are extreme.
    const lifted = run(60);
    const input = base(
      [
        { t: 'source_note' },
        { t: 'p', text: lifted, attribution: 'general' },
        { t: 'p', text: 'Theo video', attribution: 'speaker' },
        { t: 'disclaimer' },
      ],
      { sourceText: lifted },
    );
    expect(hardFailureCodes(validateArticle(input))).toContain('copy_overlap');
  });
});

describe('prescriptive-language policy is context-aware', () => {
  const inParagraph = (sentence: string) =>
    base([
      { t: 'source_note' },
      { t: 'p', text: `${sentence} ${filler(400)}`, attribution: 'general' },
      { t: 'p', text: 'Theo video', attribution: 'speaker' },
      { t: 'disclaimer' },
    ]);

  it.each([
    'Bạn có thể tự điều trị tình trạng này ngay tại nhà mà không cần ai hướng dẫn.',
    'Nên tự điều trị bằng các loại thảo dược quen thuộc trước khi nghĩ đến việc đi khám.',
  ])('hard-fails genuine self-treatment encouragement: %j', (sentence) => {
    expect(hardFailureCodes(validateArticle(inParagraph(sentence)))).toContain(
      'prescriptive_language',
    );
  });

  it.each([
    'Người đọc không nên tự điều trị mà hãy đi khám để được bác sĩ tư vấn cẩn thận.',
    'Lời khuyên quan trọng là tránh tự điều trị khi chưa có chẩn đoán chính thức từ bác sĩ.',
    'Tốt nhất là không tự ý điều trị và không tự ý dùng thuốc khi chưa hỏi ý kiến bác sĩ.',
    'Thông điệp cốt lõi: không nên tự chẩn đoán hay tự điều trị khi nghi ngờ nhiễm virus.',
  ])('allows a warning against self-care, including coordinated phrases: %j', (sentence) => {
    expect(hardFailureCodes(validateArticle(inParagraph(sentence)))).not.toContain(
      'prescriptive_language',
    );
  });
});

describe('references and structure are never hard blockers', () => {
  it('publishes a clean article with zero references', () => {
    const report = validateArticle(base(bodyWords(898)));
    expect(hardFailureCodes(report)).toStrictEqual([]);
  });

  it('a three-block body clears the gate on hard checks', () => {
    const report = validateArticle(
      base([
        { t: 'h2', text: 'Một phần nội dung' },
        { t: 'p', text: filler(900), attribution: 'general' },
        { t: 'p', text: 'Theo video điều này được nhắc tới', attribution: 'speaker' },
      ]),
    );
    expect(hardFailureCodes(report)).toStrictEqual([]);
  });
});
