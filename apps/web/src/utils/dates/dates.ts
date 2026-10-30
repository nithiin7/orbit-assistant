/**
 * Calendar dates (`YYYY-MM-DD`) and months (`YYYY-MM`), the formats the API uses for task due
 * dates and transaction dates. They are days on the user's calendar, not instants: they carry no
 * time or time zone, so arithmetic on them is done in UTC, where every day is 24 hours long.
 */

/** A date as `YYYY-MM-DD` in the user's time zone. */
export function localDateString(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** The current month as `YYYY-MM` in the user's time zone. */
export function localMonthString(date: Date = new Date()): string {
  return localDateString(date).slice(0, 7);
}

/** The parts of a `YYYY-MM-DD` date (or a `YYYY-MM` month, on its first day). */
export function parseCalendarDate(value: string): { year: number; month: number; day: number } {
  const [year = 1970, month = 1, day = 1] = value.split("-").map(Number);
  return { year, month, day };
}

function utcDate(value: string): Date {
  const { year, month, day } = parseCalendarDate(value);
  return new Date(Date.UTC(year, month - 1, day));
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. Calendar days, so DST doesn't matter. */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcDate(to).getTime() - utcDate(from).getTime()) / 86_400_000);
}

/**
 * A `YYYY-MM-DD` date for display, such as `Oct 29, 2026`. The year is left out with
 * `omitYearIn` set to that year.
 */
export function formatCalendarDate(value: string, { omitYearIn }: { omitYearIn?: number } = {}) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: parseCalendarDate(value).year === omitYearIn ? undefined : "numeric",
    // Format the calendar date itself, independent of the viewer's time zone.
    timeZone: "UTC",
  }).format(utcDate(value));
}

/** `month` (`YYYY-MM`) moved by `delta` months. */
export function shiftMonth(month: string, delta: number): string {
  const { year, month: value } = parseCalendarDate(month);
  const index = year * 12 + value - 1 + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** The first and last days of a `YYYY-MM` month, as `YYYY-MM-DD`. */
export function monthRange(month: string): { from: string; to: string } {
  const { year, month: value } = parseCalendarDate(month);
  // Day 0 of the next month is the last day of this one.
  const lastDay = new Date(Date.UTC(year, value, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}` };
}

/** `October 2026`, or `Oct` with `short`. */
export function monthLabel(month: string, { short = false }: { short?: boolean } = {}): string {
  return new Intl.DateTimeFormat(undefined, {
    month: short ? "short" : "long",
    year: short ? undefined : "numeric",
    timeZone: "UTC",
  }).format(utcDate(month));
}
