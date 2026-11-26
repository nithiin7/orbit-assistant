/**
 * Natural-language quick add: read a due date, a repeat, a priority, and a list out of a typed
 * task title ("Pay rent on the 1st every month #home !high"). English only, no AI, nothing sent
 * anywhere: plain word rules, so it is predictable and can be undone word by word.
 */

import type { TaskPriority, TaskRepeat } from "@orbit/contracts";

import {
  addDays,
  addMonths,
  dayOfWeek,
  daysBetween,
  formatCalendarDate,
  parseCalendarDate,
} from "@/utils/dates";

import { describeDueDate, repeatLabel } from "./tasks";

/** The API's limit on "every N days, weeks, months, or years". */
const MAX_REPEAT_INTERVAL = 99;

export type QuickAddKind = "date" | "repeat" | "priority" | "list";

/** One thing the parser understood: what was typed and how it reads back. */
export type QuickAddToken = { kind: QuickAddKind; text: string; label: string };

export type QuickAddResult = {
  /** The title with the understood words taken out. */
  title: string;
  dueDate: string | null;
  recurrence: TaskRepeat | null;
  priority: TaskPriority | null;
  listId: string | null;
  /** At most one per kind, in the order they appear in the text. */
  tokens: QuickAddToken[];
};

type QuickAddOptions = {
  /** `YYYY-MM-DD` in the user's time zone. */
  today: string;
  lists?: readonly { id: string; name: string }[];
  /** Kinds the user dismissed: their words stay in the title. */
  ignore?: ReadonlySet<QuickAddKind>;
};

// Sunday is 0, as `dayOfWeek` counts.
const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};
/** Short forms that are also ordinary words; they count only after "on", "by", "next", ... */
const AMBIGUOUS_WEEKDAYS = new Set(["sun", "sat", "wed"]);

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

/** Words that introduce a date and go with it: "due Friday", "by the 5th". */
const DATE_LEADS = new Set(["on", "by", "due", "before"]);

const UNITS: Record<string, TaskRepeat["frequency"]> = {
  day: "daily",
  days: "daily",
  week: "weekly",
  weeks: "weekly",
  month: "monthly",
  months: "monthly",
  year: "yearly",
  years: "yearly",
};

const PRIORITY_WORDS: Record<string, TaskPriority> = {
  "!high": "high",
  "!h": "high",
  "!!!": "high",
  p1: "high",
  "!medium": "medium",
  "!med": "medium",
  "!m": "medium",
  "!!": "medium",
  p2: "medium",
  "!low": "low",
  "!l": "low",
  p3: "low",
};

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  high: "High priority",
  medium: "Medium priority",
  low: "Low priority",
  none: "No priority",
};

/** A match: how many words it used, from `start`. */
type Match<T> = { start: number; length: number; value: T };

/** The word as matched: lower case, without trailing punctuation. */
function norm(word: string): string {
  return word.toLowerCase().replace(/[.,;:]+$/, "");
}

function count(word: string | undefined): number | null {
  if (word === undefined) return null;
  if (word === "a" || word === "an" || word === "one") return 1;
  if (word === "other") return 2;
  if (!/^\d{1,2}$/.test(word)) return null;
  const value = Number(word);
  return value >= 1 && value <= MAX_REPEAT_INTERVAL ? value : null;
}

function ordinal(word: string | undefined): number | null {
  const match = word?.match(/^(\d{1,2})(st|nd|rd|th)?$/);
  if (!match) return null;
  const day = Number(match[1]);
  return day >= 1 && day <= 31 ? day : null;
}

/** The next `weekday` on or after `today`. */
function upcoming(today: string, weekday: number): string {
  return addDays(today, (weekday - dayOfWeek(today) + 7) % 7);
}

/** `YYYY-MM-DD` for that day if it exists, else `null` (no Feb 30). */
function calendarDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function isRealDate(value: string): boolean {
  const [year = 0, month = 0, day = 0] = value.split("-").map(Number);
  return calendarDate(year, month, day) === value;
}

/** A month and day with no year: this year, or next year once it has passed. */
function nextMonthDay(today: string, month: number, day: number): string | null {
  const { year } = parseCalendarDate(today);
  const date = calendarDate(year, month, day);
  if (date === null) return calendarDate(year + 1, month, day);
  return date < today ? calendarDate(year + 1, month, day) : date;
}

/** The next time the month reaches `day`, today included; short months are skipped. */
function nextDayOfMonth(today: string, day: number): string | null {
  const { year, month } = parseCalendarDate(today);
  for (let offset = 0; offset < 12; offset += 1) {
    const first = addMonths(`${year}-${String(month).padStart(2, "0")}-01`, offset);
    const { year: y, month: m } = parseCalendarDate(first);
    const date = calendarDate(y, m, day);
    if (date !== null && date >= today) return date;
  }
  return null;
}

/** A date phrase starting at `i` (after any lead word), in `words` (already normalized). */
function matchDate(words: string[], i: number, today: string, led: boolean): Match<string> | null {
  const word = words[i];
  const next = words[i + 1];
  if (word === undefined) return null;
  const one = (value: string | null, length = 1) =>
    value === null ? null : { start: i, length, value };

  if (word === "today" || word === "tonight") return one(today);
  if (word === "tomorrow" || word === "tmrw" || word === "tmr") return one(addDays(today, 1));
  if (/^\d{4}-\d{2}-\d{2}$/.test(word)) return one(isRealDate(word) ? word : null);

  const weekday = WEEKDAYS[word];
  if (weekday !== undefined && (led || !AMBIGUOUS_WEEKDAYS.has(word))) {
    return one(upcoming(today, weekday));
  }

  if (word === "this" && next !== undefined) {
    const day = WEEKDAYS[next];
    if (day !== undefined) return one(upcoming(today, day), 2);
    if (next === "weekend") return one(upcoming(today, 6), 2);
  }
  if (word === "weekend" && led) return one(upcoming(today, 6));

  if (word === "next" && next !== undefined) {
    const day = WEEKDAYS[next];
    // "next Friday" is the Friday of next week (weeks start on Monday).
    if (day !== undefined) {
      const mondayNextWeek = addDays(today, 7 - ((dayOfWeek(today) + 6) % 7));
      return one(addDays(mondayNextWeek, (day + 6) % 7), 2);
    }
    if (next === "week") return one(addDays(today, 7 - ((dayOfWeek(today) + 6) % 7)), 2);
    if (next === "month") return one(addMonths(`${today.slice(0, 7)}-01`, 1), 2);
    if (next === "weekend") return one(addDays(upcoming(today, 6), 7), 2);
  }

  // "in 3 days", "in a week", "in 2 months"
  if (word === "in" && next !== undefined && next !== "other") {
    const amount = count(next);
    const unit = UNITS[words[i + 2] ?? ""];
    if (amount !== null && unit !== undefined) {
      const value =
        unit === "daily"
          ? addDays(today, amount)
          : unit === "weekly"
            ? addDays(today, amount * 7)
            : unit === "monthly"
              ? addMonths(today, amount)
              : addMonths(today, amount * 12);
      return one(value, 3);
    }
  }

  // "dec 5", "december 5th", "dec 5 2027"
  const month = MONTHS[word];
  if (month !== undefined) {
    const day = ordinal(next);
    if (day !== null) {
      const year = words[i + 2]?.match(/^\d{4}$/) ? Number(words[i + 2]) : null;
      return year === null
        ? one(nextMonthDay(today, month, day), 2)
        : one(calendarDate(year, month, day), 3);
    }
  }
  // "5 dec", "5th of december"
  const day = ordinal(word);
  if (day !== null) {
    const of = next === "of" ? 1 : 0;
    const monthAfter = MONTHS[words[i + 1 + of] ?? ""];
    // "5 may" is too often not a date ("5 may need"), so it needs a lead word or "5th".
    if (monthAfter !== undefined && (led || /\D$/.test(word) || words[i + 1 + of] !== "may")) {
      return one(nextMonthDay(today, monthAfter, day), 2 + of);
    }
    // "on the 5th", "by 1st": a day of the month, only after a lead word.
    if (led && /\D$/.test(word)) return one(nextDayOfMonth(today, day));
  }
  if (word === "the" && led) {
    const dayAfter = ordinal(next);
    if (dayAfter !== null && next !== undefined && /\D$/.test(next)) {
      const monthAfter =
        MONTHS[words[i + 2] === "of" ? (words[i + 3] ?? "") : (words[i + 2] ?? "")];
      if (monthAfter !== undefined) {
        return one(nextMonthDay(today, monthAfter, dayAfter), words[i + 2] === "of" ? 4 : 3);
      }
      return one(nextDayOfMonth(today, dayAfter), 2);
    }
  }
  return null;
}

/** A repeat starting at `i`, and the first due date it implies, if any ("every Monday"). */
function matchRepeat(
  words: string[],
  i: number,
  today: string,
): Match<{ repeat: TaskRepeat; due: string | null }> | null {
  const word = words[i];
  const single: Record<string, TaskRepeat["frequency"]> = {
    daily: "daily",
    weekly: "weekly",
    monthly: "monthly",
    yearly: "yearly",
    annually: "yearly",
  };
  if (word !== undefined && single[word]) {
    return {
      start: i,
      length: 1,
      value: { repeat: { frequency: single[word], interval: 1 }, due: null },
    };
  }
  if (word !== "every") return null;
  const next = words[i + 1];
  if (next === undefined) return null;

  const unit = UNITS[next];
  if (
    unit !== undefined &&
    (next === "day" || next === "week" || next === "month" || next === "year")
  ) {
    return { start: i, length: 2, value: { repeat: { frequency: unit, interval: 1 }, due: null } };
  }
  const weekday = WEEKDAYS[next];
  if (weekday !== undefined) {
    return {
      start: i,
      length: 2,
      value: { repeat: { frequency: "weekly", interval: 1 }, due: upcoming(today, weekday) },
    };
  }
  // "every 2 weeks", "every other month"
  const amount = count(next);
  const after = UNITS[words[i + 2] ?? ""];
  if (amount !== null && after !== undefined) {
    return {
      start: i,
      length: 3,
      value: { repeat: { frequency: after, interval: amount }, due: null },
    };
  }
  return null;
}

/** `#name` against the lists: an exact name (spaces and dashes ignored), or a unique prefix. */
function matchList(word: string, lists: readonly { id: string; name: string }[]) {
  if (!/^#[\p{L}\p{N}_-]{2,}$/u.test(word)) return null;
  const squash = (value: string) => value.toLowerCase().replace(/[\s_-]+/g, "");
  const wanted = squash(word.slice(1));
  const exact = lists.find((list) => squash(list.name) === wanted);
  if (exact) return exact;
  const prefixed = lists.filter((list) => squash(list.name).startsWith(wanted));
  return prefixed.length === 1 ? prefixed[0] : null;
}

const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" });

/** "Today", "Tomorrow", "Fri, Dec 4" within the week, else the date ("Jan 15"). */
function dateLabel(date: string, today: string): string {
  const { label } = describeDueDate(date, today);
  if (label === "Today" || label === "Tomorrow") return label;
  const days = daysBetween(today, date);
  if (days < 2 || days >= 7) return label;
  const weekday = weekdayFormat.format(new Date(`${date}T00:00:00Z`));
  return `${weekday}, ${formatCalendarDate(date, { omitYearIn: parseCalendarDate(today).year })}`;
}

/**
 * Read `input` for a due date, repeat, priority, and list. The first phrase of each kind wins;
 * later ones stay in the title. When nothing would be left of the title, nothing is taken.
 */
export function parseQuickAdd(input: string, options: QuickAddOptions): QuickAddResult {
  const { today, lists = [], ignore = new Set<QuickAddKind>() } = options;
  const raw = input.trim().split(/\s+/).filter(Boolean);
  const words = raw.map(norm);
  const used = new Array<boolean>(raw.length).fill(false);
  const found: { kind: QuickAddKind; start: number; length: number; label: string }[] = [];

  let dueDate: string | null = null;
  let recurrence: TaskRepeat | null = null;
  let impliedDue: string | null = null;
  let priority: TaskPriority | null = null;
  let listId: string | null = null;

  const take = (kind: QuickAddKind, start: number, length: number, label: string) => {
    for (let k = start; k < start + length; k += 1) used[k] = true;
    found.push({ kind, start, length, label });
  };
  const free = (start: number, length: number) =>
    used.slice(start, start + length).every((value) => !value);

  for (let i = 0; i < raw.length; i += 1) {
    if (used[i]) continue;
    const word = words[i] ?? "";

    if (recurrence === null && !ignore.has("repeat")) {
      const match = matchRepeat(words, i, today);
      if (match && free(match.start, match.length)) {
        recurrence = match.value.repeat;
        impliedDue = match.value.due;
        take("repeat", match.start, match.length, repeatLabel(match.value.repeat));
        i += match.length - 1;
        continue;
      }
    }

    if (dueDate === null && !ignore.has("date")) {
      const led = DATE_LEADS.has(word);
      const match = matchDate(words, led ? i + 1 : i, today, led);
      if (match && free(i, match.length + (led ? 1 : 0))) {
        dueDate = match.value;
        take("date", i, match.length + (led ? 1 : 0), dateLabel(match.value, today));
        i += match.length - (led ? 0 : 1);
        continue;
      }
    }

    if (priority === null && !ignore.has("priority")) {
      const value = PRIORITY_WORDS[word];
      if (value) {
        priority = value;
        take("priority", i, 1, PRIORITY_LABELS[value]);
        continue;
      }
    }

    if (listId === null && !ignore.has("list")) {
      const list = matchList(word, lists);
      if (list) {
        listId = list.id;
        take("list", i, 1, list.name);
      }
    }
  }

  const title = raw.filter((_, index) => !used[index]).join(" ");
  if (title === "" || found.length === 0) {
    return {
      title: raw.join(" "),
      dueDate: null,
      recurrence: null,
      priority: null,
      listId: null,
      tokens: [],
    };
  }

  // A repeat needs a due date to count from: the one typed, the weekday it names, or today.
  if (recurrence !== null && dueDate === null) {
    dueDate = impliedDue ?? today;
    const repeat = found.find((token) => token.kind === "repeat");
    const start = dateLabel(dueDate, today);
    if (repeat) {
      repeat.label = `${repeat.label}, from ${start === "Today" || start === "Tomorrow" ? start.toLowerCase() : start}`;
    }
  }

  return {
    title,
    dueDate,
    recurrence,
    priority,
    listId,
    tokens: found
      .sort((a, b) => a.start - b.start)
      .map(({ kind, start, length, label }) => ({
        kind,
        text: raw.slice(start, start + length).join(" "),
        label,
      })),
  };
}
