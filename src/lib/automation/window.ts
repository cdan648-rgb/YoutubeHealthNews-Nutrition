/**
 * Publishing-window policy, expressed purely over Hanoi calendar dates.
 *
 * This module holds no timezone literal of its own: it imports the conversion
 * helpers from `@/lib/time`, which is the single sanctioned place the IANA
 * identifier appears. Everything here is a pure function of an instant plus
 * settings, so the whole policy is testable without a database or a clock.
 *
 * Phase 6 wires these to `internal.tick()`; Phase 2 only has to get the calendar
 * arithmetic right, because every later guarantee is built on top of it.
 */
import { hanoiDate, hanoiHour, previousHanoiDate, type HanoiDate } from '@/lib/time';

/** The subset of `internal.automation_settings` that decides windowing. */
export type WindowSettings = {
  /** Hanoi hour at which the window opens (default 11). */
  readonly publishHourLocal: number;
  /** Last Hanoi hour at which a day may still be claimed (default 22). */
  readonly publishWindowEndHour: number;
  /** Hanoi hour from which an unfinished run is abandoned (default 23). */
  readonly abandonHourLocal: number;
  readonly paused: boolean;
};

export const DEFAULT_WINDOW_SETTINGS: WindowSettings = {
  publishHourLocal: 11,
  publishWindowEndHour: 22,
  abandonHourLocal: 23,
  paused: false,
};

/**
 * Where an instant sits relative to today's publishing window.
 *
 * `before`  — too early; do nothing yet.
 * `open`    — the day may be claimed and driven.
 * `closed`  — past the window end. The day is recorded as skipped rather than
 *             claimed, so a late deploy cannot publish at 23:59 and so the gap is
 *             distinguishable from a genuine no-source day.
 * `abandon` — at or past the abandon hour. Unfinished runs are expired here, which
 *             is what stops a run from crossing midnight into the next Hanoi day.
 */
export type WindowState = 'before' | 'open' | 'closed' | 'abandon';

export function windowState(instant: Date, settings: WindowSettings): WindowState {
  const hour = hanoiHour(instant);
  if (hour >= settings.abandonHourLocal) return 'abandon';
  if (hour > settings.publishWindowEndHour) return 'closed';
  if (hour < settings.publishHourLocal) return 'before';
  return 'open';
}

/**
 * Whether a run may be claimed for the Hanoi day containing `instant`.
 *
 * Note the `>=` semantics: the window is a range, not an equality test on the
 * publish hour. A single missed cron firing would otherwise lose the entire day,
 * because hour 12 is not hour 11.
 */
export function canClaim(instant: Date, settings: WindowSettings): boolean {
  if (settings.paused) return false;
  return windowState(instant, settings) === 'open';
}

/** Whether the window has closed for the day without a run being claimed. */
export function windowMissed(instant: Date, settings: WindowSettings): boolean {
  if (settings.paused) return false;
  const state = windowState(instant, settings);
  return state === 'closed' || state === 'abandon';
}

/**
 * Whether a run that is still `running` must now be abandoned.
 *
 * True when the run belongs to an earlier Hanoi day (it has crossed midnight), or
 * when it belongs to today and the abandon hour has arrived. Abandonment is
 * recorded as `expired`, which is deliberately NOT `no_source`, so a run we never
 * got a clean answer from cannot masquerade as a confirmed dry day.
 */
export function shouldAbandon(
  runHanoiDate: HanoiDate,
  instant: Date,
  settings: WindowSettings,
): boolean {
  const today = hanoiDate(instant);
  if (runHanoiDate < today) return true;
  if (runHanoiDate > today) return false;
  return hanoiHour(instant) >= settings.abandonHourLocal;
}

/** Run results that close a run out. Mirrors `internal.run_result`. */
export type RunResult =
  | 'running'
  | 'published'
  | 'research_published'
  | 'no_source'
  | 'validation_failed'
  | 'failed'
  | 'expired'
  | 'skipped_window';

/**
 * The no-source streak, derived from run history rather than stored as a counter.
 *
 * Counting back from the day BEFORE `decisionDay`, a date extends the streak only
 * when a run exists for it with result `no_source`. Two cases stop the count:
 *
 *   * a date with no run at all — we never checked that day, so we have no right
 *     to call it dry;
 *   * any other terminal result — `expired`, `failed` and `skipped_window` mean we
 *     did not get a clean answer, and `research_published` / `published` mean the
 *     day was not dry at all.
 *
 * Because the streak is derived, publishing research resets it for free and there
 * is no counter that a replayed run or a manual database fix could corrupt.
 *
 * `resultsByDate` maps a Hanoi date to that day's run result. A caller normally
 * supplies only the recent window; `maxLookback` bounds the walk.
 */
export function deriveNoSourceStreak(
  decisionDay: HanoiDate,
  resultsByDate: ReadonlyMap<string, RunResult>,
  maxLookback = 400,
): number {
  let streak = 0;
  let cursor = previousHanoiDate(decisionDay);

  for (let step = 0; step < maxLookback; step += 1) {
    if (resultsByDate.get(cursor) !== 'no_source') return streak;
    streak += 1;
    cursor = previousHanoiDate(cursor);
  }

  return streak;
}

/**
 * Whether the research fallback should fire on `decisionDay`.
 *
 * Only ever consulted when no unused YouTube video is available: fresh channel
 * content always takes priority, so this is the second question, never the first.
 */
export function shouldUseResearchFallback(
  decisionDay: HanoiDate,
  resultsByDate: ReadonlyMap<string, RunResult>,
  noSourceThreshold: number,
): boolean {
  return deriveNoSourceStreak(decisionDay, resultsByDate) >= noSourceThreshold;
}
