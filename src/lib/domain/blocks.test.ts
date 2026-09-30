import { describe, expect, it } from 'vitest';
import {
  blockSchema,
  blocksToPlainText,
  bodySchema,
  checkBodyStructure,
  countWords,
  referenceSchema,
  type Block,
  type Reference,
} from './blocks';

const ref: Reference = {
  label: '1',
  title: 'Magnesium — Health Professional Fact Sheet',
  publisher: 'NIH Office of Dietary Supplements',
  url: 'https://ods.od.nih.gov/factsheets/Magnesium-HealthProfessional/',
};

/** A minimal body that satisfies every structural rule. */
function validBody(): Block[] {
  return [
    { t: 'source_note' },
    { t: 'h2', text: 'Magie làm gì trong tế bào' },
    {
      t: 'p',
      text: 'Magie tham gia vào rất nhiều phản ứng enzyme khác nhau bên trong tế bào của cơ thể.',
      attribution: 'established',
      ref: 0,
    },
    {
      t: 'p',
      text: 'Theo bác sĩ Phúc trong video, tình trạng thiếu magie thường bị bỏ qua trong thực hành.',
      attribution: 'speaker',
    },
    { t: 'h2', text: 'Dấu hiệu thường gặp' },
    { t: 'key_facts', title: 'Những điểm chính', items: ['Điểm thứ nhất', 'Điểm thứ hai'] },
    { t: 'h2', text: 'Điều gì đã được chứng minh' },
    { t: 'callout', tone: 'caution', title: 'Lưu ý', text: 'Đây là thông tin mang tính giáo dục.' },
    { t: 'h2', text: 'Kết luận' },
    { t: 'pull_quote', text: 'Một cách diễn giải lại nội dung của video.', kind: 'paraphrase' },
    { t: 'video_embed' },
    { t: 'disclaimer' },
  ];
}

describe('block schema', () => {
  it('accepts a well-formed body', () => {
    expect(bodySchema.safeParse(validBody()).success).toBe(true);
  });

  it('rejects an unknown block type', () => {
    expect(blockSchema.safeParse({ t: 'iframe', src: 'https://evil.test' }).success).toBe(false);
  });

  it('rejects a body that is not an array', () => {
    expect(bodySchema.safeParse({ t: 'p', text: 'x' }).success).toBe(false);
  });

  it('rejects a paragraph that is too short to be a paragraph', () => {
    expect(blockSchema.safeParse({ t: 'p', text: 'Ngắn.' }).success).toBe(false);
  });

  it('defaults attribution to general rather than silently claiming a source', () => {
    const parsed = blockSchema.parse({
      t: 'p',
      text: 'Một đoạn văn dài vừa đủ để vượt qua giới hạn tối thiểu của schema.',
    });
    expect(parsed).toMatchObject({ attribution: 'general' });
  });

  it('requires a pull quote to declare paraphrase or cited', () => {
    expect(blockSchema.safeParse({ t: 'pull_quote', text: 'x'.repeat(30) }).success).toBe(false);
  });

  it('restricts figure motifs to our own SVG generators', () => {
    expect(
      blockSchema.safeParse({
        t: 'figure_svg',
        motif: 'https://example.com/stock-photo.jpg',
        caption: 'caption',
        alt: 'alt',
      }).success,
    ).toBe(false);
  });

  it('requires references to be real URLs', () => {
    expect(referenceSchema.safeParse({ ...ref, url: 'not-a-url' }).success).toBe(false);
  });
});

describe('checkBodyStructure', () => {
  it('passes a complete body', () => {
    expect(checkBodyStructure(validBody(), [ref])).toStrictEqual([]);
  });

  it('flags too few sections', () => {
    const body = validBody().filter((block) => block.t !== 'h2');
    const codes = checkBodyStructure(body, [ref]).map((issue) => issue.code);
    expect(codes).toContain('too_few_sections');
  });

  it.each(['video_embed', 'source_note', 'disclaimer'] as const)(
    'flags a missing %s block',
    (type) => {
      const body = validBody().filter((block) => block.t !== type);
      const codes = checkBodyStructure(body, [ref]).map((issue) => issue.code);
      expect(codes).toContain(`missing_${type}`);
    },
  );

  it('flags a duplicated disclaimer as firmly as a missing one', () => {
    const body = [...validBody(), { t: 'disclaimer' } as Block];
    const codes = checkBodyStructure(body, [ref]).map((issue) => issue.code);
    expect(codes).toContain('missing_disclaimer');
  });

  it('flags a missing key-facts panel', () => {
    const body = validBody().filter((block) => block.t !== 'key_facts');
    const codes = checkBodyStructure(body, [ref]).map((issue) => issue.code);
    expect(codes).toContain('missing_key_facts');
  });

  it('flags a citation pointing past the end of the reference list', () => {
    const body = validBody().map((block) =>
      block.t === 'p' && block.attribution === 'established' ? { ...block, ref: 7 } : block,
    );
    const codes = checkBodyStructure(body, [ref]).map((issue) => issue.code);
    expect(codes).toContain('dangling_reference');
  });

  it('accepts a body with no citations and an empty reference list', () => {
    // references=[] is legitimate for a YouTube article, PROVIDED nothing cites a source.
    const body = validBody().map((block) =>
      block.t === 'p' && block.attribution === 'established'
        ? { t: 'p' as const, text: block.text, attribution: 'general' as const }
        : block,
    );
    const codes = checkBodyStructure(body, []).map((issue) => issue.code);
    expect(codes).not.toContain('dangling_reference');
    expect(codes).not.toContain('unsourced_established_claim');
  });

  it('flags any citation at all when the reference list is empty', () => {
    // The 2026-09-30 shape: a body cites ref 0 while references is []. Zero-based, so even
    // ref 0 is dangling against an empty array.
    const body = validBody().map((block) =>
      block.t === 'p' && block.attribution === 'established' ? { ...block, ref: 0 } : block,
    );
    const codes = checkBodyStructure(body, []).map((issue) => issue.code);
    expect(codes).toContain('dangling_reference');
  });

  it('accepts multiple citations that each resolve (zero-based indices 0 and 1)', () => {
    const secondRef: Reference = {
      ...ref,
      label: '2',
      url: 'https://medlineplus.gov/minerals.html',
    };
    const body = [
      { t: 'source_note' as const },
      { t: 'h2' as const, text: 'Magie làm gì trong tế bào' },
      {
        t: 'p' as const,
        text: 'Magie tham gia rất nhiều phản ứng enzyme khác nhau trong tế bào.',
        attribution: 'established' as const,
        ref: 0,
      },
      {
        t: 'p' as const,
        text: 'Phần lớn khoáng chất này nằm trong xương và mô chứ không phải máu.',
        attribution: 'established' as const,
        ref: 1,
      },
      {
        t: 'p' as const,
        text: 'Theo bác sĩ trong video, tình trạng này thường bị bỏ qua.',
        attribution: 'speaker' as const,
      },
      { t: 'h2' as const, text: 'Dấu hiệu thường gặp' },
      {
        t: 'key_facts' as const,
        title: 'Những điểm chính',
        items: ['Điểm thứ nhất', 'Điểm thứ hai'],
      },
      { t: 'h2' as const, text: 'Điều gì đã được chứng minh' },
      { t: 'h2' as const, text: 'Kết luận' },
      { t: 'video_embed' as const },
      { t: 'disclaimer' as const },
    ];
    const codes = checkBodyStructure(body, [ref, secondRef]).map((issue) => issue.code);
    expect(codes).not.toContain('dangling_reference');
  });

  it('flags a claim presented as established fact with no source', () => {
    const body = validBody().map((block) =>
      block.t === 'p' && block.attribution === 'established'
        ? { t: 'p' as const, text: block.text, attribution: 'established' as const }
        : block,
    );
    const codes = checkBodyStructure(body, [ref]).map((issue) => issue.code);
    expect(codes).toContain('unsourced_established_claim');
  });

  it('flags a quotation that claims to be cited but points nowhere', () => {
    const body = validBody().map((block) =>
      block.t === 'pull_quote' ? { ...block, kind: 'cited' as const, ref: undefined } : block,
    );
    const codes = checkBodyStructure(body, [ref]).map((issue) => issue.code);
    expect(codes).toContain('uncited_quotation');
  });

  it('flags a body that never distinguishes the speaker from established fact', () => {
    // Without this, an article could present everything the presenter said as
    // settled science, which is the core hallucination risk on a health site.
    const body = validBody().map((block) =>
      block.t === 'p' && block.attribution === 'speaker'
        ? { t: 'p' as const, text: block.text, attribution: 'general' as const }
        : block,
    );
    const codes = checkBodyStructure(body, [ref]).map((issue) => issue.code);
    expect(codes).toContain('no_speaker_attribution');
  });
});

describe('checkBodyStructure — research articles', () => {
  /** A research body: no video embed, no speaker paragraph, a caution callout present. */
  function researchBody(): Block[] {
    return validBody()
      .filter((block) => block.t !== 'video_embed')
      .map((block) =>
        block.t === 'p' && block.attribution === 'speaker'
          ? { t: 'p' as const, text: block.text, attribution: 'general' as const }
          : block,
      );
  }

  it('accepts a valid research body (no video, no speaker, has a caution callout)', () => {
    expect(checkBodyStructure(researchBody(), [ref], 'research')).toHaveLength(0);
  });

  it('does NOT require a video_embed', () => {
    const codes = checkBodyStructure(researchBody(), [ref], 'research').map((issue) => issue.code);
    expect(codes).not.toContain('missing_video_embed');
  });

  it('flags a video_embed that should not be there', () => {
    const body = [...researchBody(), { t: 'video_embed' } as Block];
    const codes = checkBodyStructure(body, [ref], 'research').map((issue) => issue.code);
    expect(codes).toContain('unexpected_video_embed');
  });

  it('flags a missing single-study caution callout', () => {
    const body = researchBody().filter(
      (block) => !(block.t === 'callout' && block.tone === 'caution'),
    );
    const codes = checkBodyStructure(body, [ref], 'research').map((issue) => issue.code);
    expect(codes).toContain('missing_study_caveat');
  });

  it('flags a paragraph attributed to a speaker who does not exist', () => {
    const body = researchBody().map((block, index) =>
      index === 3 && block.t === 'p'
        ? { t: 'p' as const, text: block.text, attribution: 'speaker' as const }
        : block,
    );
    const codes = checkBodyStructure(body, [ref], 'research').map((issue) => issue.code);
    expect(codes).toContain('speaker_attribution_without_speaker');
  });

  it('does not demand speaker attribution on a research article', () => {
    const codes = checkBodyStructure(researchBody(), [ref], 'research').map((issue) => issue.code);
    expect(codes).not.toContain('no_speaker_attribution');
  });
});

describe('plain-text projection', () => {
  it('includes prose and panels but not structural markers', () => {
    const text = blocksToPlainText(validBody());
    expect(text).toContain('Magie làm gì trong tế bào');
    expect(text).toContain('Điểm thứ nhất');
    expect(text).toContain('Một cách diễn giải lại nội dung của video.');
    expect(text).not.toContain('video_embed');
  });

  it('counts words for the reading-time and length checks', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
    expect(countWords('một hai ba')).toBe(3);
    // Vietnamese is space-separated by syllable, so counts read high relative to
    // English; the 700-1,400 band used by the gate is calibrated to that.
    expect(countWords('Thiếu magie cơ thể sụp đổ như thế nào')).toBe(9);
  });
});
