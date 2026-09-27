/**
 * The Hanoi date/window matrix.
 *
 * Hanoi is UTC+7, so 17:00:00Z is exactly 00:00:00 the NEXT Hanoi day. Every case
 * below pins an instant in UTC and asserts what the publishing policy does with it,
 * because the one-article-per-day guarantee is only as good as this arithmetic.
 *
 * Matrix IDs match the approved plan. T7-T10 and T13 concern run lifecycle and
 * concurrency, which need a database; they live in the pgTAP suite and in the
 * Phase 6 scheduler tests.
 */
import { describe, expect, it } from 'vitest';
import { assertHanoiDate, hanoiDate, hanoiHour } from '@/lib/time';
import {
  DEFAULT_WINDOW_SETTINGS,
  canClaim,
  deriveNoSourceStreak,
  shouldAbandon,
  shouldUseResearchFallback,
  windowMissed,
  windowState,
  type RunResult,
  type WindowSettings,
} from './window';

const S: WindowSettings = DEFAULT_WINDOW_SETTINGS; // 11 / 22 / 23, not paused
const at = (iso: string) => new Date(iso);
const day = assertHanoiDate;

describe('T1-T2 — the midnight boundary belongs to the right Hanoi day', () => {
  it('T1: 16:59:59Z is 23:59:59 on the day that is ending, and is past the window', () => {
    const instant = at('2026-09-27T16:59:59Z');
    expect(hanoiDate(instant)).toBe('2026-09-27');
    expect(hanoiHour(instant)).toBe(23);
    expect(canClaim(instant, S)).toBe(false);
    expect(windowMissed(instant, S)).toBe(true);
    expect(windowState(instant, S)).toBe('abandon');
  });

  it('T2: 17:00:00Z is 00:00:00 on the NEXT Hanoi day', () => {
    const instant = at('2026-09-27T17:00:00Z');
    expect(hanoiDate(instant)).toBe('2026-09-28');
    expect(hanoiHour(instant)).toBe(0);
    // A new day, but hours before the window opens.
    expect(windowState(instant, S)).toBe('before');
    expect(canClaim(instant, S)).toBe(false);
  });

  it('never derives the day from the UTC calendar', () => {
    const instant = at('2026-09-27T17:30:00Z');
    expect(instant.toISOString().slice(0, 10)).toBe('2026-09-27');
    expect(hanoiDate(instant)).toBe('2026-09-28');
  });
});

describe('T3-T6 — the publishing window on the first automated day', () => {
  const cases: ReadonlyArray<readonly [string, number, ReturnType<typeof windowState>, boolean]> = [
    // instant                    Hanoi hour  state       claimable
    ['2026-09-28T03:59:59Z', 10, 'before', false], // T5: too early
    ['2026-09-28T04:00:00Z', 11, 'open', true], // T3: window opens
    ['2026-09-28T04:15:00Z', 11, 'open', true], // T4: a later tick in the same hour
    ['2026-09-28T05:00:00Z', 12, 'open', true], // T3b: a MISSED 11:00 tick still publishes
    ['2026-09-28T14:59:00Z', 21, 'open', true],
    ['2026-09-28T15:00:00Z', 22, 'open', true], // last claimable hour
    ['2026-09-28T15:01:00Z', 22, 'open', true], // still hour 22
    ['2026-09-28T16:00:00Z', 23, 'abandon', false], // T6/T8: abandon hour
  ];

  it.each(cases)('%s (Hanoi %i:xx) -> %s, claimable=%s', (iso, hour, state, claimable) => {
    const instant = at(iso);
    expect(hanoiDate(instant)).toBe('2026-09-28');
    expect(hanoiHour(instant)).toBe(hour);
    expect(windowState(instant, S)).toBe(state);
    expect(canClaim(instant, S)).toBe(claimable);
  });

  it('T3b: the window is a range, not an equality test on the publish hour', () => {
    // This is the whole point of `>=` semantics: a single missed cron firing at
    // 11:00 must not silently lose the day.
    expect(canClaim(at('2026-09-28T05:00:00Z'), S)).toBe(true);
    expect(canClaim(at('2026-09-28T12:00:00Z'), S)).toBe(true);
  });

  it('T6: a window that has passed is recorded as missed, never as a dry day', () => {
    // With the default settings the window end (22) and the abandon hour (23) are
    // adjacent, so hour 22 is still claimable and the `closed` state is unreachable
    // — hour 23 goes straight to `abandon`. Both states report `windowMissed`,
    // which is what matters: the day is recorded as skipped rather than left blank,
    // so it cannot later be mistaken for a confirmed dry day.
    const passed = at('2026-09-28T16:30:00Z'); // 23:30 Hanoi
    expect(windowState(passed, S)).toBe('abandon');
    expect(canClaim(passed, S)).toBe(false);
    expect(windowMissed(passed, S)).toBe(true);
  });

  it('T6b: `closed` is reachable when the abandon hour is not adjacent to the end', () => {
    // e.g. window 11:00-20:59, abandon from 23:00: hours 21 and 22 are then a
    // genuine "too late to start, too early to abandon" band.
    const narrow: WindowSettings = { ...S, publishWindowEndHour: 20 };
    const closed = at('2026-09-28T14:30:00Z'); // 21:30 Hanoi
    expect(windowState(closed, narrow)).toBe('closed');
    expect(canClaim(closed, narrow)).toBe(false);
    expect(windowMissed(closed, narrow)).toBe(true);
  });

  it('a paused system neither claims nor records a missed window', () => {
    const paused = { ...S, paused: true };
    expect(canClaim(at('2026-09-28T04:00:00Z'), paused)).toBe(false);
    expect(windowMissed(at('2026-09-28T16:00:00Z'), paused)).toBe(false);
  });
});

describe('T7-T8 — abandonment stops a run crossing midnight', () => {
  it('T7: a run from an earlier Hanoi day is abandoned regardless of the hour', () => {
    expect(shouldAbandon(day('2026-09-28'), at('2026-09-29T04:00:00Z'), S)).toBe(true);
    expect(shouldAbandon(day('2026-09-28'), at('2026-09-28T17:30:00Z'), S)).toBe(true);
  });

  it("T8: today's run is abandoned from the abandon hour, before midnight", () => {
    // 15:59Z = 22:59 Hanoi -> still alive; 16:00Z = 23:00 Hanoi -> abandoned.
    expect(shouldAbandon(day('2026-09-28'), at('2026-09-28T15:59:59Z'), S)).toBe(false);
    expect(shouldAbandon(day('2026-09-28'), at('2026-09-28T16:00:00Z'), S)).toBe(true);
  });

  it('a run dated in the future is never abandoned (clock skew safety)', () => {
    expect(shouldAbandon(day('2026-09-30'), at('2026-09-28T04:00:00Z'), S)).toBe(false);
  });
});

describe('T14 — the no-source streak is counted in Hanoi calendar dates', () => {
  const runs = (entries: Record<string, RunResult>) => new Map(Object.entries(entries));

  it('counts three consecutive dry days, so research fires on the 4th', () => {
    const history = runs({
      '2026-02-12': 'no_source',
      '2026-02-13': 'no_source',
      '2026-02-14': 'no_source',
    });
    expect(deriveNoSourceStreak(day('2026-02-15'), history)).toBe(3);
    expect(shouldUseResearchFallback(day('2026-02-15'), history, 3)).toBe(true);
    // On the third dry day the streak is only 2, so nothing is published.
    expect(deriveNoSourceStreak(day('2026-02-14'), history)).toBe(2);
    expect(shouldUseResearchFallback(day('2026-02-14'), history, 3)).toBe(false);
  });

  it('a MISSING Hanoi day stops the count rather than bridging it', () => {
    // 13 Feb was never checked, so we have no right to call it dry.
    const history = runs({ '2026-02-12': 'no_source', '2026-02-14': 'no_source' });
    expect(deriveNoSourceStreak(day('2026-02-15'), history)).toBe(1);
  });

  it.each<RunResult>(['expired', 'failed', 'skipped_window', 'validation_failed'])(
    'a %s run stops the count: we never got a clean answer that day',
    (result) => {
      const history = runs({
        '2026-02-12': 'no_source',
        '2026-02-13': 'no_source',
        '2026-02-14': result,
      });
      expect(deriveNoSourceStreak(day('2026-02-15'), history)).toBe(0);
    },
  );

  it('publishing resets the streak for free, with no counter to maintain', () => {
    const history = runs({
      '2026-02-12': 'no_source',
      '2026-02-13': 'no_source',
      '2026-02-14': 'no_source',
      '2026-02-15': 'research_published',
    });
    expect(deriveNoSourceStreak(day('2026-02-16'), history)).toBe(0);
    expect(shouldUseResearchFallback(day('2026-02-16'), history, 3)).toBe(false);
  });

  it('a YouTube publication also resets it', () => {
    const history = runs({ '2026-02-14': 'published' });
    expect(deriveNoSourceStreak(day('2026-02-15'), history)).toBe(0);
  });

  it('empty history yields zero, not a crash', () => {
    expect(deriveNoSourceStreak(day('2026-09-28'), new Map())).toBe(0);
  });

  it('walks correctly across a month boundary', () => {
    const history = runs({
      '2026-01-30': 'no_source',
      '2026-01-31': 'no_source',
      '2026-02-01': 'no_source',
    });
    expect(deriveNoSourceStreak(day('2026-02-02'), history)).toBe(3);
  });

  it('respects maxLookback so a long dry spell cannot loop unbounded', () => {
    const history = new Map<string, RunResult>();
    // 40 consecutive dry days ending 2026-03-11.
    for (let i = 1; i <= 40; i += 1) {
      const d = new Date(Date.UTC(2026, 2, 12, 12));
      d.setUTCDate(d.getUTCDate() - i);
      history.set(d.toISOString().slice(0, 10), 'no_source');
    }
    expect(deriveNoSourceStreak(day('2026-03-12'), history, 10)).toBe(10);
    expect(deriveNoSourceStreak(day('2026-03-12'), history)).toBe(40);
  });

  it('a configurable threshold of 2 fires on the third dry day instead', () => {
    const history = runs({ '2026-02-12': 'no_source', '2026-02-13': 'no_source' });
    expect(shouldUseResearchFallback(day('2026-02-14'), history, 2)).toBe(true);
    expect(shouldUseResearchFallback(day('2026-02-14'), history, 3)).toBe(false);
  });
});

describe('T11 — hour and date agree across a full 48-hour sweep', () => {
  it('produces a monotonic, gap-free sequence of Hanoi days', () => {
    const start = Date.parse('2026-09-27T00:00:00Z');
    const seen: string[] = [];
    for (let hour = 0; hour < 48; hour += 1) {
      const instant = new Date(start + hour * 3_600_000);
      const date = hanoiDate(instant);
      seen.push(date);
      // The hour must always be a legal wall-clock hour.
      expect(hanoiHour(instant)).toBeGreaterThanOrEqual(0);
      expect(hanoiHour(instant)).toBeLessThanOrEqual(23);
    }
    expect([...new Set(seen)]).toStrictEqual(['2026-09-27', '2026-09-28', '2026-09-29']);
    expect([...seen].sort()).toStrictEqual(seen);
  });

  it('exactly one instant per day sits in the claimable window per hour swept', () => {
    // Over 24 hours of one Hanoi day, hours 11..22 inclusive are claimable: 12 hours.
    const start = Date.parse('2026-09-27T17:00:00Z'); // 2026-09-28 00:00 Hanoi
    let claimable = 0;
    for (let hour = 0; hour < 24; hour += 1) {
      if (canClaim(new Date(start + hour * 3_600_000), S)) claimable += 1;
    }
    expect(claimable).toBe(12);
  });
});
