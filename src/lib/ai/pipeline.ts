/**
 * The generation pipeline: extract → verify → write → seo → gate.
 *
 * Returns a decision rather than publishing anything. Three outcomes:
 *
 *   publish       the gate passed and no policy blocks it
 *   needs_review  a hard gate failure, a restricted topic, or approval mode is on
 *   failed        the model or the network could not produce a candidate at all
 *
 * The distinction between `needs_review` and `failed` matters operationally: the first is
 * an article worth a human's time, the second is a run to retry.
 *
 * Nothing here decides whether to spend money — the caller claims the source first. By the
 * time this runs, the video or paper is already marked `selected`.
 */
import 'server-only';

import type { Reference } from '@/lib/domain/blocks';
import { complete, OpenRouterError, type UsageStats } from './openrouter';
import {
  BLOCK_SHAPES,
  HOUSE_RULES,
  RESEARCH_RULES,
  draftJsonSchema,
  draftPrompt,
  draftSchema,
  extractionJsonSchema,
  extractionPrompt,
  extractionSchema,
  repairDraftPrompt,
  researchDraftPrompt,
  researchExtractionPrompt,
  seoJsonSchema,
  seoPrompt,
  seoSchema,
  verificationJsonSchema,
  verificationPrompt,
  verificationSchema,
  type Draft,
  type Extraction,
  type Seo,
  type Verification,
} from './stages';
import {
  WORD_COUNT_EXPAND_MIN,
  WORD_COUNT_MAX,
  WORD_COUNT_MIN,
  validateArticle,
  type ValidationReport,
} from '@/lib/validate/gate';
import { isAllowlistedHost, type VerificationSummary } from '@/lib/references/verify';
import { reconcileReferences } from '@/lib/references/reconcile';
import { normalizeBody } from '@/lib/domain/normalize';
import { slugify } from '@/lib/slug';

export type PipelineSource = {
  readonly kind: 'youtube' | 'research';
  readonly title: string;
  /** Cleaned description, or the paper abstract. The only substantive input. */
  readonly sourceText: string;
  readonly keywords: readonly string[];
  readonly durationSeconds: number | null;
  readonly publishedAt: string;
  readonly channelTitle: string;
  /**
   * Research-only fields.
   *
   * Present when `kind` is `'research'`. `paperUrl` is required there and is enforced as a
   * reference by the gate, so the article always links the study it reports on — without
   * that link the piece gives the reader nothing to check.
   */
  readonly paperUrl?: string;
  readonly journal?: string | null;
  readonly authors?: readonly string[];
};

export type PipelineDeps = {
  readonly categories: readonly { slug: string; name: string; description: string }[];
  readonly allowedReferenceHosts: readonly string[];
  readonly restrictedTopics: readonly string[];
  readonly requireApproval: boolean;
  /** Injected so tests never call the network. */
  readonly verifyReferences: (urls: readonly string[]) => Promise<VerificationSummary>;
  readonly fetchImpl?: typeof fetch;
};

/** Artifacts persisted after each stage so a resumed run never re-pays for a call. */
export type PipelineArtifacts = {
  extraction?: Extraction;
  verification?: Verification;
  draft?: Draft;
  seo?: Seo;
};

export type PipelineOutcome =
  | {
      readonly decision: 'publish' | 'needs_review';
      readonly draft: Draft;
      readonly seo: Seo;
      readonly report: ValidationReport;
      readonly artifacts: PipelineArtifacts;
      readonly usage: readonly UsageStats[];
      readonly reason?: string;
    }
  | {
      readonly decision: 'failed';
      readonly code: 'openrouter_failed' | 'ai_malformed_output';
      readonly message: string;
      readonly artifacts: PipelineArtifacts;
      readonly usage: readonly UsageStats[];
      readonly retryable: boolean;
    };

/**
 * Hard failure codes a single AI content-repair pass may safely and meaningfully attempt.
 *
 * The structural and reference-contract failures are gone from this list on purpose: the
 * deterministic normaliser now fixes them for free (missing markers, dangling refs,
 * unsupported citations, an off-list or dead reference, an invented category), and the gate
 * treats what remains of them as warnings — so they never reach here as hard failures. What is
 * left is the editorial and safety-wording set that only a rewrite can address: length,
 * prescriptive phrasing, an untraceable number, substantial copying, and a missing headline.
 *
 * An allowlist, not a denylist, so the fail-safe direction is "route to human review": any
 * hard code NOT listed — restricted_topic, empty_article, and every backstop integrity code —
 * sends the article to review untouched rather than to a model.
 */
const REPAIRABLE_HARD_CODES: ReadonlySet<string> = new Set([
  'too_short',
  'too_long',
  'prescriptive_language',
  'prescriptive_dosage',
  'untraceable_number',
  'copy_overlap',
  'missing_headline',
]);

/**
 * Whether a report's hard failures are all repairable. It must have at least one hard issue,
 * and EVERY hard issue must be in the repairable set: a single non-repairable hard issue (a
 * restricted topic, an empty article) sends the whole article to review, because a repair that
 * left it in place would be wasted and one that "fixed" it would be unsafe.
 */
function isRepairable(report: ValidationReport): boolean {
  const hard = report.issues.filter((issue) => issue.severity === 'hard');
  return hard.length > 0 && hard.every((issue) => REPAIRABLE_HARD_CODES.has(issue.code));
}

/**
 * Whether to attempt the single repair pass. Either the report has hard failures that are all
 * repairable, OR the article already passes but is short enough (below the expand threshold)
 * to be worth one automatic expansion. A report blocked by a non-repairable hard issue is not
 * repaired — it goes straight to review.
 */
function shouldAttemptRepair(report: ValidationReport): boolean {
  if (isRepairable(report)) return true;
  return report.passed && report.stats.wordCount < WORD_COUNT_EXPAND_MIN;
}

/**
 * Run the pipeline.
 *
 * `artifacts` is both input and output: pass what a previous attempt produced and those
 * stages are skipped. This is what makes a resumed run cheap after the expensive step has
 * already succeeded.
 */
export async function generateArticle(
  source: PipelineSource,
  deps: PipelineDeps,
  artifacts: PipelineArtifacts = {},
): Promise<PipelineOutcome> {
  const usage: UsageStats[] = [];
  const working: PipelineArtifacts = { ...artifacts };

  try {
    /* ------------------------------- 1. extract ------------------------------ */
    // The house rules apply verbatim to both paths. Research adds constraints; it never
    // relaxes one.
    const system =
      source.kind === 'research'
        ? `${HOUSE_RULES}

${RESEARCH_RULES}`
        : HOUSE_RULES;

    if (working.extraction === undefined) {
      const result = await complete({
        system,
        user:
          source.kind === 'research'
            ? researchExtractionPrompt({
                title: source.title,
                abstract: source.sourceText,
                journal: source.journal ?? null,
                publicationDate: source.publishedAt,
                authors: source.authors ?? [],
                categories: deps.categories,
              })
            : extractionPrompt({
                title: source.title,
                descriptionClean: source.sourceText,
                keywords: source.keywords,
                durationSeconds: source.durationSeconds,
                publishedAt: source.publishedAt,
                categories: deps.categories,
              }),
        jsonSchema: extractionJsonSchema,
        schemaName: 'extraction',
        validator: extractionSchema,
        // Extraction returns a bounded JSON: topic, category, outline and a claims list. The
        // claims list is the variable dimension — a dense video can produce a dozen — so the
        // budget is loose enough to survive the top of that distribution without truncating.
        maxTokens: 6000,
        ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
      });
      working.extraction = result.data;
      usage.push(result.usage);
    }
    const extraction = working.extraction;

    /* -------------------------------- 2. verify ------------------------------ */
    if (working.verification === undefined) {
      const result = await complete({
        system,
        user: verificationPrompt({
          claims: extraction.claims,
          allowedHosts: deps.allowedReferenceHosts,
        }),
        jsonSchema: verificationJsonSchema,
        schemaName: 'verification',
        validator: verificationSchema,
        // One verifiedClaim per extracted claim, with resolution and (for `cite`) a URL,
        // publisher, title and short reason. Budget scales with the extraction's claim count.
        maxTokens: 6000,
        ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
      });
      working.verification = result.data;
      usage.push(result.usage);
    }

    // Drop any suggested citation whose host is not allowlisted BEFORE the writing stage
    // sees it. Offering the model a source it may not cite invites it to cite it anyway.
    const verification: Verification = {
      verifiedClaims: working.verification.verifiedClaims.map((claim) => {
        if (claim.resolution !== 'cite') return claim;
        const url = claim.suggestedUrl;
        if (url === undefined) return { ...claim, resolution: 'attribute_to_speaker' as const };
        try {
          if (!isAllowlistedHost(new URL(url).hostname, deps.allowedReferenceHosts)) {
            return { ...claim, resolution: 'attribute_to_speaker' as const };
          }
        } catch {
          return { ...claim, resolution: 'attribute_to_speaker' as const };
        }
        return claim;
      }),
    };

    /* --------------------------- 3. check the sources ----------------------- */
    // Fetch the proposed URLs before writing, so an unreachable page becomes an
    // "attribute to the speaker" instruction rather than a dead citation in the body.
    const proposedUrls = verification.verifiedClaims
      .filter((claim) => claim.resolution === 'cite')
      .map((claim) => claim.suggestedUrl)
      .filter((url): url is string => url !== undefined);

    const referenceStatus = await deps.verifyReferences(proposedUrls);
    const citable = new Set([...referenceStatus.reachable, ...referenceStatus.unverifiable]);

    const usableVerification: Verification = {
      verifiedClaims: verification.verifiedClaims.map((claim) =>
        claim.resolution === 'cite' &&
        (claim.suggestedUrl === undefined || !citable.has(claim.suggestedUrl))
          ? { ...claim, resolution: 'attribute_to_speaker' as const }
          : claim,
      ),
    };

    /* --------------------------------- 4. write ----------------------------- */
    if (working.draft === undefined) {
      const result = await complete({
        system,
        user:
          source.kind === 'research'
            ? researchDraftPrompt({
                extraction,
                verification: usableVerification,
                paperTitle: source.title,
                paperUrl: source.paperUrl ?? '',
                journal: source.journal ?? null,
                publicationDate: source.publishedAt,
                authors: source.authors ?? [],
                abstract: source.sourceText,
                wordCountMin: WORD_COUNT_MIN,
                wordCountMax: WORD_COUNT_MAX,
              })
            : draftPrompt({
                extraction,
                verification: usableVerification,
                sourceTitle: source.title,
                descriptionClean: source.sourceText,
                channelTitle: source.channelTitle,
                wordCountMin: WORD_COUNT_MIN,
                wordCountMax: WORD_COUNT_MAX,
                allowedCategorySlugs: deps.categories.map((category) => category.slug),
              }),
        jsonSchema: draftJsonSchema,
        schemaName: 'draft',
        validator: draftSchema,
        // The draft carries the full body_blocks JSON — 700–1,400 words of Vietnamese prose,
        // headings, callouts and quotes — plus title, dek, category, and the references array.
        // Vietnamese tokenises heavier than English and the block wrappers add structural
        // overhead, so the ceiling has to sit well above the raw word count in tokens.
        // Truncation here (finish_reason=length) is what took the run to attempts=5.
        maxTokens: 16000,
        // Hand the exhaustive per-block-type shape to the repair pass, so a missing required
        // field (e.g. body.N.text) is corrected against the concrete schema, not a guess.
        repairHint: BLOCK_SHAPES,
        ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
      });
      working.draft = result.data;
      usage.push(result.usage);
    }
    const draft = working.draft;

    /* ---------------------------------- 5. seo ------------------------------ */
    if (working.seo === undefined) {
      const result = await complete({
        system,
        user: seoPrompt({ title: draft.title, dek: draft.dek, topic: extraction.topic }),
        jsonSchema: seoJsonSchema,
        schemaName: 'seo',
        validator: seoSchema,
        // metaTitle, metaDescription and a short keywords array. Stays intentionally small —
        // this stage should never plausibly need more, and a smaller ceiling caps runaway cost.
        maxTokens: 1500,
        ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
      });
      working.seo = result.data;
      usage.push(result.usage);
    }
    const seo = working.seo;

    /* --------------------------------- 6. gate ------------------------------ */
    // Reference sanitation: drop anything a citation cannot safely rest on — a non-https URL,
    // an off-allowlist host, a URL that will not parse, or one the reachability check found
    // missing (404). A body citation that pointed at a dropped reference is reconciled away by
    // normalise(). None of this blocks a publish; it corrects it.
    const sanitizeReferences = (
      references: readonly Reference[],
      status: VerificationSummary,
    ): Reference[] => {
      const unreachable = new Set(status.unreachable);
      return references.filter((reference) => {
        try {
          const url = new URL(reference.url);
          return (
            url.protocol === 'https:' &&
            isAllowlistedHost(url.hostname, deps.allowedReferenceHosts) &&
            !unreachable.has(reference.url)
          );
        } catch {
          return false;
        }
      });
    };

    const allowedCategorySlugs = deps.categories.map((category) => category.slug);
    // A category the model invented is clamped to a real one rather than failing the article:
    // the extraction's proposed category if that is valid, otherwise the first seeded category
    // (which is also what persistence falls back to).
    const clampCategory = (slug: string): string =>
      allowedCategorySlugs.includes(slug)
        ? slug
        : allowedCategorySlugs.includes(extraction.proposedCategorySlug)
          ? extraction.proposedCategorySlug
          : (allowedCategorySlugs[0] ?? slug);

    // The paper's own landing page must be cited. Requiring it here — rather than only
    // asking for it in the prompt — is what makes the rule hold when the model forgets.
    const requiredReferenceUrls =
      source.kind === 'research' && source.paperUrl !== undefined && source.paperUrl !== ''
        ? [source.paperUrl]
        : [];

    // The slug is re-derived from the title rather than trusted: a model-supplied slug is
    // a hint, and the database CHECK is unforgiving.
    const runGate = (
      candidate: Draft,
      references: readonly Reference[],
      status: VerificationSummary,
    ): ValidationReport =>
      validateArticle({
        title: candidate.title,
        dek: candidate.dek,
        slug: slugify(candidate.title),
        categorySlug: candidate.categorySlug,
        body: candidate.body,
        references,
        sourceText: source.sourceText,
        sourceTitle: source.title,
        allowedCategorySlugs,
        allowedReferenceHosts: deps.allowedReferenceHosts,
        unverifiableReferenceUrls: status.unverifiable,
        unreachableReferenceUrls: status.unreachable,
        detectedRestrictedTopics: extraction.restrictedTopics,
        sourceKind: source.kind,
        requiredReferenceUrls,
      });

    // The ordered pool of verified, allowlisted, reachable sources the writing stage was
    // handed. Its order is the exact index space the body's `ref` values were written in, so
    // a body that cited into an empty references array can be repaired against it without
    // inventing anything. See reconcileReferences.
    const referencePool = buildReferencePool(
      source,
      usableVerification,
      deps.allowedReferenceHosts,
    );

    // Deterministic normalisation, run BEFORE the gate and again after any repair. It closes
    // the reference contract, guarantees render-critical structure, neutralises unsupported
    // citations, ensures a research article cites its paper, and clamps the category — every
    // one a correction rather than a reason to waste a publishing day.
    const normalize = (
      candidate: Draft,
      status: VerificationSummary,
    ): { draft: Draft; references: Reference[] } => {
      const reconciled = reconcileReferences(
        candidate.body,
        sanitizeReferences(candidate.references, status),
        referencePool,
      );
      let references = reconciled.references;
      // Append the required paper reference if the model dropped it — append, not insert at 0,
      // so existing body ref indices keep pointing where they did.
      for (const url of requiredReferenceUrls) {
        if (!references.some((reference) => reference.url === url)) {
          references = [...references, paperReference(source, url, references.length)];
        }
      }
      const body = normalizeBody(reconciled.body, source.kind);
      return {
        draft: {
          ...candidate,
          categorySlug: clampCategory(candidate.categorySlug),
          body,
          references,
        },
        references,
      };
    };

    const firstPass = normalize(draft, referenceStatus);
    let currentDraft: Draft = firstPass.draft;
    let finalReferences = firstPass.references;
    let report = runGate(currentDraft, finalReferences, referenceStatus);
    let repaired = false;

    /* ---------------------------- 6b. one repair pass ------------------------ */
    // Exactly one automatic repair. It runs when the gate's hard failures are all repairable,
    // or when the article already passes but is short enough to be worth one expansion. The
    // model sees the gate's own report (hard AND soft) plus its own prior JSON, fixes what was
    // flagged, and returns the complete article — which is renormalised and re-gated in full.
    // Never more than once: a rewrite that still fails is not going to succeed on a third try.
    if (shouldAttemptRepair(report)) {
      repaired = true;
      try {
        const repairResult = await complete({
          system,
          user: repairDraftPrompt({
            previousDraftJson: JSON.stringify(currentDraft),
            issues: report.issues,
            sourceTitle: source.title,
            sourceKind: source.kind,
            wordCountMin: WORD_COUNT_MIN,
            wordCountMax: WORD_COUNT_MAX,
          }),
          jsonSchema: draftJsonSchema,
          schemaName: 'draft',
          validator: draftSchema,
          // Same ceiling as the writing stage: a repaired full-length article is no smaller
          // than the original, and a lower budget would truncate the fix.
          maxTokens: 16000,
          repairHint: BLOCK_SHAPES,
          ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
        });
        usage.push(repairResult.usage);

        // Re-verify the repaired article's citations from scratch: a repair may add sources,
        // and an added citation must clear the same reachability bar as an original one.
        const repairedStatus = await deps.verifyReferences(
          repairResult.data.references.map((reference) => reference.url),
        );

        // Renormalise the repaired article exactly as the first draft was — reconcile refs,
        // guarantee structure, clamp category — then re-gate. Adopt it regardless of outcome:
        // on a pass it publishes, and on a still-failing repair the reviewer sees the closer
        // attempt.
        const repairedPass = normalize(repairResult.data, repairedStatus);
        currentDraft = repairedPass.draft;
        finalReferences = repairedPass.references;
        report = runGate(currentDraft, finalReferences, repairedStatus);
        working.draft = currentDraft;
      } catch {
        // A repair that cannot even produce valid output must never leave the run worse off
        // than doing nothing: fall through with the original draft and its failing report.
      }
    }

    const normalisedDraft: Draft = {
      ...currentDraft,
      slug: slugify(currentDraft.title),
      references: finalReferences,
    };

    if (!report.passed) {
      const hardCodes = report.issues
        .filter((issue) => issue.severity === 'hard')
        .map((issue) => issue.code)
        .join(', ');
      return {
        decision: 'needs_review',
        draft: normalisedDraft,
        seo,
        report,
        artifacts: working,
        usage,
        reason: repaired ? `validation_failed_after_repair: ${hardCodes}` : hardCodes,
      };
    }

    if (deps.requireApproval) {
      // Not a failure: the article is publishable, and a human is choosing to look first.
      return {
        decision: 'needs_review',
        draft: normalisedDraft,
        seo,
        report,
        artifacts: working,
        usage,
        reason: 'require_approval is enabled',
      };
    }

    return { decision: 'publish', draft: normalisedDraft, seo, report, artifacts: working, usage };
  } catch (cause) {
    if (cause instanceof OpenRouterError) {
      return {
        decision: 'failed',
        // A truncated or unparseable response is a different problem from a 500, and the
        // logs need to say which.
        code:
          cause.kind === 'malformed' || cause.kind === 'truncated'
            ? 'ai_malformed_output'
            : 'openrouter_failed',
        message: cause.message,
        artifacts: working,
        usage,
        retryable: cause.retryable,
      };
    }
    throw cause;
  }
}

/** Total estimated spend across a run's calls. */
export function totalCost(usage: readonly UsageStats[]): number {
  return usage.reduce((sum, entry) => sum + entry.estimatedCostUsd, 0);
}

/** Hostname of a URL, or '' if it will not parse. */
function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** First candidate at least `min` characters long, trimmed; '' if none qualifies. */
function firstOfLength(candidates: readonly (string | undefined)[], min: number): string {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim() ?? '';
    if (trimmed.length >= min) return trimmed;
  }
  return '';
}

/**
 * The ordered pool of verified sources the writing stage was handed, as `Reference` objects.
 *
 * The order is load-bearing: it is the exact index space the body's `ref` values were written
 * in, so reconcileReferences can adopt this pool to make a body that cited into a dropped
 * references array resolve. It mirrors the draft prompts precisely — youtube enumerates the
 * citable claims from index 0; research places the paper at index 0 and the citable claims
 * after it — so pool[N] is the source the model was told `ref: N` points at.
 *
 * Every entry is real: a citable claim carries a verified, allowlisted, reachable URL (the
 * pipeline downgraded every other resolution before this point), and the research paper's own
 * landing page is the source the article reports on. Nothing here is fabricated.
 */
function buildReferencePool(
  source: PipelineSource,
  verification: Verification,
  allowedHosts: readonly string[],
): Reference[] {
  const claimReferences = verification.verifiedClaims
    .filter((claim) => claim.resolution === 'cite' && claim.suggestedUrl !== undefined)
    .map((claim): Reference | null => {
      const url = claim.suggestedUrl ?? '';
      const host = safeHost(url);
      if (host === '' || !isAllowlistedHost(host, allowedHosts)) return null;
      return {
        label: '0',
        title: firstOfLength([claim.suggestedTitle, claim.suggestedPublisher, host], 3) || host,
        publisher: firstOfLength([claim.suggestedPublisher, host], 2) || host,
        url,
      };
    })
    .filter((reference): reference is Reference => reference !== null);

  const pool: Reference[] = [];
  if (source.kind === 'research' && source.paperUrl !== undefined && source.paperUrl !== '') {
    // The research draft prompt reserves index 0 for the paper itself.
    pool.push(paperReference(source, source.paperUrl, 0));
  }
  pool.push(...claimReferences);

  return pool.map((reference, index) => ({ ...reference, label: String(index + 1) }));
}

/** A `Reference` for a research paper's own landing page, at a given array position. */
function paperReference(source: PipelineSource, url: string, index: number): Reference {
  return {
    label: String(index + 1),
    title: firstOfLength([source.title], 3) || 'Công trình nghiên cứu',
    publisher: firstOfLength([source.journal ?? undefined], 2) || 'Tạp chí khoa học',
    url,
  };
}
