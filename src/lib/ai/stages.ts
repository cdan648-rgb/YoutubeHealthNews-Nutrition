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
4. KHÔNG đưa ra liều lượng có đơn vị (mg, mcg, µg, g, kg, ml, IU, "đơn vị"). KHÔNG viết các cụm dạng: "bạn nên uống/dùng/bổ sung/tiêm", "hãy uống/dùng/bổ sung/tiêm", "liều dùng khuyến cáo", "mỗi ngày uống/dùng", "chữa khỏi", "điều trị khỏi", "thay thế thuốc", "không cần đi khám", "tự chẩn đoán", "tự điều trị". Đây là bài giải thích, KHÔNG phải toa thuốc.
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
2. Liệt kê 3–24 luận điểm (BẮT BUỘC ít nhất 3, nhiều nhất 24; một tư liệu nghèo ý vẫn phải có 3 luận điểm — nếu bí, hãy tách một luận điểm dài thành hai). Với mỗi luận điểm, phân loại:
   - "speaker_claim": điều video nói, chưa rõ đã được y học xác lập hay chưa.
   - "general_knowledge": kiến thức y khoa cơ bản, có thể dẫn nguồn uy tín.
   - "uncertain": nghe có vẻ mạnh nhưng không kiểm chứng được — ví dụ các con số cụ thể không rõ xuất xứ.
3. Với mỗi luận điểm, liệt kê MỌI con số xuất hiện trong đó, copy đúng như trong tư liệu.
4. "restrictedTopics": nếu tư liệu liên quan tới liều dùng, dùng thuốc cho trẻ em, thai kỳ, lựa chọn phác đồ điều trị ung thư, tương tác thuốc, tranh cãi về an toàn vắc xin, tuyên bố chữa khỏi, hoặc tự chẩn đoán — hãy liệt kê. Nếu không, trả về danh sách rỗng.
5. "isFactCheck": true nếu tư liệu chủ yếu phản biện một quan niệm sai hoặc một sản phẩm được quảng cáo quá mức.
6. Đề xuất 4–8 mục (outline) cho bài viết; mỗi mục có "heading" và "intent".

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
- "cite": chỉ khi đây là kiến thức y khoa đã được xác lập VÀ bạn biết một trang CỤ THỂ, CÓ THẬT trên tên miền được phép nói về nó. BẮT BUỘC kèm suggestedUrl đầy đủ (https://... trỏ tới đúng trang đó), suggestedPublisher và suggestedTitle. Nếu bạn KHÔNG có một URL cụ thể có thật cho ý này thì TUYỆT ĐỐI KHÔNG chọn "cite" — hãy chọn "attribute_to_speaker" hoặc "drop". "cite" mà thiếu URL là vô nghĩa và sẽ bị loại.
- "attribute_to_speaker": điều video nói nhưng bạn không chắc đã được xác lập. Bài viết sẽ ghi rõ "theo video".
- "drop": luận điểm không kiểm chứng được và cũng không đáng nêu, HOẶC chứa con số cụ thể không rõ xuất xứ.

MỌI phần tử verifiedClaims BẮT BUỘC có "reason" — một câu ngắn 3–400 ký tự giải thích quyết định (kể cả với "drop" và "attribute_to_speaker", không chỉ "cite").

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
 * The exact JSON shape of every supported body block, as a prompt fragment.
 *
 * This is the single contract the model is given for block structure. It is deliberately
 * exhaustive: every block type, every required field, every field name spelled exactly as
 * the Zod schema expects (`t`, `text`, `title`, `items`, ...). It exists because the model
 * cannot infer, from "include a source note", that a paragraph's text field is literally
 * `text` and is mandatory — and a missing required string (`body.N.text: expected string,
 * received undefined`) is exactly the failure that recurred in production.
 *
 * Kept in one place and reused by both draft prompts AND the repair pass, so generation and
 * repair are held to the identical contract.
 */
export const BLOCK_SHAPES = `HÌNH DẠNG CHÍNH XÁC CỦA TỪNG LOẠI BLOCK (dùng đúng tên trường và đúng kiểu; TUYỆT ĐỐI KHÔNG bỏ trường bắt buộc, KHÔNG dùng chuỗi rỗng cho một trường bắt buộc, KHÔNG đổi tên trường — ví dụ phải là "text", không phải "content"/"value"/"body"):
- Tiêu đề mục:        {"t":"h2","text":"<3–160 ký tự>"}
- Tiêu đề phụ:        {"t":"h3","text":"<3–160 ký tự>"}
- Đoạn văn:           {"t":"p","text":"<20–1600 ký tự>","attribution":"general"}
      · "text" là BẮT BUỘC. "attribution" là một trong "general" | "speaker" | "established" (mặc định "general").
      · CHỈ khi attribution="established" mới thêm "ref": <số nguyên, LÀ CHỈ SỐ ĐẾM TỪ 0 trong mảng references — ref=0 trỏ tới references[0], ref=1 trỏ tới references[1]>.
      · TUYỆT ĐỐI KHÔNG dùng attribution="established" hay trường "ref" nếu references KHÔNG có phần tử tương ứng. Nếu references rỗng thì KHÔNG block nào được có "ref" và KHÔNG block "p" nào được attribution="established".
- Hộp điểm chính:     {"t":"key_facts","title":"<3–120 ký tự>","items":["<5–320 ký tự>", "<...>"]}  (2–8 phần tử; "title" và "items" đều BẮT BUỘC)
- Trích dẫn nổi bật:  {"t":"pull_quote","text":"<20–400 ký tự>","kind":"paraphrase"}  ("text" và "kind" BẮT BUỘC; bài từ video luôn dùng "paraphrase")
- Hộp chú ý:          {"t":"callout","tone":"caution","title":"<3–120 ký tự>","text":"<20–900 ký tự>"}  ("tone" ∈ info|caution|myth; cả "tone","title","text" BẮT BUỘC)
- Hình minh hoạ:      {"t":"figure_svg","motif":"molecule","caption":"<5–300 ký tự>","alt":"<5–300 ký tự>"}  ("motif" ∈ molecule|flame|wave|shield|organ|joint|breath|lattice; cả ba BẮT BUỘC)
- Chèn video:         {"t":"video_embed"}   (KHÔNG có trường nào khác)
- Thẻ nguồn:          {"t":"source_note"}   (KHÔNG có trường nào khác)
- Miễn trừ trách nhiệm: {"t":"disclaimer"}  (KHÔNG có trường nào khác)

TÓM TẮT TRƯỜNG BẮT BUỘC: h2/h3/p/pull_quote/callout PHẢI có "text" (chuỗi không rỗng); key_facts PHẢI có "title" và "items"; figure_svg PHẢI có "motif","caption","alt"; video_embed/source_note/disclaimer CHỈ có "t".`;

/**
 * JSON Schema for one body block.
 *
 * A discriminated `anyOf` — one branch per block type, each listing exactly the fields Zod
 * requires for that type — so the structured-output layer enforces the SAME contract as the
 * Zod discriminated union. The earlier version was a single permissive object with only `t`
 * required and every other field optional; that let the model return an h2/p/callout with
 * no `text`, which the JSON Schema accepted and Zod then rejected (`body.N.text: expected
 * string, received undefined`). Aligning the two removes that mismatch at the source.
 *
 * Optional fields (`p.attribution`, `p.ref`, `pull_quote.ref`) are present in `properties`
 * but omitted from `required`, matching Zod (attribution has a default; ref is optional).
 * `additionalProperties: false` per branch mirrors the union's per-type shape.
 */
const blockJsonSchema: Record<string, unknown> = {
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['t', 'text'],
      properties: { t: { type: 'string', enum: ['h2'] }, text: { type: 'string' } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['t', 'text'],
      properties: { t: { type: 'string', enum: ['h3'] }, text: { type: 'string' } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['t', 'text'],
      properties: {
        t: { type: 'string', enum: ['p'] },
        text: { type: 'string' },
        attribution: { type: 'string', enum: ['speaker', 'established', 'general'] },
        ref: { type: 'integer' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['t', 'title', 'items'],
      properties: {
        t: { type: 'string', enum: ['key_facts'] },
        title: { type: 'string' },
        items: { type: 'array', items: { type: 'string' } },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['t', 'text', 'kind'],
      properties: {
        t: { type: 'string', enum: ['pull_quote'] },
        text: { type: 'string' },
        kind: { type: 'string', enum: ['paraphrase', 'cited'] },
        ref: { type: 'integer' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['t', 'tone', 'title', 'text'],
      properties: {
        t: { type: 'string', enum: ['callout'] },
        tone: { type: 'string', enum: ['info', 'caution', 'myth'] },
        title: { type: 'string' },
        text: { type: 'string' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['t', 'motif', 'caption', 'alt'],
      properties: {
        t: { type: 'string', enum: ['figure_svg'] },
        motif: {
          type: 'string',
          enum: ['molecule', 'flame', 'wave', 'shield', 'organ', 'joint', 'breath', 'lattice'],
        },
        caption: { type: 'string' },
        alt: { type: 'string' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['t'],
      properties: { t: { type: 'string', enum: ['video_embed'] } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['t'],
      properties: { t: { type: 'string', enum: ['source_note'] } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['t'],
      properties: { t: { type: 'string', enum: ['disclaimer'] } },
    },
  ],
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

Ý CÓ THỂ DẪN NGUỒN (attribution "established", kèm ref = CHỈ SỐ ĐẾM TỪ 0 trong mảng references — nguồn dưới đây phải nằm trong references theo ĐÚNG thứ tự này, ref=0 ứng với nguồn đầu tiên):
${citable.length === 0 ? '(không có — vì vậy KHÔNG được có đoạn nào attribution="established", KHÔNG block nào có "ref", và references PHẢI để rỗng [])' : citable.map((claim, i) => `[ref ${i}] ${claim.claimText}\n   nguồn: ${claim.suggestedTitle ?? ''} — ${claim.suggestedPublisher ?? ''} — ${claim.suggestedUrl ?? ''}`).join('\n')}

Ý CHỈ ĐƯỢC GHI LÀ "THEO VIDEO" (attribution "speaker"):
${speakerOnly.length === 0 ? '(không có)' : speakerOnly.map((claim) => `- ${claim.claimText}`).join('\n')}

Ý PHẢI BỎ HẲN, KHÔNG ĐƯỢC NHẮC LẠI NHƯ SỰ THẬT:
${dropped.length === 0 ? '(không có)' : dropped.map((claim) => `- ${claim.claimText} (lý do: ${claim.reason})`).join('\n')}

CẤU TRÚC BẮT BUỘC của mảng body:
Mảng body PHẢI có ÍT NHẤT 8 phần tử. Một bài viết đầy đủ ${input.wordCountMin}–${input.wordCountMax} từ thường cần 12–20 block. GIỮA hai block {"t":"h2"} liền nhau PHẢI có ít nhất một block {"t":"p"} — nếu chỉ có tiêu đề mà không có đoạn văn nào thì bài viết trống rỗng và sẽ bị từ chối.

Các block bắt buộc trong mảng body:
- ĐÚNG MỘT block {"t":"source_note"} (đặt gần đầu bài)
- ÍT NHẤT 4 block {"t":"h2"}
- ÍT NHẤT MỘT block {"t":"key_facts"} với 2–8 items
- ÍT NHẤT MỘT block {"t":"p"} có "attribution":"speaker"
- ĐÚNG MỘT block {"t":"video_embed"}
- ĐÚNG MỘT block {"t":"disclaimer"} (đặt cuối)
- Tuỳ chọn: pull_quote (kind PHẢI là "paraphrase"), callout, figure_svg

${BLOCK_SHAPES}

ĐỘ DÀI: ${input.wordCountMin}–${input.wordCountMax} từ (đếm theo âm tiết tiếng Việt). BẮT BUỘC đạt tối thiểu ${input.wordCountMin} từ — một bài dưới mức này sẽ bị từ chối; hãy triển khai đủ ý trong dàn ý thay vì viết sơ sài.

AN TOÀN Y TẾ (bài sẽ bị từ chối nếu vi phạm):
- TUYỆT ĐỐI KHÔNG khuyến khích người đọc tự chẩn đoán hay tự điều trị. Được phép KHUYÊN NGƯỢC LẠI, ví dụ "không nên tự chẩn đoán", "nên đi khám để được chẩn đoán".
- KHÔNG kê liều, KHÔNG ra chỉ dẫn dùng thuốc/thực phẩm bổ sung. Đây là bài giải thích, không phải toa thuốc.
- Ghi rõ nguồn: giữ block {"t":"source_note"} và dùng attribution "speaker" cho những gì video nói.

references: TỐI ĐA 8 nguồn, CHỈ đưa vào các nguồn đã được cung cấp ở trên. KHÔNG thêm nguồn nào khác. KHI bài có nêu kiến thức y khoa đã được xác lập VÀ danh sách trên có sẵn nguồn phù hợp, hãy dẫn ÍT NHẤT 2 nguồn uy tín; nếu danh sách không có nguồn nào phù hợp thì KHÔNG được bịa — để mảng rỗng. Mỗi phần tử BẮT BUỘC có bốn trường {"label", "title", "publisher", "url"} — copy chính xác title/publisher/url từ danh sách đã cung cấp; label là số thứ tự dạng chuỗi ("1", "2", ...).

QUY TẮC DẪN NGUỒN BẤT BIẾN (vi phạm sẽ bị từ chối):
- Chỉ số ref đếm TỪ 0. Mỗi "ref": N trong body PHẢI có references[N] tồn tại — tức references phải có ít nhất N+1 phần tử.
- KHÔNG bao giờ ghi "ref" trỏ tới một nguồn không tồn tại. Nếu references rỗng thì KHÔNG block nào được có "ref" và KHÔNG "p" nào được attribution="established".
- Số nguồn trong references phải khớp với những gì bạn thực sự trích dẫn: nếu không đưa nguồn vào references thì đừng dùng attribution="established" cho ý đó — hãy để "general" hoặc "speaker".

RÀNG BUỘC ĐỘ DÀI TỪNG TRƯỜNG (nếu vi phạm, JSON sẽ bị từ chối):
- title: 10–160 ký tự.
- dek: 80–320 ký tự (một câu tóm tắt, không phải tiêu đề thứ hai).
- Mỗi block {"t":"p"}: text 20–1600 ký tự.
- Mỗi block {"t":"h2"} hoặc {"t":"h3"}: text 3–160 ký tự.
- key_facts: title 3–120 ký tự; mỗi item 5–320 ký tự; 2–8 items.
- pull_quote: text 20–400 ký tự.
- callout: title 3–120, text 20–900.

slug: chữ thường không dấu, các từ nối bằng dấu gạch ngang, chỉ a-z 0-9 và dấu - (10–90 ký tự).

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

- metaTitle: 10–70 ký tự, mô tả đúng nội dung, không giật gân.
- metaDescription: 80–180 ký tự, nêu bài viết trả lời câu hỏi gì và dẫn nguồn từ đâu.
- keywords: 0–12 từ khoá tiếng Việt người đọc thực sự tìm kiếm; mỗi từ khoá 2–60 ký tự.

KHÔNG hứa hẹn kết quả sức khoẻ. KHÔNG dùng từ như "thần dược", "chữa khỏi", "bí mật".

CHỈ trả về JSON đúng schema.`;
}

/* ============================ research variants =========================== */

/**
 * The research fallback writes from a published paper rather than from a video, and the
 * dangers are different enough to need their own prompts rather than a flag on the
 * existing ones.
 *
 * What changes: there is no presenter, so nothing may be attributed to one; the abstract is
 * a primary scientific source rather than one person's summary, so the temptation is to
 * report a single result as settled medicine; and the paper's own limitations — sample size,
 * whether it was in humans, whether anything was replicated — are the most important thing
 * the article has to say and the thing a generator is most likely to omit.
 *
 * What does not change: HOUSE_RULES. Every fabrication and dosage rule applies verbatim.
 */
export const RESEARCH_RULES = `BỐI CẢNH RIÊNG CHO BÀI VIẾT VỀ NGHIÊN CỨU:
A. Tư liệu của bạn là phần tóm tắt (abstract) của MỘT công trình đã công bố. Không có video, không có người nói. TUYỆT ĐỐI KHÔNG dùng attribution "speaker" và không viết "theo video".
B. MỘT nghiên cứu đơn lẻ KHÔNG phải kết luận của y học. Bài viết phải nói rõ điều đó.
C. Phải nêu rõ giới hạn của nghiên cứu: cỡ mẫu, đối tượng (người hay động vật hay tế bào), thiết kế nghiên cứu, và việc kết quả cần được kiểm chứng độc lập. Nếu abstract không cho biết một chi tiết nào, hãy viết rằng abstract không nêu — KHÔNG suy đoán.
D. KHÔNG chuyển kết quả nghiên cứu thành lời khuyên cho người đọc.
E. Bài viết BẮT BUỘC có một block {"t":"callout","tone":"caution"} giải thích một nghiên cứu đơn lẻ chứng minh được điều gì và chưa chứng minh được điều gì.
F. references BẮT BUỘC chứa đường dẫn tới chính công trình gốc.`;

export function researchExtractionPrompt(input: {
  readonly title: string;
  readonly abstract: string;
  readonly journal: string | null;
  readonly publicationDate: string | null;
  readonly authors: readonly string[];
  readonly categories: readonly { slug: string; name: string; description: string }[];
}): string {
  const categoryList = input.categories
    .map((category) => `- ${category.slug}: ${category.name} — ${category.description}`)
    .join('\n');

  return `Dưới đây là tóm tắt của một công trình nghiên cứu đã công bố. Nhiệm vụ của bạn là PHÂN TÍCH, chưa viết bài.

TIÊU ĐỀ CÔNG TRÌNH:
${input.title}

TẠP CHÍ: ${input.journal ?? 'không rõ'}
NGÀY CÔNG BỐ: ${input.publicationDate ?? 'không rõ'}
TÁC GIẢ: ${input.authors.length === 0 ? 'không rõ' : input.authors.slice(0, 8).join(', ')}

TÓM TẮT (đây là toàn bộ tư liệu bạn có):
"""
${input.abstract}
"""

CÁC CHUYÊN MỤC CÓ SẴN (chọn ĐÚNG MỘT slug từ danh sách này):
${categoryList}

YÊU CẦU:
1. Xác định chủ đề và chuyên mục phù hợp.
2. Liệt kê 3–24 luận điểm (BẮT BUỘC ít nhất 3, nhiều nhất 24). Với bài nghiên cứu, hãy phân loại:
   - "speaker_claim": điều CHÍNH công trình này báo cáo (kết quả của riêng nó, chưa được xác lập rộng rãi).
   - "general_knowledge": kiến thức y khoa nền đã được xác lập, có thể dẫn nguồn uy tín.
   - "uncertain": suy luận vượt quá dữ liệu trong abstract.
3. Với mỗi luận điểm, liệt kê MỌI con số xuất hiện trong đó, copy đúng như trong abstract.
4. "restrictedTopics": nếu công trình liên quan tới liều dùng, trẻ em, thai kỳ, lựa chọn phác đồ điều trị ung thư, tương tác thuốc, tranh cãi về an toàn vắc xin, tuyên bố chữa khỏi, hoặc tự chẩn đoán — hãy liệt kê.
5. "isFactCheck": false, trừ khi công trình trực tiếp phản biện một quan niệm phổ biến.
6. Đề xuất 4–8 mục (outline). BẮT BUỘC có một mục dành cho giới hạn của nghiên cứu.

CHỈ trả về JSON đúng schema.`;
}

export function researchDraftPrompt(input: {
  readonly extraction: Extraction;
  readonly verification: Verification;
  readonly paperTitle: string;
  readonly paperUrl: string;
  readonly journal: string | null;
  readonly publicationDate: string | null;
  readonly authors: readonly string[];
  readonly abstract: string;
  readonly wordCountMin: number;
  readonly wordCountMax: number;
}): string {
  const citable = input.verification.verifiedClaims.filter((claim) => claim.resolution === 'cite');
  const paperOwn = input.verification.verifiedClaims.filter(
    (claim) => claim.resolution === 'attribute_to_speaker',
  );
  const dropped = input.verification.verifiedClaims.filter((claim) => claim.resolution === 'drop');

  return `Viết bài báo hoàn chỉnh về công trình nghiên cứu này, dựa trên phân tích đã có.

CHỦ ĐỀ: ${input.extraction.topic}
CHUYÊN MỤC (dùng đúng slug này): ${input.extraction.proposedCategorySlug}

CÔNG TRÌNH GỐC:
- Tiêu đề: ${input.paperTitle}
- Tạp chí: ${input.journal ?? 'không rõ'}
- Ngày công bố: ${input.publicationDate ?? 'không rõ'}
- Tác giả: ${input.authors.length === 0 ? 'không rõ' : input.authors.slice(0, 8).join(', ')}
- Đường dẫn: ${input.paperUrl}

TÓM TẮT GỐC (chỉ được dùng con số xuất hiện ở đây):
"""
${input.abstract}
"""

DÀN Ý ĐỀ XUẤT:
${input.extraction.outline.map((item, i) => `${i + 1}. ${item.heading} — ${item.intent}`).join('\n')}

Ý CÓ THỂ DẪN NGUỒN NGOÀI (attribution "established", kèm ref = CHỈ SỐ ĐẾM TỪ 0 trong mảng references; references[0] là công trình gốc nên các nguồn ngoài dưới đây bắt đầu từ chỉ số 1, theo ĐÚNG thứ tự này):
${citable.length === 0 ? '(không có nguồn ngoài — chỉ được dẫn ref 0 là công trình gốc)' : citable.map((claim, i) => `[ref ${i + 1}] ${claim.claimText}\n   nguồn: ${claim.suggestedTitle ?? ''} — ${claim.suggestedPublisher ?? ''} — ${claim.suggestedUrl ?? ''}`).join('\n')}

Ý LÀ KẾT QUẢ CỦA RIÊNG CÔNG TRÌNH NÀY (attribution "established" kèm ref 0 — tức chính công trình gốc — và phải ghi rõ trong câu rằng đây là kết quả của nghiên cứu này):
${paperOwn.length === 0 ? '(không có)' : paperOwn.map((claim) => `- ${claim.claimText}`).join('\n')}

Ý PHẢI BỎ HẲN:
${dropped.length === 0 ? '(không có)' : dropped.map((claim) => `- ${claim.claimText} (lý do: ${claim.reason})`).join('\n')}

CẤU TRÚC BẮT BUỘC của mảng body:
Mảng body PHẢI có ÍT NHẤT 8 phần tử. Một bài viết đầy đủ ${input.wordCountMin}–${input.wordCountMax} từ thường cần 12–18 block. GIỮA hai block {"t":"h2"} liền nhau PHẢI có ít nhất một block {"t":"p"} — nếu chỉ có tiêu đề mà không có đoạn văn nào thì bài viết trống rỗng và sẽ bị từ chối.

Các block bắt buộc trong mảng body:
- ĐÚNG MỘT block {"t":"source_note"} (đặt gần đầu bài)
- ÍT NHẤT 4 block {"t":"h2"}, trong đó một mục nói về giới hạn của nghiên cứu
- ÍT NHẤT MỘT block {"t":"key_facts"} với 2–8 items
- ĐÚNG MỘT block {"t":"callout","tone":"caution"} — giải thích một nghiên cứu đơn lẻ chứng minh được gì và chưa chứng minh được gì
- ĐÚNG MỘT block {"t":"disclaimer"} (đặt cuối)
- TUYỆT ĐỐI KHÔNG có block {"t":"video_embed"} — không có video nào
- TUYỆT ĐỐI KHÔNG có đoạn nào "attribution":"speaker" — không có người nói

${BLOCK_SHAPES}

references: TỐI ĐA 8 phần tử. Phần tử ĐẦU TIÊN (chỉ số 0) PHẢI là chính công trình gốc, với url đúng bằng ${input.paperUrl}. Sau đó chỉ thêm các nguồn đã được cung cấp ở trên. KHÔNG thêm nguồn nào khác. Mỗi phần tử BẮT BUỘC có bốn trường {"label", "title", "publisher", "url"}; label là số thứ tự dạng chuỗi ("1", "2", ...).

QUY TẮC DẪN NGUỒN BẤT BIẾN (vi phạm sẽ bị từ chối): chỉ số ref đếm TỪ 0; mỗi "ref": N PHẢI có references[N] tồn tại (references có ít nhất N+1 phần tử). KHÔNG bao giờ ghi "ref" trỏ tới nguồn không tồn tại, và KHÔNG bịa URL cho bất kỳ nguồn nào.

AN TOÀN Y TẾ (bài sẽ bị từ chối nếu vi phạm): KHÔNG khuyến khích người đọc tự chẩn đoán hay tự điều trị (được phép khuyên ngược lại); KHÔNG kê liều; KHÔNG biến kết quả nghiên cứu thành lời khuyên hành động.

ĐỘ DÀI: ${input.wordCountMin}–${input.wordCountMax} từ (đếm theo âm tiết tiếng Việt). BẮT BUỘC đạt tối thiểu ${input.wordCountMin} từ.

RÀNG BUỘC ĐỘ DÀI TỪNG TRƯỜNG (nếu vi phạm, JSON sẽ bị từ chối):
- title: 10–160 ký tự.
- dek: 80–320 ký tự.
- Mỗi block {"t":"p"}: text 20–1600 ký tự.
- Mỗi block {"t":"h2"} hoặc {"t":"h3"}: text 3–160 ký tự.
- key_facts: title 3–120; mỗi item 5–320; 2–8 items.
- callout: title 3–120, text 20–900.

slug: chữ thường không dấu, các từ nối bằng dấu gạch ngang, chỉ a-z 0-9 và dấu - (10–90 ký tự).

CHỈ trả về JSON đúng schema.`;
}

/* ============================ validation repair =========================== */

/**
 * A single, targeted repair of a draft that PASSED the schema but FAILED the deterministic
 * validation gate on fixable content grounds (too short, prescriptive phrasing, thin
 * sourcing, a missing structural block).
 *
 * This is not the schema-repair loop inside `complete()` — that fixes malformed JSON. This
 * runs one level up, after the gate, and is handed the gate's own report so the model corrects
 * the exact things a deterministic checker measured rather than guessing. The contract is
 * deliberately narrow: fix ONLY the reported issues, keep everything already valid, keep the
 * source's meaning and attribution, invent nothing. It returns the complete corrected article,
 * because the gate re-runs over the whole document afterwards, not over a patch.
 *
 * `previousDraftJson` is the model's own prior output, embedded verbatim so the repair is a
 * revision rather than a rewrite; the identical `draftSchema` / `draftJsonSchema` still
 * governs the response.
 */
export function repairDraftPrompt(input: {
  readonly previousDraftJson: string;
  readonly issues: readonly {
    readonly code: string;
    readonly severity: 'hard' | 'soft';
    readonly message: string;
    readonly detail?: string;
  }[];
  readonly sourceTitle: string;
  readonly sourceKind: 'youtube' | 'research';
  readonly wordCountMin: number;
  readonly wordCountMax: number;
}): string {
  const issueList = input.issues
    .map((issue) => {
      const severity = issue.severity === 'hard' ? 'NGHIÊM TRỌNG' : 'cảnh báo';
      const detail = issue.detail === undefined ? '' : ` — chi tiết: "${issue.detail}"`;
      return `- [${severity}] ${issue.code}: ${issue.message}${detail}`;
    })
    .join('\n');

  return `Bài viết dưới đây ĐÃ đúng cấu trúc JSON nhưng KHÔNG qua được bộ kiểm duyệt nội dung tự động. Nhiệm vụ của bạn là SỬA đúng những lỗi được liệt kê, KHÔNG viết lại từ đầu.

NGUỒN GỐC (giữ nguyên chủ đề và cách dẫn nguồn này): "${input.sourceTitle}" (${input.sourceKind === 'research' ? 'bài nghiên cứu' : 'video'}).

JSON BÀI VIẾT TRƯỚC ĐÓ (đây là điểm xuất phát của bạn, hãy chỉnh sửa trên chính nó):
"""
${input.previousDraftJson}
"""

DANH SÁCH LỖI CẦN SỬA (do bộ kiểm duyệt xác định — mỗi dòng: [mức độ] mã_lỗi: mô tả):
${issueList}

CÁCH SỬA TỪNG LOẠI LỖI:
- too_short: viết thêm nội dung có thật, bám theo tư liệu nguồn và các ý đã có, để bài đạt ${input.wordCountMin}–${input.wordCountMax} từ. KHÔNG nhồi chữ vô nghĩa, KHÔNG bịa số liệu hay nghiên cứu mới.
- too_long: rút gọn cho về dưới ${input.wordCountMax} từ mà vẫn giữ các ý chính.
- prescriptive_language / prescriptive_dosage: diễn đạt lại theo hướng GIẢI THÍCH, bỏ mọi lời khuyên dùng thuốc/liều lượng, bỏ lời khuyên tự chẩn đoán hoặc tự điều trị. Nếu muốn nhắc tới việc tự chẩn đoán, chỉ được nói theo hướng KHUYÊN NGƯỢC LẠI (ví dụ "không nên tự chẩn đoán").
- few_references: nếu có nguồn uy tín phù hợp, bổ sung để có ít nhất 2 nguồn; nếu không chắc nguồn có thật, ĐỪNG thêm — một nguồn bịa còn tệ hơn không có nguồn.
- dangling_reference: một block đang trỏ "ref": N nhưng references[N] không tồn tại (chỉ số đếm TỪ 0). Sửa theo MỘT trong hai cách, KHÔNG bịa URL: (a) nếu có nguồn CÓ THẬT tương ứng, thêm nó vào references sao cho references[N] tồn tại rồi giữ ref; (b) nếu KHÔNG có nguồn thật, BỎ trường "ref" và đổi attribution "established"→"general" (hoặc "speaker" nếu đó là điều video nói), còn pull_quote thì đổi kind "cited"→"paraphrase". Bảo đảm số phần tử references đủ lớn hơn mọi chỉ số ref còn lại.
- unsourced_established_claim / uncited_quotation: đoạn đang để attribution="established" (hoặc pull_quote kind="cited") mà không có "ref". Hoặc thêm "ref" trỏ tới một nguồn CÓ THẬT trong references, hoặc hạ xuống "general"/"paraphrase".
- các lỗi cấu trúc (thiếu block, thiếu mục, thiếu key_facts/disclaimer/source_note...): bổ sung đúng block còn thiếu.

QUY TẮC BẮT BUỘC:
1. CHỈ sửa những lỗi được liệt kê ở trên. GIỮ NGUYÊN mọi nội dung đã hợp lệ.
2. GIỮ NGUYÊN ý nghĩa và thông tin của nguồn gốc. KHÔNG thêm con số, tỷ lệ, liều lượng hay nghiên cứu không có trong tư liệu nguồn.
3. Tuân thủ toàn bộ NGUYÊN TẮC BẮT BUỘC về an toàn y tế đã nêu ở đầu.
4. Trả về TOÀN BỘ bài viết đã sửa dưới dạng JSON hoàn chỉnh đúng schema (không phải bản vá, không kèm lời giải thích).

${BLOCK_SHAPES}

CHỈ trả về JSON đúng schema.`;
}
