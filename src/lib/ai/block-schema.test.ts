/**
 * Body-block schema ↔ JSON Schema ↔ prompt alignment.
 *
 * These tests defend the exact production failure `body.12.text: expected string, received
 * undefined`: a block type that Zod requires `text` on, which the OpenRouter JSON Schema did
 * not require, so the model could omit it. They assert three things stay in lockstep:
 *   1. the Zod discriminated union (blockSchema) — the authority;
 *   2. the JSON Schema sent to OpenRouter (draftJsonSchema.body.items) — must require the
 *      same fields per block type, so structured output enforces the same contract;
 *   3. the prompt's BLOCK_SHAPES reference — must name every block type and every field.
 */
import { describe, expect, it } from 'vitest';
import { blockSchema, type Block } from '@/lib/domain/blocks';
import { BLOCK_SHAPES, draftJsonSchema, draftSchema } from './stages';

/** The ten block types the union supports. */
const ALL_TYPES = [
  'h2',
  'h3',
  'p',
  'key_facts',
  'pull_quote',
  'callout',
  'figure_svg',
  'video_embed',
  'source_note',
  'disclaimer',
] as const;

/** Which types Zod requires `text` on. The failure was one of these missing `text`. */
const TEXT_REQUIRED = ['h2', 'h3', 'p', 'pull_quote', 'callout'] as const;

/** A valid example of every block type, for the "each type parses" sweep. */
function validBlocks(): Record<(typeof ALL_TYPES)[number], Block> {
  return {
    h2: { t: 'h2', text: 'Một tiêu đề mục hợp lệ' },
    h3: { t: 'h3', text: 'Một tiêu đề phụ hợp lệ' },
    p: {
      t: 'p',
      text: 'Một đoạn văn đủ dài để vượt qua giới hạn hai mươi ký tự.',
      attribution: 'general',
    },
    key_facts: { t: 'key_facts', title: 'Điểm chính', items: ['Điểm thứ nhất', 'Điểm thứ hai'] },
    pull_quote: {
      t: 'pull_quote',
      text: 'Một câu trích dẫn diễn giải đủ dài để hợp lệ theo schema.',
      kind: 'paraphrase',
    },
    callout: {
      t: 'callout',
      tone: 'caution',
      title: 'Lưu ý',
      text: 'Một hộp chú ý với nội dung đủ dài để vượt qua giới hạn tối thiểu.',
    },
    figure_svg: {
      t: 'figure_svg',
      motif: 'molecule',
      caption: 'Chú thích hình minh hoạ',
      alt: 'Mô tả thay thế cho hình',
    },
    video_embed: { t: 'video_embed' },
    source_note: { t: 'source_note' },
    disclaimer: { t: 'disclaimer' },
  };
}

/** Extract the anyOf branches of the block JSON Schema, keyed by their `t` enum value. */
function jsonSchemaBranchesByType(): Map<string, { required: string[]; properties: string[] }> {
  const body = (draftJsonSchema.properties as Record<string, { items?: unknown }>).body;
  const items = body?.items as { anyOf?: unknown[] } | undefined;
  const branches = items?.anyOf ?? [];
  const map = new Map<string, { required: string[]; properties: string[] }>();
  for (const branch of branches) {
    const b = branch as {
      required?: string[];
      properties?: { t?: { enum?: string[] } } & Record<string, unknown>;
    };
    const t = b.properties?.t?.enum?.[0];
    if (typeof t === 'string') {
      map.set(t, {
        required: b.required ?? [],
        properties: Object.keys(b.properties ?? {}),
      });
    }
  }
  return map;
}

describe('every block type has a valid example that parses', () => {
  const examples = validBlocks();
  it.each(ALL_TYPES)('%s parses under the Zod block schema', (type) => {
    const parsed = blockSchema.safeParse(examples[type]);
    expect(parsed.success).toBe(true);
  });
});

describe('text-requiring blocks reject a missing text (the body.12.text failure)', () => {
  it.each(TEXT_REQUIRED)('%s without text is rejected by Zod', (type) => {
    const example = { ...validBlocks()[type] } as Record<string, unknown>;
    delete example.text;
    const parsed = blockSchema.safeParse(example);
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error('expected rejection');
    // The error path/message matches the production failure shape.
    const issue = parsed.error.issues.find((i) => i.path.includes('text'));
    expect(issue).toBeDefined();
  });

  it('reproduces the exact body[N].text failure inside a full draft', () => {
    // A draft whose block 2 is an h2 with no text — the shape that failed in production
    // as `body.12.text: expected string, received undefined`.
    const body = [
      { t: 'source_note' },
      { t: 'p', text: 'Đoạn mở bài đủ dài để vượt qua giới hạn tối thiểu của schema.' },
      { t: 'h2' }, // <-- missing text
      { t: 'h2', text: 'Mục hai' },
      { t: 'h2', text: 'Mục ba' },
      { t: 'h2', text: 'Mục bốn' },
      { t: 'key_facts', title: 'Điểm chính', items: ['Một', 'Hai điểm cần nhớ'] },
      { t: 'disclaimer' },
    ];
    const parsed = draftSchema.safeParse({
      title: 'Một tiêu đề bài viết hợp lệ về sức khoẻ',
      dek: 'Một đoạn tóm tắt đủ dài để vượt qua giới hạn tám mươi ký tự mà schema yêu cầu cho trường dek này.',
      slug: 'mot-tieu-de-bai-viet',
      categorySlug: 'vi-chat-vitamin',
      isFactCheck: false,
      body,
      references: [],
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error('expected rejection');
    const issue = parsed.error.issues.find((i) => i.path[0] === 'body' && i.path.includes('text'));
    expect(issue).toBeDefined();
    // Path is body -> 2 -> text, mirroring the production body.N.text path.
    expect(issue?.path).toEqual(['body', 2, 'text']);
  });
});

describe('JSON Schema branches match the Zod required fields per block type', () => {
  const branches = jsonSchemaBranchesByType();

  it('has one anyOf branch per block type', () => {
    expect([...branches.keys()].sort()).toEqual([...ALL_TYPES].sort());
  });

  it.each(TEXT_REQUIRED)('%s branch requires text (no longer a permissive optional)', (type) => {
    expect(branches.get(type)?.required).toContain('text');
  });

  it('key_facts branch requires title and items', () => {
    const b = branches.get('key_facts');
    expect(b?.required).toEqual(expect.arrayContaining(['title', 'items']));
  });

  it('callout branch requires tone, title and text', () => {
    const b = branches.get('callout');
    expect(b?.required).toEqual(expect.arrayContaining(['tone', 'title', 'text']));
  });

  it('figure_svg branch requires motif, caption and alt', () => {
    const b = branches.get('figure_svg');
    expect(b?.required).toEqual(expect.arrayContaining(['motif', 'caption', 'alt']));
  });

  it('marker blocks require only t', () => {
    for (const marker of ['video_embed', 'source_note', 'disclaimer'] as const) {
      expect(branches.get(marker)?.required).toEqual(['t']);
    }
  });

  it('p branch keeps attribution and ref optional (matching the Zod default/optional)', () => {
    const b = branches.get('p');
    expect(b?.required).toEqual(['t', 'text']);
    expect(b?.properties).toEqual(expect.arrayContaining(['attribution', 'ref']));
    expect(b?.required).not.toContain('attribution');
    expect(b?.required).not.toContain('ref');
  });
});

describe('BLOCK_SHAPES prompt reference is exhaustive', () => {
  it('names every block type', () => {
    for (const type of ALL_TYPES) {
      expect(BLOCK_SHAPES).toContain(`"t":"${type}"`);
    }
  });

  it('spells the real field names, and forbids empty strings / renamed fields', () => {
    expect(BLOCK_SHAPES).toContain('"text"');
    expect(BLOCK_SHAPES).toContain('"title"');
    expect(BLOCK_SHAPES).toContain('"items"');
    expect(BLOCK_SHAPES).toContain('"motif"');
    expect(BLOCK_SHAPES).toContain('"caption"');
    expect(BLOCK_SHAPES).toContain('"alt"');
    // Explicitly warns against the failure modes we saw.
    expect(BLOCK_SHAPES).toMatch(/KHÔNG dùng chuỗi rỗng/);
    expect(BLOCK_SHAPES).toMatch(/KHÔNG đổi tên trường/);
  });
});
