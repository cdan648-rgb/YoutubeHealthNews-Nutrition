/**
 * The single source of truth for calendar-date logic in this system.
 *
 * Every publishing decision — which day a run belongs to, the one-article-per-day
 * limit, no-source streak counting — is made on an **Asia/Ho_Chi_Minh calendar
 * date**. Instants are stored and passed around as UTC (`timestamptz` / `Date`);
 * they are converted to a Hanoi calendar date only here.
 *
 * Why this file is the only place the timezone id appears: an ESLint rule
 * (`no-restricted-syntax`) makes it an error to write the IANA id, a `+07`
 * offset, or a timezone-dependent `Date` getter anywhere else. That keeps the
 * conversion from being reimplemented slightly differently in five places,
 * which is how off-by-one-day publishing bugs happen.
 *
 * Note we use the IANA identifier rather than a fixed +07 offset even though
 * Vietnam does not currently observe daylight saving: the offset is a fact about
 * today, the identifier is a fact about the place.
 */

/** IANA zone for all publishing-calendar logic. */
export const PUBLISHING_TIMEZONE = 'Asia/Ho_Chi_Minh';

/** A Hanoi calendar date in `YYYY-MM-DD` form. Branded so it can't be mixed up with a plain string. */
export type HanoiDate = string & { readonly __brand: 'HanoiDate' };

/**
 * `en-CA` is used deliberately: its short date format is ISO-like
 * (`YYYY-MM-DD`), so no manual part reassembly or zero-padding is needed.
 */
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: PUBLISHING_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: PUBLISHING_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** The Hanoi calendar date an instant falls on. */
export function hanoiDate(instant: Date = new Date()): HanoiDate {
  return dateFormatter.format(instant) as HanoiDate;
}

/** Hanoi wall-clock hour (0–23) at an instant. */
export function hanoiHour(instant: Date = new Date()): number {
  return hanoiParts(instant).hour;
}

/** Full Hanoi wall-clock breakdown at an instant. */
export function hanoiParts(instant: Date = new Date()): {
  date: HanoiDate;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = partsFormatter.formatToParts(instant);
  const lookup = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    if (found === undefined) {
      throw new Error(`Intl did not return a "${type}" part for the publishing timezone`);
    }
    return Number.parseInt(found.value, 10);
  };

  // Intl renders midnight as "24" in some engine/locale combinations; normalise.
  const rawHour = lookup('hour');

  return {
    date: hanoiDate(instant),
    year: lookup('year'),
    month: lookup('month'),
    day: lookup('day'),
    hour: rawHour === 24 ? 0 : rawHour,
    minute: lookup('minute'),
    second: lookup('second'),
  };
}

/**
 * The current year in Hanoi.
 *
 * Exists so a footer copyright line does not reach for `getFullYear()`, which reads the
 * host timezone — UTC on Vercel. For three hours either side of New Year the two
 * disagree, and the site's year should follow the publication's calendar.
 */
export function hanoiYear(instant: Date = new Date()): number {
  return hanoiParts(instant).year;
}

/** Shift a Hanoi calendar date by whole days, staying in the calendar (never in UTC). */
export function addHanoiDays(date: HanoiDate, days: number): HanoiDate {
  const [year, month, day] = date.split('-').map((part) => Number.parseInt(part, 10)) as [
    number,
    number,
    number,
  ];
  // Anchored at noon UTC so a day shift can never cross a boundary by accident.
  const anchor = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return dateFormatterFromUtcParts(anchor);
}

/** The previous Hanoi calendar date. */
export function previousHanoiDate(date: HanoiDate): HanoiDate {
  return addHanoiDays(date, -1);
}

/** Whole days between two Hanoi calendar dates (`to - from`). */
export function hanoiDaysBetween(from: HanoiDate, to: HanoiDate): number {
  return Math.round((utcNoonOf(to) - utcNoonOf(from)) / 86_400_000);
}

/** Type guard for a well-formed `YYYY-MM-DD` Hanoi date. */
export function isHanoiDate(value: string): value is HanoiDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map((part) => Number.parseInt(part, 10)) as [
    number,
    number,
    number,
  ];
  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/** Assert and narrow an untrusted string to a HanoiDate. */
export function assertHanoiDate(value: string): HanoiDate {
  if (!isHanoiDate(value)) {
    throw new Error(`Not a valid Hanoi calendar date: ${JSON.stringify(value)}`);
  }
  return value;
}

function utcNoonOf(date: HanoiDate): number {
  const [year, month, day] = date.split('-').map((part) => Number.parseInt(part, 10)) as [
    number,
    number,
    number,
  ];
  return Date.UTC(year, month - 1, day, 12, 0, 0);
}

function dateFormatterFromUtcParts(anchor: Date): HanoiDate {
  const year = anchor.getUTCFullYear();
  const month = String(anchor.getUTCMonth() + 1).padStart(2, '0');
  const day = String(anchor.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}` as HanoiDate;
}
