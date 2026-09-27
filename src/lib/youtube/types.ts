/**
 * The normalised shape every ingestion source produces.
 *
 * Both the Data API and the degraded HTML fallback are mapped into this before
 * anything else touches them, so the rest of the pipeline — eligibility, deduplication,
 * upsert — has exactly one input shape to reason about and the fallback cannot leak its
 * quirks downstream.
 */
import type { IneligibleReason, ThumbnailSet, VideoChapter } from '@/lib/domain/types';

/** A video as discovered in a listing: enough to decide whether to fetch details. */
export type DiscoveredVideo = {
  readonly youtubeVideoId: string;
  readonly title: string;
  /** ISO instant. The API always supplies it; the fallback reads it from the watch page. */
  readonly publishedAt: string | null;
};

/** A video with full metadata, ready to be normalised into a database row. */
export type FetchedVideo = {
  readonly youtubeVideoId: string;
  readonly title: string;
  readonly description: string;
  readonly publishedAt: string;
  readonly durationSeconds: number | null;
  readonly viewCount: number | null;
  readonly keywords: readonly string[];
  readonly thumbnails: ThumbnailSet;
  /** True while a livestream is still running; such a video is not yet ingestible. */
  readonly liveInProgress: boolean;
};

/** A row ready for upsert, after cleaning and eligibility. */
export type NormalisedVideo = {
  readonly youtubeVideoId: string;
  readonly title: string;
  readonly episodeNumber: number | null;
  readonly descriptionRaw: string;
  readonly descriptionClean: string;
  readonly lowSignal: boolean;
  readonly keywords: readonly string[];
  readonly chapters: readonly VideoChapter[];
  readonly durationSeconds: number | null;
  readonly viewCount: number | null;
  readonly thumbnails: ThumbnailSet;
  readonly publishedAt: string;
  readonly eligible: boolean;
  readonly ineligibleReason: IneligibleReason | null;
};

/** Where a batch of videos came from. Recorded so a degraded run is visible. */
export type IngestSource = 'data-api' | 'html-fallback';

export type IngestOutcome = {
  readonly source: IngestSource;
  readonly discovered: number;
  readonly inserted: number;
  readonly updated: number;
  readonly ineligible: number;
  readonly possibleDuplicates: number;
  readonly errors: readonly string[];
};

/**
 * The interface an ingestion source implements.
 *
 * Two implementations exist: the Data API (primary) and an HTML parse (degraded). Both
 * satisfy this, so the orchestrator picks one without knowing which.
 */
export type VideoSource = {
  readonly kind: IngestSource;
  /** Newest-first listing of the channel's uploads. */
  listUploads(limit: number): Promise<DiscoveredVideo[]>;
  /** Full metadata for specific videos. Ids that no longer exist are simply absent. */
  fetchDetails(videoIds: readonly string[]): Promise<FetchedVideo[]>;
};

/**
 * A transcript provider.
 *
 * Declared now and deliberately unimplemented. The source channel's videos carry only
 * auto-generated captions, and the `timedtext` endpoint returns an empty body without a
 * PO token — measured, not assumed. So the shipped provider is a no-op and the article
 * pipeline is built to work without a transcript. This interface exists so a paid
 * provider can be dropped in later without touching the schema or the pipeline.
 */
export type TranscriptProvider = {
  readonly name: string;
  fetchTranscript(videoId: string): Promise<{ text: string; source: string } | null>;
};

export const noopTranscriptProvider: TranscriptProvider = {
  name: 'noop',
  // eslint-disable-next-line @typescript-eslint/require-await -- satisfies the async interface
  async fetchTranscript() {
    return null;
  },
};
