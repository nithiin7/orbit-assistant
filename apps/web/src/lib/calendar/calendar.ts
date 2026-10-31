/**
 * Calendar rules for the web app: views and their date ranges, navigation, the URL, placing
 * occurrences and tasks on days and time grids, the event form, and recurrence and alert labels.
 *
 * Times come from the API two ways. Timed occurrences and scheduled tasks are instants
 * (`start_at`, `scheduled_start`), shown on the viewer's wall clock. All-day occurrences are
 * calendar dates (`start`, `end` exclusive), shown on those dates in any time zone, as the API
 * matches them.
 */

import type {
  CalendarCategoryColor,
  CalendarEvent,
  CalendarOccurrence,
  CalendarView,
  CreateCalendarEventRequest,
  EventRecurrenceFrequency,
  EventRecurrenceRule,
  Task,
  Weekday,
} from "@orbit/contracts";
import { array, boolean, mixed, number, object, string } from "yup";

import type { Option } from "@/utils/common";
import {
  addDays,
  addMonths,
  calendarWeeks,
  dayOfWeek,
  daysBetween,
  formatCalendarDate,
  parseCalendarDate,
} from "@/utils/dates";
import { localParts, zonedTimeToInstant } from "@/utils/time-zones";
import { multiLineText, singleLineText } from "@/utils/validation";

export const CALENDAR_PATH = "/calendar";
export const EVENT_TITLE_MAX_LENGTH = 200;
export const EVENT_DESCRIPTION_MAX_LENGTH = 5000;
export const EVENT_LOCATION_MAX_LENGTH = 200;
export const MAX_ALERTS = 5;
export const MAX_ALERT_MINUTES = 40_320;
/** Snapping for dragging and resizing on the time grid. */
export const SNAP_MINUTES = 15;
export const MINUTES_PER_DAY = 1440;

export const CALENDAR_VIEWS: readonly Option<CalendarView>[] = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
  { value: "agenda", label: "Agenda" },
];

function isView(value: string | null): value is CalendarView {
  return CALENDAR_VIEWS.some((view) => view.value === value);
}

function isDate(value: string | null): value is string {
  return value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

/** What the calendar page shows: the view and the date it's centered on. */
export type CalendarLocation = { view: CalendarView; date: string };

/** Read the page's state from the URL; anything missing or malformed falls back. */
export function parseCalendarLocation(
  params: Pick<URLSearchParams, "get">,
  fallback: { view: CalendarView; date: string },
): CalendarLocation {
  const view = params.get("view");
  const date = params.get("date");
  return {
    view: isView(view) ? view : fallback.view,
    date: isDate(date) ? date : fallback.date,
  };
}

export function calendarHref(location: Partial<CalendarLocation>): string {
  const params = new URLSearchParams();
  if (location.view) params.set("view", location.view);
  if (location.date) params.set("date", location.date);
  const query = params.toString();
  return query ? `${CALENDAR_PATH}?${query}` : CALENDAR_PATH;
}

/** The first day of the week containing `date`, weeks starting on `weekStart` (0 is Sunday). */
export function startOfWeek(date: string, weekStart: number): string {
  return addDays(date, -((dayOfWeek(date) - weekStart + 7) % 7));
}

/** The seven dates of the week containing `date`. */
export function weekDates(date: string, weekStart: number): string[] {
  const first = startOfWeek(date, weekStart);
  return Array.from({ length: 7 }, (_, index) => addDays(first, index));
}

export const AGENDA_DAYS = 14;

/** The local dates `[start, end)` a view shows. A month view covers its whole-week grid. */
export function visibleRange(
  view: CalendarView,
  date: string,
  weekStart: number,
): { start: string; end: string } {
  switch (view) {
    case "month": {
      const weeks = calendarWeeks(date.slice(0, 7), weekStart);
      const last = weeks.at(-1)?.at(-1) ?? date;
      return { start: weeks[0]?.[0] ?? date, end: addDays(last, 1) };
    }
    case "week": {
      const start = startOfWeek(date, weekStart);
      return { start, end: addDays(start, 7) };
    }
    case "day":
      return { start: date, end: addDays(date, 1) };
    case "agenda":
      return { start: date, end: addDays(date, AGENDA_DAYS) };
  }
}

/** `date` moved one view's worth forward (`1`) or back (`-1`). */
export function shiftDate(view: CalendarView, date: string, direction: number): string {
  switch (view) {
    case "month":
      return addMonths(`${date.slice(0, 7)}-01`, direction);
    case "week":
      return addDays(date, 7 * direction);
    case "day":
      return addDays(date, direction);
    case "agenda":
      return addDays(date, AGENDA_DAYS * direction);
  }
}

function utcDate(value: string): Date {
  const { year, month, day } = parseCalendarDate(value);
  return new Date(Date.UTC(year, month - 1, day));
}

/** A heading for the range a view shows, such as "November 2026" or "Nov 2 – 8, 2026". */
export function rangeTitle(view: CalendarView, date: string, weekStart: number): string {
  const format = (value: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(undefined, { ...options, timeZone: "UTC" }).format(utcDate(value));
  if (view === "month") return format(date, { month: "long", year: "numeric" });
  if (view === "day") {
    return format(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }
  const { start, end } = visibleRange(view, date, weekStart);
  const last = addDays(end, -1);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).formatRange(utcDate(start), utcDate(last));
}

/** "Mon 2" style column headings. */
export function dayHeading(date: string): { weekday: string; day: number } {
  return {
    weekday: new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" }).format(
      utcDate(date),
    ),
    day: parseCalendarDate(date).day,
  };
}

/** Weekday names in grid order, starting on `weekStart`. */
export function weekdayNames(weekStart: number, style: "short" | "narrow" = "short"): string[] {
  // 2023-01-01 was a Sunday.
  return Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(undefined, { weekday: style, timeZone: "UTC" }).format(
      utcDate(addDays("2023-01-01", (weekStart + index) % 7)),
    ),
  );
}

// Placing items

/** Something the calendar shows: an event occurrence, or a task (scheduled, or due that day). */
export type CalendarItem =
  | { kind: "event"; id: string; occurrence: CalendarOccurrence }
  | { kind: "task"; id: string; task: Task; due: boolean };

export function eventItem(occurrence: CalendarOccurrence): CalendarItem {
  return { kind: "event", id: occurrence.id, occurrence };
}

export function taskItem(task: Task, due = false): CalendarItem {
  return { kind: "task", id: `task:${task.id}${due ? ":due" : ""}`, task, due };
}

/** Whether an item belongs in the all-day row: all-day events and due (unscheduled) tasks. */
export function isAllDay(item: CalendarItem): boolean {
  return item.kind === "event" ? item.occurrence.all_day : item.due;
}

/** The local dates `[start, end)` an all-day item covers. */
export function allDayDates(item: CalendarItem): { start: string; end: string } {
  if (item.kind === "event") {
    const { start, end } = item.occurrence;
    const first = start.slice(0, 10);
    const after = end.slice(0, 10);
    return { start: first, end: after > first ? after : addDays(first, 1) };
  }
  const due = item.task.due_date ?? "";
  return { start: due, end: addDays(due, 1) };
}

/** A timed item's instants. */
export function itemInstants(item: CalendarItem): { start: string; end: string } {
  if (item.kind === "event")
    return { start: item.occurrence.start_at, end: item.occurrence.end_at };
  return { start: item.task.scheduled_start ?? "", end: item.task.scheduled_end ?? "" };
}

function minutesOf(time: string): number {
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  return hour * 60 + minute;
}

/** `570` as `09:30`. */
export function timeOfMinutes(minutes: number): string {
  const clamped = Math.max(0, Math.min(MINUTES_PER_DAY - 1, minutes));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

/** Where a timed item sits on one day's grid, in minutes from local midnight. */
export type DaySegment = {
  item: CalendarItem;
  start: number;
  end: number;
  /** The item started before this day or continues after it. */
  continuesBefore: boolean;
  continuesAfter: boolean;
};

/** A timed item's part on `date`, on the viewer's wall clock, or `null` if it's not that day. */
export function segmentOn(item: CalendarItem, date: string, timeZone: string): DaySegment | null {
  const { start, end } = itemInstants(item);
  const from = localParts(new Date(start), timeZone);
  const to = localParts(new Date(end), timeZone);
  if (from.date > date || to.date < date) return null;
  const startMinutes = from.date < date ? 0 : minutesOf(from.time);
  const endMinutes = to.date > date ? MINUTES_PER_DAY : minutesOf(to.time);
  // An item that ends exactly at midnight doesn't continue into that day.
  if (to.date === date && from.date < date && endMinutes === 0) return null;
  return {
    item,
    start: startMinutes,
    end: Math.max(endMinutes, startMinutes),
    continuesBefore: from.date < date,
    continuesAfter: to.date > date,
  };
}

/** A segment placed in side-by-side columns where segments overlap. */
export type PlacedSegment = DaySegment & { column: number; columns: number };

/**
 * Lay out one day's segments: overlapping segments share the width in columns, each taking the
 * first free column; each cluster of overlaps is as wide as its busiest moment needs.
 */
export function layoutDay(segments: readonly DaySegment[], minimumLength = 20): PlacedSegment[] {
  const sorted = [...segments].sort(
    (a, b) => a.start - b.start || b.end - a.end || a.item.id.localeCompare(b.item.id),
  );
  const placed: PlacedSegment[] = [];
  let cluster: PlacedSegment[] = [];
  let clusterEnd = -1;
  let columnEnds: number[] = [];

  const closeCluster = () => {
    const width = columnEnds.length;
    for (const segment of cluster) segment.columns = width;
    cluster = [];
    columnEnds = [];
  };

  for (const segment of sorted) {
    // Very short items still need room to read, so they occupy at least `minimumLength`.
    const visibleEnd = Math.max(segment.end, segment.start + minimumLength);
    if (segment.start >= clusterEnd) closeCluster();
    let column = columnEnds.findIndex((end) => end <= segment.start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(visibleEnd);
    } else {
      columnEnds[column] = visibleEnd;
    }
    const entry: PlacedSegment = { ...segment, column, columns: 1 };
    cluster.push(entry);
    placed.push(entry);
    clusterEnd = Math.max(clusterEnd, visibleEnd);
  }
  closeCluster();
  return placed;
}

/** The items to list under one day of the month view or agenda, all-day first, then by time. */
export function itemsOnDay(
  items: readonly CalendarItem[],
  date: string,
  timeZone: string,
): CalendarItem[] {
  const allDay: CalendarItem[] = [];
  const timed: { item: CalendarItem; start: number }[] = [];
  for (const item of items) {
    if (isAllDay(item)) {
      const { start, end } = allDayDates(item);
      if (start <= date && date < end) allDay.push(item);
      continue;
    }
    const segment = segmentOn(item, date, timeZone);
    if (segment) timed.push({ item, start: segment.continuesBefore ? -1 : segment.start });
  }
  timed.sort((a, b) => a.start - b.start || itemTitle(a.item).localeCompare(itemTitle(b.item)));
  return [...allDay, ...timed.map((entry) => entry.item)];
}

export function itemTitle(item: CalendarItem): string {
  return item.kind === "event" ? item.occurrence.title : item.task.title;
}

/** Local time labels, such as "9:30 AM – 10:00 AM", on the viewer's clock. */
export function formatTimeRange(start: string, end: string, timeZone: string): string {
  const format = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
  return start === end
    ? format.format(new Date(start))
    : format.formatRange(new Date(start), new Date(end));
}

export function formatTime(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(instant));
}

/** A one-line "when" for an item: "All day", "Due", or a time range on the viewer's clock. */
export function describeWhen(item: CalendarItem, timeZone: string): string {
  if (item.kind === "task" && item.due) return "Due";
  if (item.kind === "event" && item.occurrence.all_day) {
    const { start, end } = allDayDates(item);
    const days = daysBetween(start, end);
    return days > 1
      ? `All day · ${formatCalendarDate(start)} – ${formatCalendarDate(addDays(end, -1))}`
      : "All day";
  }
  const { start, end } = itemInstants(item);
  return formatTimeRange(start, end, timeZone);
}

// Moving and scheduling

/**
 * An occurrence moved to start at `minutes` past midnight on `date` (the viewer's clock), keeping
 * its length; or resized to end there. Returns the new local times in the event's own time zone,
 * as the API expects them (`YYYY-MM-DDTHH:MM`).
 */
export function movedTimes(
  occurrence: CalendarOccurrence,
  change: { date: string; minutes: number; edge: "start" | "end" },
  viewerTimeZone: string,
): { start: string; end: string } {
  const length = Date.parse(occurrence.end_at) - Date.parse(occurrence.start_at);
  const instant = zonedTimeToInstant(change.date, timeOfMinutes(change.minutes), viewerTimeZone);
  const start = change.edge === "start" ? instant : new Date(Date.parse(occurrence.start_at));
  const end =
    change.edge === "start"
      ? new Date(instant.getTime() + length)
      : new Date(Math.max(instant.getTime(), start.getTime() + SNAP_MINUTES * 60_000));
  const local = (at: Date) => {
    const parts = localParts(at, occurrence.timezone);
    return `${parts.date}T${parts.time}`;
  };
  return { start: local(start), end: local(end) };
}

/** An all-day occurrence moved to start on `date`, keeping how many days it spans. */
export function movedDates(
  occurrence: CalendarOccurrence,
  date: string,
): { start: string; end: string } {
  const from = occurrence.start.slice(0, 10);
  const days = Math.max(1, daysBetween(from, occurrence.end.slice(0, 10)));
  return { start: `${date}T00:00`, end: `${addDays(date, days)}T00:00` };
}

/** A timed occurrence moved to another date in the month view, keeping its time of day. */
export function movedToDate(
  occurrence: CalendarOccurrence,
  date: string,
): { start: string; end: string } {
  const shift = daysBetween(occurrence.start.slice(0, 10), date);
  const move = (value: string) => `${addDays(value.slice(0, 10), shift)}${value.slice(10, 16)}`;
  return { start: move(occurrence.start), end: move(occurrence.end) };
}

/** A task's scheduled block starting at `minutes` on `date` on the viewer's clock. */
export function taskSchedule(
  date: string,
  minutes: number,
  lengthMinutes: number,
  timeZone: string,
): { scheduled_start: string; scheduled_end: string } {
  const start = zonedTimeToInstant(date, timeOfMinutes(minutes), timeZone);
  const end = new Date(start.getTime() + lengthMinutes * 60_000);
  return { scheduled_start: start.toISOString(), scheduled_end: end.toISOString() };
}

export function snap(minutes: number, step = SNAP_MINUTES): number {
  return Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(minutes / step) * step));
}

// Categories

/** Classes for each palette color: a tinted block with an accent edge, and a solid dot. */
export const CATEGORY_STYLES: Record<CalendarCategoryColor, { block: string; dot: string }> = {
  blue: { block: "border-event-blue bg-event-blue/15", dot: "bg-event-blue" },
  green: { block: "border-event-green bg-event-green/15", dot: "bg-event-green" },
  amber: { block: "border-event-amber bg-event-amber/20", dot: "bg-event-amber" },
  rose: { block: "border-event-rose bg-event-rose/15", dot: "bg-event-rose" },
  violet: { block: "border-event-violet bg-event-violet/15", dot: "bg-event-violet" },
  teal: { block: "border-event-teal bg-event-teal/15", dot: "bg-event-teal" },
  orange: { block: "border-event-orange bg-event-orange/15", dot: "bg-event-orange" },
  slate: { block: "border-event-slate bg-event-slate/15", dot: "bg-event-slate" },
};

export const CATEGORY_COLORS: readonly Option<CalendarCategoryColor>[] = [
  { value: "blue", label: "Blue" },
  { value: "green", label: "Green" },
  { value: "amber", label: "Amber" },
  { value: "rose", label: "Rose" },
  { value: "violet", label: "Violet" },
  { value: "teal", label: "Teal" },
  { value: "orange", label: "Orange" },
  { value: "slate", label: "Slate" },
];

// Alerts

export const ALERT_PRESETS: readonly number[] = [0, 5, 15, 30, 60, 1440];

/** "At start", "15 minutes before", "1 hour before", "2 days before". */
export function describeAlert(minutes: number): string {
  if (minutes === 0) return "At start";
  const units: [number, string][] = [
    [10_080, "week"],
    [1440, "day"],
    [60, "hour"],
  ];
  for (const [size, unit] of units) {
    if (minutes % size === 0) {
      const count = minutes / size;
      return `${count} ${unit}${count === 1 ? "" : "s"} before`;
    }
  }
  return `${minutes} minute${minutes === 1 ? "" : "s"} before`;
}

// Recurrence

export const WEEKDAY_OPTIONS: readonly Option<Weekday>[] = [
  { value: "mon", label: "Mon" },
  { value: "tue", label: "Tue" },
  { value: "wed", label: "Wed" },
  { value: "thu", label: "Thu" },
  { value: "fri", label: "Fri" },
  { value: "sat", label: "Sat" },
  { value: "sun", label: "Sun" },
];

/** The API's weekday name for a `YYYY-MM-DD` date. */
export function weekdayOf(date: string): Weekday {
  return WEEKDAY_OPTIONS[(dayOfWeek(date) + 6) % 7]?.value ?? "mon";
}

export type Repeat = "none" | EventRecurrenceFrequency;

export const REPEATS: readonly Option<Repeat>[] = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

export type RepeatEnd = "never" | "count" | "until";

export const REPEAT_ENDS: readonly Option<RepeatEnd>[] = [
  { value: "never", label: "Never" },
  { value: "count", label: "After a number of times" },
  { value: "until", label: "On a date" },
];

const UNITS: Record<EventRecurrenceFrequency, [string, string]> = {
  daily: ["day", "days"],
  weekly: ["week", "weeks"],
  monthly: ["month", "months"],
  yearly: ["year", "years"],
};

/** "Every 2 weeks on Mon, Wed, until Mar 3, 2030", in the API's terms. */
export function describeRule(rule: EventRecurrenceRule | null, startDate: string): string {
  if (!rule) return "Does not repeat";
  const interval = rule.interval ?? 1;
  const [one, many] = UNITS[rule.frequency];
  let text = interval === 1 ? `Every ${one}` : `Every ${interval} ${many}`;
  if (rule.frequency === "weekly") {
    const days = WEEKDAY_OPTIONS.filter((day) => rule.weekdays?.includes(day.value));
    text += ` on ${days.map((day) => day.label).join(", ")}`;
  }
  const { month, day } = parseCalendarDate(startDate);
  if (rule.frequency === "monthly") {
    text += ` on day ${day}`;
    if (day > 28) text += " (or the month’s last day)";
  }
  if (rule.frequency === "yearly") {
    text += ` on ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(2024, month - 1, day)))}`;
  }
  if (rule.count) text += `, ${rule.count} time${rule.count === 1 ? "" : "s"}`;
  if (rule.until) text += `, until ${formatCalendarDate(rule.until)}`;
  return text;
}

// The event form

export type EventFormValues = {
  title: string;
  description: string;
  location: string;
  /** `""` for no category. */
  categoryId: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  /** For all-day events, the last day (inclusive). */
  endDate: string;
  endTime: string;
  timeZone: string;
  repeat: Repeat;
  interval: number;
  weekdays: Weekday[];
  ends: RepeatEnd;
  count: number;
  until: string;
  alerts: number[];
};

const TIME = /^\d{2}:\d{2}$/;

function endsAfterStart(values: {
  allDay?: boolean;
  startDate?: string;
  startTime?: string;
  endDate?: string;
  endTime?: string;
}): boolean {
  const { allDay, startDate = "", startTime = "", endDate = "", endTime = "" } = values;
  if (!startDate || !endDate) return true;
  if (allDay) return endDate >= startDate;
  return `${endDate}T${endTime}` >= `${startDate}T${startTime}`;
}

export const eventSchema = object({
  title: singleLineText(EVENT_TITLE_MAX_LENGTH).required("Enter a title."),
  description: multiLineText(EVENT_DESCRIPTION_MAX_LENGTH),
  location: singleLineText(EVENT_LOCATION_MAX_LENGTH),
  categoryId: string().defined(),
  allDay: boolean().defined(),
  startDate: string().defined().required("Choose a start date."),
  startTime: string()
    .defined()
    .when("allDay", {
      is: false,
      then: (schema) => schema.matches(TIME, "Choose a start time."),
    }),
  endDate: string()
    .defined()
    .required("Choose an end date.")
    .test("after-start", "The end can’t be before the start.", (_, context) =>
      endsAfterStart(context.parent as Partial<EventFormValues>),
    ),
  endTime: string()
    .defined()
    .when("allDay", {
      is: false,
      then: (schema) => schema.matches(TIME, "Choose an end time."),
    }),
  timeZone: string().defined().required("Choose a time zone."),
  repeat: mixed<Repeat>()
    .oneOf(REPEATS.map((option) => option.value))
    .defined(),
  interval: number()
    .defined()
    .integer("Use a whole number.")
    .min(1, "Repeat at least every 1.")
    .max(99, "Repeat at most every 99."),
  weekdays: array(mixed<Weekday>().defined())
    .defined()
    .when("repeat", {
      is: "weekly",
      then: (schema) => schema.min(1, "Choose at least one day."),
    }),
  ends: mixed<RepeatEnd>()
    .oneOf(REPEAT_ENDS.map((option) => option.value))
    .defined(),
  count: number()
    .defined()
    .integer("Use a whole number.")
    .when("ends", {
      is: "count",
      then: (schema) => schema.min(1, "At least once.").max(999, "At most 999 times."),
    }),
  until: string()
    .defined()
    .when("ends", {
      is: "until",
      then: (schema) =>
        schema
          .required("Choose an end date.")
          .test("after-start", "The series can’t end before it starts.", (value, context) => {
            const { startDate = "" } = context.parent as Partial<EventFormValues>;
            return !value || !startDate || value >= startDate;
          }),
    }),
  alerts: array(number().defined().integer().min(0).max(MAX_ALERT_MINUTES))
    .defined()
    .max(MAX_ALERTS, `At most ${MAX_ALERTS} alerts.`),
});

/** New-event values: `date` at `minutes` past midnight (or the next hour), lasting an hour. */
export function newEventValues(
  timeZone: string,
  start: { date: string; minutes?: number; endMinutes?: number; allDay?: boolean },
): EventFormValues {
  const startMinutes = start.minutes ?? 9 * 60;
  const endMinutes = Math.min(start.endMinutes ?? startMinutes + 60, MINUTES_PER_DAY - 1);
  return {
    title: "",
    description: "",
    location: "",
    categoryId: "",
    allDay: start.allDay ?? false,
    startDate: start.date,
    startTime: timeOfMinutes(startMinutes),
    endDate: start.date,
    endTime: timeOfMinutes(endMinutes),
    timeZone,
    repeat: "none",
    interval: 1,
    weekdays: [weekdayOf(start.date)],
    ends: "never",
    count: 10,
    until: "",
    alerts: [],
  };
}

/** The form's values for an existing event or series. */
export function toEventFormValues(event: CalendarEvent): EventFormValues {
  const rule = event.recurrence;
  const startDate = event.start.slice(0, 10);
  const endDate = event.all_day ? addDays(event.end.slice(0, 10), -1) : event.end.slice(0, 10);
  return {
    title: event.title,
    description: event.description,
    location: event.location,
    categoryId: event.category_id ?? "",
    allDay: event.all_day,
    startDate,
    startTime: event.all_day ? "09:00" : event.start.slice(11, 16),
    endDate,
    endTime: event.all_day ? "10:00" : event.end.slice(11, 16),
    timeZone: event.timezone,
    repeat: rule?.frequency ?? "none",
    interval: rule?.interval ?? 1,
    weekdays: rule?.weekdays?.length ? [...rule.weekdays] : [weekdayOf(startDate)],
    ends: rule?.count ? "count" : rule?.until ? "until" : "never",
    count: rule?.count ?? 10,
    until: rule?.until ?? "",
    alerts: [...event.alerts],
  };
}

export function toRule(values: EventFormValues): EventRecurrenceRule | null {
  if (values.repeat === "none") return null;
  const weekdays =
    values.repeat === "weekly"
      ? // The start date's weekday is always included, as the API requires.
        WEEKDAY_OPTIONS.map((day) => day.value).filter(
          (day) => values.weekdays.includes(day) || day === weekdayOf(values.startDate),
        )
      : [];
  return {
    frequency: values.repeat,
    interval: values.interval,
    weekdays,
    count: values.ends === "count" ? values.count : null,
    until: values.ends === "until" ? values.until : null,
  };
}

/** The fields a create or a whole-series update sends. */
export type EventFields = Omit<CreateCalendarEventRequest, "note_ids" | "task_ids" | "status">;

export function toEventRequest(values: EventFormValues): EventFields {
  const start = values.allDay
    ? `${values.startDate}T00:00`
    : `${values.startDate}T${values.startTime}`;
  const end = values.allDay
    ? `${addDays(values.endDate, 1)}T00:00`
    : `${values.endDate}T${values.endTime}`;
  return {
    title: values.title.trim(),
    description: values.description.trim(),
    location: values.location.trim(),
    category_id: values.categoryId || null,
    all_day: values.allDay,
    start,
    end,
    timezone: values.timeZone,
    recurrence: toRule(values),
    alerts: [...new Set(values.alerts)].sort((a, b) => a - b),
  };
}

// Dates for a viewer

/** Today's date on `timeZone`'s calendar. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return localParts(now, timeZone).date;
}

/** Minutes past local midnight now, on `timeZone`'s clock. */
export function minutesNow(timeZone: string, now: Date = new Date()): number {
  return minutesOf(localParts(now, timeZone).time);
}

/** The agenda's day label: "Today", "Tomorrow", or "Mon, Nov 2". */
export function agendaDayLabel(date: string, today: string): string {
  const offset = daysBetween(today, date);
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: parseCalendarDate(date).year === parseCalendarDate(today).year ? undefined : "numeric",
    timeZone: "UTC",
  }).format(utcDate(date));
}

/** The viewer-local date an item starts on (all-day: its first date). */
export function itemDate(item: CalendarItem, timeZone: string): string {
  if (isAllDay(item)) return allDayDates(item).start;
  return localParts(new Date(itemInstants(item).start), timeZone).date;
}

/** Group items by the date they start on, in order. */
export function groupByDate(
  items: readonly CalendarItem[],
  timeZone: string,
): { date: string; items: CalendarItem[] }[] {
  const groups = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const date = itemDate(item, timeZone);
    const group = groups.get(date);
    if (group) group.push(item);
    else groups.set(date, [item]);
  }
  return [...groups.entries()].map(([date, entries]) => ({ date, items: entries }));
}

/** The occurrence's original start as the API's path segment (`YYYY-MM-DDTHH:MM`). */
export function occurrenceKey(occurrence: CalendarOccurrence): string {
  return occurrence.original_start.slice(0, 16);
}

/** How long a task block lasts when scheduled without a length: an hour. */
export const DEFAULT_TASK_MINUTES = 60;

/** Week start for a viewer: their preference, else their locale's. */
export function resolveWeekStart(preference: number | null | undefined, locale: number): number {
  return preference ?? locale;
}

/** Minutes for "HH:MM" (or "HH:MM:SS"). */
export function minutesOfTime(time: string): number {
  return minutesOf(time.slice(0, 5));
}

// Scheduling a task without dragging

export const TASK_LENGTHS: readonly Option<string>[] = [
  { value: "15", label: "15 minutes" },
  { value: "30", label: "30 minutes" },
  { value: "60", label: "1 hour" },
  { value: "90", label: "1.5 hours" },
  { value: "120", label: "2 hours" },
  { value: "180", label: "3 hours" },
  { value: "240", label: "4 hours" },
];

export type TaskScheduleValues = { date: string; time: string; length: string };

export const taskScheduleSchema = object({
  date: string().defined().required("Choose a date."),
  time: string().defined().matches(TIME, "Choose a time."),
  length: string()
    .defined()
    .oneOf(TASK_LENGTHS.map((option) => option.value)),
});

/** The form's values for a task: its current block, or `date` at `minutes` for an hour. */
export function taskScheduleValues(
  task: Task,
  timeZone: string,
  fallback: { date: string; minutes: number },
): TaskScheduleValues {
  if (task.scheduled_start && task.scheduled_end) {
    const start = localParts(new Date(task.scheduled_start), timeZone);
    const minutes = Math.round(
      (Date.parse(task.scheduled_end) - Date.parse(task.scheduled_start)) / 60_000,
    );
    const length = TASK_LENGTHS.some((option) => option.value === String(minutes))
      ? String(minutes)
      : String(DEFAULT_TASK_MINUTES);
    return { date: start.date, time: start.time, length };
  }
  return {
    date: task.due_date ?? fallback.date,
    time: timeOfMinutes(fallback.minutes),
    length: String(DEFAULT_TASK_MINUTES),
  };
}
