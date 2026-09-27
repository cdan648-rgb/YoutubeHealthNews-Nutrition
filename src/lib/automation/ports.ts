/**
 * The live `SchedulerPorts` implementation.
 *
 * Deliberately thin: each method is one database call or one delegation. All the decision
 * logic lives in `scheduler.ts`, where it is driven in memory by the concurrency matrix, so
 * this file has nothing to get subtly wrong on its own.
 */
import 'server-only';

import { toJson, toJsonObject } from '@/lib/json';
import { blocksToPlainText, countWords } from '@/lib/domain/blocks';
import { slugify } from '@/lib/slug';
import { SOURCE_CHANNEL } from '@/lib/site';
import { internalClient, serviceClient, type InternalClient } from '@/lib/supabase/service';
import { publicClient } from '@/lib/supabase/server';
import { verifyReferences } from '@/lib/references/verify';
import { generateArticle, type PipelineArtifacts, type PipelineSource } from '@/lib/ai/pipeline';
import { cleanDescription } from '@/lib/youtube/clean';
import { createApiSource } from '@/lib/youtube/api';
import { createFallbackSource } from '@/lib/youtube/fallback';
import { ingestChannel } from '@/lib/youtube/ingest';
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

export function createPorts(client: InternalClient = internalClient()): SchedulerPorts {
  const log: SchedulerPorts['log'] = async (entry) => {
    const { error } = await client.from('job_logs').insert({
      run_id: entry.runId ?? null,
      level: entry.level ?? 'info',
      stage: entry.stage ?? null,
      code: entry.code,
      message: entry.message ?? null,
      context: toJsonObject(entry.context),
    });
    if (error !== null) console.error(`job_logs insert failed: ${error.message}`);
  };

  // Named so a method can call a sibling (chooseSource needs settings and noSourceStreak).
  // Referenced only when invoked, never during construction — constructing a client at
  // module scope would make `next build` require the service-role key just to import a route.
  const self: SchedulerPorts = {
    now: () => new Date(),

    settings: async () => {
      const { data, error } = await client.from('automation_settings').select('*').maybeSingle();
      if (error !== null) throw new Error(`settings read failed: ${error.message}`);
      if (data === null) throw new Error('automation_settings singleton is missing');
      return {
        publishHourLocal: data.publish_hour_local,
        publishWindowEndHour: data.publish_window_end_hour,
        abandonHourLocal: data.abandon_hour_local,
        paused: data.paused,
        noSourceThreshold: data.no_source_threshold,
        freshWindowDays: data.fresh_window_days,
        requireApproval: data.require_approval,
      };
    },

    getRun: async (day) => {
      const { data, error } = await client
        .from('automation_runs')
        .select('id, result, stage, attempt_count')
        .eq('hanoi_date', day)
        .maybeSingle();
      if (error !== null) throw new Error(`getRun failed: ${error.message}`);
      return data === null
        ? null
        : {
            id: data.id,
            result: data.result,
            stage: data.stage as Stage,
            attemptCount: data.attempt_count,
          };
    },

    // The one-run-per-Hanoi-day guarantee. A unique violation is the expected answer when
    // another tick got there first, not an error.
    claimDay: async (day) => {
      const { data, error } = await client
        .from('automation_runs')
        .insert({ hanoi_date: day, trigger: 'cron', result: 'running', stage: 'claimed' })
        .select('id')
        .maybeSingle();
      if (error !== null) {
        if (error.code === '23505') return null;
        throw new Error(`claimDay failed: ${error.message}`);
      }
      return data === null ? null : { id: data.id };
    },

    recordSkippedWindow: async (day) => {
      const { error } = await client.from('automation_runs').insert({
        hanoi_date: day,
        trigger: 'cron',
        result: 'skipped_window',
        stage: 'done',
        completed_at: new Date().toISOString(),
      });
      // 23505 means a run appeared in the meantime, which is fine.
      if (error !== null && error.code !== '23505') {
        throw new Error(`recordSkippedWindow failed: ${error.message}`);
      }
    },

    listRunning: async () => {
      const { data, error } = await client
        .from('automation_runs')
        .select('id, hanoi_date, attempt_count')
        .eq('result', 'running');
      if (error !== null) throw new Error(`listRunning failed: ${error.message}`);
      return (data ?? []).map((row) => ({
        id: row.id,
        hanoiDate: row.hanoi_date as never,
        attemptCount: row.attempt_count,
      }));
    },

    expireRun: async (runId) => {
      const { error } = await client
        .from('automation_runs')
        .update({
          result: 'expired',
          completed_at: new Date().toISOString(),
          lease_until: null,
          lease_token: null,
        })
        .eq('id', runId)
        .eq('result', 'running');
      if (error !== null) throw new Error(`expireRun failed: ${error.message}`);
    },

    // Filter and write in one statement, so two ticks cannot both acquire.
    acquireLease: async (runId) => {
      const token = crypto.randomUUID();
      const now = new Date();
      const { data, error } = await client
        .from('automation_runs')
        .update({
          lease_until: new Date(now.getTime() + 20 * 60 * 1000).toISOString(),
          lease_token: token,
        })
        .eq('id', runId)
        .eq('result', 'running')
        .or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`)
        .select('id')
        .maybeSingle();
      if (error !== null) throw new Error(`acquireLease failed: ${error.message}`);
      return data === null ? null : token;
    },

    saveStage: async (runId, token, stage, artifacts) => {
      const { data, error } = await client
        .from('automation_runs')
        .update(artifacts === undefined ? { stage } : { stage, artifacts: toJsonObject(artifacts) })
        .eq('id', runId)
        // The token check is what makes a stale driver's write a no-op.
        .eq('lease_token', token)
        .select('id')
        .maybeSingle();
      if (error !== null) throw new Error(`saveStage failed: ${error.message}`);
      return data !== null;
    },

    loadArtifacts: async (runId) => {
      const { data, error } = await client
        .from('automation_runs')
        .select('artifacts')
        .eq('id', runId)
        .maybeSingle();
      if (error !== null) throw new Error(`loadArtifacts failed: ${error.message}`);
      const artifacts = data?.artifacts;
      return artifacts !== null && typeof artifacts === 'object' && !Array.isArray(artifacts)
        ? artifacts
        : {};
    },

    incrementAttempt: async (runId) => {
      const { data } = await client
        .from('automation_runs')
        .select('attempt_count')
        .eq('id', runId)
        .maybeSingle();
      const next = (data?.attempt_count ?? 0) + 1;
      await client.from('automation_runs').update({ attempt_count: next }).eq('id', runId);
      return next;
    },

    finish: async (runId, input) => {
      const { error } = await client
        .from('automation_runs')
        .update({
          result: input.result,
          completed_at: new Date().toISOString(),
          lease_until: null,
          lease_token: null,
          ...(input.sourceKind !== undefined ? { source_kind: input.sourceKind } : {}),
          ...(input.articleId !== undefined ? { article_id: input.articleId } : {}),
          ...(input.streak !== undefined ? { streak_at_decision: input.streak } : {}),
          ...(input.errorStage !== undefined ? { error_stage: input.errorStage } : {}),
          ...(input.error !== undefined ? { error: toJson(input.error) } : {}),
        })
        .eq('id', runId)
        // Scoped to `running`, so finishing an already-finished run changes nothing.
        .eq('result', 'running');
      if (error !== null) throw new Error(`finish failed: ${error.message}`);
    },

    noSourceStreak: async (day) => {
      const { data, error } = await client.rpc('no_source_streak', { decision_day: day });
      if (error !== null) throw new Error(`noSourceStreak failed: ${error.message}`);
      return typeof data === 'number' ? data : 0;
    },

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
        await ingestChannel({ source, client, limit: 15 });
      } catch (cause) {
        await log({
          code: 'ingest_api_failed',
          level: 'warn',
          stage: 'source',
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }

      const { data, error } = await client.rpc('claim_next_video', {
        fresh_window_days: freshWindowDays,
      });
      if (error !== null) throw new Error(`claim_next_video failed: ${error.message}`);

      const claimed = Array.isArray(data) ? data[0] : null;
      if (claimed !== null && claimed !== undefined) {
        return {
          kind: 'youtube',
          videoId: claimed.id,
          youtubeVideoId: claimed.youtube_video_id,
          title: claimed.title,
        };
      }

      const streak = await self.noSourceStreak(day);
      if (streak < threshold) return { kind: 'none', streak };

      // The dry spell is long enough. The paper is claimed inside the database before any
      // generation call is made, so a duplicate costs one round trip rather than an article.
      const { claimResearchSource } = await import('@/lib/research/select');
      const paper = await claimResearchSource(client, {
        today: day,
        log: (entry) =>
          log({
            code: entry.code,
            stage: 'source',
            ...(entry.level === undefined ? {} : { level: entry.level }),
            ...(entry.message === undefined ? {} : { message: entry.message }),
            ...(entry.context === undefined ? {} : { context: entry.context }),
          }),
      });
      if (paper === null) return { kind: 'none', streak };

      await log({
        code: 'research_selected',
        stage: 'source',
        message: `rank ${paper.rank} of ${paper.poolSize}, score ${paper.score}`,
        context: { researchSourceId: paper.id, score: paper.score, rank: paper.rank },
      });
      return { kind: 'research', researchSourceId: paper.id, title: paper.title };
    },

    generate: async (source, artifacts) => {
      const settings = await self.settings();
      const categories = await loadCategories();
      const hosts = await loadAllowedHosts(client);

      const pipelineSource = await buildPipelineSource(source, client);
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
          allowedReferenceHosts: hosts,
          restrictedTopics: [],
          requireApproval: settings.requireApproval,
          verifyReferences: (urls) => verifyReferences(urls, { client }),
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
      const run = await client
        .from('automation_runs')
        .select('artifacts')
        .eq('id', runId)
        .maybeSingle();
      const artifacts = (run.data?.artifacts ?? {}) as Record<string, unknown>;
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
        ...(await sourceColumns(source, client)),
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
        await client
          .from('youtube_videos')
          .update({ status: 'used', processed_at: hanoi.toISOString() })
          .eq('id', source.videoId);
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
      await queueCampaign(articleId, client);
    },

    log,
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

async function loadAllowedHosts(client: InternalClient): Promise<string[]> {
  const { data } = await client
    .from('automation_settings')
    .select('allowed_reference_hosts')
    .maybeSingle();
  return data?.allowed_reference_hosts ?? [];
}

async function buildPipelineSource(
  source: PublishableSource,
  client: InternalClient,
): Promise<PipelineSource | null> {
  if (source.kind === 'youtube') {
    const { data } = await client
      .from('youtube_videos')
      .select('title, description_clean, description_raw, keywords, duration_seconds, published_at')
      .eq('id', source.videoId)
      .maybeSingle();
    if (data === null || data === undefined) return null;

    // description_clean is normally populated at ingest; recompute if an older row lacks it.
    const clean =
      data.description_clean ??
      (data.description_raw === null ? '' : cleanDescription(data.description_raw).clean);

    return {
      kind: 'youtube',
      title: data.title,
      sourceText: clean,
      keywords: data.keywords,
      durationSeconds: data.duration_seconds,
      publishedAt: data.published_at,
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
  client: InternalClient,
): Promise<SourceColumns> {
  if (source.kind === 'youtube') {
    const { data } = await client
      .from('youtube_videos')
      .select('youtube_video_id, url, title, duration_seconds, published_at, thumbnails')
      .eq('id', source.videoId)
      .maybeSingle();

    const thumbnails = (data?.thumbnails ?? {}) as { best?: string };
    const heroUrl =
      thumbnails.best ?? `https://i.ytimg.com/vi/${data?.youtube_video_id ?? ''}/hqdefault.jpg`;

    return {
      source_video_id: source.videoId,
      source_video_youtube_id: data?.youtube_video_id ?? null,
      source_video_url: data?.url ?? null,
      source_metadata: toJsonObject({
        video_title: data?.title,
        channel_title: SOURCE_CHANNEL.title,
        video_published_at: data?.published_at,
        video_duration_seconds: data?.duration_seconds,
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
