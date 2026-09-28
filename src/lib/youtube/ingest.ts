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

import { liveGateway, type AutomationGateway } from '@/lib/automation/internal-gateway';
import { toJsonObject } from '@/lib/json';
import { titleFingerprint } from '@/lib/slug';
import { findProbableDuplicate, normaliseVideo, type DuplicateCandidate } from './eligibility';
import type { IngestOutcome, VideoSource } from './types';

/**
 * The slice of the automation gateway ingestion needs. Narrowed so a test can supply an
 * in-memory double without implementing the whole tick surface.
 */
export type IngestGateway = Pick<
  AutomationGateway,
  | 'youtubeExisting'
  | 'youtubeCandidates'
  | 'youtubeInsert'
  | 'youtubeUpdateMetadata'
  | 'youtubeMarkUnavailable'
  | 'log'
>;

export type IngestOptions = {
  readonly source: VideoSource;
  readonly gateway?: IngestGateway;
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
  const gateway = options.gateway ?? liveGateway();
  const limit = options.limit ?? 50;
  const errors: string[] = [];

  const discovered = await options.source.listUploads(limit);

  if (options.source.kind === 'html-fallback') {
    await gateway.log({
      runId: options.runId ?? null,
      level: 'warn',
      stage: 'ingest',
      code: 'ingest_degraded',
      message: 'ingestion used the HTML fallback rather than the Data API',
      context: { discovered: discovered.length },
    });
  }

  // Which of these do we already have? Determines what needs a details fetch.
  const ids = discovered.map((video) => video.youtubeVideoId);
  const existingRows = await gateway.youtubeExisting(ids);

  const existingById = new Map(existingRows.map((row) => [row.youtubeVideoId, row]));

  const toFetch =
    options.refreshExisting === true ? ids : ids.filter((id) => !existingById.has(id));

  const fetched = toFetch.length === 0 ? [] : await options.source.fetchDetails(toFetch);
  const fetchedIds = new Set(fetched.map((video) => video.youtubeVideoId));

  // Ids we asked for but did not get back are deleted, private or region-blocked. Record
  // them so the gap is explicable rather than mysterious.
  for (const id of toFetch) {
    if (fetchedIds.has(id)) continue;
    errors.push(`no details returned for ${id} (deleted, private or unavailable)`);
    await gateway.youtubeMarkUnavailable(
      id,
      discovered.find((v) => v.youtubeVideoId === id)?.title ?? id,
    );
  }

  // Every candidate a re-upload could collide with — not just the current batch.
  const duplicateCandidates = await loadDuplicateCandidates(gateway);

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
      try {
        await gateway.youtubeUpdateMetadata({
          youtube_video_id: normalised.youtubeVideoId,
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
        });
      } catch (cause) {
        errors.push(
          `update ${normalised.youtubeVideoId}: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
        continue;
      }
      updated += 1;
      continue;
    }

    const duplicate = findProbableDuplicate(
      { title: normalised.title, episodeNumber: normalised.episodeNumber },
      duplicateCandidates,
    );

    let insertedId: string | null;
    try {
      insertedId = await gateway.youtubeInsert({
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
    } catch (cause) {
      errors.push(
        `insert ${normalised.youtubeVideoId}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      continue;
    }

    // A null id means a unique violation: a concurrent run got there first. That is the
    // constraint doing its job, not a failure worth reporting.
    if (insertedId === null) continue;

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
      await gateway.log({
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
      });
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

  await gateway.log({
    runId: options.runId ?? null,
    level: errors.length > 0 ? 'warn' : 'info',
    stage: 'ingest',
    code: 'ingest_completed',
    message: `ingested ${inserted} new, refreshed ${updated}`,
    context: { ...outcome, errors: errors.slice(0, 10) },
  });

  return outcome;
}

/**
 * All rows a re-upload could plausibly duplicate.
 *
 * Fingerprints are generated columns, so they are read rather than recomputed and cannot
 * disagree with the stored titles.
 */
async function loadDuplicateCandidates(gateway: IngestGateway): Promise<DuplicateCandidate[]> {
  const rows = await gateway.youtubeCandidates();
  return rows.map((row) => ({
    id: row.id,
    youtubeVideoId: row.youtubeVideoId,
    titleFingerprint: row.titleFingerprint,
    episodeNumber: row.episodeNumber,
    status: row.status,
  }));
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
 * The underlying SQL function uses FOR UPDATE SKIP LOCKED so two concurrent runs cannot
 * claim the same video.
 */
export async function claimNextVideo(
  freshWindowDays: number,
  gateway: Pick<AutomationGateway, 'claimNextVideo'> = liveGateway(),
): Promise<{ id: string; youtubeVideoId: string; title: string } | null> {
  return gateway.claimNextVideo(freshWindowDays);
}
