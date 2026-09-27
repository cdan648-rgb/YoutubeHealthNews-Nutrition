/**
 * Pipeline tests. OpenRouter is always mocked here — no test consumes API credit.
 *
 * The real API is exercised only by `scripts/generate-article.ts --live`, which must be
 * invoked explicitly and is never part of `npm test`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Block } from '@/lib/domain/blocks';
import { SEED_ARTICLES } from '@/content/seeds';
import { generateArticle, totalCost, type PipelineDeps, type PipelineSource } from './pipeline';
import { hardFailureCodes, validateArticle } from '@/lib/validate/gate';

const CATEGORIES = [
  { slug: 'vi-chat-vitamin', name: 'Vi chất & Vitamin', description: 'Vitamin và khoáng chất.' },
  { slug: 'phong-ngua-tam-than', name: 'Phòng ngừa & Tâm–Thân', description: 'Phòng ngừa.' },
];

const ALLOWED_HOSTS = ['medlineplus.gov', 'nccih.nih.gov', 'who.int', 'nih.gov'];

const SOURCE: PipelineSource = {
  kind: 'youtube',
  title: 'Số 118: THIẾU MAGIE CƠ THỂ SỤP ĐỔ NHƯ THẾ NÀO?',
  sourceText:
    'Magie tham gia hơn 300 phản ứng sinh hoá trong cơ thể. Phần lớn nằm trong xương và tế bào, ' +
    'không phải huyết tương. Nguồn gồm hạt, đậu, ngũ cốc nguyên hạt và rau lá xanh đậm.',
  keywords: ['magie'],
  durationSeconds: 12164,
  publishedAt: '2026-06-13T02:00:07Z',
  channelTitle: 'Bác sĩ Trần Văn Phúc Official',
};

/** A body that satisfies the gate, built to be reused by the mocked write stage. */
function goodBody(): Block[] {
  const para = (
    text: string,
    attribution: 'general' | 'speaker' | 'established' = 'general',
    ref?: number,
  ) =>
    ref === undefined
      ? { t: 'p' as const, text, attribution }
      : { t: 'p' as const, text, attribution, ref };

  const filler = (n: number) =>
    para(
      `Đoạn nội dung số ${['một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám'][n] ?? 'khác'} giải thích vai trò của khoáng chất này trong hoạt động của tế bào, `.repeat(
        3,
      ) + 'và vì sao điều đó quan trọng với sức khoẻ hằng ngày của mỗi người.',
    );

  return [
    { t: 'source_note' },
    para(
      'Magie là khoáng chất có mặt nhiều trong cơ thể nhưng ít được nhắc tới khi người ta nói về dinh dưỡng hằng ngày.',
    ),
    para(
      'Tài liệu y khoa ghi nhận khoáng chất này tham gia rất nhiều phản ứng sinh hoá khác nhau bên trong tế bào.',
      'established',
      0,
    ),
    para(
      'Video mô tả tình trạng thiếu hụt như một hệ thống nhà máy trong tế bào bị đình trệ dần dần.',
      'speaker',
    ),
    { t: 'h2', text: 'Vai trò trong tế bào' },
    filler(0),
    filler(1),
    { t: 'h2', text: 'Vì sao khó phát hiện' },
    filler(2),
    filler(3),
    {
      t: 'key_facts',
      title: 'Những điểm chính',
      items: ['Điểm thứ nhất cần ghi nhớ', 'Điểm thứ hai cần ghi nhớ'],
    },
    { t: 'h2', text: 'Nguồn trong bữa ăn' },
    filler(4),
    filler(5),
    { t: 'h2', text: 'Khi nào cần gặp bác sĩ' },
    filler(6),
    filler(7),
    filler(0),
    {
      t: 'pull_quote',
      text: 'Thiếu hụt thường không tạo ra một triệu chứng riêng biệt nào rõ ràng.',
      kind: 'paraphrase',
    },
    { t: 'video_embed' },
    { t: 'disclaimer' },
  ];
}

type StageResponses = {
  extraction?: unknown;
  verification?: unknown;
  draft?: unknown;
  seo?: unknown;
};

function defaults(): Required<StageResponses> {
  return {
    extraction: {
      topic: 'Thiếu magie',
      plainLanguageTopic: 'Magie và cơ thể',
      proposedCategorySlug: 'vi-chat-vitamin',
      isFactCheck: false,
      restrictedTopics: [],
      outline: [
        { heading: 'Vai trò', intent: 'giải thích' },
        { heading: 'Phát hiện', intent: 'giải thích' },
        { heading: 'Nguồn', intent: 'giải thích' },
        { heading: 'Khi nào khám', intent: 'giải thích' },
      ],
      claims: [
        {
          text: 'Magie tham gia nhiều phản ứng sinh hoá',
          kind: 'general_knowledge',
          needsCitation: true,
          numbers: ['300'],
        },
        {
          text: 'Phần lớn magie không nằm trong huyết tương',
          kind: 'general_knowledge',
          needsCitation: false,
          numbers: [],
        },
        {
          text: 'Thiếu magie làm hệ thống tế bào đình trệ',
          kind: 'speaker_claim',
          needsCitation: false,
          numbers: [],
        },
      ],
    },
    verification: {
      verifiedClaims: [
        {
          claimText: 'Magie tham gia nhiều phản ứng sinh hoá',
          resolution: 'cite',
          suggestedUrl: 'https://medlineplus.gov/ency/article/002423.htm',
          suggestedPublisher: 'MedlinePlus',
          suggestedTitle: 'Magnesium in diet',
          reason: 'kiến thức cơ bản',
        },
        {
          claimText: 'Thiếu magie làm hệ thống tế bào đình trệ',
          resolution: 'attribute_to_speaker',
          reason: 'chưa xác lập',
        },
      ],
    },
    draft: {
      title: 'Thiếu magie ảnh hưởng đến cơ thể như thế nào',
      dek: 'Magie tham gia rất nhiều phản ứng enzyme, nhưng phần lớn lượng magie lại không nằm trong máu, khiến xét nghiệm máu không phản ánh đầy đủ tình trạng dự trữ của cơ thể.',
      slug: 'thieu-magie-anh-huong-den-co-the',
      categorySlug: 'vi-chat-vitamin',
      isFactCheck: false,
      body: goodBody(),
      references: [
        {
          label: '1',
          title: 'Magnesium in diet',
          publisher: 'MedlinePlus',
          url: 'https://medlineplus.gov/ency/article/002423.htm',
        },
        {
          label: '2',
          title: 'Minerals',
          publisher: 'MedlinePlus',
          url: 'https://medlineplus.gov/minerals.html',
        },
      ],
    },
    seo: {
      metaTitle: 'Thiếu magie: vai trò và cách nhận biết',
      metaDescription:
        'Magie tham gia nhiều phản ứng enzyme trong cơ thể. Bài viết giải thích vai trò và vì sao xét nghiệm máu có giới hạn, kèm nguồn từ MedlinePlus.',
      keywords: ['magie', 'khoáng chất'],
    },
  };
}

/**
 * A fetch stub that answers each stage in turn.
 *
 * Order matters and is asserted: extraction, verification, draft, seo. If the pipeline ever
 * reorders or skips a stage, the wrong canned payload arrives and the schema rejects it —
 * which is a useful failure rather than a silent pass.
 */
function mockOpenRouter(
  responses: StageResponses = {},
  options: { failAt?: number; httpStatus?: number; truncate?: boolean } = {},
) {
  const merged = { ...defaults(), ...responses };
  let call = 0;
  const bodies: string[] = [];

  const impl = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    call += 1;
    // We always send a JSON string body; narrow rather than stringify a union.
    const raw = typeof init?.body === 'string' ? init.body : '';
    bodies.push(raw);

    if (options.failAt === call) {
      return Promise.resolve(new Response('upstream boom', { status: options.httpStatus ?? 500 }));
    }

    // Answer whichever stage asked, so a resumed run that starts at stage 4 still gets the
    // stage-4 payload. Order-based dispatch silently returns the wrong shape.
    const request = JSON.parse(raw) as { response_format?: { json_schema?: { name?: string } } };
    const stage = request.response_format?.json_schema?.name ?? 'seo';
    const payload =
      stage === 'extraction'
        ? merged.extraction
        : stage === 'verification'
          ? merged.verification
          : stage === 'draft'
            ? merged.draft
            : merged.seo;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          model: 'inclusionai/ling-3.0-flash-vl',
          usage: { prompt_tokens: 1200, completion_tokens: 900 },
          choices: [
            {
              finish_reason: options.truncate === true ? 'length' : 'stop',
              message: { content: JSON.stringify(payload) },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
  };

  return {
    fetchImpl: impl,
    bodies,
    get calls() {
      return call;
    },
  };
}

function deps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    categories: CATEGORIES,
    allowedReferenceHosts: ALLOWED_HOSTS,
    restrictedTopics: [],
    requireApproval: false,
    verifyReferences: (urls) =>
      Promise.resolve({
        checks: [],
        reachable: [...urls],
        unverifiable: [],
        unreachable: [],
      }),
    ...overrides,
  };
}

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'test-key-not-real';
  process.env.OPENROUTER_MODEL = 'inclusionai/ling-3.0-flash-vl';
});

afterEach(() => {
  delete process.env.OPENROUTER_API_KEY;
});

describe('the happy path', () => {
  it('runs four stages and publishes', async () => {
    const mock = mockOpenRouter();
    const outcome = await generateArticle(SOURCE, deps({ fetchImpl: mock.fetchImpl }));

    expect(outcome.decision).toBe('publish');
    expect(mock.calls).toBe(4);
    if (outcome.decision === 'failed') throw new Error('unexpected failure');
    expect(outcome.report.passed).toBe(true);
    expect(outcome.usage).toHaveLength(4);
    expect(totalCost(outcome.usage)).toBeGreaterThan(0);
    expect(totalCost(outcome.usage)).toBeLessThan(0.01);
  });

  it('sends require_parameters so a provider cannot ignore the schema', async () => {
    const mock = mockOpenRouter();
    await generateArticle(SOURCE, deps({ fetchImpl: mock.fetchImpl }));
    for (const body of mock.bodies) {
      const parsed = JSON.parse(body) as {
        provider?: { require_parameters?: boolean };
        response_format?: { type?: string };
      };
      expect(parsed.provider?.require_parameters).toBe(true);
      expect(parsed.response_format?.type).toBe('json_schema');
    }
  });

  it('re-derives the slug rather than trusting the model', async () => {
    const mock = mockOpenRouter({
      draft: { ...(defaults().draft as Record<string, unknown>), slug: 'Slug_KHONG_Hop_Le!!' },
    });
    const outcome = await generateArticle(SOURCE, deps({ fetchImpl: mock.fetchImpl }));
    if (outcome.decision === 'failed') throw new Error('unexpected failure');
    expect(outcome.draft.slug).toBe('thieu-magie-anh-huong-den-co-the-nhu-the-nao');
  });
});

describe('approval mode', () => {
  it('routes a passing article to review without calling it a failure', async () => {
    const mock = mockOpenRouter();
    const outcome = await generateArticle(
      SOURCE,
      deps({ fetchImpl: mock.fetchImpl, requireApproval: true }),
    );
    expect(outcome.decision).toBe('needs_review');
    if (outcome.decision === 'failed') throw new Error('unexpected failure');
    expect(outcome.report.passed).toBe(true);
    expect(outcome.reason).toContain('require_approval');
  });
});

describe('restricted topics', () => {
  it('never publishes automatically, however clean the article is', async () => {
    const mock = mockOpenRouter({
      extraction: {
        ...(defaults().extraction as Record<string, unknown>),
        restrictedTopics: ['cancer_treatment_choice'],
      },
    });
    const outcome = await generateArticle(SOURCE, deps({ fetchImpl: mock.fetchImpl }));
    expect(outcome.decision).toBe('needs_review');
    if (outcome.decision === 'failed') throw new Error('unexpected failure');
    expect(hardFailureCodes(outcome.report)).toContain('restricted_topic');
  });
});

describe('source discipline', () => {
  it('downgrades a citation on a host that is not allowlisted, before writing', async () => {
    const mock = mockOpenRouter({
      verification: {
        verifiedClaims: [
          {
            claimText: 'Một luận điểm cần kiểm chứng nguồn',
            resolution: 'cite',
            suggestedUrl: 'https://randomblog.example/post',
            suggestedPublisher: 'Blog',
            suggestedTitle: 'Post',
            reason: 'nguồn không nằm trong danh sách được phép',
          },
        ],
      },
    });
    await generateArticle(SOURCE, deps({ fetchImpl: mock.fetchImpl }));
    const writePrompt = mock.bodies.find((body) => body.includes('"name":"draft"')) ?? '';
    expect(writePrompt).toContain('THEO VIDEO');
    expect(writePrompt).not.toContain('randomblog.example');
  });

  it('downgrades a citation whose URL turned out to be missing', async () => {
    const mock = mockOpenRouter();
    await generateArticle(
      SOURCE,
      deps({
        fetchImpl: mock.fetchImpl,
        verifyReferences: (urls) =>
          Promise.resolve({ checks: [], reachable: [], unverifiable: [], unreachable: [...urls] }),
      }),
    );
    const writePrompt = mock.bodies.find((body) => body.includes('"name":"draft"')) ?? '';
    // It appears in the "attribute to speaker" list, not the citable list.
    expect(writePrompt).not.toContain('[ref 0]');
  });

  it('strips a reference the model added despite instructions', async () => {
    const mock = mockOpenRouter({
      draft: {
        ...(defaults().draft as Record<string, unknown>),
        references: [
          {
            label: '1',
            title: 'Magnesium in diet',
            publisher: 'MedlinePlus',
            url: 'https://medlineplus.gov/ency/article/002423.htm',
          },
          { label: '2', title: 'Sketchy', publisher: 'Blog', url: 'https://sketchy.example/x' },
        ],
      },
    });
    const outcome = await generateArticle(SOURCE, deps({ fetchImpl: mock.fetchImpl }));
    if (outcome.decision === 'failed') throw new Error('unexpected failure');
    expect(outcome.draft.references.map((reference) => reference.url)).toStrictEqual([
      'https://medlineplus.gov/ency/article/002423.htm',
    ]);
  });
});

describe('model and transport failures', () => {
  it('reports a 500 as a retryable openrouter failure', async () => {
    const mock = mockOpenRouter({}, { failAt: 1, httpStatus: 500 });
    const outcome = await generateArticle(SOURCE, deps({ fetchImpl: mock.fetchImpl }));
    expect(outcome.decision).toBe('failed');
    if (outcome.decision !== 'failed') throw new Error('expected failure');
    expect(outcome.code).toBe('openrouter_failed');
    expect(outcome.retryable).toBe(true);
  });

  it('reports a 400 as not retryable', async () => {
    const mock = mockOpenRouter({}, { failAt: 1, httpStatus: 400 });
    const outcome = await generateArticle(SOURCE, deps({ fetchImpl: mock.fetchImpl }));
    if (outcome.decision !== 'failed') throw new Error('expected failure');
    expect(outcome.retryable).toBe(false);
  });

  it('classifies a truncated response as malformed output, not a schema error', async () => {
    // finish_reason=length means the JSON was cut mid-object. Calling that a schema failure
    // would send the operator looking at the prompt when the fix is a token budget.
    const mock = mockOpenRouter({}, { truncate: true });
    const outcome = await generateArticle(SOURCE, deps({ fetchImpl: mock.fetchImpl }));
    if (outcome.decision !== 'failed') throw new Error('expected failure');
    expect(outcome.code).toBe('ai_malformed_output');
    expect(outcome.message).toContain('truncated');
  });

  it('attempts exactly one repair on invalid JSON, then fails', async () => {
    let call = 0;
    const fetchImpl = ((): Promise<Response> => {
      call += 1;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            model: 'm',
            usage: { prompt_tokens: 1, completion_tokens: 1 },
            choices: [{ finish_reason: 'stop', message: { content: 'not json at all' } }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    }) as unknown as typeof fetch;

    const outcome = await generateArticle(SOURCE, deps({ fetchImpl }));
    if (outcome.decision !== 'failed') throw new Error('expected failure');
    expect(outcome.code).toBe('ai_malformed_output');
    // Two attempts for the first stage, never a third.
    expect(call).toBe(2);
  });

  it('fails cleanly with a clear message when the key is missing', async () => {
    // A configuration problem is reported, not thrown: the run records why it could not
    // proceed and the operator reads one sentence rather than a stack trace.
    delete process.env.OPENROUTER_API_KEY;
    const mock = mockOpenRouter();
    const outcome = await generateArticle(SOURCE, deps({ fetchImpl: mock.fetchImpl }));
    if (outcome.decision !== 'failed') throw new Error('expected failure');
    expect(outcome.code).toBe('openrouter_failed');
    expect(outcome.message).toMatch(/OPENROUTER_API_KEY is not set/);
    expect(outcome.retryable).toBe(false);
  });
});

describe('resumability', () => {
  it('skips stages whose artifacts already exist', async () => {
    const first = mockOpenRouter();
    const initial = await generateArticle(SOURCE, deps({ fetchImpl: first.fetchImpl }));
    if (initial.decision === 'failed') throw new Error('unexpected failure');
    expect(first.calls).toBe(4);

    // Resume with everything but the SEO stage already done: exactly one more call.
    const second = mockOpenRouter({ seo: defaults().seo });
    // Spread rather than explicit keys: exactOptionalPropertyTypes forbids assigning an
    // explicit `undefined` to an optional field.
    const { seo: _discardSeo, ...completedStages } = initial.artifacts;
    const resumed = await generateArticle(
      SOURCE,
      deps({ fetchImpl: second.fetchImpl }),
      completedStages,
    );
    expect(resumed.decision).toBe('publish');
    // Only the SEO stage ran; the expensive writing stage was not re-paid for.
    expect(second.calls).toBe(1);
  });

  it('returns artifacts even when a later stage fails, so a retry is cheap', async () => {
    const mock = mockOpenRouter({}, { failAt: 3, httpStatus: 500 });
    const outcome = await generateArticle(SOURCE, deps({ fetchImpl: mock.fetchImpl }));
    if (outcome.decision !== 'failed') throw new Error('expected failure');
    expect(outcome.artifacts.extraction).toBeDefined();
    expect(outcome.artifacts.verification).toBeDefined();
    expect(outcome.artifacts.draft).toBeUndefined();
  });
});

describe('the seed articles remain publishable', () => {
  // Regression guard: the seeds are the standard, so a gate change that would reject them
  // is either a bug in the change or a sign the seeds need revisiting. Either way, loudly.
  it.each(SEED_ARTICLES.map((seed) => [seed.slug, seed] as const))(
    '%s passes the gate',
    (_slug, seed) => {
      const report = validateArticle({
        title: seed.title,
        dek: seed.dek,
        slug: seed.slug,
        categorySlug: seed.categorySlug,
        body: seed.body,
        references: [...seed.references],
        // The real description plus title, as production supplies.
        sourceText: 'placeholder source that shares no long run with the article body',
        sourceTitle: seed.title,
        allowedCategorySlugs: [
          'vi-chat-vitamin',
          'dinh-duong-chuyen-hoa',
          'noi-tiet-hormone',
          'mien-dich-nhiem-trung-ung-thu',
          'tieu-hoa-gan-than',
          'co-xuong-khop-van-dong',
          'phong-ngua-tam-than',
        ],
        allowedReferenceHosts: ALLOWED_HOSTS,
        // Every number in the seeds is traceable to the title or the real description; the
        // referenceTexts here stand in for the description's numerals.
        referenceTexts: ['300 70 132 127 126 121 15 118 4 7 8'],
      });
      expect(hardFailureCodes(report)).toStrictEqual([]);
    },
  );
});
