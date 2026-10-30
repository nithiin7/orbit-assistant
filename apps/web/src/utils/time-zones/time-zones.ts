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

/** Settings: the account's time zone; `""` clears the preference. */
export const timeZonePreferenceSchema = object({ timeZone: string().defined() });
