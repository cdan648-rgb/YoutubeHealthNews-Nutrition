/**
 * Ingestion orchestration: the idempotency and duplicate-handling behaviour.
 *
 * Driven by real captured metadata against an in-memory database. The database
 * constraints themselves are proven separately by the pgTAP suite; what is under test
 * here is the orchestration around them — that a second run inserts nothing, that a used
 * video is never resurrected, and that freshness is judged on the video's publish date
 * rather than on when we happened to look.
 */
import { describe, expect, it } from 'vitest';
import { ingestChannel } from './ingest';
import type { DiscoveredVideo, FetchedVideo, VideoSource } from './types';
import {
  emptyDb,
  fakeIngestGateway,
  seedVideo,
  type FakeDb,
} from '../../../tests/helpers/fake-internal-client';
import { loadVideoFixture, VIDEO_FIXTURE_IDS, type VideoFixtureId } from '../../../tests/fixtures';

/** A source backed by the captured fixtures. Counts calls so we can assert on traffic. */
function fixtureSource(
  ids: readonly VideoFixtureId[],
  options: { kind?: 'data-api' | 'html-fallback'; omit?: readonly string[] } = {},
): VideoSource & { calls: { list: number; details: string[][] } } {
  const calls = { list: 0, details: [] as string[][] };
  const omit = new Set(options.omit ?? []);

  return {
    kind: options.kind ?? 'data-api',
    calls,
    // eslint-disable-next-line @typescript-eslint/require-await -- satisfies the async interface
    async listUploads(limit: number): Promise<DiscoveredVideo[]> {
      calls.list += 1;
      return ids.slice(0, limit).map((id) => {
        const fixture = loadVideoFixture(id);
        return {
          youtubeVideoId: fixture.videoId,
          title: fixture.title,
          publishedAt: new Date(fixture.publishDate).toISOString(),
        };
      });
    },
    // eslint-disable-next-line @typescript-eslint/require-await -- satisfies the async interface
    async fetchDetails(videoIds: readonly string[]): Promise<FetchedVideo[]> {
      calls.details.push([...videoIds]);
      return videoIds
        .filter((id) => !omit.has(id))
        .map((id) => {
          const fixture = loadVideoFixture(id as VideoFixtureId);
          return {
            youtubeVideoId: fixture.videoId,
            title: fixture.title,
            description: fixture.description,
            publishedAt: new Date(fixture.publishDate).toISOString(),
            durationSeconds: fixture.lengthSeconds,
            viewCount: fixture.viewCount,
            keywords: fixture.keywords,
            thumbnails: { best: null, variants: {} },
            liveInProgress: false,
          };
        });
    },
  };
}

async function ingest(db: FakeDb, source: VideoSource) {
  return ingestChannel({ source, gateway: fakeIngestGateway(db), limit: 50 });
}

describe('ingesting the channel for the first time', () => {
  it('inserts every discovered video with cleaned metadata', async () => {
    const db = emptyDb();
    const outcome = await ingest(db, fixtureSource(VIDEO_FIXTURE_IDS));

    expect(outcome.discovered).toBe(6);
    expect(outcome.inserted).toBe(6);
    expect(outcome.updated).toBe(0);
    expect(outcome.errors).toStrictEqual([]);
    expect(db.youtube_videos).toHaveLength(6);

    const magnesium = db.youtube_videos.find((row) => row.youtube_video_id === 'An4HFu4EwFQ');
    expect(magnesium?.status).toBe('available');
    expect(magnesium?.episode_number).toBe(118);
    expect(String(magnesium?.description_clean)).not.toContain('QUÝ KHÁN GIẢ LƯU Ý');
    expect(magnesium?.duration_seconds).toBe(12164);
  });

  it('records the publish date from the channel, not the time of ingestion', async () => {
    const db = emptyDb();
    await ingest(db, fixtureSource(['An4HFu4EwFQ']));
    const row = db.youtube_videos[0];
    // Freshness is judged on this. If ingestion stamped "now", a backfill would make the
    // whole archive look like breaking news.
    expect(row?.published_at).toBe(
      new Date(loadVideoFixture('An4HFu4EwFQ').publishDate).toISOString(),
    );
    expect(String(row?.published_at).startsWith('2026-06')).toBe(true);
  });
});

describe('running ingestion twice', () => {
  it('inserts nothing the second time', async () => {
    const db = emptyDb();
    const first = await ingest(db, fixtureSource(VIDEO_FIXTURE_IDS));
    const second = await ingest(db, fixtureSource(VIDEO_FIXTURE_IDS));

    expect(first.inserted).toBe(6);
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(0);
    expect(db.youtube_videos).toHaveLength(6);
  });

  it('does not even fetch details for videos it already has', async () => {
    // The quota saving is incidental; the point is that a repeat run is cheap enough to
    // schedule as often as we like.
    const db = emptyDb();
    await ingest(db, fixtureSource(VIDEO_FIXTURE_IDS));

    const source = fixtureSource(VIDEO_FIXTURE_IDS);
    await ingest(db, source);
    expect(source.calls.details).toStrictEqual([]);
  });

  it('never resurrects a used video', async () => {
    const db = emptyDb();
    await ingest(db, fixtureSource(VIDEO_FIXTURE_IDS));

    // Simulate the automation having published from this one.
    const used = db.youtube_videos.find((row) => row.youtube_video_id === 'An4HFu4EwFQ');
    if (used !== undefined) {
      used.status = 'used';
      used.processed_at = '2026-09-25T04:00:00Z';
    }

    await ingest(db, fixtureSource(VIDEO_FIXTURE_IDS, {}));
    await ingestChannel({
      source: fixtureSource(VIDEO_FIXTURE_IDS),
      gateway: fakeIngestGateway(db),
      refreshExisting: true,
    });

    const after = db.youtube_videos.find((row) => row.youtube_video_id === 'An4HFu4EwFQ');
    expect(after?.status).toBe('used');
    expect(after?.processed_at).toBe('2026-09-25T04:00:00Z');
  });

  it('refreshes mutable metadata but leaves lifecycle columns alone', async () => {
    const db = emptyDb();
    await ingest(db, fixtureSource(['An4HFu4EwFQ']));

    const before = db.youtube_videos[0];
    expect(before?.view_count).toBe(424298);
    // Mark it selected, as the automation would mid-run.
    if (before !== undefined) before.status = 'selected';

    // A refresh run sees a higher view count, as it would in reality.
    const source = fixtureSource(['An4HFu4EwFQ']);
    const originalFetch = source.fetchDetails.bind(source);
    source.fetchDetails = async (ids) => {
      const details = await originalFetch(ids);
      return details.map((video) => ({ ...video, viewCount: 999999 }));
    };

    const outcome = await ingestChannel({
      source,
      gateway: fakeIngestGateway(db),
      refreshExisting: true,
    });

    expect(outcome.updated).toBe(1);
    expect(outcome.inserted).toBe(0);
    const after = db.youtube_videos[0];
    expect(after?.view_count).toBe(999999);
    // Lifecycle is owned by the automation, not by ingestion.
    expect(after?.status).toBe('selected');
  });
});

describe('several uploads arriving at once', () => {
  it('stores them all as available for the coming days', async () => {
    const db = emptyDb();
    const outcome = await ingest(db, fixtureSource(['lBKtncuS0yY', 'cI74O0zS5QI', 'nfNvuW2lQkI']));

    expect(outcome.inserted).toBe(3);
    // None is consumed at ingest time; selection is a separate, later decision, which is
    // what leaves the extras in the backlog rather than discarding them.
    expect(db.youtube_videos.every((row) => row.status === 'available')).toBe(true);
  });
});

describe('an old archive import', () => {
  it('does not mark decade-old videos as fresh', async () => {
    const db = emptyDb();
    const source = fixtureSource(['An4HFu4EwFQ']);
    const originalFetch = source.fetchDetails.bind(source);
    source.fetchDetails = async (ids) => {
      const details = await originalFetch(ids);
      return details.map((video) => ({ ...video, publishedAt: '2019-03-01T00:00:00Z' }));
    };

    await ingestChannel({ source, gateway: fakeIngestGateway(db) });

    const row = db.youtube_videos[0];
    expect(row?.published_at).toBe('2019-03-01T00:00:00Z');
    // discovered_at is today, published_at is 2019. The selection query orders on
    // published_at, so this cannot masquerade as a new upload.
    expect(String(row?.discovered_at) > String(row?.published_at)).toBe(true);
  });
});

describe('a re-upload under a new id', () => {
  it('is flagged against the used original and kept out of selection', async () => {
    const db = emptyDb();
    // An article already exists for episode 118.
    seedVideo(db, {
      youtube_video_id: 'An4HFu4EwFQ',
      title: loadVideoFixture('An4HFu4EwFQ').title,
      episode_number: 118,
      status: 'used',
    });

    const reupload: VideoSource = {
      kind: 'data-api',
      // eslint-disable-next-line @typescript-eslint/require-await -- interface
      async listUploads() {
        return [
          {
            youtubeVideoId: 'zzzzzzzzzzz',
            title: 'Số 118: Thiếu magie cơ thể sụp đổ (đăng lại)',
            publishedAt: '2026-09-26T02:00:00Z',
          },
        ];
      },
      // eslint-disable-next-line @typescript-eslint/require-await -- interface
      async fetchDetails() {
        const fixture = loadVideoFixture('An4HFu4EwFQ');
        return [
          {
            youtubeVideoId: 'zzzzzzzzzzz',
            title: 'Số 118: Thiếu magie cơ thể sụp đổ (đăng lại)',
            description: fixture.description,
            publishedAt: '2026-09-26T02:00:00Z',
            durationSeconds: fixture.lengthSeconds,
            viewCount: 10,
            keywords: [],
            thumbnails: { best: null, variants: {} },
            liveInProgress: false,
          },
        ];
      },
    };

    const outcome = await ingest(db, reupload);

    expect(outcome.inserted).toBe(1);
    expect(outcome.possibleDuplicates).toBe(1);

    const flagged = db.youtube_videos.find((row) => row.youtube_video_id === 'zzzzzzzzzzz');
    // Excluded from selection by possible_duplicate_of, but not deleted: a legitimate
    // "Part 2" must be recoverable by review rather than permanently lost.
    expect(flagged?.possible_duplicate_of).toBeTruthy();
    expect(flagged?.status).toBe('available');
    expect(db.job_logs.some((log) => log.code === 'possible_duplicate_video')).toBe(true);
  });
});

describe('a video that has been deleted or made private', () => {
  it('is recorded as unavailable rather than silently missing', async () => {
    const db = emptyDb();
    const outcome = await ingest(
      db,
      fixtureSource(['An4HFu4EwFQ', 'lBKtncuS0yY'], { omit: ['lBKtncuS0yY'] }),
    );

    expect(outcome.inserted).toBe(1);
    expect(outcome.errors.some((error) => error.includes('lBKtncuS0yY'))).toBe(true);

    const gone = db.youtube_videos.find((row) => row.youtube_video_id === 'lBKtncuS0yY');
    expect(gone?.status).toBe('ineligible');
    expect(gone?.ineligible_reason).toBe('unavailable');
  });

  it('leaves a used video alone even if it disappears from YouTube', async () => {
    // The article still exists and still credits the video, so rewriting its status
    // because the source was taken down would misrepresent our own history.
    const db = emptyDb();
    seedVideo(db, {
      youtube_video_id: 'lBKtncuS0yY',
      title: 'Số 132',
      status: 'used',
      processed_at: '2026-09-20T04:00:00Z',
    });

    await ingestChannel({
      source: fixtureSource(['lBKtncuS0yY'], { omit: ['lBKtncuS0yY'] }),
      gateway: fakeIngestGateway(db),
      refreshExisting: true,
    });

    const row = db.youtube_videos[0];
    expect(row?.status).toBe('used');
    expect(row?.ineligible_reason).toBeNull();
  });
});

describe('ineligible videos', () => {
  it('are stored with a reason instead of being dropped', async () => {
    const db = emptyDb();
    const placeholder: VideoSource = {
      kind: 'data-api',
      // eslint-disable-next-line @typescript-eslint/require-await -- interface
      async listUploads() {
        return [
          {
            youtubeVideoId: 'ilVWYjEcr5c',
            title: 'Thuốc kích thích rau củ quả có nguy hiểm không? – coming soon',
            publishedAt: '2026-01-01T00:00:00Z',
          },
        ];
      },
      // eslint-disable-next-line @typescript-eslint/require-await -- interface
      async fetchDetails() {
        return [
          {
            youtubeVideoId: 'ilVWYjEcr5c',
            title: 'Thuốc kích thích rau củ quả có nguy hiểm không? – coming soon',
            description: 'x'.repeat(600),
            publishedAt: '2026-01-01T00:00:00Z',
            durationSeconds: 3000,
            viewCount: 0,
            keywords: [],
            thumbnails: { best: null, variants: {} },
            liveInProgress: false,
          },
        ];
      },
    };

    const outcome = await ingest(db, placeholder);
    expect(outcome.ineligible).toBe(1);

    const row = db.youtube_videos[0];
    expect(row?.status).toBe('ineligible');
    expect(row?.ineligible_reason).toBe('placeholder');
  });
});

describe('observability', () => {
  it('logs completion with the source that was used', async () => {
    const db = emptyDb();
    await ingest(db, fixtureSource(['An4HFu4EwFQ']));
    const log = db.job_logs.find((entry) => entry.code === 'ingest_completed');
    expect(log).toBeDefined();
    expect(log?.level).toBe('info');
  });

  it('records a warning when the degraded fallback was used', async () => {
    // A run that relied on scraping must be visible, not silently equivalent.
    const db = emptyDb();
    await ingest(db, fixtureSource(['An4HFu4EwFQ'], { kind: 'html-fallback' }));
    const degraded = db.job_logs.find((entry) => entry.code === 'ingest_degraded');
    expect(degraded).toBeDefined();
    expect(degraded?.level).toBe('warn');
  });
});
