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

/** `value` (`YYYY-MM-DD`) moved by `days` calendar days. */
export function addDays(value: string, days: number): string {
  const moved = utcDate(value);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

/** `value` (`YYYY-MM-DD`) moved by `months`, keeping the day where it exists: Jan 31 + 1 is Feb 28. */
export function addMonths(value: string, months: number): string {
  const { day } = parseCalendarDate(value);
  const { from, to } = monthRange(shiftMonth(value.slice(0, 7), months));
  return `${from.slice(0, 8)}${String(Math.min(day, parseCalendarDate(to).day)).padStart(2, "0")}`;
}

/** The weekday of a `YYYY-MM-DD` date: 0 is Sunday. */
export function dayOfWeek(value: string): number {
  return utcDate(value).getUTCDay();
}

/**
 * The weeks a month calendar shows for `month` (`YYYY-MM`): whole weeks, each seven
 * `YYYY-MM-DD` dates starting on `firstDay` (0 is Sunday), padded with the neighbouring months.
 */
export function calendarWeeks(month: string, firstDay = 0): string[][] {
  const { from, to } = monthRange(month);
  const start = addDays(from, -((dayOfWeek(from) - firstDay + 7) % 7));
  const weeks: string[][] = [];
  for (let day = start; day <= to; day = addDays(day, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, index) => addDays(day, index)));
  }
  return weeks;
}

/** The first day of the week (0 is Sunday) where `locale` is, or Sunday when unknown. */
export function firstDayOfWeek(locale?: string): number {
  try {
    // `getWeekInfo` is newer than the ES2023 typings, and not in every browser yet.
    const info: Intl.Locale & { getWeekInfo?: () => { firstDay: number } } = new Intl.Locale(
      locale ?? navigator.language,
    );
    if (typeof info.getWeekInfo !== "function") return 0;
    // Intl numbers the days 1 (Monday) to 7 (Sunday).
    return info.getWeekInfo().firstDay % 7;
  } catch {
    // An invalid locale tag: fall back to Sunday.
    return 0;
  }
}
