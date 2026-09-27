/**
 * Ingestion orchestrator.
 *
 * Idempotent by construction. Running it twice inserts nothing the second time, because
 * the unique constraint on `youtube_video_id` is the arbiter and the upsert refreshes only
 * mutable metadata. Running it a hundred times cannot resurrect a used video, because the
 * update never touches `status` and a database trigger makes `used` terminal anyway.
 *
 * Two properties are worth stating because they are easy to get wrong:
 *
 *   * `discovered_at` is when WE first saw a video. `published_at` is when the channel
 *     published it. Freshness is judged on `published_at`, so a late backfill does not
 *     make a three-year-old episode look like breaking news.
 *   * an ineligible video is stored with a reason, not skipped. "Why was nothing
 *     published?" has to be answerable from the table.
 */
import 'server-only';

import { logJob } from '@/lib/repositories/automation';
import { internalClient, type InternalClient } from '@/lib/supabase/service';
import { toJsonObject } from '@/lib/json';
import { titleFingerprint } from '@/lib/slug';
import { findProbableDuplicate, normaliseVideo, type DuplicateCandidate } from './eligibility';
import type { IngestOutcome, VideoSource } from './types';

export type IngestOptions = {
  readonly source: VideoSource;
  readonly client?: InternalClient;
  /** How many of the newest uploads to consider. */
  readonly limit?: number;
  /** Fetch details even for videos already stored. Used by a metadata refresh. */
  readonly refreshExisting?: boolean;
  readonly boilerplateMarkers?: readonly string[];
  readonly runId?: string | null;
};

/**
 * Discover, fetch, normalise and upsert.
 *
 * Returns a structured outcome rather than throwing on partial failure: a run that
 * ingested 30 of 50 videos has still made progress worth keeping, and the caller decides
 * whether that is good enough.
 */
export async function ingestChannel(options: IngestOptions): Promise<IngestOutcome> {
  const client = options.client ?? internalClient();
  const limit = options.limit ?? 50;
  const errors: string[] = [];

  const discovered = await options.source.listUploads(limit);

  if (options.source.kind === 'html-fallback') {
    await logJob(
      {
        runId: options.runId ?? null,
        level: 'warn',
        stage: 'ingest',
        code: 'ingest_degraded',
        message: 'ingestion used the HTML fallback rather than the Data API',
        context: { discovered: discovered.length },
      },
      client,
    );
  }

  // Which of these do we already have? Determines what needs a details fetch.
  const ids = discovered.map((video) => video.youtubeVideoId);
  const { data: existingRows, error: existingError } = await client
    .from('youtube_videos')
    .select('id, youtube_video_id, title_fingerprint, episode_number, status')
    .in('youtube_video_id', ids);

  if (existingError !== null) {
    throw new Error(`ingest could not read existing videos: ${existingError.message}`);
  }

  const existingById = new Map((existingRows ?? []).map((row) => [row.youtube_video_id, row]));

  const toFetch =
    options.refreshExisting === true ? ids : ids.filter((id) => !existingById.has(id));

  const fetched = toFetch.length === 0 ? [] : await options.source.fetchDetails(toFetch);
  const fetchedIds = new Set(fetched.map((video) => video.youtubeVideoId));

  // Ids we asked for but did not get back are deleted, private or region-blocked. Record
  // them so the gap is explicable rather than mysterious.
  for (const id of toFetch) {
    if (fetchedIds.has(id)) continue;
    errors.push(`no details returned for ${id} (deleted, private or unavailable)`);
    await markUnavailable(client, id, discovered.find((v) => v.youtubeVideoId === id)?.title ?? id);
  }

  // Every candidate a re-upload could collide with — not just the current batch.
  const duplicateCandidates = await loadDuplicateCandidates(client);

  let inserted = 0;
  let updated = 0;
  let ineligible = 0;
  let possibleDuplicates = 0;

  for (const video of fetched) {
    const normalised = normaliseVideo(video, options.boilerplateMarkers);
    if (!normalised.eligible) ineligible += 1;

    const existing = existingById.get(normalised.youtubeVideoId);

    if (existing !== undefined) {
      // Refresh only what legitimately changes. Notably NOT status: an existing row's
      // lifecycle is owned by the automation, not by ingestion.
      const { error } = await client
        .from('youtube_videos')
        .update({
          title: normalised.title,
          description_raw: normalised.descriptionRaw,
          description_clean: normalised.descriptionClean,
          low_signal: normalised.lowSignal,
          keywords: [...normalised.keywords],
          chapters: toJsonObject({ items: normalised.chapters }).items ?? [],
          duration_seconds: normalised.durationSeconds,
          view_count: normalised.viewCount,
          thumbnails: toJsonObject(normalised.thumbnails),
          episode_number: normalised.episodeNumber,
        })
        .eq('youtube_video_id', normalised.youtubeVideoId);

      if (error !== null) {
        errors.push(`update ${normalised.youtubeVideoId}: ${error.message}`);
        continue;
      }
      updated += 1;
      continue;
    }

    const duplicate = findProbableDuplicate(
      { title: normalised.title, episodeNumber: normalised.episodeNumber },
      duplicateCandidates,
    );

    const { error } = await client.from('youtube_videos').insert({
      youtube_video_id: normalised.youtubeVideoId,
      title: normalised.title,
      episode_number: normalised.episodeNumber,
      description_raw: normalised.descriptionRaw,
      description_clean: normalised.descriptionClean,
      low_signal: normalised.lowSignal,
      keywords: [...normalised.keywords],
      chapters: toJsonObject({ items: normalised.chapters }).items ?? [],
      duration_seconds: normalised.durationSeconds,
      view_count: normalised.viewCount,
      thumbnails: toJsonObject(normalised.thumbnails),
      published_at: normalised.publishedAt,
      status: normalised.eligible ? 'available' : 'ineligible',
      ineligible_reason: normalised.ineligibleReason,
      ...(duplicate !== null ? { possible_duplicate_of: duplicate.id } : {}),
    });

    if (error !== null) {
      // A unique violation means a concurrent run got there first. That is the
      // constraint doing its job, not a failure worth reporting.
      if (error.code !== '23505') {
        errors.push(`insert ${normalised.youtubeVideoId}: ${error.message}`);
      }
      continue;
    }

    inserted += 1;

    if (duplicate !== null) {
      possibleDuplicates += 1;
      // Newly inserted rows can collide with each other within one run, so the candidate
      // list grows as we go.
      duplicateCandidates.push({
        id: duplicate.id,
        youtubeVideoId: normalised.youtubeVideoId,
        titleFingerprint: titleFingerprint(normalised.title),
        episodeNumber: normalised.episodeNumber,
        status: 'available',
      });
      await logJob(
        {
          runId: options.runId ?? null,
          level: 'warn',
          stage: 'ingest',
          code: 'possible_duplicate_video',
          message: `${normalised.youtubeVideoId} looks like a re-upload of ${duplicate.youtubeVideoId}`,
          context: {
            candidate: normalised.youtubeVideoId,
            existing: duplicate.youtubeVideoId,
            episodeNumber: normalised.episodeNumber,
          },
        },
        client,
      );
    }
  }

  const outcome: IngestOutcome = {
    source: options.source.kind,
    discovered: discovered.length,
    inserted,
    updated,
    ineligible,
    possibleDuplicates,
    errors,
  };

  await logJob(
    {
      runId: options.runId ?? null,
      level: errors.length > 0 ? 'warn' : 'info',
      stage: 'ingest',
      code: 'ingest_completed',
      message: `ingested ${inserted} new, refreshed ${updated}`,
      context: { ...outcome, errors: errors.slice(0, 10) },
    },
    client,
  );

  return outcome;
}

/**
 * All rows a re-upload could plausibly duplicate.
 *
 * Fingerprints are generated columns, so they are read rather than recomputed and cannot
 * disagree with the stored titles.
 */
async function loadDuplicateCandidates(client: InternalClient): Promise<DuplicateCandidate[]> {
  const { data, error } = await client
    .from('youtube_videos')
    .select('id, youtube_video_id, title_fingerprint, episode_number, status');

  if (error !== null) throw new Error(`could not load duplicate candidates: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    youtubeVideoId: row.youtube_video_id,
    titleFingerprint: row.title_fingerprint,
    episodeNumber: row.episode_number,
    status: row.status,
  }));
}

/**
 * Record a video that has disappeared.
 *
 * Only ever creates a row or marks an untouched one ineligible. A video already `used`
 * keeps its status: the article derived from it still exists and still credits it, so
 * rewriting history because the source was taken down would be wrong.
 */
async function markUnavailable(
  client: InternalClient,
  youtubeVideoId: string,
  title: string,
): Promise<void> {
  const { data: existing } = await client
    .from('youtube_videos')
    .select('status')
    .eq('youtube_video_id', youtubeVideoId)
    .maybeSingle();

  if (existing === null || existing === undefined) {
    await client.from('youtube_videos').insert({
      youtube_video_id: youtubeVideoId,
      title,
      published_at: new Date().toISOString(),
      status: 'ineligible',
      ineligible_reason: 'unavailable',
    });
    return;
  }

  if (existing.status === 'available') {
    await client
      .from('youtube_videos')
      .update({ status: 'ineligible', ineligible_reason: 'unavailable' })
      .eq('youtube_video_id', youtubeVideoId)
      .eq('status', 'available');
  }
}

/**
 * The next video the automation should turn into an article, claimed atomically.
 *
 * Ordering is the whole of the priority policy:
 *   1. videos published inside the fresh window, newest first — so a new upload wins,
 *      and several uploads on one day are consumed newest-first over following days
 *      while still outranking the archive;
 *   2. then the rest of the backlog by view count, best content first.
 *
 * `select_next_video` is a SQL function using FOR UPDATE SKIP LOCKED so two concurrent
 * runs cannot claim the same video. Without that, both would read the same row before
 * either wrote.
 */
export async function claimNextVideo(
  freshWindowDays: number,
  client: InternalClient = internalClient(),
): Promise<{ id: string; youtubeVideoId: string; title: string } | null> {
  const { data, error } = await client.rpc('claim_next_video', {
    fresh_window_days: freshWindowDays,
  });

  if (error !== null) throw new Error(`claimNextVideo failed: ${error.message}`);

  const row = Array.isArray(data) ? data[0] : data;
  if (row === null || row === undefined) return null;

  const claimed = row;
  return { id: claimed.id, youtubeVideoId: claimed.youtube_video_id, title: claimed.title };
}
