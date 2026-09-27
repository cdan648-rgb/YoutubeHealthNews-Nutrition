/**
 * Degraded HTML source. NOT the primary path.
 *
 * This exists only so a missing API key or an exhausted quota degrades the service
 * instead of stopping it. Every use is recorded as `ingest_degraded` in `job_logs`, so a
 * run that relied on it is visible rather than silently different.
 *
 * It parses the `ytInitialData` / `ytInitialPlayerResponse` payloads embedded in YouTube's
 * own pages. That is undocumented and can change without notice — it already has: the
 * listing format moved from `videoRenderer` to `lockupViewModel`, which is why the parser
 * accepts both. Treat any failure here as expected, never as an outage.
 *
 * Deliberately NOT used for bulk work. Discovery reads one listing page; details are
 * fetched per video only for videos about to be processed, with a delay between requests.
 */
import { parseIsoDuration } from './clean';
import { pickBestThumbnail } from './thumbnails';
import type { DiscoveredVideo, FetchedVideo, VideoSource } from './types';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export class FallbackParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FallbackParseError';
  }
}

/** Pull an embedded JSON object out of a YouTube page by its assignment prefix. */
export function extractEmbeddedJson(html: string, marker: string): unknown {
  const start = html.indexOf(marker);
  if (start === -1) throw new FallbackParseError(`marker not found: ${marker}`);

  const jsonStart = start + marker.length;
  // Brace matching rather than a regex: the payload contains braces inside strings, so
  // a lazy regex terminates in the wrong place.
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = jsonStart; i < html.length; i += 1) {
    const char = html[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(html.slice(jsonStart, i + 1)) as unknown;
      }
    }
  }

  throw new FallbackParseError(`unterminated JSON after ${marker}`);
}

/** Walk an arbitrary object tree collecting every node that has the given key. */
function collect(node: unknown, key: string, out: Record<string, unknown>[]): void {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, key, out);
    return;
  }
  if (node === null || typeof node !== 'object') return;

  const record = node as Record<string, unknown>;
  const hit = record[key];
  if (hit !== null && typeof hit === 'object') out.push(hit as Record<string, unknown>);
  for (const child of Object.values(record)) collect(child, key, out);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Parse a uploads/videos listing page.
 *
 * Handles both the current `lockupViewModel` shape and the older `videoRenderer` one, so
 * a format flip does not take the fallback down with it.
 */
export function parseUploadsListing(html: string): DiscoveredVideo[] {
  const data = extractEmbeddedJson(html, 'var ytInitialData = ');
  const found: DiscoveredVideo[] = [];
  const seen = new Set<string>();

  const lockups: Record<string, unknown>[] = [];
  collect(data, 'lockupViewModel', lockups);
  for (const lockup of lockups) {
    const id = asString(lockup.contentId);
    const metadata = lockup.metadata as Record<string, unknown> | undefined;
    const inner = metadata?.lockupMetadataViewModel as Record<string, unknown> | undefined;
    const title = asString((inner?.title as Record<string, unknown> | undefined)?.content);
    if (id === null || title === null || seen.has(id)) continue;
    seen.add(id);
    // A listing page gives only a relative date ("2 weeks ago"), which is not good enough
    // for a publishing calendar. The exact instant comes from the watch page.
    found.push({ youtubeVideoId: id, title, publishedAt: null });
  }

  const renderers: Record<string, unknown>[] = [];
  collect(data, 'videoRenderer', renderers);
  for (const renderer of renderers) {
    const id = asString(renderer.videoId);
    const titleNode = renderer.title as Record<string, unknown> | undefined;
    const runs = titleNode?.runs as { text?: string }[] | undefined;
    const title =
      asString(titleNode?.simpleText) ?? runs?.map((r) => r.text ?? '').join('') ?? null;
    if (id === null || title === null || title === '' || seen.has(id)) continue;
    seen.add(id);
    found.push({ youtubeVideoId: id, title, publishedAt: null });
  }

  if (found.length === 0) {
    throw new FallbackParseError('listing page contained no recognisable video entries');
  }
  return found;
}

/** Parse a watch page for the metadata the listing cannot supply. */
export function parseWatchPage(html: string): Omit<FetchedVideo, 'thumbnails'> {
  const player = extractEmbeddedJson(html, 'var ytInitialPlayerResponse = ') as Record<
    string,
    unknown
  >;

  const details = player.videoDetails as Record<string, unknown> | undefined;
  const microformat = (player.microformat as Record<string, unknown> | undefined)
    ?.playerMicroformatRenderer as Record<string, unknown> | undefined;

  const videoId = asString(details?.videoId);
  const title = asString(details?.title);
  if (videoId === null || title === null) {
    throw new FallbackParseError('watch page contained no videoDetails');
  }

  const lengthSeconds = asString(details?.lengthSeconds);
  const viewCount = asString(details?.viewCount);
  const publishDate = asString(microformat?.publishDate) ?? asString(microformat?.uploadDate);

  return {
    youtubeVideoId: videoId,
    title,
    description: asString(details?.shortDescription) ?? '',
    publishedAt:
      publishDate === null ? new Date().toISOString() : new Date(publishDate).toISOString(),
    durationSeconds:
      lengthSeconds === null
        ? parseIsoDuration(asString(microformat?.duration))
        : Number.parseInt(lengthSeconds, 10),
    viewCount: viewCount === null ? null : Number.parseInt(viewCount, 10),
    keywords: Array.isArray(details?.keywords) ? (details.keywords as string[]) : [],
    liveInProgress:
      details?.isLiveContent === true && microformat?.liveBroadcastDetails !== undefined,
  };
}

export type FallbackOptions = {
  readonly channelHandle: string;
  readonly fetchImpl?: typeof fetch;
  /** Delay between watch-page requests. Politeness, not performance. */
  readonly requestDelayMs?: number;
  readonly probeThumbnails?: boolean;
};

export function createFallbackSource(options: FallbackOptions): VideoSource {
  const fetchImpl = options.fetchImpl ?? fetch;
  const delayMs = options.requestDelayMs ?? 1200;

  async function getHtml(url: string): Promise<string> {
    const response = await fetchImpl(url, {
      headers: { 'user-agent': BROWSER_UA, 'accept-language': 'vi,en;q=0.8' },
    });
    if (!response.ok) {
      throw new FallbackParseError(`${url} returned ${response.status}`);
    }
    return await response.text();
  }

  return {
    kind: 'html-fallback',

    async listUploads(limit) {
      const html = await getHtml(`https://www.youtube.com/${options.channelHandle}/videos`);
      return parseUploadsListing(html).slice(0, limit);
    },

    async fetchDetails(videoIds) {
      const fetched: FetchedVideo[] = [];

      for (const [index, videoId] of videoIds.entries()) {
        // One request per video, spaced out. This path is for a handful of videos, never
        // for a bulk backfill.
        if (index > 0 && delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        try {
          const html = await getHtml(`https://www.youtube.com/watch?v=${videoId}`);
          const parsed = parseWatchPage(html);
          fetched.push({
            ...parsed,
            thumbnails: await pickBestThumbnail(videoId, {
              probe: options.probeThumbnails ?? true,
              fetchImpl,
            }),
          });
        } catch {
          // A video that cannot be parsed is skipped, not fatal. Its absence from the
          // result is how the orchestrator learns it is unavailable.
          continue;
        }
      }

      return fetched;
    },
  };
}
