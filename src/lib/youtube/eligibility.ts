/**
 * Eligibility and duplicate detection.
 *
 * An ineligible video is recorded with a reason rather than dropped. That matters
 * operationally: "why is there no article today?" must be answerable from the database,
 * and a video silently missing from the table is indistinguishable from one that was
 * never discovered.
 */
import type { IneligibleReason } from '@/lib/domain/types';
import { extractEpisodeNumber, titleFingerprint } from '@/lib/slug';
import { MIN_USEFUL_DESCRIPTION, cleanDescription, parseChapters } from './clean';
import type { FetchedVideo, NormalisedVideo } from './types';

/** Below two minutes is a Short, not an episode. */
export const MIN_DURATION_SECONDS = 120;

export type EligibilityVerdict =
  { readonly eligible: true } | { readonly eligible: false; readonly reason: IneligibleReason };

/**
 * Decide whether a video can become an article.
 *
 * Order matters only for which reason gets recorded when several apply; the most
 * fundamental disqualifier is checked first.
 */
export function checkEligibility(
  video: Pick<FetchedVideo, 'title' | 'durationSeconds' | 'liveInProgress'>,
  cleanedLength: number,
): EligibilityVerdict {
  if (video.liveInProgress) {
    return { eligible: false, reason: 'live_not_ended' };
  }

  // A premiere or placeholder announces itself in the title. The channel has a real
  // example: "Thuốc kích thích rau củ quả có nguy hiểm không? – coming soon".
  if (/\bcoming soon\b|sắp ra mắt|sắp phát sóng/iu.test(video.title)) {
    return { eligible: false, reason: 'placeholder' };
  }

  if (video.durationSeconds !== null && video.durationSeconds < MIN_DURATION_SECONDS) {
    return { eligible: false, reason: 'is_short' };
  }

  // With no transcript available, the description is the only substantive input. Too
  // little of it and any article would be padding.
  if (cleanedLength < MIN_USEFUL_DESCRIPTION) {
    return { eligible: false, reason: 'insufficient_source' };
  }

  return { eligible: true };
}

/** Clean, parse and classify a fetched video into a row-ready shape. */
export function normaliseVideo(
  video: FetchedVideo,
  boilerplateMarkers?: readonly string[],
): NormalisedVideo {
  const { clean, lowSignal } = cleanDescription(video.description, boilerplateMarkers);
  const verdict = checkEligibility(video, clean.length);

  return {
    youtubeVideoId: video.youtubeVideoId,
    title: video.title,
    episodeNumber: extractEpisodeNumber(video.title),
    descriptionRaw: video.description,
    descriptionClean: clean,
    lowSignal,
    keywords: video.keywords,
    chapters: parseChapters(video.description),
    durationSeconds: video.durationSeconds,
    viewCount: video.viewCount,
    thumbnails: video.thumbnails,
    publishedAt: video.publishedAt,
    eligible: verdict.eligible,
    ineligibleReason: verdict.eligible ? null : verdict.reason,
  };
}

/** Trigram similarity threshold above which two titles are treated as the same episode. */
export const DUPLICATE_SIMILARITY_THRESHOLD = 0.85;

export type DuplicateCandidate = {
  readonly id: string;
  readonly youtubeVideoId: string;
  readonly titleFingerprint: string;
  readonly episodeNumber: number | null;
  readonly status: string;
};

/**
 * Detect a probable re-upload.
 *
 * A re-upload gets a brand-new 11-character id, so the unique constraint on
 * `youtube_video_id` cannot catch it. Two softer signals can: an episode number that a
 * used video already claims, and a near-identical title fingerprint.
 *
 * Deliberately a soft flag rather than a hard rejection. A legitimate "Part 2" shares
 * most of its title with Part 1, and permanently blocking it would be worse than
 * surfacing it for review.
 */
export function findProbableDuplicate(
  candidate: { readonly title: string; readonly episodeNumber: number | null },
  existing: readonly DuplicateCandidate[],
): DuplicateCandidate | null {
  const fingerprint = titleFingerprint(candidate.title);

  // An episode number already claimed by a video we have used is the stronger signal.
  if (candidate.episodeNumber !== null) {
    const sameEpisode = existing.find(
      (row) => row.episodeNumber === candidate.episodeNumber && row.status === 'used',
    );
    if (sameEpisode !== undefined) return sameEpisode;
  }

  let best: { row: DuplicateCandidate; score: number } | null = null;
  for (const row of existing) {
    const score = trigramSimilarity(fingerprint, row.titleFingerprint);
    if (score >= DUPLICATE_SIMILARITY_THRESHOLD && (best === null || score > best.score)) {
      best = { row, score };
    }
  }
  return best?.row ?? null;
}

/**
 * Trigram similarity, matching Postgres `pg_trgm.similarity` closely enough for a
 * pre-filter.
 *
 * The database index remains the authority for querying; this exists so the ingest path
 * can decide without a round trip per candidate. pg_trgm pads each word, so the
 * implementation mirrors that rather than taking naive character triples.
 */
export function trigramSimilarity(left: string, right: string): number {
  const a = trigrams(left);
  const b = trigrams(right);
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function trigrams(value: string): Set<string> {
  const grams = new Set<string>();
  for (const word of value.toLowerCase().split(/\s+/).filter(Boolean)) {
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i += 1) {
      grams.add(padded.slice(i, i + 3));
    }
  }
  return grams;
}
