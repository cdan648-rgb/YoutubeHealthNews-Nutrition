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
  HOUSE_RULES,
  draftJsonSchema,
  draftPrompt,
  draftSchema,
  extractionJsonSchema,
  extractionPrompt,
  extractionSchema,
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
    if (working.extraction === undefined) {
      const result = await complete({
        system: HOUSE_RULES,
        user: extractionPrompt({
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
        maxTokens: 4000,
        ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
      });
      working.extraction = result.data;
      usage.push(result.usage);
    }
    const extraction = working.extraction;

    /* -------------------------------- 2. verify ------------------------------ */
    if (working.verification === undefined) {
      const result = await complete({
        system: HOUSE_RULES,
        user: verificationPrompt({
          claims: extraction.claims,
          allowedHosts: deps.allowedReferenceHosts,
        }),
        jsonSchema: verificationJsonSchema,
        schemaName: 'verification',
        validator: verificationSchema,
        maxTokens: 3000,
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
        system: HOUSE_RULES,
        user: draftPrompt({
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
        maxTokens: 12000,
        ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
      });
      working.draft = result.data;
      usage.push(result.usage);
    }
    const draft = working.draft;

    /* ---------------------------------- 5. seo ------------------------------ */
    if (working.seo === undefined) {
      const result = await complete({
        system: HOUSE_RULES,
        user: seoPrompt({ title: draft.title, dek: draft.dek, topic: extraction.topic }),
        jsonSchema: seoJsonSchema,
        schemaName: 'seo',
        validator: seoSchema,
        maxTokens: 1000,
        ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
      });
      working.seo = result.data;
      usage.push(result.usage);
    }
    const seo = working.seo;

    /* --------------------------------- 6. gate ------------------------------ */
    // The slug is re-derived from the title rather than trusted: a model-supplied slug is
    // a hint, and the database CHECK is unforgiving.
    const slug = slugify(draft.title);

    const finalReferences: Reference[] = draft.references.filter((reference) => {
      try {
        return isAllowlistedHost(new URL(reference.url).hostname, deps.allowedReferenceHosts);
      } catch {
        return false;
      }
    });

    const report = validateArticle({
      title: draft.title,
      dek: draft.dek,
      slug,
      categorySlug: draft.categorySlug,
      body: draft.body,
      references: finalReferences,
      sourceText: source.sourceText,
      sourceTitle: source.title,
      allowedCategorySlugs: deps.categories.map((category) => category.slug),
      allowedReferenceHosts: deps.allowedReferenceHosts,
      unverifiableReferenceUrls: referenceStatus.unverifiable,
      unreachableReferenceUrls: referenceStatus.unreachable,
      detectedRestrictedTopics: extraction.restrictedTopics,
    });

    const normalisedDraft: Draft = { ...draft, slug, references: finalReferences };

    if (!report.passed) {
      return {
        decision: 'needs_review',
        draft: normalisedDraft,
        seo,
        report,
        artifacts: working,
        usage,
        reason: report.issues
          .filter((issue) => issue.severity === 'hard')
          .map((issue) => issue.code)
          .join(', '),
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
