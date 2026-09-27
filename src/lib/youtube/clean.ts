/**
 * Description cleaning, chapter parsing and duration parsing.
 *
 * All deterministic, no AI. The channel appends an identical promotional and copyright
 * block to every description; the editorial content is everything *before* the first
 * marker. Getting this right matters more than it looks: the cleaned description is the
 * only substantive input the article generator gets, because the videos have no usable
 * transcript.
 */
import type { VideoChapter } from '@/lib/domain/types';

/**
 * Default boilerplate markers, taken verbatim from the real descriptions.
 *
 * These live in `internal.automation_settings.boilerplate_markers` at runtime so a
 * change to the channel's template is a settings update rather than a deploy. This
 * constant is the seed value and the fallback.
 */
export const DEFAULT_BOILERPLATE_MARKERS: readonly string[] = [
  '🚀 Đừng quên kết nối',
  '🎯 QUÝ KHÁN GIẢ LƯU Ý',
  '© Bản quyền',
  '© Copyright by',
  'Please do not Reup',
  '• Đăng ký kênh',
  'Kênh YouTube chính thức của',
];

/** Below this, a description cannot carry an article on its own. */
export const MIN_USEFUL_DESCRIPTION = 250;

export type CleanedDescription = {
  readonly clean: string;
  /**
   * True when cleaning left too little to work with and the full description was kept
   * instead. Flags the row for review rather than silently degrading the article.
   */
  readonly lowSignal: boolean;
};

/**
 * Strip channel boilerplate from a description.
 *
 * Cuts at the earliest marker found, then removes trailing hashtag runs and the
 * shortened social links YouTube renders as bare paths. If the result is too short to be
 * useful, the full text is returned with `lowSignal` set — losing the editorial lead
 * entirely would be worse than keeping some boilerplate.
 */
export function cleanDescription(
  description: string,
  markers: readonly string[] = DEFAULT_BOILERPLATE_MARKERS,
): CleanedDescription {
  const raw = description.replace(/\r\n/g, '\n');

  let cut = raw.length;
  for (const marker of markers) {
    const index = raw.indexOf(marker);
    if (index !== -1 && index < cut) cut = index;
  }

  let clean = raw
    .slice(0, cut)
    // Trailing hashtag block, e.g. "#bacsi #tranvanphuc #ytế".
    .replace(/(?:^|\n)\s*(?:#[^\s#]+\s*){2,}$/u, '')
    // Bare "/ @channel" and "/ page" paths YouTube substitutes for full URLs.
    .replace(/^\s*[•·]?\s*\/\s*@?\S+\s*$/gmu, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (clean.length < MIN_USEFUL_DESCRIPTION) {
    const fullFallback = raw.trim();
    // Only fall back if the full text is actually longer; otherwise the video simply
    // has a short description and the flag would be misleading.
    if (fullFallback.length > clean.length) {
      return { clean: fullFallback, lowSignal: true };
    }
    clean = fullFallback;
  }

  return { clean, lowSignal: clean.length < MIN_USEFUL_DESCRIPTION };
}

/**
 * Parse chapter markers out of a description.
 *
 * Accepts `M:SS`, `MM:SS` and `H:MM:SS` at the start of a line, which is how the channel
 * writes them when it writes them at all. A label is required: a bare timestamp is not a
 * chapter. Results are sorted and de-duplicated by timestamp.
 */
export function parseChapters(description: string): VideoChapter[] {
  const chapters: VideoChapter[] = [];
  const seen = new Set<number>();

  for (const line of description.split('\n')) {
    const match = /^\s*(?:\d+\s*[.)]\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*[-–—:]?\s*(.+)$/u.exec(
      line,
    );
    if (match === null) continue;

    const [, a, b, c, rawLabel] = match;
    if (a === undefined || b === undefined || rawLabel === undefined) continue;

    // With three groups the first is hours; with two it is minutes.
    const seconds =
      c === undefined
        ? Number.parseInt(a, 10) * 60 + Number.parseInt(b, 10)
        : Number.parseInt(a, 10) * 3600 + Number.parseInt(b, 10) * 60 + Number.parseInt(c, 10);

    const label = rawLabel.trim();
    if (label.length < 2 || seen.has(seconds)) continue;

    seen.add(seconds);
    chapters.push({ seconds, label });
  }

  return chapters.sort((left, right) => left.seconds - right.seconds);
}

/**
 * Parse an ISO-8601 duration as returned by `videos.list.contentDetails.duration`.
 *
 * Only the time components are handled; YouTube never returns a day component for a
 * video. Returns null for anything unparseable rather than a misleading zero, because
 * zero would read as "a video of no length" and pass a `>= 0` check.
 */
export function parseIsoDuration(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const match = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value.trim());
  if (match === null) return null;

  const [, days, hours, minutes, seconds] = match;
  if (hours === undefined && minutes === undefined && seconds === undefined && days === undefined) {
    return null;
  }

  return (
    Number.parseInt(days ?? '0', 10) * 86400 +
    Number.parseInt(hours ?? '0', 10) * 3600 +
    Number.parseInt(minutes ?? '0', 10) * 60 +
    Number.parseInt(seconds ?? '0', 10)
  );
}

/** Human-readable duration, for the admin view and source attribution cards. */
export function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds === null || totalSeconds < 0) return '—';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
