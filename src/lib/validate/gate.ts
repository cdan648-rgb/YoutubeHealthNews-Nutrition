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

export const WORD_COUNT_MIN = 700;
export const WORD_COUNT_MAX = 1400;
/** Longest run of identical words permitted between the article and its source. */
export const MAX_COPY_NGRAM = 12;

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
  { pattern: /\btự\s+(?:chẩn đoán|điều trị)\b/iu, label: 'encourages self-treatment' },
];

/**
 * A dosage, in any unit. Separate from the prescriptive patterns because a bare quantity
 * is dangerous even in a descriptive sentence: readers copy numbers out of context.
 *
 * The trailing `\p{L}` lookahead is essential — see the note in `numbers.ts`.
 */
const DOSAGE_PATTERN = /\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|g|kg|ml|IU|đơn vị)(?![\p{L}\d])/giu;

export type GateInput = {
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
  for (const issue of checkBodyStructure(input.body, input.references)) {
    // The speaker-attribution rule is the one structural check we treat as soft: a
    // well-sourced article that happens not to quote the video is not dangerous.
    if (issue.code === 'no_speaker_attribution') {
      soft(issue.code, issue.message);
    } else {
      hard(issue.code, issue.message);
    }
  }

  if (wordCount < WORD_COUNT_MIN) {
    hard('too_short', `article is ${wordCount} words, minimum ${WORD_COUNT_MIN}`);
  }
  if (wordCount > WORD_COUNT_MAX) {
    hard('too_long', `article is ${wordCount} words, maximum ${WORD_COUNT_MAX}`);
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

  if (input.references.length < 2) {
    soft('few_references', `only ${input.references.length} external reference(s)`);
  }

  /* ------------------------------ copy overlap ------------------------------ */
  const sharedRun = longestSharedWordRun(plain, input.sourceText);
  if (sharedRun > MAX_COPY_NGRAM) {
    hard(
      'copy_overlap',
      `article shares a ${sharedRun}-word run with its source (limit ${MAX_COPY_NGRAM})`,
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
