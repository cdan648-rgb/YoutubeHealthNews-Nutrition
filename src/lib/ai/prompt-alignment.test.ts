/**
 * Prompt ↔ schema alignment regression tests.
 *
 * These assertions guard the exact production failure the pipeline has hit twice: a Zod
 * constraint the JSON Schema alone does not express (min items, min string length, required
 * accompanying field), which the model can only satisfy if the prompt tells it about the
 * constraint. Each test names a specific Zod rule and requires the prompt to state it —
 * so a future prompt rewrite that drops one of these lines fails here instead of in
 * production on Hanoi day.
 *
 * Every test asserts on prompt CONTENT (deterministic strings), not model behaviour.
 */
import { describe, expect, it } from 'vitest';
import {
  HOUSE_RULES,
  RESEARCH_RULES,
  draftPrompt,
  extractionPrompt,
  repairDraftPrompt,
  researchDraftPrompt,
  researchExtractionPrompt,
  seoPrompt,
  verificationPrompt,
} from './stages';

const CATEGORY_LIST = [
  { slug: 'vi-chat-vitamin', name: 'Vi chất', description: 'x' },
  { slug: 'dinh-duong-chuyen-hoa', name: 'Dinh dưỡng', description: 'x' },
] as const;

function extract() {
  return extractionPrompt({
    title: 't',
    descriptionClean: 'd',
    keywords: [],
    durationSeconds: null,
    publishedAt: '2026-09-28',
    categories: CATEGORY_LIST,
  });
}

function verify() {
  return verificationPrompt({
    claims: [
      { text: 'claim one', kind: 'speaker_claim', needsCitation: false, numbers: [] },
      { text: 'claim two', kind: 'general_knowledge', needsCitation: true, numbers: [] },
      { text: 'claim three', kind: 'uncertain', needsCitation: false, numbers: [] },
    ],
    allowedHosts: ['medlineplus.gov', 'nih.gov'],
  });
}

function draft() {
  return draftPrompt({
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
        { text: 'claim one', kind: 'speaker_claim', needsCitation: false, numbers: [] },
        { text: 'claim two', kind: 'general_knowledge', needsCitation: false, numbers: [] },
        { text: 'claim three', kind: 'general_knowledge', needsCitation: false, numbers: [] },
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
}

function researchDraft() {
  return researchDraftPrompt({
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
        { text: 'claim one', kind: 'general_knowledge', needsCitation: false, numbers: [] },
        { text: 'claim two', kind: 'general_knowledge', needsCitation: false, numbers: [] },
        { text: 'claim three', kind: 'general_knowledge', needsCitation: false, numbers: [] },
      ],
    },
    verification: { verifiedClaims: [] },
    paperTitle: 't',
    paperUrl: 'https://europepmc.org/article/MED/1',
    journal: null,
    publicationDate: null,
    authors: [],
    abstract: 'a',
    wordCountMin: 700,
    wordCountMax: 1400,
  });
}

describe('house rules ↔ validation gate', () => {
  it('names every prescriptive-language phrase the gate rejects', () => {
    // src/lib/validate/gate.ts PRESCRIPTIVE_PATTERNS. Each Vietnamese phrase the gate
    // matches must have a corresponding "KHÔNG" in the house rules; otherwise the model
    // has no way to know a passing article cannot say that.
    expect(HOUSE_RULES).toMatch(/nên uống\/dùng\/bổ sung\/tiêm/);
    expect(HOUSE_RULES).toMatch(/hãy uống\/dùng\/bổ sung\/tiêm/);
    expect(HOUSE_RULES).toMatch(/liều dùng khuyến cáo/);
    expect(HOUSE_RULES).toMatch(/mỗi ngày uống\/dùng/);
    expect(HOUSE_RULES).toMatch(/chữa khỏi/);
    expect(HOUSE_RULES).toMatch(/điều trị khỏi/);
    expect(HOUSE_RULES).toMatch(/thay thế thuốc/);
    expect(HOUSE_RULES).toMatch(/không cần đi khám/);
    expect(HOUSE_RULES).toMatch(/tự chẩn đoán/);
    expect(HOUSE_RULES).toMatch(/tự điều trị/);
    // The dosage-unit set the gate regex catches.
    expect(HOUSE_RULES).toMatch(/mg,\s*mcg/);
    expect(HOUSE_RULES).toMatch(/IU/);
  });

  it('names the ≤10-word copy-overlap ceiling that keeps articles safely under the gate ≤12', () => {
    expect(HOUSE_RULES).toMatch(/KHÔNG sao chép quá 10 từ liên tiếp/);
  });
});

describe('extraction prompt ↔ schema', () => {
  it('names the 3–24 claims range (extractionSchema.claims.min(3).max(24))', () => {
    // Sparse videos have produced <3 claims and failed Zod silently. The prompt must
    // state the range explicitly so the model splits a long claim into two if needed.
    expect(extract()).toMatch(/3[–-]24 luận điểm/);
  });

  it('names the 4–8 outline range (extractionSchema.outline.min(4).max(8))', () => {
    expect(extract()).toMatch(/4[–-]8 mục/);
  });

  it('lists every restricted-topic value the enum accepts', () => {
    // If the prompt uses a phrase the enum doesn't include, restrictedTopics fails Zod.
    // The prompt's Vietnamese description covers each enum member; this is a smoke check
    // that the block naming these is still present.
    expect(extract()).toMatch(/liều dùng/);
    expect(extract()).toMatch(/vắc xin/);
    expect(extract()).toMatch(/ung thư/);
  });

  it('carries over to the research extraction prompt', () => {
    const p = researchExtractionPrompt({
      title: 't',
      abstract: 'a',
      journal: null,
      publicationDate: null,
      authors: [],
      categories: CATEGORY_LIST,
    });
    expect(p).toMatch(/3[–-]24 luận điểm/);
    expect(p).toMatch(/4[–-]8 mục/);
  });
});

describe('verification prompt ↔ schema', () => {
  it('requires reason on every verifiedClaim (verificationSchema.reason: min 3)', () => {
    // The Zod schema requires a reason on every claim, not just "cite". A model that
    // omits reason on "drop"/"attribute_to_speaker" fails Zod. The prompt must say this.
    expect(verify()).toMatch(/MỌI phần tử verifiedClaims BẮT BUỘC có "reason"/);
  });

  it('warns against fabricated URLs', () => {
    // A model that guesses a URL is worse than a model that admits it does not know.
    expect(verify()).toMatch(/KHÔNG bịa URL/);
  });
});

describe('draft prompt (youtube) ↔ schema', () => {
  it('names the ≥8 body-block minimum (draftSchema.body.min(8))', () => {
    expect(draft()).toMatch(/ÍT NHẤT 8 phần tử/);
  });

  it('requires a p between adjacent h2 blocks', () => {
    // Without this the model can hit every per-type minimum and still ship a list-of-
    // headings body under 8 blocks.
    expect(draft()).toMatch(/GIỮA hai block .*"h2".*"p"/);
  });

  it('names the max-8 reference cap (draftSchema.references.max(8))', () => {
    expect(draft()).toMatch(/TỐI ĐA 8 nguồn/);
  });

  it('names the four required reference fields', () => {
    // referenceSchema requires label/title/publisher/url; the prompt must instruct the
    // model to emit them all or Zod will reject.
    expect(draft()).toMatch(/"label", "title", "publisher", "url"/);
  });

  it('names title (10–160) and dek (80–320) length bounds', () => {
    expect(draft()).toMatch(/title: 10[–-]160/);
    expect(draft()).toMatch(/dek: 80[–-]320/);
  });

  it('names paragraph, heading, key_facts and callout length limits', () => {
    // Each per-block Zod min-length that the model realistically may violate.
    expect(draft()).toMatch(/"p".*20[–-]1600/);
    expect(draft()).toMatch(/"h2".*3[–-]160/);
    expect(draft()).toMatch(/key_facts.*3[–-]120/);
    expect(draft()).toMatch(/key_facts.*5[–-]320/);
    expect(draft()).toMatch(/callout.*20[–-]900/);
  });

  it('carries the 700–1400-word range from the caller', () => {
    // The prompt is templated on the caller's word band; a mismatched hard-coded number
    // here would let the gate reject a well-formed article.
    expect(draft()).toContain('700–1400 từ');
  });

  it('reinforces the medical-safety and sourcing targets that reduce first-draft failures', () => {
    // Prevention side of the repair work: the draft prompt itself must prohibit self-care
    // advice, state the hard minimum word count, and ask for ≥2 sources where appropriate —
    // so fewer drafts reach the gate broken in the first place.
    expect(draft()).toMatch(/tự chẩn đoán hay tự điều trị/);
    expect(draft()).toMatch(/BẮT BUỘC đạt tối thiểu 700 từ/);
    expect(draft()).toMatch(/ÍT NHẤT 2 nguồn/);
  });
});

describe('draft prompt (research) ↔ schema and gate', () => {
  it('names the ≥8 body-block minimum', () => {
    expect(researchDraft()).toMatch(/ÍT NHẤT 8 phần tử/);
  });

  it('states research-specific gate rules from RESEARCH_RULES', () => {
    // The gate needs: no speaker, no video_embed, a caution callout, and the paper URL
    // as the first reference. All four are asserted in RESEARCH_RULES, which is
    // prepended to the system prompt — so testing the source rules here proves they
    // reach the model.
    expect(RESEARCH_RULES).toMatch(/TUYỆT ĐỐI KHÔNG dùng attribution "speaker"/);
    expect(RESEARCH_RULES).toMatch(/callout","tone":"caution/);
    expect(RESEARCH_RULES).toMatch(/BẮT BUỘC chứa đường dẫn tới chính công trình gốc/);
  });

  it('cites the paper URL first (index 0) with the exact URL', () => {
    // The gate treats requiredReferenceUrls[0] as a hard requirement; the prompt must
    // interpolate the exact URL rather than "the paper's URL".
    expect(researchDraft()).toContain('https://europepmc.org/article/MED/1');
    expect(researchDraft()).toMatch(/chỉ số 0.*PHẢI là chính công trình gốc/);
  });

  it('names the max-8 reference cap and the required-field shape', () => {
    expect(researchDraft()).toMatch(/TỐI ĐA 8/);
    expect(researchDraft()).toMatch(/"label", "title", "publisher", "url"/);
  });

  it('reinforces the medical-safety prohibitions and the hard minimum word count', () => {
    expect(researchDraft()).toMatch(/tự chẩn đoán hay tự điều trị/);
    expect(researchDraft()).toMatch(/BẮT BUỘC đạt tối thiểu 700 từ/);
  });
});

describe('repair prompt', () => {
  function repair() {
    return repairDraftPrompt({
      previousDraftJson: '{"title":"x"}',
      issues: [
        { code: 'too_short', severity: 'hard', message: 'article is 556 words, minimum 700' },
        {
          code: 'prescriptive_language',
          severity: 'hard',
          message: 'encourages',
          detail: 'tự chẩn đoán',
        },
        { code: 'few_references', severity: 'soft', message: 'only 0 external reference(s)' },
      ],
      sourceTitle: 'Số 118: THIẾU MAGIE',
      sourceKind: 'youtube',
      wordCountMin: 700,
      wordCountMax: 1400,
    });
  }

  it('surfaces each reported issue with its code, severity and detail', () => {
    const p = repair();
    expect(p).toContain('too_short');
    expect(p).toContain('prescriptive_language');
    expect(p).toContain('few_references');
    expect(p).toMatch(/NGHIÊM TRỌNG/); // hard
    expect(p).toMatch(/cảnh báo/); // soft
    expect(p).toContain('tự chẩn đoán'); // the detail string
  });

  it('embeds the model’s own prior JSON and demands the complete corrected article', () => {
    const p = repair();
    expect(p).toContain('{"title":"x"}');
    expect(p).toMatch(/GIỮ NGUYÊN/);
    expect(p).toMatch(/CHỈ sửa/);
    expect(p).toMatch(/TOÀN BỘ bài viết đã sửa/);
    // The exhaustive block-shape contract rides along, exactly as the writing stage's does.
    expect(p).toMatch(/HÌNH DẠNG CHÍNH XÁC CỦA TỪNG LOẠI BLOCK/);
  });

  it('preserves the source topic and keeps the medical-safety rules', () => {
    const p = repair();
    expect(p).toContain('Số 118: THIẾU MAGIE');
    expect(p).toMatch(/KHÔNG bịa số liệu/);
    expect(p).toMatch(/an toàn y tế/i);
  });
});

describe('seo prompt ↔ schema', () => {
  it('names metaTitle 10–70, metaDescription 80–180, keywords limits', () => {
    const p = seoPrompt({ title: 'T', dek: 'D', topic: 'X' });
    // metaTitle: min 10, max 70 — the min was omitted in the earlier prompt and would
    // silently reject any short title the model chose.
    expect(p).toMatch(/metaTitle: 10[–-]70/);
    expect(p).toMatch(/metaDescription: 80[–-]180/);
    // keywords.max(12) and per-item length constraint.
    expect(p).toMatch(/12 từ khoá/);
    expect(p).toMatch(/mỗi từ khoá 2[–-]60/);
  });
});
