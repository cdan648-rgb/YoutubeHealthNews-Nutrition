import { describe, expect, it } from 'vitest';
import {
  PUBLISHING_TIMEZONE,
  addHanoiDays,
  assertHanoiDate,
  hanoiDate,
  hanoiDaysBetween,
  hanoiHour,
  hanoiParts,
  isHanoiDate,
  previousHanoiDate,
} from './time';

/**
 * Hanoi is UTC+7, so 17:00:00Z is exactly 00:00:00 the NEXT Hanoi day.
 * These are the boundary cases the whole one-article-per-day guarantee rests on.
 * The full T1-T14 matrix (including the SQL side and the run-claim behaviour)
 * lands in Phase 2; this file pins the pure date arithmetic.
 */
describe('hanoiDate — midnight boundary', () => {
  it('assigns 16:59:59Z to the day that is ending in Hanoi', () => {
    // 2026-09-27T16:59:59Z === 2026-09-27 23:59:59 Hanoi
    expect(hanoiDate(new Date('2026-09-27T16:59:59Z'))).toBe('2026-09-27');
  });

  it('assigns 17:00:00Z to the NEW Hanoi day', () => {
    // 2026-09-27T17:00:00Z === 2026-09-28 00:00:00 Hanoi
    expect(hanoiDate(new Date('2026-09-27T17:00:00Z'))).toBe('2026-09-28');
  });

  it('does not use the UTC calendar date', () => {
    // Still 27 September in UTC, already 28 September in Hanoi.
    const instant = new Date('2026-09-27T17:30:00Z');
    expect(instant.toISOString().slice(0, 10)).toBe('2026-09-27');
    expect(hanoiDate(instant)).toBe('2026-09-28');
  });

  it('reports the Hanoi wall-clock hour, not the UTC hour', () => {
    expect(hanoiHour(new Date('2026-09-28T04:00:00Z'))).toBe(11); // the publish hour
    expect(hanoiHour(new Date('2026-09-27T17:00:00Z'))).toBe(0); // midnight, not 24
    expect(hanoiHour(new Date('2026-09-27T16:59:59Z'))).toBe(23);
  });

  it('breaks an instant into Hanoi wall-clock parts', () => {
    expect(hanoiParts(new Date('2026-09-27T16:59:59Z'))).toStrictEqual({
      date: '2026-09-27',
      year: 2026,
      month: 9,
      day: 27,
      hour: 23,
      minute: 59,
      second: 59,
    });
  });
});

describe('hanoiDate — the publish window on the first automated day', () => {
  const cases: ReadonlyArray<readonly [string, string, number]> = [
    ['2026-09-28T03:59:59Z', '2026-09-28', 10], // before the 11:00 window
    ['2026-09-28T04:00:00Z', '2026-09-28', 11], // window opens
    ['2026-09-28T15:00:00Z', '2026-09-28', 22], // window closes
    ['2026-09-28T15:01:00Z', '2026-09-28', 22], // 22:01, past the close
    ['2026-09-28T16:30:00Z', '2026-09-28', 23], // abandon hour
  ];

  it.each(cases)('%s maps to %s hour %i', (iso, expectedDate, expectedHour) => {
    const instant = new Date(iso);
    expect(hanoiDate(instant)).toBe(expectedDate);
    expect(hanoiHour(instant)).toBe(expectedHour);
  });
});

describe('hanoiDate — every hour of a two-day span resolves consistently', () => {
  it('never skips or repeats a calendar date across 48 hourly instants', () => {
    const start = Date.parse('2026-09-27T00:00:00Z');
    const seen: string[] = [];
    for (let hour = 0; hour < 48; hour += 1) {
      seen.push(hanoiDate(new Date(start + hour * 3_600_000)));
    }
    const distinct = [...new Set(seen)];
    // 48 hours starting 07:00 Hanoi on the 27th spans the 27th, 28th and 29th.
    expect(distinct).toStrictEqual(['2026-09-27', '2026-09-28', '2026-09-29']);
    // Dates must be non-decreasing — a regression here means the conversion is wrong.
    expect([...seen].sort()).toStrictEqual(seen);
  });
});

describe('calendar arithmetic stays in the Hanoi calendar', () => {
  it('walks backwards across a month boundary', () => {
    expect(previousHanoiDate(assertHanoiDate('2026-10-01'))).toBe('2026-09-30');
  });

  it('walks backwards across a year boundary', () => {
    expect(previousHanoiDate(assertHanoiDate('2027-01-01'))).toBe('2026-12-31');
  });

  it('handles a leap day', () => {
    expect(addHanoiDays(assertHanoiDate('2028-02-28'), 1)).toBe('2028-02-29');
    expect(addHanoiDays(assertHanoiDate('2028-02-29'), 1)).toBe('2028-03-01');
  });

  it('counts the three-day streak window used by the research fallback', () => {
    const decisionDay = assertHanoiDate('2026-02-15');
    expect(hanoiDaysBetween(assertHanoiDate('2026-02-12'), decisionDay)).toBe(3);
    expect(previousHanoiDate(decisionDay)).toBe('2026-02-14');
    expect(addHanoiDays(decisionDay, -3)).toBe('2026-02-12');
  });
});

describe('validation', () => {
  it('accepts well-formed dates', () => {
    expect(isHanoiDate('2026-09-28')).toBe(true);
  });

  it.each(['2026-9-28', '26-09-28', '2026-02-30', '2026-13-01', 'not-a-date', ''])(
    'rejects %o',
    (value) => {
      expect(isHanoiDate(value)).toBe(false);
      expect(() => assertHanoiDate(value)).toThrow();
    },
  );
});

describe('configuration', () => {
  it('uses the IANA identifier, not a fixed offset', () => {
    expect(PUBLISHING_TIMEZONE).toBe('Asia/Ho_Chi_Minh');
  });
});
