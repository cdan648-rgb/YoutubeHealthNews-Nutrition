/**
 * An in-memory stand-in for the automation gateway's YouTube operations.
 *
 * Only the operations the ingestion orchestrator actually uses are implemented, because a
 * faithful reimplementation of the whole gateway would be a larger and less trustworthy
 * thing than the code under test.
 *
 * What it does model precisely is the two behaviours the tests exist to prove:
 *
 *   * the unique constraint on `youtube_video_id` — a second insert of the same id returns
 *     null (no id), exactly as `INSERT ... ON CONFLICT DO NOTHING RETURNING id` does, so
 *     "run ingestion twice" exercises the same conflict path as production;
 *   * generated columns (`title_fingerprint`, `url`), computed on write from the same
 *     helpers the SQL uses, so a test cannot pass by supplying a fingerprint the real
 *     database would have derived differently.
 *
 * The constraints and the RPC wrappers themselves are separately proven against the real
 * database by the pgTAP suite; this fake exists to test the orchestration around them.
 */
import { titleFingerprint } from '@/lib/slug';
import type { IngestGateway } from '@/lib/youtube/ingest';
import type { LogEntry, YoutubeVideoSlim } from '@/lib/automation/internal-gateway';

type Row = Record<string, unknown>;

export type FakeDb = {
  youtube_videos: Row[];
  job_logs: Row[];
};

export function emptyDb(): FakeDb {
  return { youtube_videos: [], job_logs: [] };
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `00000000-0000-4000-8000-${String(idCounter).padStart(12, '0')}`;
}

/** Seed a video row with the generated columns filled in, as the database would. */
export function seedVideo(
  db: FakeDb,
  row: Partial<Row> & { youtube_video_id: string; title: string },
): Row {
  const full: Row = {
    id: nextId(),
    episode_number: null,
    description_raw: null,
    description_clean: null,
    low_signal: false,
    keywords: [],
    chapters: [],
    duration_seconds: null,
    view_count: null,
    thumbnails: {},
    published_at: '2026-01-01T00:00:00Z',
    discovered_at: '2026-01-01T00:00:00Z',
    processed_at: null,
    status: 'available',
    ineligible_reason: null,
    possible_duplicate_of: null,
    attempt_count: 0,
    ...row,
    // Generated columns, always derived — never taken from the caller.
    title_fingerprint: titleFingerprint(String(row.title)),
    url: `https://www.youtube.com/watch?v=${row.youtube_video_id}`,
  };
  db.youtube_videos.push(full);
  return full;
}

function toSlim(row: Row): YoutubeVideoSlim {
  return {
    id: String(row.id),
    youtubeVideoId: String(row.youtube_video_id),
    titleFingerprint: String(row.title_fingerprint),
    episodeNumber: (row.episode_number as number | null) ?? null,
    status: row.status as YoutubeVideoSlim['status'],
  };
}

/**
 * An `IngestGateway` backed by `db`. The mutation methods manipulate the in-memory rows
 * exactly as the SQL functions manipulate `internal.youtube_videos`.
 */
export function fakeIngestGateway(db: FakeDb): IngestGateway {
  return {
    youtubeExisting: (ids) =>
      Promise.resolve(
        db.youtube_videos.filter((row) => ids.includes(String(row.youtube_video_id))).map(toSlim),
      ),

    youtubeCandidates: () => Promise.resolve(db.youtube_videos.map(toSlim)),

    youtubeInsert: (payload) => {
      const id = String(payload.youtube_video_id);
      if (db.youtube_videos.some((row) => row.youtube_video_id === id)) {
        // The unique constraint. ON CONFLICT DO NOTHING returns no id.
        return Promise.resolve(null);
      }
      const inserted = seedVideo(db, {
        ...payload,
        youtube_video_id: id,
        title: String(payload.title),
      });
      return Promise.resolve(String(inserted.id));
    },

    youtubeUpdateMetadata: (payload) => {
      const id = String(payload.youtube_video_id);
      const row = db.youtube_videos.find((entry) => entry.youtube_video_id === id);
      if (row === undefined) return Promise.resolve(false);
      const { youtube_video_id: _ignored, ...mutable } = payload;
      Object.assign(row, mutable);
      if (typeof row.title === 'string') row.title_fingerprint = titleFingerprint(row.title);
      return Promise.resolve(true);
    },

    youtubeMarkUnavailable: (youtubeVideoId, title) => {
      const row = db.youtube_videos.find((entry) => entry.youtube_video_id === youtubeVideoId);
      if (row === undefined) {
        seedVideo(db, {
          youtube_video_id: youtubeVideoId,
          title,
          status: 'ineligible',
          ineligible_reason: 'unavailable',
        });
      } else if (row.status === 'available') {
        row.status = 'ineligible';
        row.ineligible_reason = 'unavailable';
      }
      return Promise.resolve();
    },

    log: (entry: LogEntry) => {
      db.job_logs.push({ ...entry });
      return Promise.resolve();
    },
  };
}
