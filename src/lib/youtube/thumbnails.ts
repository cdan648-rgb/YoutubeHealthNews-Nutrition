/**
 * Thumbnail variant selection.
 *
 * `maxresdefault.jpg` does not exist for every video — YouTube only generates it above a
 * certain source resolution — so choosing it blindly produces broken heroes. The best
 * available variant is probed once at ingest and stored, rather than probed at render
 * time, because a reader should never wait on a HEAD request to see an image.
 *
 * Nothing is downloaded or re-hosted: the probe is a HEAD, and what gets stored is
 * YouTube's own URL.
 */
import type { ThumbnailSet } from '@/lib/domain/types';

/** Ordered best-first. The first that responds 2xx wins. */
const VARIANTS = [
  { key: 'maxres', file: 'maxresdefault.jpg' },
  { key: 'sd', file: 'sddefault.jpg' },
  { key: 'hq', file: 'hqdefault.jpg' },
  { key: 'mq', file: 'mqdefault.jpg' },
] as const;

export function thumbnailUrl(videoId: string, file: string): string {
  return `https://i.ytimg.com/vi/${videoId}/${file}`;
}

export type ProbeOptions = {
  /** Off in tests, so the suite makes no network calls. */
  readonly probe?: boolean;
  readonly fetchImpl?: typeof fetch;
};

/**
 * Determine the best available thumbnail for a video.
 *
 * With probing disabled, `hqdefault` is assumed as `best`: it is the one variant YouTube
 * generates for every video, so it is the safe default rather than an optimistic guess.
 */
export async function pickBestThumbnail(
  videoId: string,
  options: ProbeOptions = {},
): Promise<ThumbnailSet> {
  const variants: Record<string, string> = {};
  for (const variant of VARIANTS) {
    variants[variant.key] = thumbnailUrl(videoId, variant.file);
  }

  if (options.probe !== true) {
    return { best: thumbnailUrl(videoId, 'hqdefault.jpg'), variants };
  }

  const fetchImpl = options.fetchImpl ?? fetch;

  for (const variant of VARIANTS) {
    const url = thumbnailUrl(videoId, variant.file);
    try {
      const response = await fetchImpl(url, { method: 'HEAD' });
      if (response.ok) return { best: url, variants };
    } catch {
      // A network error on a probe is not a reason to fail ingestion; try the next
      // variant and fall through to the guaranteed one.
      continue;
    }
  }

  return { best: thumbnailUrl(videoId, 'hqdefault.jpg'), variants };
}
