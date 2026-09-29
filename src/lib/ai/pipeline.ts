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
  WORD_COUNT_MAX,
  WORD_COUNT_MIN,
  validateArticle,
  type ValidationReport,
} from '@/lib/validate/gate';
import { isAllowlistedHost, type VerificationSummary } from '@/lib/references/verify';
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
 * Hard failure codes a single content-repair pass may safely and meaningfully attempt.
 *
 * An allowlist, not a denylist, so the fail-safe direction is "route to human review": any
 * code not listed here — and every code added in future — sends the article to review
 * untouched rather than to a model. The omissions are deliberate:
 *
 *   restricted_topic          a policy block a body rewrite cannot clear — it comes from the
 *                             extraction, so a repaired body would just fail the gate again.
 *   untraceable_number,       fabrication and plagiarism signals. Letting a model "repair"
 *   copy_overlap,             them is precisely the surface we do not want an automated pass
 *   fabricated_quote          improvising over; these belong to a human.
 *   invalid_slug,             the generation is broken at a level a content edit will not
 *   unknown_category,         mend (the slug is re-derived from the title; a missing headline
 *   missing_headline,         or a required paper link is a structural generation failure).
 *   missing_required_reference
 *
 * The listed codes are the length, phrasing, thin-sourcing and missing-structural-block
 * failures — the ones the reported production incident hit, and the ones a careful rewrite
 * can fix without inventing anything.
 */
const REPAIRABLE_HARD_CODES: ReadonlySet<string> = new Set([
  'too_short',
  'too_long',
  'prescriptive_language',
  'prescriptive_dosage',
  'too_few_sections',
  'missing_key_facts',
  'missing_video_embed',
  'missing_source_note',
  'missing_disclaimer',
  'unexpected_video_embed',
  'missing_study_caveat',
  'dangling_reference',
  'unsourced_established_claim',
  'uncited_quotation',
  'speaker_attribution_without_speaker',
]);

/**
 * Whether a failed report is one the repair pass may attempt: it must have at least one hard
 * issue, and EVERY hard issue must be repairable. A single non-repairable hard issue (a
 * restricted topic, a fabricated number) sends the whole article to review — a repair that
 * left such an issue in place would be wasted, and one that "fixed" it would be unsafe.
 */
function isRepairable(report: ValidationReport): boolean {
  const hard = report.issues.filter((issue) => issue.severity === 'hard');
  return hard.length > 0 && hard.every((issue) => REPAIRABLE_HARD_CODES.has(issue.code));
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
    // Keep only allowlisted references. A model-supplied reference on an off-list host is
    // stripped before the gate, matching what the writing stage was told it may cite.
    const allowlist = (references: readonly Reference[]): Reference[] =>
      references.filter((reference) => {
        try {
          return isAllowlistedHost(new URL(reference.url).hostname, deps.allowedReferenceHosts);
        } catch {
          return false;
        }
      });

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
        allowedCategorySlugs: deps.categories.map((category) => category.slug),
        allowedReferenceHosts: deps.allowedReferenceHosts,
        unverifiableReferenceUrls: status.unverifiable,
        unreachableReferenceUrls: status.unreachable,
        detectedRestrictedTopics: extraction.restrictedTopics,
        sourceKind: source.kind,
        requiredReferenceUrls,
      });

    let currentDraft = draft;
    let finalReferences = allowlist(draft.references);
    let report = runGate(currentDraft, finalReferences, referenceStatus);
    let repaired = false;

    /* ---------------------------- 6b. one repair pass ------------------------ */
    // A fixable content failure gets exactly one automatic repair before the article is
    // handed to a human. The model sees the gate's own report and its own prior JSON, fixes
    // only what was flagged, and returns the complete article — which the gate then re-runs
    // over in full. Never more than once: a rewrite that still fails is not going to succeed
    // on a third try, and the deterministic gate is what decides, not the model.
    if (!report.passed && isRepairable(report)) {
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

        const repairedReferences = allowlist(repairResult.data.references);
        // Re-verify the repaired article's citations from scratch: a repair may add sources,
        // and an added citation must clear the same reachability bar as an original one.
        const repairedStatus = await deps.verifyReferences(
          repairedReferences.map((reference) => reference.url),
        );

        // Adopt the repaired article regardless of outcome: on a pass it publishes, and on a
        // still-failing repair the human reviewer is shown the closer attempt.
        currentDraft = repairResult.data;
        finalReferences = repairedReferences;
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
