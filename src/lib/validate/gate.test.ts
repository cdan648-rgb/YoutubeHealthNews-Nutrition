/**
 * The red-team suite.
 *
 * Every test here takes a valid article and injects exactly one dangerous thing, then
 * asserts the gate rejects it with the right code. That shape matters: a test that fails an
 * article for the wrong reason would pass while the safeguard it claims to cover is broken.
 *
 * The baseline is the real magnesium seed article, so a "clean" case is genuinely
 * publishable rather than a contrivance that happens to satisfy the rules.
 */
import { describe, expect, it } from 'vitest';
import type { Block, Reference } from '@/lib/domain/blocks';
import { SEED_ARTICLES } from '@/content/seeds';
import { blocksToPlainText } from '@/lib/domain/blocks';
import { hardFailureCodes, longestSharedWordRun, validateArticle, type GateInput } from './gate';

const CATEGORY_SLUGS = [
  'vi-chat-vitamin',
  'dinh-duong-chuyen-hoa',
  'noi-tiet-hormone',
  'mien-dich-nhiem-trung-ung-thu',
  'tieu-hoa-gan-than',
  'co-xuong-khop-van-dong',
  'phong-ngua-tam-than',
];

const ALLOWED_HOSTS = [
  'who.int',
  'nih.gov',
  'nccih.nih.gov',
  'medlineplus.gov',
  'europepmc.org',
  'doi.org',
];

/** Non-optional lookup, so every use below is typed without a narrowing dance. */
function requireSeed(prefix: string) {
  const found = SEED_ARTICLES.find((item) => item.slug.startsWith(prefix));
  if (found === undefined) throw new Error(`seed "${prefix}" is missing`);
  return found;
}

const seed = requireSeed('thieu-magie');

/**
 * Source text for the baseline.
 *
 * Contains the numbers the article legitimately uses ("hơn 300 phản ứng"), because
 * traceability is checked against the source and a clean baseline must actually be
 * traceable. Deliberately NOT the real description verbatim — using that would trip the
 * copy-overlap rule, since the seed paraphrases it closely in places.
 */
const SOURCE_TEXT =
  'Magie là khoáng chất tham gia hơn 300 phản ứng sinh hoá. Phần lớn nằm trong xương và ' +
  'trong tế bào chứ không phải huyết tương, nên xét nghiệm máu có giới hạn. Nguồn gồm hạt, ' +
  'đậu, ngũ cốc nguyên hạt, rau lá xanh. Nhu cầu phụ thuộc tuổi, giới và chức năng thận.';

function baseInput(overrides: Partial<GateInput> = {}): GateInput {
  return {
    title: seed.title,
    dek: seed.dek,
    slug: seed.slug,
    categorySlug: seed.categorySlug,
    body: seed.body,
    references: seed.references,
    sourceText: SOURCE_TEXT,
    sourceTitle: 'Số 118: THIẾU MAGIE CƠ THỂ SỤP ĐỔ NHƯ THẾ NÀO?',
    allowedCategorySlugs: CATEGORY_SLUGS,
    allowedReferenceHosts: ALLOWED_HOSTS,
    ...overrides,
  };
}

/** Replace the first paragraph's text, leaving everything else intact. */
function withFirstParagraph(text: string): Block[] {
  let replaced = false;
  return (seed.body as Block[]).map((block) => {
    if (!replaced && block.t === 'p' && block.attribution === 'general') {
      replaced = true;
      return { ...block, text };
    }
    return block;
  });
}

describe('the baseline passes', () => {
  it('accepts a real, human-reviewed article', () => {
    const report = validateArticle(baseInput());
    expect(hardFailureCodes(report)).toStrictEqual([]);
    expect(report.passed).toBe(true);
    expect(report.stats.wordCount).toBeGreaterThan(700);
    expect(report.stats.speakerParagraphs).toBeGreaterThanOrEqual(1);
  });
});

describe('fabricated numbers', () => {
  it('rejects a statistic that appears in neither the source nor a reference', () => {
    const report = validateArticle(
      baseInput({
        body: withFirstParagraph(
          'Một nghiên cứu cho thấy 47 phần trăm người trưởng thành bị thiếu magie ở mức đáng lo ngại và cần được chú ý.',
        ),
      }),
    );
    expect(hardFailureCodes(report)).toContain('untraceable_number');
  });

  it('rejects a bare multiplier, not just a unit', () => {
    // The channel's own breathing description claims a clearance effect "gấp 15 lần". A
    // units-only detector waves that straight through, which is the exact failure this
    // rule exists for.
    const report = validateArticle(
      baseInput({
        body: withFirstParagraph(
          'Kỹ thuật này làm tăng hoạt động thanh thải của cơ thể mạnh hơn bình thường gấp 15 lần, theo một cách rất rõ rệt.',
        ),
      }),
    );
    expect(hardFailureCodes(report)).toContain('untraceable_number');
  });

  it('rejects a spelled-out multiplier', () => {
    const report = validateArticle(
      baseInput({
        body: withFirstParagraph(
          'Người thiếu magie có nguy cơ gấp đôi so với người bình thường, đó là điều đã được ghi nhận rộng rãi.',
        ),
      }),
    );
    expect(hardFailureCodes(report)).toContain('untraceable_number');
  });

  it('accepts a number that IS in the source', () => {
    const report = validateArticle(
      baseInput({
        body: withFirstParagraph(
          'Magie tham gia vào hơn 300 phản ứng sinh hoá khác nhau, một con số cho thấy phạm vi ảnh hưởng rất rộng.',
        ),
      }),
    );
    expect(hardFailureCodes(report)).not.toContain('untraceable_number');
  });

  it('accepts a number supplied by a verified reference', () => {
    const report = validateArticle(
      baseInput({
        body: withFirstParagraph(
          'Tài liệu tham khảo ghi nhận con số 320 miligam trong bối cảnh dân số, không phải khuyến nghị cá nhân.',
        ),
        referenceTexts: ['Adult requirements are discussed around 320 in population terms.'],
      }),
    );
    expect(hardFailureCodes(report)).not.toContain('untraceable_number');
  });

  it('does not flag a year', () => {
    const report = validateArticle(
      baseInput({
        body: withFirstParagraph(
          'Tài liệu được cập nhật năm 2024 và vẫn giữ nguyên các kết luận chính về vai trò của khoáng chất này.',
        ),
      }),
    );
    expect(hardFailureCodes(report)).not.toContain('untraceable_number');
  });

  it('does not flag ordinary Vietnamese prose containing "g" after a number', () => {
    // JavaScript's \b is ASCII-only, so /\d+\s*g\b/ matches "126 gọi". A dosage detector
    // without a \p{L} lookahead flags normal sentences.
    const report = validateArticle(
      baseInput({
        body: withFirstParagraph(
          'Số 118 gọi tình trạng này là một cuộc khủng hoảng âm thầm, và cách gọi đó phản ánh đúng bản chất vấn đề.',
        ),
        sourceText: `${SOURCE_TEXT} Số 118 gọi đây là khủng hoảng âm thầm.`,
      }),
    );
    expect(hardFailureCodes(report)).not.toContain('prescriptive_dosage');
  });
});

describe('prescriptive content', () => {
  it.each([
    [
      'Người lớn nên bổ sung khoảng 400 mg magie mỗi ngày để đạt được hiệu quả tốt nhất cho cơ thể.',
      'prescriptive_dosage',
    ],
    [
      'Quý vị nên uống magie vào buổi tối để cơ thể hấp thu tốt hơn và ngủ sâu hơn mỗi đêm.',
      'prescriptive_language',
    ],
    [
      'Hãy dùng thêm khoáng chất này hằng ngày, đó là cách đơn giản nhất để cải thiện tình trạng sức khoẻ.',
      'prescriptive_language',
    ],
    [
      'Bổ sung đầy đủ sẽ chữa khỏi tình trạng mệt mỏi kéo dài mà nhiều người đang gặp phải hiện nay.',
      'prescriptive_language',
    ],
    [
      'Cách này có thể thay thế thuốc mà bác sĩ đã kê, giúp quý vị tiết kiệm chi phí điều trị lâu dài.',
      'prescriptive_language',
    ],
    [
      'Nếu áp dụng đúng thì không cần đi khám, quý vị hoàn toàn có thể tự theo dõi tại nhà mỗi ngày.',
      'prescriptive_language',
    ],
  ])('rejects %j', (text, expectedCode) => {
    const report = validateArticle(baseInput({ body: withFirstParagraph(text) }));
    expect(hardFailureCodes(report)).toContain(expectedCode);
  });

  it('accepts a sentence that explicitly declines to give a dose', () => {
    // The seed says exactly this, and it must remain sayable: "liều lượng là việc của bác
    // sĩ điều trị". A keyword match on "liều" would forbid the safest sentence in the piece.
    const report = validateArticle(
      baseInput({
        body: withFirstParagraph(
          'Vì nhu cầu khác nhau theo từng người, liều lượng là việc của bác sĩ điều trị chứ không phải của một bài viết.',
        ),
      }),
    );
    expect(hardFailureCodes(report)).not.toContain('prescriptive_language');
    expect(hardFailureCodes(report)).not.toContain('prescriptive_dosage');
  });
});

describe('fabricated attribution', () => {
  it('rejects a pull quote claiming a citation it does not have', () => {
    const body = (seed.body as Block[]).map((block) =>
      block.t === 'pull_quote' ? { ...block, kind: 'cited' as const, ref: 99 } : block,
    );
    const codes = hardFailureCodes(validateArticle(baseInput({ body })));
    expect(codes).toContain('fabricated_quote');
  });

  it('rejects a claim presented as established fact with no reference', () => {
    const body = (seed.body as Block[]).map((block) =>
      block.t === 'p' && block.attribution === 'established'
        ? { t: 'p' as const, text: block.text, attribution: 'established' as const }
        : block,
    );
    expect(hardFailureCodes(validateArticle(baseInput({ body })))).toContain(
      'unsourced_established_claim',
    );
  });
});

describe('sourcing', () => {
  it('rejects a reference on a host that is not approved', () => {
    const report = validateArticle(
      baseInput({
        references: [
          {
            label: '1',
            title: 'Blog post',
            publisher: 'Health Blog',
            url: 'https://healthblog.example/magie',
          },
        ],
      }),
    );
    expect(hardFailureCodes(report)).toContain('reference_not_allowlisted');
  });

  it('rejects a reference that returned 404', () => {
    const url = seed.references[0]?.url ?? '';
    const report = validateArticle(baseInput({ unreachableReferenceUrls: [url] }));
    expect(hardFailureCodes(report)).toContain('reference_unreachable');
  });

  it('only warns when an allowlisted host BLOCKED us rather than 404ing', () => {
    // Measured behaviour: ods.od.nih.gov and cdc.gov return 403 to datacenter requests
    // while the pages exist. Treating that as absence would reject correct NIH citations
    // and push the pipeline toward weaker sources.
    const url = seed.references[0]?.url ?? '';
    const report = validateArticle(baseInput({ unverifiableReferenceUrls: [url] }));
    expect(report.passed).toBe(true);
    expect(
      report.issues.some(
        (issue) => issue.code === 'reference_unverified' && issue.severity === 'soft',
      ),
    ).toBe(true);
  });

  it('accepts a subdomain of an allowlisted host', () => {
    const report = validateArticle(
      baseInput({
        references: [
          {
            label: '1',
            title: 'Fact sheet',
            publisher: 'NIH ODS',
            url: 'https://ods.od.nih.gov/factsheets/Magnesium-HealthProfessional/',
          },
        ],
      }),
    );
    expect(hardFailureCodes(report)).not.toContain('reference_not_allowlisted');
  });

  it('rejects a plain-http reference', () => {
    const report = validateArticle(
      baseInput({
        references: [{ label: '1', title: 'T', publisher: 'P', url: 'http://medlineplus.gov/x' }],
      }),
    );
    expect(hardFailureCodes(report)).toContain('reference_not_https');
  });
});

describe('restricted topics', () => {
  it.each(['dosing_protocol', 'cancer_treatment_choice', 'paediatric_dosing', 'pregnancy_advice'])(
    'blocks automatic publication for %s however clean the prose is',
    (topic) => {
      const report = validateArticle(baseInput({ detectedRestrictedTopics: [topic] }));
      expect(report.passed).toBe(false);
      expect(hardFailureCodes(report)).toContain('restricted_topic');
    },
  );

  it('passes when no restricted topic was detected', () => {
    expect(validateArticle(baseInput({ detectedRestrictedTopics: [] })).passed).toBe(true);
  });
});

describe('copying', () => {
  it('rejects a long verbatim lift from the source', () => {
    const lifted =
      'Magie là khoáng chất tham gia hơn 300 phản ứng sinh hoá. Phần lớn nằm trong xương và trong tế bào chứ không phải huyết tương, nên xét nghiệm máu có giới hạn.';
    const report = validateArticle(baseInput({ body: withFirstParagraph(lifted) }));
    expect(hardFailureCodes(report)).toContain('copy_overlap');
  });

  it('measures the longest shared run correctly', () => {
    expect(longestSharedWordRun('a b c d e', 'x b c d y')).toBe(3);
    expect(longestSharedWordRun('a b c', 'x y z')).toBe(0);
    expect(longestSharedWordRun('', 'anything')).toBe(0);
  });
});

describe('structure and identity', () => {
  it('rejects a body with too few sections', () => {
    const body = (seed.body as Block[]).filter((block) => block.t !== 'h2');
    expect(hardFailureCodes(validateArticle(baseInput({ body })))).toContain('too_few_sections');
  });

  it('rejects a missing disclaimer', () => {
    const body = (seed.body as Block[]).filter((block) => block.t !== 'disclaimer');
    expect(hardFailureCodes(validateArticle(baseInput({ body })))).toContain('missing_disclaimer');
  });

  it('rejects an invented category', () => {
    expect(
      hardFailureCodes(validateArticle(baseInput({ categorySlug: 'suc-khoe-tong-quat' }))),
    ).toContain('unknown_category');
  });

  it('rejects a malformed slug', () => {
    expect(hardFailureCodes(validateArticle(baseInput({ slug: 'Thieu_Magie' })))).toContain(
      'invalid_slug',
    );
  });

  it('rejects an article that is too short', () => {
    const body: Block[] = [
      { t: 'source_note' },
      { t: 'h2', text: 'Một' },
      { t: 'h2', text: 'Hai' },
      { t: 'h2', text: 'Ba' },
      { t: 'h2', text: 'Bốn' },
      { t: 'key_facts', title: 'Điểm chính', items: ['Một điểm', 'Hai điểm'] },
      {
        t: 'p',
        text: 'Theo video, đây là một đoạn văn rất ngắn để kiểm tra giới hạn độ dài.',
        attribution: 'speaker',
      },
      { t: 'video_embed' },
      { t: 'disclaimer' },
    ];
    expect(hardFailureCodes(validateArticle(baseInput({ body })))).toContain('too_short');
  });

  it('warns but does not block when there are too few references', () => {
    const report = validateArticle(baseInput({ references: [seed.references[0] as Reference] }));
    expect(
      report.issues.some((issue) => issue.code === 'few_references' && issue.severity === 'soft'),
    ).toBe(true);
  });

  it('reports the article text length it measured', () => {
    const report = validateArticle(baseInput());
    expect(report.stats.wordCount).toBe(
      blocksToPlainText(seed.body as Block[])
        .trim()
        .split(/\s+/).length,
    );
  });
});

/**
 * The research-article branch of the gate.
 *
 * A research piece is built from a paper, not a video, so three rules differ: it must not
 * embed a video it does not have, it must cite the paper's own landing page, and two
 * corroborating references are a hard floor rather than a soft nicety — a single study
 * reported with nothing beside it is exactly the failure the section exists to prevent.
 *
 * The baseline reuses the magnesium seed body with the video_embed removed and its speaker
 * paragraph neutralised, so a "clean" research article is genuinely publishable.
 */
describe('the research branch', () => {
  const PAPER_URL = 'https://europepmc.org/article/MED/40000001';

  const studyCaveat: Block = {
    t: 'callout',
    tone: 'caution',
    title: 'Một nghiên cứu đơn lẻ',
    text: 'Kết quả này cần được các nghiên cứu độc lập khác kiểm chứng lại trước khi trở thành cơ sở cho thực hành.',
  };

  function researchBody(): Block[] {
    // Drop the video, neutralise the speaker paragraph, and add the caution callout a
    // research piece must carry. The magnesium seed was written for a YouTube article, so
    // it has none of these — which is the point: the research rules are genuinely different.
    return [
      studyCaveat,
      ...(seed.body as Block[])
        .filter((block) => block.t !== 'video_embed')
        .map((block) =>
          block.t === 'p' && block.attribution === 'speaker'
            ? { t: 'p' as const, text: block.text, attribution: 'general' as const }
            : block,
        ),
    ];
  }

  const paperRef: Reference = {
    label: '1',
    title: 'A randomized trial',
    publisher: 'Europe PMC',
    url: PAPER_URL,
  };

  function researchInput(overrides: Partial<GateInput> = {}): GateInput {
    return baseInput({
      sourceKind: 'research',
      body: researchBody(),
      references: [paperRef, seed.references[0] as Reference],
      requiredReferenceUrls: [PAPER_URL],
      allowedReferenceHosts: [...ALLOWED_HOSTS, 'europepmc.org'],
      ...overrides,
    });
  }

  it('passes a well-formed research article', () => {
    const report = validateArticle(researchInput());
    expect(report.passed).toBe(true);
  });

  it('fails when the paper it reports on is not cited', () => {
    const codes = hardFailureCodes(
      validateArticle(researchInput({ references: [seed.references[0] as Reference] })),
    );
    expect(codes).toContain('missing_required_reference');
  });

  it('treats fewer than two references as a HARD failure, unlike a YouTube article', () => {
    const codes = hardFailureCodes(researchInputWithOneRef());
    expect(codes).toContain('few_references');

    function researchInputWithOneRef() {
      return validateArticle(
        researchInput({ references: [paperRef], requiredReferenceUrls: [PAPER_URL] }),
      );
    }
  });

  it('fails a research article that embeds a video', () => {
    const body = [...researchBody(), { t: 'video_embed' } as Block];
    const codes = hardFailureCodes(validateArticle(researchInput({ body })));
    expect(codes).toContain('unexpected_video_embed');
  });

  it('fails a research article that attributes a claim to a non-existent speaker', () => {
    let converted = false;
    const body = researchBody().map((block) => {
      if (!converted && block.t === 'p') {
        converted = true;
        return { t: 'p' as const, text: block.text, attribution: 'speaker' as const };
      }
      return block;
    });
    const codes = hardFailureCodes(validateArticle(researchInput({ body })));
    expect(codes).toContain('speaker_attribution_without_speaker');
  });
});
