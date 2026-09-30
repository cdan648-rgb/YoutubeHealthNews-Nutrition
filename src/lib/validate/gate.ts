/**
 * The validation gate.
 *
 * The last thing between a generated draft and a published health article, and the one
 * component where failing is always the right answer when in doubt. Nothing here consults
 * a model: every rule is deterministic, inspectable and individually testable, because a
 * model asked to check another model's work shares its blind spots.
 *
 * A HARD failure means the article is stored as `needs_review` and nothing is published or
 * emailed. A SOFT failure is recorded and published anyway. The split is a judgement about
 * consequence: "this number came from nowhere" is hard, "only one external reference" is
 * soft.
 *
 * Deliberately NOT tunable at runtime. If publishing is failing too often the answer is
 * better generation or a different source, never a lower bar.
 */
import {
  blocksToPlainText,
  checkBodyStructure,
  countWords,
  type Block,
  type Reference,
} from '@/lib/domain/blocks';
import { isValidSlug } from '@/lib/slug';
import { checkNumericTraceability, type NumericClaim } from './numbers';

export type Severity = 'hard' | 'soft';

export type ValidationIssue = {
  readonly code: string;
  readonly severity: Severity;
  readonly message: string;
  readonly detail?: string;
};

export type ValidationReport = {
  readonly passed: boolean;
  readonly issues: readonly ValidationIssue[];
  readonly stats: {
    readonly wordCount: number;
    readonly sections: number;
    readonly references: number;
    readonly numericClaims: number;
    readonly speakerParagraphs: number;
  };
};

/**
 * Word-count policy for unattended publishing.
 *
 * The band is deliberately wide. 700–1400 is what we ASK the model for, but an otherwise
 * coherent article is not worth wasting a publishing day over a few dozen words either side.
 * Only the hard floor and hard ceiling block a publish; everything between is a warning, and
 * a genuinely short piece (below the expand threshold) earns one automatic expansion first.
 *
 *   < HARD_MIN (350)        hard fail — too little to be an article
 *   < EXPAND_MIN (450)      warn, and attempt one expansion
 *   < WORD_COUNT_MIN (700)  warn only (preferred floor)
 *   700 – 1400              preferred band
 *   > SOFT_MAX (1800)       warn only
 *   > HARD_MAX (2600)       hard fail — extremely excessive
 */
export const WORD_COUNT_MIN = 700;
export const WORD_COUNT_MAX = 1400;
export const WORD_COUNT_HARD_MIN = 350;
export const WORD_COUNT_EXPAND_MIN = 450;
export const WORD_COUNT_SOFT_MAX = 1800;
export const WORD_COUNT_HARD_MAX = 2600;

/**
 * Copy-overlap policy.
 *
 * The article is written FROM a source, so short phrase overlap is normal and must not block
 * a publish. A single shared run is a warning up to a generous length; a hard failure is
 * reserved for genuine copying — a very long verbatim run, or a large fraction of the whole
 * article lifted. `COPY_RUN_MARK_MIN` is the run length that counts toward the copied ratio.
 */
export const MAX_COPY_NGRAM = 12;
export const COPY_WARN_NGRAM = 12;
export const COPY_HARD_NGRAM = 30;
export const COPY_RATIO_HARD = 0.5;
export const COPY_RUN_MARK_MIN = 8;

/**
 * Language that turns an explainer into a prescription.
 *
 * Matching phrases rather than keywords: "liều" appears innocently in "liều lượng là việc
 * của bác sĩ", which is exactly the sentence we want articles to contain.
 */
const PRESCRIPTIVE_PATTERNS: readonly { readonly pattern: RegExp; readonly label: string }[] = [
  {
    pattern: /\b(?:bạn|quý vị)\s+(?:nên|hãy)\s+(?:uống|dùng|bổ sung|tiêm)\b/iu,
    label: 'instructs the reader to take something',
  },
  { pattern: /\bhãy\s+(?:uống|dùng|bổ sung|tiêm)\b/iu, label: 'imperative to take something' },
  { pattern: /\bliều\s+(?:dùng|khuyến cáo|hằng ngày|mỗi ngày)\b/iu, label: 'states a dose' },
  { pattern: /\b(?:mỗi ngày|hằng ngày)\s+(?:uống|dùng)\b/iu, label: 'states a daily regimen' },
  { pattern: /\bchữa\s+khỏi\b/iu, label: 'claims a cure' },
  { pattern: /\bđiều trị\s+khỏi\b/iu, label: 'claims a cure' },
  { pattern: /\bthay\s+(?:thế|cho)\s+thuốc\b/iu, label: 'suggests replacing medication' },
  { pattern: /\bkhông cần\s+(?:đi\s+)?(?:khám|bác sĩ)\b/iu, label: 'discourages seeking care' },
];

/**
 * Self-diagnosis and self-treatment — but only where the article ENCOURAGES them.
 *
 * "tự chẩn đoán" / "tự điều trị" are phrases a safe health article must never use as advice.
 * Yet the safest sentence in such an article is frequently the warning AGAINST them:
 * "không nên tự chẩn đoán", "tránh tự điều trị". A bare phrase match rejects that warning as
 * if it were the encouragement — punishing exactly the sentence we most want the article to
 * contain. So we match the phrase twice: once plainly, and once only when a negation or
 * avoidance cue governs it ("không", "đừng", "tránh", "chớ", "thay vì", "hạn chế", with only
 * modal connectives like "nên"/"được"/"cần" allowed to sit between the cue and the phrase). An
 * occurrence is prescriptive only when it is NOT one of the negated ones — the cue has to
 * directly govern the phrase, so "không cần bác sĩ, hãy tự chẩn đoán" (the negation governs
 * "bác sĩ", the imperative governs the phrase) is still caught.
 */
// The boundaries are Unicode lookarounds, not `\b`: JavaScript's `\b` is ASCII-only, so it
// finds no boundary after "trị" (which ends in the non-ASCII "ị") and would silently miss
// every "tự điều trị". Same lesson as the dosage detector above.
//
// The phrase covers the self-care acts a health article must never PRESCRIBE: self-diagnosis,
// self-treatment, and self-medication ("tự ý dùng thuốc"). The optional "ý" catches "tự ý".
const SELF_CARE_PATTERN =
  /(?<![\p{L}])tự(?:\s+ý)?\s+(?:chẩn đoán|điều trị|dùng thuốc)(?![\p{L}])/giu;

/**
 * A negated / warning CLAUSE governing one or more self-care phrases.
 *
 * A negation or avoidance cue ("không", "tránh", "không nên", "không tự ý", …), optionally
 * followed by modal connectives, then a self-care phrase — AND any further self-care phrases
 * coordinated onto it by "và", "hay", "hoặc", "lẫn", "cũng như" or a comma. That trailing
 * coordination is the fix for the real false positive: "không nên tự chẩn đoán hay tự điều
 * trị" is one warning in which a single "không nên" governs BOTH acts, so both must be treated
 * as safe — not just the first. The cue still has to reach the first phrase through modal
 * words only, so "không cần đi khám, hãy tự điều trị" (the cue governs "khám", the imperative
 * governs the act) is NOT swept in and remains a hard failure.
 */
const SELF_CARE_NEGATED_CLAUSE =
  /(?<![\p{L}])(?:không|đừng|chớ|tránh|thay vì|hạn chế|ngăn(?:\s+ngừa)?|tuyệt đối không|cần tránh|nên tránh)(?:\s+(?:nên|được|phải|cần|bao|giờ|khi|việc|ý|tự))*\s+tự(?:\s+ý)?\s+(?:chẩn đoán|điều trị|dùng thuốc)(?:\s*(?:,|;|và|hay|hoặc|lẫn|cũng như)\s+(?:tự(?:\s+ý)?\s+)?(?:chẩn đoán|điều trị|dùng thuốc))*(?![\p{L}])/giu;

/**
 * The first self-care phrase that is ENCOURAGED rather than warned against, or null when every
 * occurrence sits inside a negation/warning clause. A phrase is safe when its start offset
 * falls within the span of some negated clause — which covers the head act and every act
 * coordinated onto it. The returned phrase becomes the report's `detail`.
 */
function encouragedSelfCare(plain: string): string | null {
  const safeSpans: [number, number][] = [];
  for (const match of plain.matchAll(SELF_CARE_NEGATED_CLAUSE)) {
    if (match.index !== undefined) safeSpans.push([match.index, match.index + match[0].length]);
  }
  for (const match of plain.matchAll(SELF_CARE_PATTERN)) {
    if (match.index === undefined) continue;
    const start = match.index;
    const covered = safeSpans.some(([from, to]) => start >= from && start < to);
    if (!covered) return match[0];
  }
  return null;
}

/**
 * A dosage, in any unit. Separate from the prescriptive patterns because a bare quantity
 * is dangerous even in a descriptive sentence: readers copy numbers out of context.
 *
 * The trailing `\p{L}` lookahead is essential — see the note in `numbers.ts`.
 */
const DOSAGE_PATTERN = /\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|g|kg|ml|IU|đơn vị)(?![\p{L}\d])/giu;

export type GateInput = {
  /**
   * Where the article came from.
   *
   * Not a strictness dial — it selects rules that only make sense for one kind. A
   * research article must not embed a video it does not have, must carry the single-study
   * caveat, and must cite the paper it reports on; a YouTube article must embed its video
   * and must separate the presenter's claims from established ones.
   */
  readonly sourceKind?: 'youtube' | 'research';
  readonly title: string;
  readonly dek: string;
  readonly slug: string;
  readonly categorySlug: string;
  readonly body: readonly Block[];
  readonly references: readonly Reference[];
  /** The cleaned video description, or the paper abstract for a research article. */
  readonly sourceText: string;
  /**
   * The source's title.
   *
   * Counted as a traceability source but NOT as copy-overlap material. Articles
   * legitimately cite the episode number ("Số 118 mô tả…"), and that number lives in the
   * title rather than the description — so omitting the title here flags every correctly
   * sourced article. The title is short enough that including it in the overlap check
   * would be noise.
   */
  readonly sourceTitle?: string;
  /** Text of each reference that was successfully fetched, for traceability. */
  readonly referenceTexts?: readonly string[];
  readonly allowedCategorySlugs: readonly string[];
  readonly allowedReferenceHosts: readonly string[];
  /** Hosts whose reachability could not be confirmed (403/429), but which are allowlisted. */
  readonly unverifiableReferenceUrls?: readonly string[];
  /** URLs that returned 404/410 and must not be cited. */
  readonly unreachableReferenceUrls?: readonly string[];
  /** Restricted topics the extraction stage detected. Any hit is a hard failure. */
  readonly detectedRestrictedTopics?: readonly string[];
  /**
   * URLs that MUST appear among the references.
   *
   * Used by the research path for the paper's own landing page. A research article that
   * does not link the study it reports on gives the reader no way to check it, which is
   * the entire justification for publishing it — so its absence is a hard failure rather
   * than a missing nicety.
   */
  readonly requiredReferenceUrls?: readonly string[];
};

/** Longest shared word run between two texts. Used for the copy-overlap check. */
export function longestSharedWordRun(left: string, right: string): number {
  const a = left.toLowerCase().split(/\s+/).filter(Boolean);
  const b = right.toLowerCase().split(/\s+/).filter(Boolean);
  if (a.length === 0 || b.length === 0) return 0;

  // Rolling row rather than a full matrix: bodies are ~1,000 words and sources ~1,000, so
  // the full table would be a million cells for a single number.
  let best = 0;
  let previous = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        current[j] = (previous[j - 1] ?? 0) + 1;
        if ((current[j] ?? 0) > best) best = current[j] ?? 0;
      }
    }
    previous = current;
  }
  return best;
}

export type CopyOverlapProfile = {
  /** Length of the single longest shared run of words. */
  readonly longestRun: number;
  /** Fraction of the article's words that lie inside a shared run of `markMin`+ words. */
  readonly copiedRatio: number;
};

/**
 * How much of the article overlaps its source, as both the longest verbatim run and the
 * fraction of the article copied.
 *
 * The ratio is what turns "one shared 13-word phrase" (normal, when writing from a source)
 * into a warning rather than a block, while still catching a piece that is largely lifted.
 * A single DP pass marks every article word that participates in a shared run of at least
 * `markMin` words; the marked fraction is the copied ratio. Tokenisation matches
 * `longestSharedWordRun`: lower-cased, whitespace-split, so case never creates a false match
 * and punctuation stays attached to its word (which only ever REDUCES matches — the
 * conservative direction for an anti-copying measure).
 */
export function copyOverlapProfile(
  left: string,
  right: string,
  markMin = COPY_RUN_MARK_MIN,
): CopyOverlapProfile {
  const a = left.toLowerCase().split(/\s+/).filter(Boolean);
  const b = right.toLowerCase().split(/\s+/).filter(Boolean);
  if (a.length === 0 || b.length === 0) return { longestRun: 0, copiedRatio: 0 };

  let best = 0;
  const copied = new Array<boolean>(a.length).fill(false);
  let previous = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        const run = (previous[j - 1] ?? 0) + 1;
        current[j] = run;
        if (run > best) best = run;
        // Once a run reaches the mark length, flag every article word in it (the window
        // ending at position i-1). Overlapping windows dedupe through the boolean array.
        if (run >= markMin) {
          for (let k = i - run; k < i; k += 1) copied[k] = true;
        }
      }
    }
    previous = current;
  }

  const copiedCount = copied.reduce((sum, flag) => sum + (flag ? 1 : 0), 0);
  return { longestRun: best, copiedRatio: copiedCount / a.length };
}

export function validateArticle(input: GateInput): ValidationReport {
  const issues: ValidationIssue[] = [];
  const hard = (code: string, message: string, detail?: string) =>
    issues.push(
      detail === undefined
        ? { code, severity: 'hard', message }
        : { code, severity: 'hard', message, detail },
    );
  const soft = (code: string, message: string, detail?: string) =>
    issues.push(
      detail === undefined
        ? { code, severity: 'soft', message }
        : { code, severity: 'soft', message, detail },
    );

  const plain = blocksToPlainText(input.body);
  const wordCount = countWords(plain);
  const sections = input.body.filter((block) => block.t === 'h2').length;
  const speakerParagraphs = input.body.filter(
    (block) => block.t === 'p' && block.attribution === 'speaker',
  ).length;

  /* ---------------------------- restricted topics ---------------------------- */
  // Checked first and unconditionally. Some subjects must never auto-publish however
  // clean the prose is, because being well written is not the same as being safe.
  if ((input.detectedRestrictedTopics?.length ?? 0) > 0) {
    hard(
      'restricted_topic',
      'topic requires human review before publication',
      input.detectedRestrictedTopics?.join(', '),
    );
  }

  /* ------------------------------- structure -------------------------------- */
  const sourceKind = input.sourceKind ?? 'youtube';

  // An article with nothing readable in it cannot publish, whatever else is true.
  const meaningfulBlocks = input.body.filter((block) =>
    ['p', 'h2', 'h3', 'key_facts', 'callout', 'pull_quote'].includes(block.t),
  ).length;
  if (meaningfulBlocks === 0 || plain.trim() === '') {
    hard('empty_article', 'article has no readable content');
  }

  // Structural rules are WARNINGS now, not blockers: the pipeline's deterministic normaliser
  // guarantees the render-critical markers (source note, disclaimer, one video embed) and
  // reconciles reference pointers before the gate runs, so a structural gap here means a
  // stylistic imperfection, not an unsafe or unrenderable article. None of these should waste
  // a publishing day.
  for (const issue of checkBodyStructure(input.body, input.references, sourceKind)) {
    soft(issue.code, issue.message);
  }

  // Word count: only the hard floor and ceiling block a publish. The rest is a warning, and a
  // genuinely short article earns one automatic expansion (driven by the pipeline).
  if (wordCount < WORD_COUNT_HARD_MIN) {
    hard(
      'too_short',
      `article is ${wordCount} words, below the hard minimum ${WORD_COUNT_HARD_MIN}`,
    );
  } else if (wordCount < WORD_COUNT_MIN) {
    soft('short_article', `article is ${wordCount} words, below the preferred ${WORD_COUNT_MIN}`);
  }
  if (wordCount > WORD_COUNT_HARD_MAX) {
    hard(
      'too_long',
      `article is ${wordCount} words, above the hard maximum ${WORD_COUNT_HARD_MAX}`,
    );
  } else if (wordCount > WORD_COUNT_SOFT_MAX) {
    soft('long_article', `article is ${wordCount} words, above the preferred ${WORD_COUNT_MAX}`);
  }

  /* --------------------------- identity and routing ------------------------- */
  if (!isValidSlug(input.slug)) {
    hard('invalid_slug', `slug "${input.slug}" does not match the required format`);
  }
  if (!input.allowedCategorySlugs.includes(input.categorySlug)) {
    // An unrecognised category is a model inventing a taxonomy, not a new category.
    hard(
      'unknown_category',
      `category "${input.categorySlug}" is not one of the seeded categories`,
    );
  }
  if (input.title.trim() === '' || input.dek.trim() === '') {
    hard('missing_headline', 'title and dek are both required');
  }

  /* ------------------------------ fabrication ------------------------------- */
  // There is no transcript for these videos, so a verbatim quotation attributed to the
  // presenter is fabricated by construction. The schema allows only 'paraphrase' or
  // 'cited'; this catches a 'cited' quote whose reference does not exist.
  for (const [index, block] of input.body.entries()) {
    if (block.t !== 'pull_quote') continue;
    if (
      block.kind === 'cited' &&
      (block.ref === undefined || input.references[block.ref] === undefined)
    ) {
      hard('fabricated_quote', `pull quote ${index} claims a citation it does not have`);
    }
  }

  const traceability = checkNumericTraceability(plain, [
    input.sourceText,
    input.sourceTitle ?? '',
    ...(input.referenceTexts ?? []),
  ]);
  if (traceability.untraceable.length > 0) {
    hard(
      'untraceable_number',
      `${traceability.untraceable.length} number(s) appear in neither the source nor any verified reference`,
      describeClaims(traceability.untraceable),
    );
  }

  /* --------------------------- prescriptive content ------------------------- */
  const dosages = [...plain.matchAll(DOSAGE_PATTERN)].map((match) => match[0]);
  if (dosages.length > 0) {
    hard('prescriptive_dosage', 'article states a dose', dosages.slice(0, 5).join(', '));
  }
  for (const { pattern, label } of PRESCRIPTIVE_PATTERNS) {
    const match = pattern.exec(plain);
    if (match !== null) {
      hard('prescriptive_language', `article ${label}`, match[0]);
    }
  }
  // Self-diagnosis / self-treatment is context-aware: an explicit warning against it
  // ("không nên tự chẩn đoán", "tránh tự điều trị") is allowed; only an encouragement fails.
  const encouragedPhrase = encouragedSelfCare(plain);
  if (encouragedPhrase !== null) {
    hard('prescriptive_language', 'article encourages self-treatment', encouragedPhrase);
  }

  /* -------------------------------- sourcing -------------------------------- */
  const unreachable = new Set(input.unreachableReferenceUrls ?? []);
  const unverifiable = new Set(input.unverifiableReferenceUrls ?? []);

  for (const reference of input.references) {
    let host: string;
    try {
      const url = new URL(reference.url);
      host = url.hostname;
      if (url.protocol !== 'https:') {
        hard('reference_not_https', `reference ${reference.url} is not https`);
      }
    } catch {
      hard('reference_malformed', `reference "${reference.url}" is not a URL`);
      continue;
    }

    const allowlisted = input.allowedReferenceHosts.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`),
    );
    if (!allowlisted) {
      hard('reference_not_allowlisted', `host ${host} is not an approved source`);
    }
    if (unreachable.has(reference.url)) {
      hard('reference_unreachable', `reference ${reference.url} does not exist`);
    } else if (unverifiable.has(reference.url)) {
      // 403 and 429 mean "we were blocked", not "the page is missing". Several genuine
      // authorities (ods.od.nih.gov, cdc.gov) refuse datacenter requests outright, so
      // treating that as absence would reject perfectly good citations.
      soft(
        'reference_unverified',
        `could not confirm ${reference.url} is reachable (blocked, not missing)`,
      );
    }
  }

  const citedUrls = new Set(input.references.map((reference) => reference.url));
  for (const url of input.requiredReferenceUrls ?? []) {
    if (!citedUrls.has(url)) {
      hard('missing_required_reference', 'article does not cite the source it reports on', url);
    }
  }

  // A thin reference list is a WARNING, never a blocker — including for a research article.
  // The paper's own landing page is separately REQUIRED (missing_required_reference, hard), so
  // a research piece still cannot omit the study it reports on; but requiring a second
  // corroborating source for every article is an editorial preference, not a safety rule, and
  // a YouTube article whose claims are attributed to the video needs no external reference at
  // all. Zero references is allowed.
  if (input.references.length < 2) {
    soft('few_references', `only ${input.references.length} external reference(s)`);
  }

  /* ------------------------------ copy overlap ------------------------------ */
  // Writing from a source makes short phrase overlap normal. Only substantial copying blocks a
  // publish — a very long verbatim run, or a large fraction of the whole article lifted.
  // Anything shorter is a warning the piece publishes with.
  const overlap = copyOverlapProfile(plain, input.sourceText);
  if (overlap.longestRun > COPY_HARD_NGRAM || overlap.copiedRatio > COPY_RATIO_HARD) {
    hard(
      'copy_overlap',
      `substantial copying from the source: longest run ${overlap.longestRun} words, ` +
        `${Math.round(overlap.copiedRatio * 100)}% of the article overlaps the source`,
      // The overlapping run text would be ideal here, but the run offset is not tracked; the
      // longest-run length is enough for the repair pass to target the copied passage.
      `longest_run=${overlap.longestRun}`,
    );
  } else if (overlap.longestRun > COPY_WARN_NGRAM) {
    soft(
      'copy_overlap',
      `article shares a ${overlap.longestRun}-word run with its source (preferred limit ${COPY_WARN_NGRAM})`,
    );
  }

  const passed = !issues.some((issue) => issue.severity === 'hard');

  return {
    passed,
    issues,
    stats: {
      wordCount,
      sections,
      references: input.references.length,
      numericClaims: traceability.checked,
      speakerParagraphs,
    },
  };
}

function describeClaims(claims: readonly NumericClaim[]): string {
  return claims
    .slice(0, 6)
    .map((claim) => `"${claim.text}" (${claim.kind})`)
    .join(', ');
}

/** Hard failure codes only, for logging and the admin view. */
export function hardFailureCodes(report: ValidationReport): string[] {
  return report.issues.filter((issue) => issue.severity === 'hard').map((issue) => issue.code);
}
