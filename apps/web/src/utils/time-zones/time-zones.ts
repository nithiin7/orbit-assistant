/** IANA time zones: detecting the browser's, listing and labelling them, and reading clocks. */

import { object, string } from "yup";

/** The browser's IANA time zone, falling back to UTC where the browser won't say. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Whether two IANA names are the same zone. Browsers canonicalize some names differently (one
 * reports `Asia/Calcutta` where another says `Asia/Kolkata`), so compare what each resolves to.
 */
export function sameTimeZone(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    const resolve = (name: string) =>
      new Intl.DateTimeFormat("en", { timeZone: name }).resolvedOptions().timeZone;
    return resolve(a) === resolve(b);
  } catch {
    // An unknown name matches only itself.
    return false;
  }
}

/** Every IANA time zone the browser knows, always including `UTC` and the given extras. */
export function timeZoneNames(...include: (string | null | undefined)[]): string[] {
  let names: string[] = [];
  try {
    names = Intl.supportedValuesOf("timeZone");
  } catch {
    // Older browsers: offer the zones that matter here.
  }
  const extras = ["UTC", ...include].filter((name): name is string => Boolean(name));
  return [...new Set([...names, ...extras])].sort((a, b) => a.localeCompare(b));
}

/** "Europe/Paris" as "Europe / Paris", easier to scan in a long list. */
export function timeZoneLabel(name: string): string {
  return name.replaceAll("_", " ").replaceAll("/", " / ");
}

/** The date (`YYYY-MM-DD`) and time (`HH:MM`) of an instant, on the wall clock of `timeZone`. */
export function localParts(instant: Date, timeZone: string): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

/**
 * The instant a wall-clock date (`YYYY-MM-DD`) and time (`HH:MM`) happen in `timeZone`. Times a
 * daylight-saving jump skips resolve forward (02:30 becomes 03:30), and repeated times resolve to
 * the first, matching how the API converts local times.
 */
export function zonedTimeToInstant(date: string, time: string, timeZone: string): Date {
  const [year = 1970, month = 1, day = 1] = date.split("-").map(Number);
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const offsetAt = (instant: number) => {
    const parts = localParts(new Date(instant), timeZone);
    const [y = 1970, mo = 1, d = 1] = parts.date.split("-").map(Number);
    const [h = 0, mi = 0] = parts.time.split(":").map(Number);
    return Date.UTC(y, mo - 1, d, h, mi) - Math.floor(instant / 60_000) * 60_000;
  };
  // Try the offset in effect before and after the date. A wall time that exists once matches one
  // of them; a repeated time matches both (take the first, earlier instant, which uses the offset
  // from before); a skipped time matches neither (use the offset from before, which lands after
  // the jump).
  const before = wall - offsetAt(wall - 86_400_000);
  const after = wall - offsetAt(wall + 86_400_000);
  const reads = (instant: number) => offsetAt(instant) === wall - instant;
  if (reads(before) || !reads(after)) return new Date(before);
  return new Date(after);
}

/** Settings: the account's time zone; `""` clears the preference. */
export const timeZonePreferenceSchema = object({ timeZone: string().defined() });
