/**
 * The live `SchedulerPorts` implementation.
 *
 * Deliberately thin: each method is one gateway call or one delegation. All the decision
 * logic lives in `scheduler.ts`, where it is driven in memory by the concurrency matrix, so
 * this file has nothing to get subtly wrong on its own.
 *
 * Everything that touches the private `internal` schema goes through `AutomationGateway`,
 * which calls the service-role-only `public.automation_*` RPCs. The `internal` schema is
 * never reached over the Data API — see `internal-gateway.ts` for why that matters.
 */
import 'server-only';

import { toJson, toJsonObject } from '@/lib/json';
import { blocksToPlainText, countWords } from '@/lib/domain/blocks';
import { slugify } from '@/lib/slug';
import { SOURCE_CHANNEL } from '@/lib/site';
import { serviceClient } from '@/lib/supabase/service';
import { publicClient } from '@/lib/supabase/server';
import { verifyReferences } from '@/lib/references/verify';
import { generateArticle, type PipelineArtifacts, type PipelineSource } from '@/lib/ai/pipeline';
import { cleanDescription } from '@/lib/youtube/clean';
import { createApiSource } from '@/lib/youtube/api';
import { createFallbackSource } from '@/lib/youtube/fallback';
import { ingestChannel } from '@/lib/youtube/ingest';
import { liveGateway, type AutomationGateway } from './internal-gateway';
import type { PublishableSource, Stage, SchedulerPorts, SourceChoice } from './scheduler';

const CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID ?? SOURCE_CHANNEL.channelId;
const CHANNEL_HANDLE = SOURCE_CHANNEL.handle;

/** Article shape the persist step writes. Built from the pipeline artifacts. */
type DraftArtifact = {
  title: string;
  dek: string;
  slug: string;
  categorySlug: string;
  isFactCheck: boolean;
  body: unknown[];
  references: unknown[];
};

export function createPorts(gateway: AutomationGateway = liveGateway()): SchedulerPorts {
  // Named so a method can call a sibling (chooseSource needs settings and noSourceStreak).
  const self: SchedulerPorts = {
    now: () => new Date(),

    settings: async () => {
      const data = await gateway.getSettings();
      return {
        publishHourLocal: data.publishHourLocal,
        publishWindowEndHour: data.publishWindowEndHour,
        abandonHourLocal: data.abandonHourLocal,
        paused: data.paused,
        noSourceThreshold: data.noSourceThreshold,
        freshWindowDays: data.freshWindowDays,
        requireApproval: data.requireApproval,
      };
    },

    getRun: async (day) => {
      const run = await gateway.getRun(day);
      return run === null
        ? null
        : {
            id: run.id,
            result: run.result,
            stage: run.stage as Stage,
            attemptCount: run.attemptCount,
          };
    },

    // The one-run-per-Hanoi-day guarantee lives in the unique constraint on hanoi_date; the
    // RPC's INSERT ... ON CONFLICT DO NOTHING returns null when another tick got there first.
    claimDay: (day) => gateway.claimDay(day),

    recordSkippedWindow: (day) => gateway.recordSkippedWindow(day),

    listRunning: async () => {
      const running = await gateway.listRunning();
      return running.map((row) => ({
        id: row.id,
        hanoiDate: row.hanoiDate,
        attemptCount: row.attemptCount,
      }));
    },

    expireRun: (runId) => gateway.expireRun(runId),

    acquireLease: (runId) => gateway.acquireLease(runId),

    saveStage: (runId, token, stage, artifacts) =>
      gateway.saveStage(runId, token, stage, artifacts),

    loadArtifacts: (runId) => gateway.loadArtifacts(runId),

    incrementAttempt: (runId) => gateway.incrementAttempt(runId),

    finish: (runId, input) =>
      gateway.finish(runId, {
        result: input.result,
        ...(input.sourceKind !== undefined ? { sourceKind: input.sourceKind } : {}),
        ...(input.articleId !== undefined ? { articleId: input.articleId } : {}),
        ...(input.streak !== undefined ? { streak: input.streak } : {}),
        ...(input.errorStage !== undefined ? { errorStage: input.errorStage } : {}),
        ...(input.error !== undefined ? { error: input.error } : {}),
      }),

    noSourceStreak: (day) => gateway.noSourceStreak(day),

    /**
     * Pick today's source.
     *
     * Order is the policy: ingest, then a YouTube video, then — only if none exists and the
     * dry spell is long enough — research. Fresh channel content always wins.
     */
    chooseSource: async (freshWindowDays, threshold, day): Promise<SourceChoice> => {
      // Ingestion failure is non-fatal: the backlog in the table is still usable.
      try {
        const apiKey = process.env.YOUTUBE_API_KEY;
        const source =
          apiKey !== undefined && apiKey !== ''
            ? createApiSource({ apiKey, channelId: CHANNEL_ID })
            : createFallbackSource({ channelHandle: CHANNEL_HANDLE, requestDelayMs: 1200 });
        await ingestChannel({ source, gateway, limit: 15 });
      } catch (cause) {
        await gateway.log({
          code: 'ingest_api_failed',
          level: 'warn',
          stage: 'source',
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }

      const claimed = await gateway.claimNextVideo(freshWindowDays);
      if (claimed !== null) {
        return {
          kind: 'youtube',
          videoId: claimed.id,
          youtubeVideoId: claimed.youtubeVideoId,
          title: claimed.title,
        };
      }

      const streak = await self.noSourceStreak(day);
      if (streak < threshold) return { kind: 'none', streak };

      // The dry spell is long enough. The paper is claimed inside the database before any
      // generation call is made, so a duplicate costs one round trip rather than an article.
      const { claimResearchSource } = await import('@/lib/research/select');
      const paper = await claimResearchSource({
        today: day,
        gateway,
        log: (entry) =>
          gateway.log({
            code: entry.code,
            stage: 'source',
            ...(entry.level === undefined ? {} : { level: entry.level }),
            ...(entry.message === undefined ? {} : { message: entry.message }),
            ...(entry.context === undefined ? {} : { context: entry.context }),
          }),
      });
      if (paper === null) return { kind: 'none', streak };

      await gateway.log({
        code: 'research_selected',
        stage: 'source',
        message: `rank ${paper.rank} of ${paper.poolSize}, score ${paper.score}`,
        context: { researchSourceId: paper.id, score: paper.score, rank: paper.rank },
      });
      return { kind: 'research', researchSourceId: paper.id, title: paper.title };
    },

    generate: async (source, artifacts) => {
      const settings = await gateway.getSettings();
      const categories = await loadCategories();

      const pipelineSource = await buildPipelineSource(source, gateway);
      if (pipelineSource === null) {
        return {
          status: 'failed',
          code: 'db_failed',
          message: 'source row disappeared',
          retryable: false,
          artifacts,
        };
      }

      const previous: PipelineArtifacts = {
        ...(isRecord(artifacts.extraction) ? { extraction: artifacts.extraction as never } : {}),
        ...(isRecord(artifacts.verification)
          ? { verification: artifacts.verification as never }
          : {}),
        ...(isRecord(artifacts.draft) ? { draft: artifacts.draft as never } : {}),
        ...(isRecord(artifacts.seo) ? { seo: artifacts.seo as never } : {}),
      };

      const outcome = await generateArticle(
        pipelineSource,
        {
          categories,
          allowedReferenceHosts: settings.allowedReferenceHosts,
          restrictedTopics: [],
          requireApproval: settings.requireApproval,
          verifyReferences: (urls) => verifyReferences(urls),
        },
        previous,
      );

      if (outcome.decision === 'failed') {
        return {
          status: 'failed',
          code: outcome.code,
          message: outcome.message,
          retryable: outcome.retryable,
          artifacts: { ...artifacts, ...outcome.artifacts },
        };
      }

      return {
        status: 'ok',
        publishable: outcome.decision === 'publish',
        artifacts: {
          ...artifacts,
          ...outcome.artifacts,
          draft: outcome.draft,
          seo: outcome.seo,
          validationReport: outcome.report,
        },
        ...(outcome.reason !== undefined ? { reason: outcome.reason } : {}),
      };
    },

    persist: async (source, runId, publishable) => {
      const artifacts = await gateway.loadArtifacts(runId);
      const draft = artifacts.draft as DraftArtifact | undefined;
      const seo = artifacts.seo;
      const report = artifacts.validationReport;

      if (draft === undefined) throw new Error('persist called with no draft in artifacts');

      const categories = await loadCategories();
      const category = categories.find((item) => item.slug === draft.categorySlug) ?? categories[0];
      if (category === undefined) throw new Error('no categories seeded');

      const bodyText = blocksToPlainText(draft.body as never);
      const hanoi = new Date();

      const row = {
        slug: slugify(draft.title),
        title: draft.title,
        dek: draft.dek,
        body_blocks: toJson(draft.body),
        body_text: bodyText,
        word_count: countWords(bodyText),
        article_type: source.kind === 'research' ? ('research' as const) : ('youtube' as const),
        category_id: category.id,
        is_fact_check: draft.isFactCheck,
        references_used: toJson(draft.references),
        validation_report: toJson(report),
        seo: toJsonObject(seo),
        automation_run_id: runId,
        generated_at: hanoi.toISOString(),
        status: publishable ? ('published' as const) : ('needs_review' as const),
        ...(await sourceColumns(source, gateway)),
        ...(publishable
          ? {
              published_at: hanoi.toISOString(),
              published_date_hanoi: (await import('@/lib/time')).hanoiDate(hanoi),
            }
          : {}),
      };

      const { data, error } = await serviceClient()
        .from('articles')
        .insert(row)
        .select('id')
        .maybeSingle();

      if (error !== null) {
        // A unique violation on automation_run_id means an earlier attempt already wrote
        // the article. That is the guarantee working; report the existing row.
        if (error.code === '23505') {
          const existing = await serviceClient()
            .from('articles')
            .select('id')
            .eq('automation_run_id', runId)
            .maybeSingle();
          return { outcome: 'already_exists', articleId: existing.data?.id ?? null };
        }
        throw new Error(`persist failed: ${error.message}`);
      }

      if (source.kind === 'youtube') {
        await gateway.youtubeMarkUsed(source.videoId);
      } else {
        await serviceClient()
          .from('research_sources')
          .update({ used_at: hanoi.toISOString() })
          .eq('id', source.researchSourceId);
      }

      return { outcome: 'created', articleId: data?.id ?? '', published: publishable };
    },

    revalidate: async (articleId) => {
      const secret = process.env.REVALIDATE_SECRET;
      const site = process.env.NEXT_PUBLIC_SITE_URL;
      if (secret === undefined || secret === '' || site === undefined) return;
      await fetch(`${site}/api/revalidate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-revalidate-secret': secret },
        body: JSON.stringify({ articleId }),
      });
    },

    notify: async (articleId) => {
      const { queueCampaign } = await import('@/lib/newsletter/send');
      await queueCampaign(articleId);
    },

    log: (entry) => gateway.log(entry),
  };

  return self;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function loadCategories() {
  const { data, error } = await publicClient()
    .from('categories')
    .select('id, slug, name, description')
    .order('sort_order');
  if (error !== null) throw new Error(`loadCategories failed: ${error.message}`);
  return data ?? [];
}

async function buildPipelineSource(
  source: PublishableSource,
  gateway: AutomationGateway,
): Promise<PipelineSource | null> {
  if (source.kind === 'youtube') {
    const data = await gateway.youtubeGet(source.videoId);
    if (data === null) return null;

    // description_clean is normally populated at ingest; recompute if an older row lacks it.
    const clean =
      data.descriptionClean ??
      (data.descriptionRaw === null ? '' : cleanDescription(data.descriptionRaw).clean);

    return {
      kind: 'youtube',
      title: data.title,
      sourceText: clean,
      keywords: data.keywords,
      durationSeconds: data.durationSeconds,
      publishedAt: data.publishedAt,
      channelTitle: SOURCE_CHANNEL.title,
    };
  }

  const { data } = await serviceClient()
    .from('research_sources')
    .select('title, abstract, journal, publication_date, source_url, authors')
    .eq('id', source.researchSourceId)
    .maybeSingle();
  if (data === null || data === undefined) return null;

  const authors = Array.isArray(data.authors)
    ? data.authors
        .map((author) => {
          if (author === null || typeof author !== 'object' || Array.isArray(author)) return '';
          const name = (author as { name?: unknown }).name;
          return typeof name === 'string' ? name : '';
        })
        .filter((name) => name !== '')
    : [];

  return {
    kind: 'research',
    title: data.title,
    sourceText: data.abstract ?? '',
    keywords: [],
    durationSeconds: null,
    publishedAt: data.publication_date ?? new Date().toISOString(),
    channelTitle: data.journal ?? 'tạp chí khoa học',
    // The gate requires this URL among the references, so the article always links the study.
    paperUrl: data.source_url,
    journal: data.journal,
    authors,
  };
}

/**
 * Source-specific article columns.
 *
 * One declared shape with everything nullable rather than a union of two shapes: a union
 * makes the insert's argument type ambiguous, and the database CHECK constraints
 * (`youtube_needs_video`, `research_needs_source`) are what actually enforce that the right
 * combination is present.
 */
type SourceColumns = {
  source_video_id?: string;
  source_video_youtube_id?: string | null;
  source_video_url?: string | null;
  research_source_id?: string;
  source_doi?: string | null;
  source_metadata: ReturnType<typeof toJsonObject>;
  hero_kind: 'youtube_thumbnail' | 'svg';
  hero_image_url?: string;
  hero_alt: string;
  hero_attribution?: string;
};

async function sourceColumns(
  source: PublishableSource,
  gateway: AutomationGateway,
): Promise<SourceColumns> {
  if (source.kind === 'youtube') {
    const data = await gateway.youtubeGet(source.videoId);

    const thumbnails = (data?.thumbnails ?? {}) as { best?: string };
    const heroUrl =
      thumbnails.best ?? `https://i.ytimg.com/vi/${data?.youtubeVideoId ?? ''}/hqdefault.jpg`;

    return {
      source_video_id: source.videoId,
      source_video_youtube_id: data?.youtubeVideoId ?? null,
      source_video_url: data?.url ?? null,
      source_metadata: toJsonObject({
        video_title: data?.title,
        channel_title: SOURCE_CHANNEL.title,
        video_published_at: data?.publishedAt,
        video_duration_seconds: data?.durationSeconds,
        derived_from: 'public video description and metadata',
        transcript_available: false,
      }),
      hero_kind: 'youtube_thumbnail' as const,
      hero_image_url: heroUrl,
      hero_alt: `Ảnh đại diện video “${data?.title ?? ''}” trên kênh ${SOURCE_CHANNEL.title}`,
      hero_attribution: `Ảnh: YouTube / ${SOURCE_CHANNEL.title}`,
    };
  }

  const { data } = await serviceClient()
    .from('research_sources')
    .select('doi_normalized, title')
    .eq('id', source.researchSourceId)
    .maybeSingle();

  return {
    research_source_id: source.researchSourceId,
    source_doi: data?.doi_normalized ?? null,
    source_metadata: toJsonObject({ paper_title: data?.title, derived_from: 'published abstract' }),
    // Research articles use our own artwork: there is no thumbnail to reference.
    hero_kind: 'svg' as const,
    hero_alt: `Hình minh hoạ cho bài viết về nghiên cứu: ${data?.title ?? ''}`,
  };
}
