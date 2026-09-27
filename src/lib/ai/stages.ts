/**
 * The generation stages: schemas, prompts and JSON Schemas.
 *
 * Four separate calls rather than one large prompt, for reasons that are about control
 * rather than elegance:
 *
 *   extract   inventory the claims and classify each one's provenance
 *   verify    decide which claims can be sourced, and downgrade the rest
 *   write     produce the body, knowing which claims it may assert
 *   seo       metadata, where a bad answer is cosmetic rather than dangerous
 *
 * Splitting them means the claim inventory exists as data before any prose is written, so
 * "did the article assert something it has no source for?" is a comparison rather than an
 * interpretation. One giant prompt would collapse that into a single opaque step.
 *
 * Every prompt is in Vietnamese because the output is Vietnamese; asking in English and
 * answering in Vietnamese reliably degrades the register.
 */
import { z } from 'zod';
import { blockSchema, referenceSchema } from '@/lib/domain/blocks';

/* ============================== shared rules ============================== */

/**
 * Prepended to every stage. States the constraints the validation gate will enforce, so
 * the model is aiming at the same target the gate is measuring — and so a failure is a
 * genuine disagreement rather than the model never having been told.
 */
export const HOUSE_RULES = `Bạn là biên tập viên của một trang tin sức khoẻ độc lập bằng tiếng Việt.

NGUYÊN TẮC BẮT BUỘC:
1. KHÔNG bao giờ bịa ra con số, tỷ lệ phần trăm, liều lượng, tên nghiên cứu hay lời dẫn.
2. Mọi con số trong bài PHẢI xuất hiện trong tư liệu nguồn được cung cấp. Nếu không có, hãy bỏ con số đó.
3. KHÔNG trích dẫn nguyên văn lời người nói trong video. Chúng tôi KHÔNG có bản ghi lời nói, nên mọi trích dẫn nguyên văn đều là bịa đặt. Chỉ được diễn giải lại.
4. KHÔNG đưa ra liều lượng (mg, mcg, IU...), KHÔNG khuyên người đọc uống hay dùng bất cứ thứ gì, KHÔNG nói điều gì "chữa khỏi" bệnh.
5. Phân biệt rõ: điều video NÓI (attribution "speaker") với điều đã được y học xác lập (attribution "established", phải kèm ref tới nguồn).
6. Diễn giải bằng lời của mình. KHÔNG sao chép quá 10 từ liên tiếp từ tư liệu nguồn.
7. Nếu không đủ căn cứ cho một ý, hãy bỏ ý đó thay vì viết mơ hồ.
8. Viết tiếng Việt tự nhiên, rõ ràng, tôn trọng người đọc. Không giật gân.`;

/* ================================ extract ================================ */

/** Restricted topics. Any hit routes the article to human review, whatever the prose. */
export const RESTRICTED_TOPICS = [
  'dosing_protocol',
  'paediatric_dosing',
  'pregnancy_advice',
  'cancer_treatment_choice',
  'drug_interaction',
  'vaccine_safety_controversy',
  'cure_claim',
  'self_diagnosis',
] as const;

export const extractionSchema = z.object({
  topic: z.string().min(3).max(200),
  plainLanguageTopic: z.string().min(3).max(300),
  proposedCategorySlug: z.string().min(3).max(60),
  isFactCheck: z.boolean(),
  /** Topics the model believes the material touches. Any entry blocks auto-publication. */
  restrictedTopics: z.array(z.enum(RESTRICTED_TOPICS)),
  outline: z
    .array(z.object({ heading: z.string().min(3).max(160), intent: z.string().min(3).max(300) }))
    .min(4)
    .max(8),
  claims: z
    .array(
      z.object({
        text: z.string().min(10).max(600),
        /** 'speaker' = the video said it. 'general_knowledge' = textbook. 'uncertain' = drop or qualify. */
        kind: z.enum(['speaker_claim', 'general_knowledge', 'uncertain']),
        needsCitation: z.boolean(),
        /** Any number the claim contains, copied verbatim from the source. */
        numbers: z.array(z.string().max(40)),
      }),
    )
    .min(3)
    .max(24),
});

export type Extraction = z.infer<typeof extractionSchema>;

export const extractionJsonSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'topic',
    'plainLanguageTopic',
    'proposedCategorySlug',
    'isFactCheck',
    'restrictedTopics',
    'outline',
    'claims',
  ],
  properties: {
    topic: { type: 'string' },
    plainLanguageTopic: { type: 'string' },
    proposedCategorySlug: { type: 'string' },
    isFactCheck: { type: 'boolean' },
    restrictedTopics: { type: 'array', items: { type: 'string', enum: [...RESTRICTED_TOPICS] } },
    outline: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['heading', 'intent'],
        properties: { heading: { type: 'string' }, intent: { type: 'string' } },
      },
    },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'kind', 'needsCitation', 'numbers'],
        properties: {
          text: { type: 'string' },
          kind: { type: 'string', enum: ['speaker_claim', 'general_knowledge', 'uncertain'] },
          needsCitation: { type: 'boolean' },
          numbers: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

export function extractionPrompt(input: {
  readonly title: string;
  readonly descriptionClean: string;
  readonly keywords: readonly string[];
  readonly durationSeconds: number | null;
  readonly publishedAt: string;
  readonly categories: readonly { slug: string; name: string; description: string }[];
}): string {
  const categoryList = input.categories
    .map((category) => `- ${category.slug}: ${category.name} — ${category.description}`)
    .join('\n');

  return `Dưới đây là tư liệu công khai về một video. Nhiệm vụ của bạn là PHÂN TÍCH, chưa viết bài.

TIÊU ĐỀ VIDEO:
${input.title}

PHẦN MÔ TẢ (do tác giả video viết — đây là toàn bộ tư liệu bạn có):
"""
${input.descriptionClean}
"""

TỪ KHOÁ: ${input.keywords.slice(0, 15).join(', ')}
THỜI LƯỢNG: ${input.durationSeconds === null ? 'không rõ' : `${Math.round(input.durationSeconds / 60)} phút`}
NGÀY ĐĂNG: ${input.publishedAt}

CÁC CHUYÊN MỤC CÓ SẴN (chọn ĐÚNG MỘT slug từ danh sách này):
${categoryList}

YÊU CẦU:
1. Xác định chủ đề và chuyên mục phù hợp.
2. Liệt kê các luận điểm. Với mỗi luận điểm, phân loại:
   - "speaker_claim": điều video nói, chưa rõ đã được y học xác lập hay chưa.
   - "general_knowledge": kiến thức y khoa cơ bản, có thể dẫn nguồn uy tín.
   - "uncertain": nghe có vẻ mạnh nhưng không kiểm chứng được — ví dụ các con số cụ thể không rõ xuất xứ.
3. Với mỗi luận điểm, liệt kê MỌI con số xuất hiện trong đó, copy đúng như trong tư liệu.
4. "restrictedTopics": nếu tư liệu liên quan tới liều dùng, dùng thuốc cho trẻ em, thai kỳ, lựa chọn phác đồ điều trị ung thư, tương tác thuốc, tranh cãi về an toàn vắc xin, tuyên bố chữa khỏi, hoặc tự chẩn đoán — hãy liệt kê. Nếu không, trả về danh sách rỗng.
5. "isFactCheck": true nếu tư liệu chủ yếu phản biện một quan niệm sai hoặc một sản phẩm được quảng cáo quá mức.
6. Đề xuất 4–8 mục (outline) cho bài viết.

CHỈ trả về JSON đúng schema.`;
}

/* ================================= verify ================================ */

export const verificationSchema = z.object({
  verifiedClaims: z.array(
    z.object({
      claimText: z.string().min(5).max(600),
      /** How the writing stage must present it. */
      resolution: z.enum(['cite', 'attribute_to_speaker', 'drop']),
      /** A specific page on an allowlisted host. Required when resolution is 'cite'. */
      suggestedUrl: z.string().max(500).optional(),
      suggestedPublisher: z.string().max(200).optional(),
      suggestedTitle: z.string().max(400).optional(),
      reason: z.string().min(3).max(400),
    }),
  ),
});

export type Verification = z.infer<typeof verificationSchema>;

export const verificationJsonSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['verifiedClaims'],
  properties: {
    verifiedClaims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claimText', 'resolution', 'reason'],
        properties: {
          claimText: { type: 'string' },
          resolution: { type: 'string', enum: ['cite', 'attribute_to_speaker', 'drop'] },
          suggestedUrl: { type: 'string' },
          suggestedPublisher: { type: 'string' },
          suggestedTitle: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  },
};

export function verificationPrompt(input: {
  readonly claims: Extraction['claims'];
  readonly allowedHosts: readonly string[];
}): string {
  return `Với mỗi luận điểm dưới đây, hãy quyết định cách trình bày trong bài viết.

LUẬN ĐIỂM:
${input.claims.map((claim, index) => `${index + 1}. [${claim.kind}] ${claim.text}${claim.numbers.length > 0 ? ` (con số: ${claim.numbers.join(', ')})` : ''}`).join('\n')}

CÁC TÊN MIỀN ĐƯỢC PHÉP DẪN NGUỒN (không được dùng tên miền khác):
${input.allowedHosts.join(', ')}

QUY TẮC QUYẾT ĐỊNH:
- "cite": chỉ khi đây là kiến thức y khoa đã được xác lập VÀ bạn biết một trang cụ thể trên tên miền được phép nói về nó. Cung cấp suggestedUrl đầy đủ (https://...), suggestedPublisher và suggestedTitle.
- "attribute_to_speaker": điều video nói nhưng bạn không chắc đã được xác lập. Bài viết sẽ ghi rõ "theo video".
- "drop": luận điểm không kiểm chứng được và cũng không đáng nêu, HOẶC chứa con số cụ thể không rõ xuất xứ.

CỰC KỲ QUAN TRỌNG: KHÔNG bịa URL. Nếu không chắc một trang cụ thể tồn tại, hãy chọn "attribute_to_speaker" hoặc "drop" thay vì đoán một đường dẫn. Một nguồn bịa còn tệ hơn không có nguồn.

CHỈ trả về JSON đúng schema.`;
}

/* ================================= write ================================= */

export const draftSchema = z.object({
  title: z.string().min(10).max(160),
  dek: z.string().min(80).max(320),
  slug: z.string().min(10).max(90),
  categorySlug: z.string().min(3).max(60),
  isFactCheck: z.boolean(),
  body: z.array(blockSchema).min(8),
  references: z.array(referenceSchema).max(8),
});

export type Draft = z.infer<typeof draftSchema>;

/**
 * JSON Schema for the body blocks.
 *
 * Kept as a permissive object with an enum-constrained `t` rather than a discriminated
 * union: `oneOf` with discriminators is one of the least consistently supported parts of
 * JSON Schema across providers, and Zod re-checks the discriminated union properly
 * afterwards anyway.
 */
const blockJsonSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['t'],
  properties: {
    t: {
      type: 'string',
      enum: [
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
      ],
    },
    text: { type: 'string' },
    title: { type: 'string' },
    items: { type: 'array', items: { type: 'string' } },
    attribution: { type: 'string', enum: ['speaker', 'established', 'general'] },
    ref: { type: 'integer' },
    kind: { type: 'string', enum: ['paraphrase', 'cited'] },
    tone: { type: 'string', enum: ['info', 'caution', 'myth'] },
    motif: {
      type: 'string',
      enum: ['molecule', 'flame', 'wave', 'shield', 'organ', 'joint', 'breath', 'lattice'],
    },
    caption: { type: 'string' },
    alt: { type: 'string' },
  },
};

export const draftJsonSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'dek', 'slug', 'categorySlug', 'isFactCheck', 'body', 'references'],
  properties: {
    title: { type: 'string' },
    dek: { type: 'string' },
    slug: { type: 'string' },
    categorySlug: { type: 'string' },
    isFactCheck: { type: 'boolean' },
    body: { type: 'array', items: blockJsonSchema },
    references: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'title', 'publisher', 'url'],
        properties: {
          label: { type: 'string' },
          title: { type: 'string' },
          publisher: { type: 'string' },
          url: { type: 'string' },
          published: { type: 'string' },
        },
      },
    },
  },
};

export function draftPrompt(input: {
  readonly extraction: Extraction;
  readonly verification: Verification;
  readonly sourceTitle: string;
  readonly descriptionClean: string;
  readonly channelTitle: string;
  readonly wordCountMin: number;
  readonly wordCountMax: number;
  readonly allowedCategorySlugs: readonly string[];
}): string {
  const citable = input.verification.verifiedClaims.filter((claim) => claim.resolution === 'cite');
  const speakerOnly = input.verification.verifiedClaims.filter(
    (claim) => claim.resolution === 'attribute_to_speaker',
  );
  const dropped = input.verification.verifiedClaims.filter((claim) => claim.resolution === 'drop');

  return `Viết bài báo hoàn chỉnh dựa trên phân tích đã có.

CHỦ ĐỀ: ${input.extraction.topic}
CHUYÊN MỤC (dùng đúng slug này): ${input.extraction.proposedCategorySlug}
VIDEO NGUỒN: "${input.sourceTitle}" — kênh ${input.channelTitle}

TƯ LIỆU NGUỒN (chỉ được dùng con số xuất hiện ở đây):
"""
${input.descriptionClean}
"""

DÀN Ý ĐỀ XUẤT:
${input.extraction.outline.map((item, i) => `${i + 1}. ${item.heading} — ${item.intent}`).join('\n')}

Ý CÓ THỂ DẪN NGUỒN (attribution "established", kèm ref là chỉ số trong mảng references):
${citable.length === 0 ? '(không có)' : citable.map((claim, i) => `[ref ${i}] ${claim.claimText}\n   nguồn: ${claim.suggestedTitle ?? ''} — ${claim.suggestedPublisher ?? ''} — ${claim.suggestedUrl ?? ''}`).join('\n')}

Ý CHỈ ĐƯỢC GHI LÀ "THEO VIDEO" (attribution "speaker"):
${speakerOnly.length === 0 ? '(không có)' : speakerOnly.map((claim) => `- ${claim.claimText}`).join('\n')}

Ý PHẢI BỎ HẲN, KHÔNG ĐƯỢC NHẮC LẠI NHƯ SỰ THẬT:
${dropped.length === 0 ? '(không có)' : dropped.map((claim) => `- ${claim.claimText} (lý do: ${claim.reason})`).join('\n')}

CẤU TRÚC BẮT BUỘC của mảng body:
- ĐÚNG MỘT block {"t":"source_note"} (đặt gần đầu bài)
- ÍT NHẤT 4 block {"t":"h2"}
- ÍT NHẤT MỘT block {"t":"key_facts"} với 2–8 items
- ÍT NHẤT MỘT block {"t":"p"} có "attribution":"speaker"
- ĐÚNG MỘT block {"t":"video_embed"}
- ĐÚNG MỘT block {"t":"disclaimer"} (đặt cuối)
- Tuỳ chọn: pull_quote (kind PHẢI là "paraphrase"), callout, figure_svg

ĐỘ DÀI: ${input.wordCountMin}–${input.wordCountMax} từ (đếm theo âm tiết tiếng Việt).

references: CHỈ đưa vào các nguồn đã được cung cấp ở trên. KHÔNG thêm nguồn nào khác. Nếu không có nguồn nào, để mảng rỗng.

slug: chữ thường không dấu, các từ nối bằng dấu gạch ngang, chỉ a-z 0-9 và dấu -.

CHỈ trả về JSON đúng schema.`;
}

/* ================================== seo ================================== */

export const seoSchema = z.object({
  metaTitle: z.string().min(10).max(70),
  metaDescription: z.string().min(80).max(180),
  keywords: z.array(z.string().min(2).max(60)).max(12),
});

export type Seo = z.infer<typeof seoSchema>;

export const seoJsonSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['metaTitle', 'metaDescription', 'keywords'],
  properties: {
    metaTitle: { type: 'string' },
    metaDescription: { type: 'string' },
    keywords: { type: 'array', items: { type: 'string' } },
  },
};

export function seoPrompt(input: {
  readonly title: string;
  readonly dek: string;
  readonly topic: string;
}): string {
  return `Viết metadata SEO cho bài viết sau.

TIÊU ĐỀ: ${input.title}
TÓM TẮT: ${input.dek}
CHỦ ĐỀ: ${input.topic}

- metaTitle: tối đa 70 ký tự, mô tả đúng nội dung, không giật gân.
- metaDescription: 80–180 ký tự, nêu bài viết trả lời câu hỏi gì và dẫn nguồn từ đâu.
- keywords: tối đa 12 từ khoá tiếng Việt người đọc thực sự tìm kiếm.

KHÔNG hứa hẹn kết quả sức khoẻ. KHÔNG dùng từ như "thần dược", "chữa khỏi", "bí mật".

CHỈ trả về JSON đúng schema.`;
}
