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
import { draftPrompt, draftSchema, researchDraftPrompt } from './stages';
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

describe('token budgets', () => {
  /**
   * Each stage's `max_tokens` is asserted per stage rather than in aggregate. A change that
   * lowers the draft budget below what a full Vietnamese article needs would put us back
   * where we were on 2026-09-28: repeated `finish_reason=length` failures on attempt 5.
   * A change that lowers extraction or verification below the current headroom would
   * truncate on dense sources; a change that raises seo without reason invites cost creep.
   */
  function requestedBudgets(bodies: readonly string[]): Record<string, number> {
    const budgets: Record<string, number> = {};
    for (const raw of bodies) {
      const parsed = JSON.parse(raw) as {
        max_tokens?: number;
        response_format?: { json_schema?: { name?: string } };
      };
      const stage = parsed.response_format?.json_schema?.name;
      if (typeof stage === 'string' && typeof parsed.max_tokens === 'number') {
        // First occurrence wins; a repair attempt uses the same budget, so this is the intent.
        budgets[stage] = budgets[stage] ?? parsed.max_tokens;
      }
    }
    return budgets;
  }

  it('sends the expected max_tokens per stage, sized for a full structured article', async () => {
    const mock = mockOpenRouter();
    await generateArticle(SOURCE, deps({ fetchImpl: mock.fetchImpl }));

    const budgets = requestedBudgets(mock.bodies);
    expect(budgets.extraction).toBe(6000);
    expect(budgets.verification).toBe(6000);
    // The draft has to fit 700–1,400 words of Vietnamese prose plus body_blocks JSON and
    // the references array. Anything under 12,000 has been observed to truncate.
    expect(budgets.draft).toBe(16000);
    // Kept intentionally small: this stage produces metaTitle + metaDescription + keywords.
    expect(budgets.seo).toBe(1500);
    // The stage relationship matters: seo is the smallest, draft is by far the largest.
    const seo = budgets.seo ?? Number.POSITIVE_INFINITY;
    const extraction = budgets.extraction ?? 0;
    const draft = budgets.draft ?? 0;
    expect(seo).toBeLessThan(extraction);
    expect(seo).toBeLessThan(draft);
  });

  it('lets the draft stage return a payload larger than the old 12k ceiling', async () => {
    // A regression guard for the truncation blocker: the mock returns a genuinely long draft
    // JSON (many filler paragraphs), which under the old budget would have been prone to
    // finish_reason=length. Here the pipeline must accept it and publish.
    const long = defaults();
    const draft = long.draft as { body: unknown[] };
    const originalBody = draft.body;
    const bulk: unknown[] = [];
    // 200 filler paragraphs of substantive Vietnamese text — a realistic worst-case draft.
    for (let index = 0; index < 200; index += 1) {
      bulk.push({
        t: 'p',
        attribution: 'general',
        text:
          `Doạn ${index} giải thích chi tiết vai trò của khoáng chất và các cơ chế sinh học liên quan. `.repeat(
            4,
          ) +
          'Nội dung được trình bày để giữ bài viết dài như một bài phân tích chuyên sâu thực tế.',
      });
    }
    draft.body = [...originalBody, ...bulk];

    const mock = mockOpenRouter(long);
    const outcome = await generateArticle(SOURCE, deps({ fetchImpl: mock.fetchImpl }));

    // The pipeline completed cleanly. Under the old 12k ceiling the model would have hit
    // finish_reason=length on this payload; the assertion here is that we do NOT see the
    // 'ai_malformed_output' failure path.
    if (outcome.decision === 'failed') {
      throw new Error(`unexpected failure: ${outcome.code} ${outcome.message}`);
    }
    // The draft stage still requested at least 16k tokens for this payload.
    const budgets = requestedBudgets(mock.bodies);
    expect(budgets.draft).toBeGreaterThanOrEqual(16000);
  });

  it('reuses the same per-stage budget on the repair pass, and does not attempt a third call', async () => {
    // The repair is the second (and last) call on the SAME stage. It must carry the same
    // budget as attempt 0 — a smaller ceiling on the repair would defeat the whole point —
    // and there must be at most two calls per stage, so a broken model cannot loop forever.
    let calls = 0;
    const budgetsPerCall: number[] = [];
    const fetchImpl = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls += 1;
      const raw = typeof init?.body === 'string' ? init.body : '';
      const parsed = JSON.parse(raw) as { max_tokens?: number };
      if (typeof parsed.max_tokens === 'number') budgetsPerCall.push(parsed.max_tokens);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            model: 'inclusionai/ling-3.0-flash-vl',
            usage: { prompt_tokens: 10, completion_tokens: 10 },
            choices: [{ finish_reason: 'stop', message: { content: 'still not json' } }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    };

    const outcome = await generateArticle(SOURCE, deps({ fetchImpl }));
    if (outcome.decision !== 'failed') throw new Error('expected failure');
    expect(outcome.code).toBe('ai_malformed_output');
    // Two attempts on the first stage (extraction), never a third — the retry cap holds.
    expect(calls).toBe(2);
    // Both attempts carried the same stage budget.
    expect(budgetsPerCall).toStrictEqual([6000, 6000]);
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

  it('reports a 429 as a retryable openrouter failure so the run comes back next tick', async () => {
    // A transient rate limit must not spend the run's attempt budget as a permanent
    // failure — the scheduler's retry loop is what recovers from it.
    const mock = mockOpenRouter({}, { failAt: 1, httpStatus: 429 });
    const outcome = await generateArticle(SOURCE, deps({ fetchImpl: mock.fetchImpl }));
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

describe('body block minimum', () => {
  /**
   * Regression pack for the 2026-09-28 blocker: the draft stage was returning fewer than
   * eight body blocks and taking the run to attempts=5 with `body: Too small`.
   *
   * The 8-block floor is real — for a YouTube article the structural gate needs a source
   * note, at least four h2 sections, a key-facts panel, a video embed, a disclaimer and at
   * least one speaker-attributed paragraph, which is already nine blocks — so this pack
   * proves the schema catches too-short bodies, that the repair pass can recover a
   * short-body attempt without a third try, and that the prompts now name the total.
   */

  /** A body of exactly eight blocks — the Zod floor. Passes the schema even though a
   * YouTube gate check would additionally require the speaker paragraph. */
  function eightBlockBody(): Block[] {
    return [
      { t: 'source_note' },
      {
        t: 'p',
        text: 'Đoạn mở bài trình bày ngắn gọn chủ đề của bài viết và lý do vì sao nó đáng được quan tâm.',
        attribution: 'general',
      },
      { t: 'h2', text: 'Vai trò cơ bản' },
      { t: 'h2', text: 'Vì sao khó phát hiện' },
      { t: 'h2', text: 'Nguồn trong bữa ăn' },
      { t: 'h2', text: 'Khi nào cần gặp bác sĩ' },
      { t: 'key_facts', title: 'Ghi nhớ', items: ['Điểm một cần lưu ý', 'Điểm hai cần lưu ý'] },
      { t: 'disclaimer' },
    ];
  }

  it('accepts a body with exactly the minimum block count at the Zod schema boundary', () => {
    // Direct schema check: 8 blocks is the floor and must pass, since a shorter body
    // is what took today's run to attempt 5.
    const draft = {
      title: 'Thiếu magie ảnh hưởng đến cơ thể như thế nào',
      dek: 'Magie tham gia rất nhiều phản ứng enzyme, nhưng phần lớn lượng magie lại không nằm trong máu, khiến xét nghiệm máu không phản ánh đầy đủ tình trạng dự trữ của cơ thể.',
      slug: 'thieu-magie-anh-huong-den-co-the',
      categorySlug: 'vi-chat-vitamin',
      isFactCheck: false,
      body: eightBlockBody(),
      references: [],
    };
    const parsed = draftSchema.safeParse(draft);
    expect(parsed.success).toBe(true);
  });

  it('rejects a body of seven blocks with an array-too-small error', () => {
    // The exact failure production hit: body length below the schema floor. This is the
    // check that must NOT be relaxed; the fix is prompt-side.
    const shortBody = eightBlockBody().slice(0, 7);
    const parsed = draftSchema.safeParse({
      title: 'Thiếu magie ảnh hưởng đến cơ thể như thế nào',
      dek: 'Magie tham gia rất nhiều phản ứng enzyme, nhưng phần lớn lượng magie lại không nằm trong máu, khiến xét nghiệm máu không phản ánh đầy đủ tình trạng dự trữ của cơ thể.',
      slug: 'thieu-magie-anh-huong-den-co-the',
      categorySlug: 'vi-chat-vitamin',
      isFactCheck: false,
      body: shortBody,
      references: [],
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error('expected schema rejection');
    const bodyIssue = parsed.error.issues.find((issue) => issue.path[0] === 'body');
    expect(bodyIssue).toBeDefined();
    expect(bodyIssue?.message).toMatch(/at least|>=|too_small|Too small/i);
  });

  it('names the total-block minimum explicitly in both draft prompts', () => {
    // The prompt is the primary fix. If a future rewrite drops the "at least 8" wording
    // the model can hit every named block and still ship a 5-block body, which is what
    // took today's run to attempt 5.
    const youtube = draftPrompt({
      extraction: {
        topic: 't',
        plainLanguageTopic: 't',
        proposedCategorySlug: 'vi-chat-vitamin',
        isFactCheck: false,
        restrictedTopics: [],
        outline: [
          { heading: 'a', intent: 'x' },
          { heading: 'b', intent: 'x' },
          { heading: 'c', intent: 'x' },
          { heading: 'd', intent: 'x' },
        ],
        claims: [
          { text: 'a claim', kind: 'speaker_claim', needsCitation: false, numbers: [] },
          { text: 'another claim', kind: 'speaker_claim', needsCitation: false, numbers: [] },
          { text: 'third claim', kind: 'general_knowledge', needsCitation: false, numbers: [] },
        ],
      },
      verification: { verifiedClaims: [] },
      sourceTitle: 't',
      descriptionClean: 'd',
      channelTitle: 'c',
      wordCountMin: 700,
      wordCountMax: 1400,
      allowedCategorySlugs: ['vi-chat-vitamin'],
    });
    // The prompt must state the total-array minimum, not only per-type minimums.
    expect(youtube).toMatch(/ÍT NHẤT 8 phần tử/);
    // …and it must tell the model to put paragraphs between headings.
    expect(youtube).toMatch(/GIỮA hai block .*"h2".*block .*"p"/);

    const research = researchDraftPrompt({
      extraction: {
        topic: 't',
        plainLanguageTopic: 't',
        proposedCategorySlug: 'vi-chat-vitamin',
        isFactCheck: false,
        restrictedTopics: [],
        outline: [
          { heading: 'a', intent: 'x' },
          { heading: 'b', intent: 'x' },
          { heading: 'c', intent: 'x' },
          { heading: 'd', intent: 'x' },
        ],
        claims: [
          { text: 'a claim', kind: 'speaker_claim', needsCitation: false, numbers: [] },
          { text: 'another claim', kind: 'general_knowledge', needsCitation: false, numbers: [] },
          { text: 'third claim', kind: 'general_knowledge', needsCitation: false, numbers: [] },
        ],
      },
      verification: { verifiedClaims: [] },
      paperTitle: 't',
      paperUrl: 'https://europepmc.org/x',
      journal: null,
      publicationDate: null,
      authors: [],
      abstract: 'a',
      wordCountMin: 700,
      wordCountMax: 1400,
    });
    expect(research).toMatch(/ÍT NHẤT 8 phần tử/);
  });

  it("recovers when the draft's first attempt returns a too-short body, on the repair pass", async () => {
    // Attempt 0 for the draft stage returns a 5-block body — under the 8-block floor.
    // Attempt 1 (repair) returns the full-length body. The pipeline must succeed with
    // exactly one repair on the draft stage, and the whole pipeline in exactly five calls.
    let draftCalls = 0;
    const merged = defaults();
    const goodDraft = merged.draft;
    const shortDraft = {
      ...(goodDraft as Record<string, unknown>),
      body: eightBlockBody().slice(0, 5),
    };

    const fetchImpl = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const raw = typeof init?.body === 'string' ? init.body : '';
      const parsed = JSON.parse(raw) as {
        response_format?: { json_schema?: { name?: string } };
      };
      const stage = parsed.response_format?.json_schema?.name;
      let payload: unknown;
      if (stage === 'draft') {
        draftCalls += 1;
        payload = draftCalls === 1 ? shortDraft : goodDraft;
      } else if (stage === 'extraction') {
        payload = merged.extraction;
      } else if (stage === 'verification') {
        payload = merged.verification;
      } else {
        payload = merged.seo;
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            model: 'inclusionai/ling-3.0-flash-vl',
            usage: { prompt_tokens: 1200, completion_tokens: 900 },
            choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(payload) } }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    };

    const outcome = await generateArticle(SOURCE, deps({ fetchImpl }));
    if (outcome.decision === 'failed') {
      throw new Error(`unexpected failure: ${outcome.code} ${outcome.message}`);
    }
    // Draft was retried exactly once; there is no third attempt.
    expect(draftCalls).toBe(2);
  });

  it('does not attempt a third try when the draft stays too short', async () => {
    // Both draft attempts return a 5-block body. The pipeline must fail cleanly with
    // ai_malformed_output — never a third call, never a loop.
    let draftCalls = 0;
    const merged = defaults();
    const shortDraft = {
      ...(merged.draft as Record<string, unknown>),
      body: eightBlockBody().slice(0, 5),
    };

    const fetchImpl = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const raw = typeof init?.body === 'string' ? init.body : '';
      const parsed = JSON.parse(raw) as {
        response_format?: { json_schema?: { name?: string } };
      };
      const stage = parsed.response_format?.json_schema?.name;
      let payload: unknown;
      if (stage === 'draft') {
        draftCalls += 1;
        payload = shortDraft;
      } else if (stage === 'extraction') {
        payload = merged.extraction;
      } else if (stage === 'verification') {
        payload = merged.verification;
      } else {
        payload = merged.seo;
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            model: 'inclusionai/ling-3.0-flash-vl',
            usage: { prompt_tokens: 1200, completion_tokens: 900 },
            choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(payload) } }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    };

    const outcome = await generateArticle(SOURCE, deps({ fetchImpl }));
    if (outcome.decision !== 'failed') throw new Error('expected failure');
    expect(outcome.code).toBe('ai_malformed_output');
    expect(outcome.message).toMatch(/body/);
    // Exactly two draft calls — no infinite retry loop.
    expect(draftCalls).toBe(2);
  });

  it('replays the model’s own previous JSON on the repair pass, with a preserve-and-fix instruction', async () => {
    // The old repair code sent the Zod error text as the "assistant" message, which meant
    // the model had no view of what it had actually produced and could not revise it —
    // it started over each time. The fix must (a) put the model's previous JSON in the
    // assistant slot and (b) instruct it to preserve valid content, not rewrite everything.
    const merged = defaults();
    const shortDraft = {
      ...(merged.draft as Record<string, unknown>),
      body: eightBlockBody().slice(0, 5),
    };
    const shortDraftJson = JSON.stringify(shortDraft);

    let draftCalls = 0;
    const bodies: string[] = [];
    const fetchImpl = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const raw = typeof init?.body === 'string' ? init.body : '';
      const parsed = JSON.parse(raw) as {
        response_format?: { json_schema?: { name?: string } };
      };
      const stage = parsed.response_format?.json_schema?.name;
      let payload: unknown;
      if (stage === 'draft') {
        draftCalls += 1;
        bodies.push(raw);
        payload = draftCalls === 1 ? shortDraft : merged.draft;
      } else if (stage === 'extraction') {
        payload = merged.extraction;
      } else if (stage === 'verification') {
        payload = merged.verification;
      } else {
        payload = merged.seo;
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            model: 'inclusionai/ling-3.0-flash-vl',
            usage: { prompt_tokens: 1200, completion_tokens: 900 },
            choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(payload) } }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    };

    await generateArticle(SOURCE, deps({ fetchImpl }));
    expect(draftCalls).toBe(2);

    // The second draft request is the repair. Inspect its message array.
    const repairBody = bodies[1] ?? '';
    const parsedRepair = JSON.parse(repairBody) as {
      messages?: { role: string; content: string }[];
    };
    const messages = parsedRepair.messages ?? [];
    // The last assistant message must be the model's own previous JSON (possibly truncated
    // to the 6000-char cap in openrouter.ts), NOT the Zod error text.
    const assistantMessages = messages.filter((m) => m.role === 'assistant');
    expect(assistantMessages.length).toBeGreaterThan(0);
    const lastAssistant = assistantMessages[assistantMessages.length - 1]?.content ?? '';
    expect(lastAssistant.startsWith(shortDraftJson.slice(0, 200))).toBe(true);

    // The final user message must give the model an actionable, preserve-and-fix directive
    // rather than a bare "your JSON was wrong, try again".
    const userMessages = messages.filter((m) => m.role === 'user');
    const lastUser = userMessages[userMessages.length - 1]?.content ?? '';
    expect(lastUser).toMatch(/GIỮ NGUYÊN/);
    expect(lastUser).toMatch(/Too small|>=|BỔ SUNG/);
  });
});

describe('missing required block field (body.N.text)', () => {
  /**
   * The 2026-09-28 production blocker: `body.12.text: expected string, received undefined`.
   * A text-requiring block came back with no `text`. These prove the draft request now
   * carries a per-type JSON Schema that requires text, that the repair pass restores a
   * missing text field and is handed the block-shape reference, and that a still-broken
   * repair fails cleanly with no third attempt.
   */

  it('sends a per-type anyOf body schema that requires text on h2/p/callout', async () => {
    const mock = mockOpenRouter();
    await generateArticle(SOURCE, deps({ fetchImpl: mock.fetchImpl }));
    const draftBody = mock.bodies.find((b) => b.includes('"name":"draft"')) ?? '';
    const parsed = JSON.parse(draftBody) as {
      response_format?: {
        json_schema?: { schema?: { properties?: { body?: { items?: { anyOf?: unknown[] } } } } };
      };
    };
    const anyOf = parsed.response_format?.json_schema?.schema?.properties?.body?.items?.anyOf;
    expect(Array.isArray(anyOf)).toBe(true);
    // Find the h2 branch and assert text is required, not merely allowed.
    const branchFor = (t: string) =>
      (anyOf as { required?: string[]; properties?: { t?: { enum?: string[] } } }[]).find(
        (b) => b.properties?.t?.enum?.[0] === t,
      );
    expect(branchFor('h2')?.required).toContain('text');
    expect(branchFor('p')?.required).toContain('text');
    expect(branchFor('callout')?.required).toEqual(
      expect.arrayContaining(['tone', 'title', 'text']),
    );
  });

  it('repairs a draft whose h2 block is missing text, and hands over the block-shape hint', async () => {
    const merged = defaults();
    const goodDraft = merged.draft as Record<string, unknown>;
    // Attempt 0: a draft identical to the good one but with one h2 stripped of its text.
    const brokenBody = (goodDraft.body as Record<string, unknown>[]).map((block) =>
      block.t === 'h2'
        ? (() => {
            const copy = { ...block };
            delete copy.text;
            return copy;
          })()
        : block,
    );
    const brokenDraft = { ...goodDraft, body: brokenBody };

    let draftCalls = 0;
    const bodies: string[] = [];
    const fetchImpl = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const raw = typeof init?.body === 'string' ? init.body : '';
      const stage =
        (JSON.parse(raw) as { response_format?: { json_schema?: { name?: string } } })
          .response_format?.json_schema?.name ?? 'seo';
      let payload: unknown;
      if (stage === 'draft') {
        draftCalls += 1;
        bodies.push(raw);
        payload = draftCalls === 1 ? brokenDraft : goodDraft;
      } else if (stage === 'extraction') {
        payload = merged.extraction;
      } else if (stage === 'verification') {
        payload = merged.verification;
      } else {
        payload = merged.seo;
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            model: 'inclusionai/ling-3.0-flash-vl',
            usage: { prompt_tokens: 1200, completion_tokens: 900 },
            choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(payload) } }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    };

    const outcome = await generateArticle(SOURCE, deps({ fetchImpl }));
    if (outcome.decision === 'failed') {
      throw new Error(`unexpected failure: ${outcome.code} ${outcome.message}`);
    }
    expect(draftCalls).toBe(2);

    // The repair (2nd draft request) must carry the exhaustive block-shape reference so the
    // model knows the exact required field for the block type it broke.
    const repair = JSON.parse(bodies[1] ?? '{}') as {
      messages?: { role: string; content: string }[];
    };
    const lastUser = (repair.messages ?? []).filter((m) => m.role === 'user').at(-1)?.content ?? '';
    expect(lastUser).toMatch(/HÌNH DẠNG CHÍNH XÁC CỦA TỪNG LOẠI BLOCK/);
    expect(lastUser).toMatch(/KHÔNG dùng chuỗi rỗng/);
    // And it must instruct against omitting a required string / using empty strings.
    expect(lastUser).toMatch(/TRƯỜNG BẮT BUỘC bị THIẾU|nội dung có nghĩa|NỘI DUNG CÓ NGHĨA/i);
  });

  it('fails cleanly with no third attempt when the block stays missing text', async () => {
    const merged = defaults();
    const goodDraft = merged.draft as Record<string, unknown>;
    const brokenBody = (goodDraft.body as Record<string, unknown>[]).map((block) => {
      if (block.t !== 'h2') return block;
      const copy = { ...block };
      delete copy.text;
      return copy;
    });
    const brokenDraft = { ...goodDraft, body: brokenBody };

    let draftCalls = 0;
    const fetchImpl = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const raw = typeof init?.body === 'string' ? init.body : '';
      const stage =
        (JSON.parse(raw) as { response_format?: { json_schema?: { name?: string } } })
          .response_format?.json_schema?.name ?? 'seo';
      let payload: unknown;
      if (stage === 'draft') {
        draftCalls += 1;
        payload = brokenDraft; // stays broken on both attempts
      } else if (stage === 'extraction') {
        payload = merged.extraction;
      } else if (stage === 'verification') {
        payload = merged.verification;
      } else {
        payload = merged.seo;
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            model: 'inclusionai/ling-3.0-flash-vl',
            usage: { prompt_tokens: 1200, completion_tokens: 900 },
            choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(payload) } }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    };

    const outcome = await generateArticle(SOURCE, deps({ fetchImpl }));
    if (outcome.decision !== 'failed') throw new Error('expected failure');
    expect(outcome.code).toBe('ai_malformed_output');
    expect(outcome.message).toMatch(/text/);
    // Two draft attempts (initial + one repair), never a third.
    expect(draftCalls).toBe(2);
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

/**
 * The research path.
 *
 * A research source routes through the research prompts and the research branch of the
 * gate: no video embed, a caution callout, no speaker attribution, and the paper's own URL
 * cited. The mock returns a research-shaped body, so the whole path is exercised without an
 * API call.
 */
describe('the research path', () => {
  const PAPER_URL = 'https://europepmc.org/article/MED/40000001';

  const RESEARCH_SOURCE: PipelineSource = {
    kind: 'research',
    title: 'Magnesium supplementation and insulin sensitivity: a randomized controlled trial',
    sourceText:
      'This randomized controlled trial enrolled adults and measured insulin sensitivity after ' +
      'magnesium supplementation. Fasting glucose and insulin resistance improved in the ' +
      'intervention arm. The authors note the modest sample and call for independent ' +
      'replication before any change to practice.',
    keywords: [],
    durationSeconds: null,
    publishedAt: '2026-06-15',
    channelTitle: 'Nutrients',
    paperUrl: PAPER_URL,
    journal: 'Nutrients',
    authors: ['A Researcher', 'B Researcher'],
  };

  function researchBody(): Block[] {
    const para = (
      text: string,
      attribution: 'general' | 'established' = 'general',
      ref?: number,
    ) =>
      ref === undefined
        ? { t: 'p' as const, text, attribution }
        : { t: 'p' as const, text, attribution, ref };
    const filler = (n: number) =>
      para(
        `Doan ${n} trinh bay boi canh cua nghien cuu va y nghia cua ket qua doi voi nguoi doc pho thong. `.repeat(
          7,
        ) + 'Ket qua don le luon can duoc dien giai mot cach than trong va kiem chung doc lap.',
      );
    return [
      { t: 'source_note' },
      para('Mot thu nghiem ngau nhien co doi chung vua duoc cong bo ve magie va do nhay insulin.'),
      para(
        'Nghien cuu nay ghi nhan cai thien o nhom can thiep so voi nhom chung.',
        'established',
        0,
      ),
      { t: 'h2', text: 'Nghien cuu da lam gi' },
      filler(1),
      filler(2),
      { t: 'h2', text: 'Ket qua chinh' },
      {
        t: 'key_facts',
        title: 'Nhung diem chinh',
        items: ['Diem mot ghi nho', 'Diem hai ghi nho'],
      },
      filler(3),
      { t: 'h2', text: 'Gioi han cua nghien cuu' },
      filler(4),
      {
        t: 'callout',
        tone: 'caution',
        title: 'Mot nghien cuu don le',
        text: 'Ket qua can duoc cac nhom doc lap kiem chung lai truoc khi thay doi thuc hanh.',
      },
      { t: 'h2', text: 'Y nghia voi nguoi doc' },
      filler(5),
      { t: 'disclaimer' },
    ];
  }

  function researchResponses(): StageResponses {
    return {
      extraction: {
        topic: 'Magie va insulin',
        plainLanguageTopic: 'Magie va duong huyet',
        proposedCategorySlug: 'vi-chat-vitamin',
        isFactCheck: false,
        restrictedTopics: [],
        outline: [
          { heading: 'Nghien cuu', intent: 'mo ta' },
          { heading: 'Ket qua', intent: 'mo ta' },
          { heading: 'Gioi han', intent: 'mo ta' },
          { heading: 'Y nghia', intent: 'mo ta' },
        ],
        claims: [
          {
            text: 'Nhom can thiep cai thien do nhay insulin',
            kind: 'speaker_claim',
            needsCitation: true,
            numbers: [],
          },
          {
            text: 'Magie tham gia chuyen hoa glucose',
            kind: 'general_knowledge',
            needsCitation: true,
            numbers: [],
          },
          {
            text: 'Co mau cua nghien cuu con nho',
            kind: 'speaker_claim',
            needsCitation: false,
            numbers: [],
          },
        ],
      },
      verification: {
        verifiedClaims: [
          {
            claimText: 'Magie tham gia chuyen hoa glucose',
            resolution: 'cite',
            suggestedUrl: 'https://medlineplus.gov/ency/article/002423.htm',
            suggestedPublisher: 'MedlinePlus',
            suggestedTitle: 'Magnesium in diet',
            reason: 'kien thuc nen',
          },
        ],
      },
      draft: {
        title: 'Magie va do nhay insulin: mot thu nghiem ngau nhien co doi chung',
        dek: 'Mot thu nghiem ngau nhien co doi chung ghi nhan magie co the cai thien do nhay insulin, nhung co mau con nho va ket qua can duoc kiem chung doc lap truoc khi ap dung.',
        slug: 'magie-va-do-nhay-insulin',
        categorySlug: 'vi-chat-vitamin',
        isFactCheck: false,
        body: researchBody(),
        references: [
          { label: '1', title: 'The trial', publisher: 'Europe PMC', url: PAPER_URL },
          {
            label: '2',
            title: 'Magnesium in diet',
            publisher: 'MedlinePlus',
            url: 'https://medlineplus.gov/ency/article/002423.htm',
          },
        ],
      },
      seo: {
        metaTitle: 'Magie va do nhay insulin: mot thu nghiem moi',
        metaDescription:
          'Mot thu nghiem ngau nhien co doi chung ve magie va do nhay insulin: ket qua, gioi han va vi sao can than trong, kem nguon tu Europe PMC.',
        keywords: ['magie', 'insulin'],
      },
    };
  }

  function researchDeps() {
    return deps({ allowedReferenceHosts: [...ALLOWED_HOSTS, 'europepmc.org'] });
  }

  it('publishes a well-formed research article via the research prompts', async () => {
    const mock = mockOpenRouter(researchResponses());
    const outcome = await generateArticle(RESEARCH_SOURCE, {
      ...researchDeps(),
      fetchImpl: mock.fetchImpl,
    });
    if (outcome.decision === 'failed') throw new Error(`unexpected failure: ${outcome.message}`);
    expect(outcome.decision).toBe('publish');
    expect(outcome.report.passed).toBe(true);
  });

  it('sends the research house rules to the model', async () => {
    const mock = mockOpenRouter(researchResponses());
    await generateArticle(RESEARCH_SOURCE, { ...researchDeps(), fetchImpl: mock.fetchImpl });
    // The system prompt must carry the research-specific constraints, not just HOUSE_RULES.
    expect(mock.bodies.length).toBeGreaterThan(0);
    const first = JSON.parse(mock.bodies[0] ?? '{}') as {
      messages?: { role: string; content: string }[];
    };
    const system = first.messages?.find((message) => message.role === 'system')?.content ?? '';
    // RESEARCH_RULES opens with this heading; its presence proves the research system
    // prompt was used rather than the plain HOUSE_RULES.
    expect(system).toContain('BỐI CẢNH RIÊNG CHO BÀI VIẾT VỀ NGHIÊN CỨU');
  });

  it('fails a research article that omits the paper it reports on', async () => {
    const responses = researchResponses();
    (responses.draft as { references: unknown[] }).references = [
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
    ];
    const mock = mockOpenRouter(responses);
    const outcome = await generateArticle(RESEARCH_SOURCE, {
      ...researchDeps(),
      fetchImpl: mock.fetchImpl,
    });
    if (outcome.decision === 'failed') throw new Error('unexpected failure');
    expect(outcome.decision).toBe('needs_review');
    expect(outcome.report.issues.map((issue) => issue.code)).toContain(
      'missing_required_reference',
    );
  });
});

/**
 * The validation-repair pass.
 *
 * After the gate, a draft that fails on FIXABLE content grounds (too short, prescriptive
 * phrasing, thin sourcing, a missing structural block) gets exactly one automatic repair
 * before it is handed to a human. The model is shown the gate's own report and its own JSON,
 * and the gate re-runs in full over the result. A failure that is NOT fixable — a restricted
 * topic, a fabricated number — skips the repair entirely and goes straight to review, and no
 * failure is ever repaired more than once.
 */
describe('validation repair', () => {
  /**
   * A schema-valid body that clears the YouTube structural gate but is far too short: the
   * ONLY hard failure it produces is `too_short`, which is repairable. No numbers (so no
   * traceability flag) and no overlap with the source text.
   */
  function shortButStructuredBody(): Block[] {
    const p = (text: string, attribution: 'general' | 'speaker' = 'general') => ({
      t: 'p' as const,
      text,
      attribution,
    });
    return [
      { t: 'source_note' },
      p('Bài viết ngắn này giới thiệu chủ đề một cách sơ lược cho người đọc.'),
      p('Theo video, khoáng chất này góp mặt trong nhiều hoạt động của cơ thể.', 'speaker'),
      { t: 'h2', text: 'Vai trò' },
      p('Phần này nói vắn tắt về vai trò của khoáng chất.'),
      { t: 'h2', text: 'Dấu hiệu' },
      p('Phần này nói vắn tắt về các dấu hiệu thường thấy.'),
      { t: 'h2', text: 'Nguồn thực phẩm' },
      p('Phần này nói vắn tắt về nguồn thực phẩm hằng ngày.'),
      { t: 'h2', text: 'Khi nào gặp bác sĩ' },
      p('Phần này nhắc người đọc nên đi khám khi thấy bất thường.'),
      { t: 'key_facts', title: 'Điểm chính', items: ['Điểm một cần nhớ', 'Điểm hai cần nhớ'] },
      { t: 'video_embed' },
      { t: 'disclaimer' },
    ];
  }

  /** goodBody with an untraceable statistic injected — a fabrication signal that must NOT be
   * routed through the repair pass. */
  function bodyWithUntraceableNumber(): Block[] {
    let done = false;
    return goodBody().map((block) => {
      if (!done && block.t === 'p' && block.attribution === 'general') {
        done = true;
        return {
          ...block,
          text: 'Một khảo sát gần đây cho thấy khoảng 87 phần trăm người trưởng thành gặp vấn đề này, một tỷ lệ đáng chú ý.',
        };
      }
      return block;
    });
  }

  /**
   * A fetch stub that answers each stage from the defaults, but returns a SEQUENCE of draft
   * payloads across successive draft-stage calls (write, then repair). The count of draft
   * calls is exposed so "exactly one repair, never a third attempt" is directly assertable.
   */
  function sequencedDraftMock(draftPayloads: readonly unknown[], base: StageResponses = {}) {
    const merged = { ...defaults(), ...base };
    let draftCall = 0;
    const bodies: string[] = [];

    const impl = (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const raw = typeof init?.body === 'string' ? init.body : '';
      bodies.push(raw);
      const stage =
        (JSON.parse(raw) as { response_format?: { json_schema?: { name?: string } } })
          .response_format?.json_schema?.name ?? 'seo';

      let payload: unknown;
      if (stage === 'draft') {
        payload = draftPayloads[Math.min(draftCall, draftPayloads.length - 1)];
        draftCall += 1;
      } else if (stage === 'extraction') {
        payload = merged.extraction;
      } else if (stage === 'verification') {
        payload = merged.verification;
      } else {
        payload = merged.seo;
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            model: 'inclusionai/ling-3.0-flash-vl',
            usage: { prompt_tokens: 1200, completion_tokens: 900 },
            choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(payload) } }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    };

    return {
      fetchImpl: impl,
      bodies,
      draftRequests: () => bodies.filter((body) => body.includes('"name":"draft"')),
      get draftCalls() {
        return draftCall;
      },
    };
  }

  it('repairs a too-short article to ≥700 words and publishes', async () => {
    const short = {
      ...(defaults().draft as Record<string, unknown>),
      body: shortButStructuredBody(),
    };
    const good = defaults().draft;
    const mock = sequencedDraftMock([short, good]);

    const outcome = await generateArticle(SOURCE, deps({ fetchImpl: mock.fetchImpl }));
    if (outcome.decision === 'failed') throw new Error(`unexpected failure: ${outcome.message}`);

    expect(outcome.decision).toBe('publish');
    expect(outcome.report.passed).toBe(true);
    expect(outcome.report.stats.wordCount).toBeGreaterThanOrEqual(700);
    // Exactly one repair on the draft stage (write + repair), never a third.
    expect(mock.draftCalls).toBe(2);
    // The repair call is counted in usage alongside the four stage calls.
    expect(outcome.usage).toHaveLength(5);
  });

  it('adds references through the repair when the first draft cites none', async () => {
    // The short draft has zero references (a soft `few_references`) AND is too short (a hard
    // `too_short`): the hard failure triggers the repair, and the repaired draft carries the
    // allowlisted references the good draft supplies.
    const short = {
      ...(defaults().draft as Record<string, unknown>),
      body: shortButStructuredBody(),
      references: [],
    };
    const good = defaults().draft;
    const mock = sequencedDraftMock([short, good]);

    const outcome = await generateArticle(SOURCE, deps({ fetchImpl: mock.fetchImpl }));
    if (outcome.decision === 'failed') throw new Error(`unexpected failure: ${outcome.message}`);

    expect(outcome.decision).toBe('publish');
    expect(outcome.draft.references.length).toBeGreaterThanOrEqual(2);
    // The repair prompt was handed BOTH the hard and the soft issue verbatim.
    const repair = mock.draftRequests()[1] ?? '';
    expect(repair).toContain('too_short');
    expect(repair).toContain('few_references');
  });

  it('feeds the exact validation report and a preserve-and-fix directive to the repair', async () => {
    const short = {
      ...(defaults().draft as Record<string, unknown>),
      body: shortButStructuredBody(),
    };
    const mock = sequencedDraftMock([short, defaults().draft]);

    await generateArticle(SOURCE, deps({ fetchImpl: mock.fetchImpl }));

    const repair = JSON.parse(mock.draftRequests()[1] ?? '{}') as {
      messages?: { role: string; content: string }[];
    };
    const lastUser =
      (repair.messages ?? []).filter((message) => message.role === 'user').at(-1)?.content ?? '';
    // The gate's own report reaches the model: the code, its severity, and its own prior JSON.
    expect(lastUser).toContain('too_short');
    expect(lastUser).toMatch(/NGHIÊM TRỌNG/);
    expect(lastUser).toContain('JSON BÀI VIẾT TRƯỚC ĐÓ');
    // A fix-only, preserve-the-rest directive rather than a bare "try again".
    expect(lastUser).toMatch(/CHỈ sửa/);
    expect(lastUser).toMatch(/GIỮ NGUYÊN/);
  });

  it('routes to review as validation_failed when the repair still fails, with no third attempt', async () => {
    const short = {
      ...(defaults().draft as Record<string, unknown>),
      body: shortButStructuredBody(),
      references: [],
    };
    // Both the write and the repair return the same too-short draft.
    const mock = sequencedDraftMock([short, short]);

    const outcome = await generateArticle(SOURCE, deps({ fetchImpl: mock.fetchImpl }));
    if (outcome.decision === 'failed') throw new Error(`unexpected failure: ${outcome.message}`);

    expect(outcome.decision).toBe('needs_review');
    expect(outcome.report.passed).toBe(false);
    expect(hardFailureCodes(outcome.report)).toContain('too_short');
    expect(outcome.reason).toContain('validation_failed_after_repair');
    // The repair ran once and only once — never a third draft call.
    expect(mock.draftCalls).toBe(2);
  });

  it('does NOT repair a restricted-topic failure — it goes straight to review', async () => {
    const short = {
      ...(defaults().draft as Record<string, unknown>),
      body: shortButStructuredBody(),
    };
    const mock = sequencedDraftMock([short], {
      extraction: {
        ...(defaults().extraction as Record<string, unknown>),
        restrictedTopics: ['self_diagnosis'],
      },
    });

    const outcome = await generateArticle(SOURCE, deps({ fetchImpl: mock.fetchImpl }));
    if (outcome.decision === 'failed') throw new Error('unexpected failure');

    expect(outcome.decision).toBe('needs_review');
    expect(hardFailureCodes(outcome.report)).toContain('restricted_topic');
    // A restricted topic is not repairable: no second draft call is made.
    expect(mock.draftCalls).toBe(1);
    expect(outcome.reason).not.toContain('validation_failed_after_repair');
  });

  it('does NOT repair a fabricated (untraceable) number — it goes straight to review', async () => {
    const mock = sequencedDraftMock([
      { ...(defaults().draft as Record<string, unknown>), body: bodyWithUntraceableNumber() },
    ]);

    const outcome = await generateArticle(SOURCE, deps({ fetchImpl: mock.fetchImpl }));
    if (outcome.decision === 'failed') throw new Error('unexpected failure');

    expect(outcome.decision).toBe('needs_review');
    expect(hardFailureCodes(outcome.report)).toContain('untraceable_number');
    // Fabrication belongs to a human, not to an automated rewrite.
    expect(mock.draftCalls).toBe(1);
  });
});
