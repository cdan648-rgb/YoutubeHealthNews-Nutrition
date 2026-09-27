/**
 * YouTube Data API v3 source. The primary and intended path.
 *
 * Quota arithmetic, since it drives the design: the daily budget is 10,000 units.
 *   playlistItems.list  1 unit per page of up to 50
 *   videos.list         1 unit per call of up to 50 ids
 *   search.list       100 units — and it silently omits videos, so it is never used
 *
 * A daily discovery run therefore costs about 2 units, and a full backfill of the
 * channel's 136 videos costs about 6. Nothing here needs rationing.
 */
import { parseIsoDuration } from './clean';
import { pickBestThumbnail } from './thumbnails';
import type { DiscoveredVideo, FetchedVideo, VideoSource } from './types';

const API_ROOT = 'https://www.googleapis.com/youtube/v3';

/**
 * The uploads playlist id is the channel id with the second character changed.
 * `UC…` → `UU…`. This is a documented, stable property, which is why no extra
 * `channels.list` call is needed to find it.
 */
export function uploadsPlaylistId(channelId: string): string {
  if (!/^UC[A-Za-z0-9_-]{22}$/.test(channelId)) {
    throw new Error(`not a channel id: ${channelId}`);
  }
  return `UU${channelId.slice(2)}`;
}

export class YouTubeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** True for quota exhaustion and rate limiting: retry later, do not treat as fatal. */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'YouTubeApiError';
  }
}

type PlaylistItemsResponse = {
  items?: {
    contentDetails?: { videoId?: string; videoPublishedAt?: string };
    snippet?: { title?: string; publishedAt?: string };
  }[];
  nextPageToken?: string;
};

type VideosResponse = {
  items?: {
    id?: string;
    snippet?: {
      title?: string;
      description?: string;
      publishedAt?: string;
      tags?: string[];
      thumbnails?: Record<string, { url?: string; width?: number; height?: number }>;
    };
    contentDetails?: { duration?: string };
    statistics?: { viewCount?: string };
    liveStreamingDetails?: { actualEndTime?: string; scheduledStartTime?: string };
  }[];
};

export type ApiSourceOptions = {
  readonly apiKey: string;
  readonly channelId: string;
  /** Injected so tests can run without network access. */
  readonly fetchImpl?: typeof fetch;
  /** Injected so tests can skip the HEAD probes. */
  readonly probeThumbnails?: boolean;
};

export function createApiSource(options: ApiSourceOptions): VideoSource {
  const fetchImpl = options.fetchImpl ?? fetch;
  const playlistId = uploadsPlaylistId(options.channelId);

  async function call<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${API_ROOT}/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set('key', options.apiKey);

    const response = await fetchImpl(url, { headers: { accept: 'application/json' } });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      // 403 is overwhelmingly quota exhaustion here; 429 is explicit rate limiting.
      // Both mean "come back later", which is materially different from a 400.
      const retryable =
        response.status === 403 || response.status === 429 || response.status >= 500;
      throw new YouTubeApiError(
        `${path} returned ${response.status}: ${body.slice(0, 300)}`,
        response.status,
        retryable,
      );
    }

    return (await response.json()) as T;
  }

  return {
    kind: 'data-api',

    async listUploads(limit) {
      const discovered: DiscoveredVideo[] = [];
      let pageToken: string | undefined;

      do {
        const page = await call<PlaylistItemsResponse>('playlistItems', {
          part: 'contentDetails,snippet',
          playlistId,
          maxResults: String(Math.min(50, limit - discovered.length)),
          ...(pageToken !== undefined ? { pageToken } : {}),
        });

        for (const item of page.items ?? []) {
          const videoId = item.contentDetails?.videoId;
          const title = item.snippet?.title;
          if (videoId === undefined || title === undefined) continue;
          discovered.push({
            youtubeVideoId: videoId,
            title,
            // videoPublishedAt is when the VIDEO went public; snippet.publishedAt is when
            // it was added to the playlist. For an uploads playlist they normally agree,
            // but the former is the one that means what we want.
            publishedAt: item.contentDetails?.videoPublishedAt ?? item.snippet?.publishedAt ?? null,
          });
        }

        pageToken = page.nextPageToken;
      } while (pageToken !== undefined && discovered.length < limit);

      return discovered.slice(0, limit);
    },

    async fetchDetails(videoIds) {
      const fetched: FetchedVideo[] = [];

      // videos.list accepts 50 ids per call, so a full backfill is a handful of units.
      for (let offset = 0; offset < videoIds.length; offset += 50) {
        const batch = videoIds.slice(offset, offset + 50);
        const page = await call<VideosResponse>('videos', {
          part: 'snippet,contentDetails,statistics,liveStreamingDetails',
          id: batch.join(','),
        });

        for (const item of page.items ?? []) {
          const id = item.id;
          const snippet = item.snippet;
          if (id === undefined || snippet?.title === undefined) continue;

          const live = item.liveStreamingDetails;
          fetched.push({
            youtubeVideoId: id,
            title: snippet.title,
            description: snippet.description ?? '',
            publishedAt: snippet.publishedAt ?? new Date().toISOString(),
            durationSeconds: parseIsoDuration(item.contentDetails?.duration),
            viewCount:
              item.statistics?.viewCount === undefined
                ? null
                : Number.parseInt(item.statistics.viewCount, 10),
            keywords: snippet.tags ?? [],
            thumbnails: await pickBestThumbnail(id, {
              probe: options.probeThumbnails ?? true,
              fetchImpl,
            }),
            // A scheduled or running livestream has no actualEndTime yet.
            liveInProgress: live !== undefined && live.actualEndTime === undefined,
          });
        }
      }

      // Ids absent from the response no longer exist or were made private. Returning
      // fewer rows than requested is the caller's signal, handled in the orchestrator.
      return fetched;
    },
  };
}
