/**
 * Tests for both ingestion sources.
 *
 * No network: the Data API source is driven by a stubbed `fetch` returning the real
 * response shapes, and the fallback parser runs against compact HTML fixtures extracted
 * from the genuine pages (same nesting, same field names, three entries instead of 100).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { YouTubeApiError, createApiSource, uploadsPlaylistId } from './api';
import {
  FallbackParseError,
  extractEmbeddedJson,
  parseUploadsListing,
  parseWatchPage,
} from './fallback';
import { thumbnailUrl } from './thumbnails';

const FIXTURES = join(process.cwd(), 'tests', 'fixtures', 'youtube');
const listingHtml = readFileSync(join(FIXTURES, 'listing-page.html'), 'utf8');
const watchHtml = readFileSync(join(FIXTURES, 'watch-page.html'), 'utf8');

const CHANNEL = 'UC79E6KatRfXbmdWVWGncsew';
/**
 * A typed `fetch` stub.
 *
 * Avoids three lint traps in one place: `String(input)` on a `Request` would stringify to
 * "[object Object]", an `async` arrow with no `await` is flagged, and casting through
 * `unknown` to `typeof fetch` is an unnecessary assertion.
 */
type Handler = (url: URL, call: number) => Response;

function stubFetch(handler: Handler): typeof fetch {
  let calls = 0;
  const impl = (input: RequestInfo | URL): Promise<Response> => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls += 1;
    return Promise.resolve(handler(new URL(href), calls));
  };
  return impl;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('uploadsPlaylistId', () => {
  it('derives UU… from UC…, avoiding a channels.list call', () => {
    expect(uploadsPlaylistId(CHANNEL)).toBe('UU79E6KatRfXbmdWVWGncsew');
  });

  it('rejects anything that is not a channel id', () => {
    for (const bad of ['UU79E6KatRfXbmdWVWGncsew', '@handle', 'UC-too-short', '']) {
      expect(() => uploadsPlaylistId(bad)).toThrow();
    }
  });
});

describe('Data API source', () => {
  it('paginates playlistItems and prefers videoPublishedAt', () => {
    const calls: string[] = [];
    const fetchImpl = stubFetch((url) => {
      calls.push(url.pathname + (url.searchParams.get('pageToken') ?? ''));
      if (url.searchParams.get('pageToken') === null) {
        return jsonResponse({
          items: [
            {
              contentDetails: { videoId: 'aaaaaaaaaaa', videoPublishedAt: '2026-09-19T02:00:07Z' },
              snippet: { title: 'Số 132', publishedAt: '2026-09-25T00:00:00Z' },
            },
          ],
          nextPageToken: 'page2',
        });
      }
      return jsonResponse({
        items: [
          {
            contentDetails: { videoId: 'bbbbbbbbbbb' },
            snippet: { title: 'Số 131', publishedAt: '2026-09-12T02:00:00Z' },
          },
        ],
      });
    });

    const source = createApiSource({
      apiKey: 'test-key',
      channelId: CHANNEL,
      fetchImpl,
      probeThumbnails: false,
    });

    return source.listUploads(50).then((videos) => {
      expect(videos).toHaveLength(2);
      // videoPublishedAt is when the video went public; snippet.publishedAt is when it was
      // added to the playlist. The former is the one that means what we want.
      expect(videos[0]?.publishedAt).toBe('2026-09-19T02:00:07Z');
      // Falls back to snippet.publishedAt only when the better field is missing.
      expect(videos[1]?.publishedAt).toBe('2026-09-12T02:00:00Z');
      expect(calls).toHaveLength(2);
    });
  });

  it('requests details in batches of 50, keeping quota at a few units', async () => {
    const batches: number[] = [];
    const fetchImpl = stubFetch((url) => {
      const ids = (url.searchParams.get('id') ?? '').split(',').filter(Boolean);
      batches.push(ids.length);
      return jsonResponse({
        items: ids.map((id) => ({
          id,
          snippet: {
            title: `T ${id}`,
            description: 'd',
            publishedAt: '2026-01-01T00:00:00Z',
            tags: [],
          },
          contentDetails: { duration: 'PT3H22M44S' },
          statistics: { viewCount: '1234' },
        })),
      });
    });

    const source = createApiSource({
      apiKey: 'k',
      channelId: CHANNEL,
      fetchImpl,
      probeThumbnails: false,
    });

    const ids = Array.from({ length: 120 }, (_, i) => `v${String(i).padStart(10, '0')}`);
    const details = await source.fetchDetails(ids);

    expect(details).toHaveLength(120);
    expect(batches).toStrictEqual([50, 50, 20]);
    expect(details[0]?.durationSeconds).toBe(12164);
    expect(details[0]?.viewCount).toBe(1234);
  });

  it('marks quota exhaustion and rate limiting as retryable, a 400 as not', async () => {
    const make = (status: number) =>
      createApiSource({
        apiKey: 'k',
        channelId: CHANNEL,
        probeThumbnails: false,
        fetchImpl: stubFetch(() => new Response('boom', { status })),
      });

    for (const status of [403, 429, 500]) {
      await expect(make(status).listUploads(5)).rejects.toMatchObject({
        name: 'YouTubeApiError',
        retryable: true,
      });
    }
    await expect(make(400).listUploads(5)).rejects.toMatchObject({ retryable: false });
    expect(new YouTubeApiError('x', 403, true).retryable).toBe(true);
  });

  it('omits videos whose ids came back empty rather than inventing rows', async () => {
    const source = createApiSource({
      apiKey: 'k',
      channelId: CHANNEL,
      probeThumbnails: false,
      // Asked for three, YouTube returns one: the others are deleted or private.
      fetchImpl: stubFetch(() =>
        jsonResponse({
          items: [
            {
              id: 'aaaaaaaaaaa',
              snippet: { title: 'Alive', description: '', publishedAt: '2026-01-01T00:00:00Z' },
            },
          ],
        }),
      ),
    });

    const details = await source.fetchDetails(['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']);
    expect(details.map((d) => d.youtubeVideoId)).toStrictEqual(['aaaaaaaaaaa']);
  });

  it('treats a still-running livestream as live', async () => {
    const source = createApiSource({
      apiKey: 'k',
      channelId: CHANNEL,
      probeThumbnails: false,
      fetchImpl: stubFetch(() =>
        jsonResponse({
          items: [
            {
              id: 'aaaaaaaaaaa',
              snippet: { title: 'Live', description: '', publishedAt: '2026-01-01T00:00:00Z' },
              liveStreamingDetails: { scheduledStartTime: '2026-01-01T00:00:00Z' },
            },
            {
              id: 'bbbbbbbbbbb',
              snippet: { title: 'Ended', description: '', publishedAt: '2026-01-01T00:00:00Z' },
              liveStreamingDetails: { actualEndTime: '2026-01-01T05:00:00Z' },
            },
          ],
        }),
      ),
    });

    const details = await source.fetchDetails(['aaaaaaaaaaa', 'bbbbbbbbbbb']);
    expect(details[0]?.liveInProgress).toBe(true);
    expect(details[1]?.liveInProgress).toBe(false);
  });
});

describe('HTML fallback parser', () => {
  it('brace-matches embedded JSON rather than regex-matching it', () => {
    // A lazy regex would stop at the "};" inside the string value.
    const html = 'x var ytInitialData = {"a":"};","b":{"c":1}}; more';
    expect(extractEmbeddedJson(html, 'var ytInitialData = ')).toStrictEqual({
      a: '};',
      b: { c: 1 },
    });
  });

  it('throws a typed error for a missing or unterminated payload', () => {
    expect(() => extractEmbeddedJson('nothing here', 'var ytInitialData = ')).toThrow(
      FallbackParseError,
    );
    expect(() => extractEmbeddedJson('var ytInitialData = {"a":1', 'var ytInitialData = ')).toThrow(
      FallbackParseError,
    );
  });

  it('parses the real lockupViewModel listing shape', () => {
    const videos = parseUploadsListing(listingHtml);
    expect(videos).toHaveLength(3);
    expect(videos[0]?.youtubeVideoId).toBe('-ZFkrC79LNM');
    expect(videos[0]?.title).toContain('Silic và Boron');
    expect(videos[1]?.youtubeVideoId).toBe('lBKtncuS0yY');
    // A listing gives only a relative date, so the exact instant must come from elsewhere.
    expect(videos[0]?.publishedAt).toBeNull();
  });

  it('also parses the older videoRenderer shape', () => {
    // YouTube already changed this format once; supporting both is why the fallback
    // survived that change.
    const legacy = `var ytInitialData = ${JSON.stringify({
      contents: [{ videoRenderer: { videoId: 'ccccccccccc', title: { runs: [{ text: 'Cũ' }] } } }],
    })};`;
    const videos = parseUploadsListing(legacy);
    expect(videos).toStrictEqual([
      { youtubeVideoId: 'ccccccccccc', title: 'Cũ', publishedAt: null },
    ]);
  });

  it('throws rather than silently returning an empty channel', () => {
    // An empty result would look like "the channel has no videos", which would quietly
    // stop publishing. Failing loudly is correct.
    expect(() => parseUploadsListing('var ytInitialData = {"contents":[]};')).toThrow(
      FallbackParseError,
    );
  });

  it('parses a real watch page into full metadata', () => {
    const video = parseWatchPage(watchHtml);
    expect(video.youtubeVideoId).toBe('hkP4Heyobuc');
    expect(video.title).toContain('Kỹ thuật thở 4 - 7 - 8');
    expect(video.durationSeconds).toBe(12065);
    expect(video.viewCount).toBe(222488);
    expect(video.description).toContain('sóng Delta');
    // 19:00 on 3 July Pacific is 2 July 02:00Z... the point is it round-trips to an
    // instant rather than staying a display string.
    expect(video.publishedAt).toMatch(/^2026-07-0\dT/);
    expect(video.liveInProgress).toBe(false);
  });
});

describe('thumbnails', () => {
  it('builds ytimg URLs that our srcset regex recognises', () => {
    expect(thumbnailUrl('hkP4Heyobuc', 'maxresdefault.jpg')).toBe(
      'https://i.ytimg.com/vi/hkP4Heyobuc/maxresdefault.jpg',
    );
  });
});
