/**
 * Fixture loader.
 *
 * Every fixture under `tests/fixtures/youtube/` was captured from the real channel
 * on 2026-09-27 and is checked in verbatim. Nothing here is invented: the titles,
 * descriptions, durations, view counts, publish dates and caption-track lists are
 * what the channel actually returned.
 *
 * Tests read from these rather than the network, so the suite is deterministic,
 * offline, and consumes no API quota — while still exercising the real shape and the
 * real awkwardness of the data (5-hour durations, boilerplate-laden descriptions,
 * ASR-only captions, a "coming soon" placeholder in the archive).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const YOUTUBE_DIR = join(HERE, 'youtube');

/** A captured watch-page payload. Field names mirror the source verbatim. */
export type VideoFixture = {
  readonly _source: string;
  readonly videoId: string;
  readonly title: string;
  readonly channelTitle: string;
  readonly channelId: string;
  readonly description: string;
  readonly lengthSeconds: number;
  readonly viewCount: number;
  readonly keywords: readonly string[];
  readonly publishDate: string;
  readonly uploadDate: string;
  readonly category: string;
  readonly isLiveContent: boolean;
  readonly captionTracks: readonly { readonly languageCode: string; readonly kind?: string }[];
  readonly thumbnails: readonly {
    readonly url: string;
    readonly width: number;
    readonly height: number;
  }[];
};

export type UploadsFixture = {
  readonly _source: string;
  readonly channelId: string;
  readonly uploadsPlaylistId: string;
  readonly channelTitle: string;
  readonly capturedCount: number;
  readonly totalVideosOnChannel: number;
  readonly items: readonly {
    readonly videoId: string;
    readonly title: string;
    readonly durationLabel: string | null;
  }[];
};

/** The six videos captured in full, keyed by video id. */
export const VIDEO_FIXTURE_IDS = [
  'An4HFu4EwFQ', // Số 118 — magnesium; highest view count in the sample
  'lBKtncuS0yY', // Số 132 — cancer vaccines; newest of the six
  'cI74O0zS5QI', // Số 127 — detox marketing; the fact-check case
  'nfNvuW2lQkI', // Số 126 — meniscus; description carries a numbered outline
  'hkP4Heyobuc', // Số 121 — 4-7-8 breathing; the claim-heavy red-team case
  'hidyLQgR-ro', // Số 129 — adenovirus
] as const;

export type VideoFixtureId = (typeof VIDEO_FIXTURE_IDS)[number];

export function loadVideoFixture(id: VideoFixtureId): VideoFixture {
  return JSON.parse(readFileSync(join(YOUTUBE_DIR, `${id}.json`), 'utf8')) as VideoFixture;
}

export function loadAllVideoFixtures(): VideoFixture[] {
  return VIDEO_FIXTURE_IDS.map(loadVideoFixture);
}

export function loadUploadsFixture(): UploadsFixture {
  return JSON.parse(
    readFileSync(join(YOUTUBE_DIR, 'uploads-playlist.json'), 'utf8'),
  ) as UploadsFixture;
}

/** Sanity check used by the fixture test: every id has a file and vice versa. */
export function listFixtureFiles(): string[] {
  return readdirSync(YOUTUBE_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

/* ------------------------------- research -------------------------------- */

const RESEARCH_DIR = join(HERE, 'research');

/** Load one captured research API payload by basename (without the .json extension). */
export function loadResearchFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(RESEARCH_DIR, `${name}.json`), 'utf8'));
}
