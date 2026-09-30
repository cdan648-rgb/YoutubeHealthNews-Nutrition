/**
 * End-to-end publication-policy simulation.
 *
 * The point of the tolerant redesign is operational: a normal, imperfect article generated
 * from a legitimate source should publish unattended — immediately or after one repair — while
 * only genuinely unsafe, duplicated or unusable content is stopped. This file runs many
 * realistic drafts through the WHOLE pipeline (extract → verify → write → seo → normalise →
 * gate → one repair) with OpenRouter mocked, classifies each outcome, and asserts both the
 * per-scenario result and the aggregate: every non-dangerous scenario publishes, and every
 * dangerous one is blocked.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Block } from '@/lib/domain/blocks';
import { generateArticle, type PipelineDeps, type PipelineSource } from './pipeline';

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'test-key-not-real';
  process.env.OPENROUTER_MODEL = 'test';
});
afterEach(() => {
  delete process.env.OPENROUTER_API_KEY;
});

const CATEGORIES = [
  { slug: 'vi-chat-vitamin', name: 'Vi chất & Vitamin', description: 'Vitamin và khoáng chất.' },
];
const ALLOWED_HOSTS = ['medlineplus.gov', 'nih.gov'];

const SOURCE_TEXT = 'Tư liệu nguồn mô tả một chủ đề sức khoẻ chung, không trùng với bài viết.';

const SOURCE: PipelineSource = {
  kind: 'youtube',
  title: 'Số 129: Một chủ đề sức khoẻ',
  sourceText: SOURCE_TEXT,
  keywords: ['sức khoẻ'],
  durationSeconds: 900,
  publishedAt: '2026-09-01T00:00:00Z',
  channelTitle: 'Kênh sức khoẻ',
};

const filler = (n: number): string => Array.from({ length: n }, (_, i) => `noi${i % 60}`).join(' ');
const sharedRun = (n: number): string => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

/** `total` filler words split across paragraphs, each comfortably under the block cap. */
function fillerParagraphs(total: number, chunk = 300): Block[] {
  const out: Block[] = [];
  let remaining = total;
  while (remaining > 0) {
    const n = Math.min(chunk, remaining);
    out.push({ t: 'p', text: filler(n), attribution: 'general' });
    remaining -= n;
  }
  return out;
}

/** A clean, gate-passing YouTube body of about `pWords` words, optionally led by a sentence. */
function cleanBody(pWords = 900, lead = ''): Block[] {
  const leadBlocks: Block[] =
    lead === '' ? [] : [{ t: 'p', text: `${lead} ${filler(20)}`, attribution: 'general' }];
  return [
    { t: 'source_note' },
    { t: 'h2', text: 'Phần một' },
    ...leadBlocks,
    ...fillerParagraphs(pWords),
    { t: 'h2', text: 'Phần hai' },
    {
      t: 'p',
      text: 'Theo video, chủ đề này liên quan tới nhiều hoạt động của cơ thể',
      attribution: 'speaker',
    },
    { t: 'h2', text: 'Phần ba' },
    { t: 'h2', text: 'Phần bốn' },
    { t: 'key_facts', title: 'Điểm chính', items: ['Điểm một cần nhớ', 'Điểm hai cần nhớ'] },
    { t: 'video_embed' },
    { t: 'disclaimer' },
  ];
}

const DRAFT_META = {
  title: 'Một tiêu đề đủ dài cho bài viết sức khoẻ',
  dek: 'Một câu tóm tắt đủ dài cho bài viết, giải thích ngắn gọn nội dung mà người đọc sẽ tìm thấy bên trong bài.',
  slug: 'bai-viet-suc-khoe-thu-nghiem',
  categorySlug: 'vi-chat-vitamin',
  isFactCheck: false,
};

const draft = (
  body: Block[],
  references: unknown[] = [],
  meta: Partial<typeof DRAFT_META> = {},
) => ({
  ...DRAFT_META,
  ...meta,
  body,
  references,
});

const EXTRACTION = {
  topic: 'Một chủ đề sức khoẻ',
  plainLanguageTopic: 'Chủ đề sức khoẻ',
  proposedCategorySlug: 'vi-chat-vitamin',
  isFactCheck: false,
  restrictedTopics: [] as string[],
  outline: [
    { heading: 'Phần một', intent: 'Giới thiệu chủ đề' },
    { heading: 'Phần hai', intent: 'Giải thích cơ chế' },
    { heading: 'Phần ba', intent: 'Dấu hiệu thường gặp' },
    { heading: 'Phần bốn', intent: 'Khi nào cần gặp bác sĩ' },
  ],
  claims: [
    { text: 'Luận điểm một của bài', kind: 'speaker_claim', needsCitation: false, numbers: [] },
    { text: 'Luận điểm hai của bài', kind: 'general_knowledge', needsCitation: false, numbers: [] },
    { text: 'Luận điểm ba của bài', kind: 'speaker_claim', needsCitation: false, numbers: [] },
  ],
};

/** No citable URL → an empty verified pool, so references are whatever the draft supplies. */
const VERIFICATION_NO_POOL = {
  verifiedClaims: [
    {
      claimText: 'Luận điểm một của bài',
      resolution: 'attribute_to_speaker',
      reason: 'theo video',
    },
  ],
};

const SEO = {
  metaTitle: 'Tiêu đề SEO đủ dài',
  metaDescription:
    'Một mô tả SEO đủ dài để vượt qua giới hạn tối thiểu, nêu bài viết trả lời câu hỏi gì cho người đọc.',
  keywords: ['sức khoẻ'],
};

type Scenario = {
  readonly name: string;
  readonly draft: unknown;
  readonly repairDraft?: unknown;
  readonly sourceText?: string;
  readonly restrictedTopics?: readonly string[];
  readonly dangerous?: boolean;
  readonly expect: 'published' | 'repaired_published' | 'blocked' | 'failed';
};

function deps(): PipelineDeps {
  return {
    categories: CATEGORIES,
    allowedReferenceHosts: ALLOWED_HOSTS,
    restrictedTopics: [],
    requireApproval: false,
    verifyReferences: (urls) =>
      Promise.resolve({ checks: [], reachable: [...urls], unverifiable: [], unreachable: [] }),
  };
}

function mockFor(scenario: Scenario) {
  let draftCall = 0;
  const impl = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof init?.body === 'string' ? init.body : '';
    const stage =
      (JSON.parse(raw) as { response_format?: { json_schema?: { name?: string } } }).response_format
        ?.json_schema?.name ?? 'seo';
    let payload: unknown;
    if (stage === 'extraction') {
      payload = { ...EXTRACTION, restrictedTopics: [...(scenario.restrictedTopics ?? [])] };
    } else if (stage === 'verification') {
      payload = VERIFICATION_NO_POOL;
    } else if (stage === 'draft') {
      draftCall += 1;
      payload = draftCall === 1 ? scenario.draft : (scenario.repairDraft ?? scenario.draft);
    } else {
      payload = SEO;
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          model: 'test',
          usage: { prompt_tokens: 10, completion_tokens: 10 },
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(payload) } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
  };
  return {
    impl,
    get draftCalls() {
      return draftCall;
    },
  };
}

async function classify(scenario: Scenario) {
  const mock = mockFor(scenario);
  const source: PipelineSource = {
    ...SOURCE,
    ...(scenario.sourceText === undefined ? {} : { sourceText: scenario.sourceText }),
  };
  const outcome = await generateArticle(source, { ...deps(), fetchImpl: mock.impl });
  if (outcome.decision === 'failed') return 'failed' as const;
  if (outcome.decision === 'publish') {
    return mock.draftCalls >= 2 ? ('repaired_published' as const) : ('published' as const);
  }
  return 'blocked' as const;
}

/** A body citing established fact but with no references — the reference-drop shape. */
function danglingBody(): Block[] {
  const body = cleanBody(900);
  body[2] = { t: 'p', text: filler(900), attribution: 'established', ref: 0 };
  return body;
}

const SCENARIOS: readonly Scenario[] = [
  { name: '900-word clean article', draft: draft(cleanBody(900)), expect: 'published' },
  { name: '1600-word article', draft: draft(cleanBody(1600)), expect: 'published' },
  { name: '1800-word article (soft-long)', draft: draft(cleanBody(1800)), expect: 'published' },
  {
    name: '550-word article (soft-short, no repair)',
    draft: draft(cleanBody(550)),
    expect: 'published',
  },
  {
    name: 'sub-450-word article expands then publishes',
    draft: draft(cleanBody(360)),
    repairDraft: draft(cleanBody(900)),
    expect: 'repaired_published',
  },
  {
    name: 'three-block minimal but 900 words',
    draft: draft([
      { t: 'h2', text: 'Một phần' },
      { t: 'p', text: filler(900), attribution: 'general' },
      { t: 'p', text: 'Theo video điều này được nhắc tới', attribution: 'speaker' },
    ]),
    expect: 'published',
  },
  { name: 'zero references', draft: draft(cleanBody(900), []), expect: 'published' },
  {
    name: 'one reference',
    draft: draft(cleanBody(900), [
      {
        label: '1',
        title: 'Magnesium in diet',
        publisher: 'MedlinePlus',
        url: 'https://medlineplus.gov/x',
      },
    ]),
    expect: 'published',
  },
  { name: 'dangling references stripped', draft: draft(danglingBody(), []), expect: 'published' },
  {
    name: '13-word overlap (warning)',
    draft: draft(cleanBody(900, sharedRun(13))),
    sourceText: `${sharedRun(13)} phần còn lại của nguồn`,
    expect: 'published',
  },
  {
    name: '20-word overlap (warning)',
    draft: draft(cleanBody(900, sharedRun(20))),
    sourceText: `${sharedRun(20)} phần còn lại của nguồn`,
    expect: 'published',
  },
  {
    name: 'long copied run repaired then published',
    draft: draft(cleanBody(900, sharedRun(40))),
    repairDraft: draft(cleanBody(900)),
    sourceText: `${sharedRun(40)} phần còn lại của nguồn`,
    expect: 'repaired_published',
  },
  {
    name: 'safe "không nên tự điều trị"',
    draft: draft(cleanBody(900, 'Người đọc không nên tự điều trị mà hãy đi khám bác sĩ.')),
    expect: 'published',
  },
  {
    name: 'safe coordinated warning "không nên tự chẩn đoán hay tự điều trị"',
    draft: draft(cleanBody(900, 'Không nên tự chẩn đoán hay tự điều trị khi nghi ngờ bệnh.')),
    expect: 'published',
  },
  {
    name: 'unsafe "nên tự điều trị" repaired then published',
    draft: draft(cleanBody(900, 'Bạn nên tự điều trị tại nhà bằng mẹo dân gian.')),
    repairDraft: draft(cleanBody(900)),
    expect: 'repaired_published',
  },
  { name: 'zero numeric claims', draft: draft(cleanBody(900)), expect: 'published' },
  {
    name: 'unknown category clamped',
    draft: draft(cleanBody(900), [], { categorySlug: 'khong-ton-tai' }),
    expect: 'published',
  },
  {
    name: 'missing optional key_facts still publishes',
    draft: draft(cleanBody(900).filter((b) => b.t !== 'key_facts')),
    expect: 'published',
  },
  {
    name: 'missing disclaimer inserted by normaliser',
    draft: draft(cleanBody(900).filter((b) => b.t !== 'disclaimer')),
    expect: 'published',
  },
  {
    name: 'untraceable number that repair removes',
    draft: draft(cleanBody(900, 'Một khảo sát cho thấy 87 phần trăm người gặp vấn đề này.')),
    repairDraft: draft(cleanBody(900)),
    expect: 'repaired_published',
  },
  // Dangerous / unusable — must be BLOCKED even after a repair attempt.
  {
    name: 'restricted topic (blocked, no repair)',
    draft: draft(cleanBody(900)),
    restrictedTopics: ['cancer_treatment_choice'],
    dangerous: true,
    expect: 'blocked',
  },
  {
    name: 'dosage instruction that repair cannot fix (blocked)',
    draft: draft(cleanBody(900, 'Hãy bổ sung 500 mg mỗi ngày để khỏi bệnh.')),
    repairDraft: draft(cleanBody(900, 'Hãy bổ sung 500 mg mỗi ngày để khỏi bệnh.')),
    dangerous: true,
    expect: 'blocked',
  },
  {
    name: 'persistent self-treatment encouragement (blocked)',
    draft: draft(cleanBody(900, 'Bạn nên tự điều trị tại nhà thay vì đi khám.')),
    repairDraft: draft(cleanBody(900, 'Bạn nên tự điều trị tại nhà thay vì đi khám.')),
    dangerous: true,
    expect: 'blocked',
  },
  {
    name: 'empty/unusable body (below the 3-block floor) fails',
    draft: draft([{ t: 'source_note' }, { t: 'disclaimer' }]),
    repairDraft: draft([{ t: 'source_note' }, { t: 'disclaimer' }]),
    dangerous: true,
    expect: 'failed',
  },
];

describe('daily publication simulation', () => {
  it.each(SCENARIOS.map((s) => [s.name, s] as const))('%s', async (_name, scenario) => {
    expect(await classify(scenario)).toBe(scenario.expect);
  });

  it('publishes every non-dangerous article and blocks every dangerous one', async () => {
    const results = await Promise.all(
      SCENARIOS.map(async (scenario) => ({ scenario, outcome: await classify(scenario) })),
    );

    const nonDangerous = results.filter((r) => r.scenario.dangerous !== true);
    const dangerous = results.filter((r) => r.scenario.dangerous === true);

    const publishedCount = nonDangerous.filter(
      (r) => r.outcome === 'published' || r.outcome === 'repaired_published',
    ).length;

    // Every non-dangerous scenario publishes (immediately or after one repair).
    expect(publishedCount).toBe(nonDangerous.length);
    // No dangerous scenario ever publishes.
    expect(dangerous.every((r) => r.outcome === 'blocked' || r.outcome === 'failed')).toBe(true);

    // Reported for visibility: immediate vs repaired vs stopped.
    const immediate = results.filter((r) => r.outcome === 'published').length;
    const repaired = results.filter((r) => r.outcome === 'repaired_published').length;
    const stopped = results.filter((r) => r.outcome === 'blocked' || r.outcome === 'failed').length;
    expect(immediate + repaired + stopped).toBe(SCENARIOS.length);
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(20);
  });
});
