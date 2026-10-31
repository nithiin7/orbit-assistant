/** Reminder display rules, recurrence presets, and the form schema mirroring the API. */

import type {
  CreateReminderRequest,
  Recurrence,
  Reminder,
  ReminderListQuery,
  ReminderStatus,
  Weekday,
} from "@orbit/contracts";
import { array, mixed, object, string } from "yup";

import { type Option } from "@/utils/common";
import { daysBetween } from "@/utils/dates";
import { localParts } from "@/utils/time-zones";
import { multiLineText, singleLineText } from "@/utils/validation";

export const REMINDER_TITLE_MAX_LENGTH = 200;
export const REMINDER_DESCRIPTION_MAX_LENGTH = 2000;
/** The most reminders the Reminders page loads at once. */
export const REMINDER_PAGE_SIZE = 200;

/** In the API's order, Monday first. */
export const WEEKDAYS: readonly Option<Weekday>[] = [
  { value: "mon", label: "Mon" },
  { value: "tue", label: "Tue" },
  { value: "wed", label: "Wed" },
  { value: "thu", label: "Thu" },
  { value: "fri", label: "Fri" },
  { value: "sat", label: "Sat" },
  { value: "sun", label: "Sun" },
];

const WORKDAYS: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri"];

/** How a reminder repeats, as offered in the form. `weekdays` is weekly on Monday to Friday. */
export type Repeat = "none" | "daily" | "weekdays" | "weekly" | "monthly";

export const REPEATS: readonly Option<Repeat>[] = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Every weekday (Mon–Fri)" },
  { value: "weekly", label: "Weekly on chosen days" },
  { value: "monthly", label: "Every month" },
];

/** A `YYYY-MM-DD` date's weekday, independent of the viewer's time zone. */
export function weekdayOf(date: string): Weekday {
  const [year = 1970, month = 1, day = 1] = date.split("-").map(Number);
  // getUTCDay: Sunday is 0. The API's weekdays start on Monday.
  const index = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
  return WEEKDAYS[index]?.value ?? "mon";
}

function sameDays(a: readonly Weekday[], b: readonly Weekday[]): boolean {
  return a.length === b.length && a.every((day) => b.includes(day));
}

export function toRecurrence(repeat: Repeat, weekdays: readonly Weekday[]): Recurrence | null {
  switch (repeat) {
    case "none":
      return null;
    case "weekdays":
      return { frequency: "weekly", weekdays: [...WORKDAYS] };
    case "weekly":
      // In weekday order, as the API returns them.
      return {
        frequency: "weekly",
        weekdays: WEEKDAYS.map((day) => day.value).filter((day) => weekdays.includes(day)),
      };
    default:
      return { frequency: repeat, weekdays: [] };
  }
}

export function toRepeat(recurrence: Recurrence | null): Repeat {
  if (!recurrence) return "none";
  if (recurrence.frequency !== "weekly") return recurrence.frequency;
  return sameDays(recurrence.weekdays ?? [], WORKDAYS) ? "weekdays" : "weekly";
}

function ordinal(day: number): string {
  const rule = new Intl.PluralRules("en", { type: "ordinal" }).select(day);
  const suffix = { one: "st", two: "nd", few: "rd" }[rule as "one" | "two" | "few"] ?? "th";
  return `${day}${suffix}`;
}

/** "Every day", "Weekly on Mon, Thu", "Monthly on the 31st (or the month’s last day)". */
export function describeRecurrence(recurrence: Recurrence | null, startDate: string): string {
  if (!recurrence) return "Once";
  switch (recurrence.frequency) {
    case "daily":
      return "Every day";
    case "weekly": {
      const days = recurrence.weekdays ?? [];
      if (sameDays(days, WORKDAYS)) return "Every weekday";
      if (days.length === 7) return "Every day";
      const labels = WEEKDAYS.filter((day) => days.includes(day.value)).map((day) => day.label);
      return `Weekly on ${labels.join(", ")}`;
    }
    case "monthly": {
      const day = Number(startDate.slice(8, 10));
      return day > 28
        ? `Monthly on the ${ordinal(day)} (or the month’s last day)`
        : `Monthly on the ${ordinal(day)}`;
    }
  }
}

/** The page's status tabs; `all` sends no filter. */
export type ReminderFilter = ReminderStatus | "all";

export const REMINDER_FILTERS: readonly Option<ReminderFilter>[] = [
  { value: "scheduled", label: "Upcoming" },
  { value: "overdue", label: "Overdue" },
  { value: "completed", label: "Completed" },
  { value: "disabled", label: "Disabled" },
  { value: "all", label: "All" },
];

export function toReminderListQuery(filter: ReminderFilter): ReminderListQuery {
  return { status: filter === "all" ? undefined : filter, limit: REMINDER_PAGE_SIZE };
}

/**
 * When a reminder fires, on its own time zone's clock: "Today, 9:00 AM", "Tomorrow, 9:00 AM",
 * or "Tue, Jan 15, 9:00 AM" (with the year when it isn't this year).
 */
export function formatOccurrence(at: string, timeZone: string, now: Date = new Date()): string {
  const instant = new Date(at);
  const time = new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
  const day = localParts(instant, timeZone).date;
  const today = localParts(now, timeZone).date;
  const tomorrow = localParts(new Date(now.getTime() + 86_400_000), timeZone).date;
  if (day === today) return `Today, ${time}`;
  if (day === tomorrow) return `Tomorrow, ${time}`;
  const date = new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: day.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric",
  }).format(instant);
  return `${date}, ${time}`;
}

/** A short "3 min ago" or "Jan 15" for when a notification arrived. */
export function formatReceived(at: string, now: Date = new Date()): string {
  const minutes = Math.round((now.getTime() - new Date(at).getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    new Date(at),
  );
}

/** The next whole hour on the wall clock of `timeZone`: a sensible default for a new reminder. */
export function nextHour(timeZone: string, now: Date = new Date()): { date: string; time: string } {
  const hour = new Date(Math.ceil((now.getTime() + 1) / 3_600_000) * 3_600_000);
  return localParts(hour, timeZone);
}

export type FireGroupKey = "overdue" | "today" | "tomorrow" | "week" | "later" | "none";

export type FireGroup<T> = { key: FireGroupKey; label: string; reminders: T[] };

const FIRE_GROUPS: readonly Option<FireGroupKey>[] = [
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "week", label: "Next 7 days" },
  { value: "later", label: "Later" },
  { value: "none", label: "Not scheduled" },
];

type Groupable = Pick<Reminder, "status" | "next_occurrence_at">;

/** Which section a reminder falls in by when it next fires, on the calendar of `timeZone`. */
export function fireGroupOf(
  reminder: Groupable,
  timeZone: string,
  now: Date = new Date(),
): FireGroupKey {
  if (reminder.status === "overdue") return "overdue";
  if (!reminder.next_occurrence_at) return "none";
  const days = daysBetween(
    localParts(now, timeZone).date,
    localParts(new Date(reminder.next_occurrence_at), timeZone).date,
  );
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return days < 7 ? "week" : "later";
}

/**
 * Reminders split into sections by when they next fire, judged by the calendar in `timeZone`
 * (the viewer's), soonest first. Overdue reminders lead; those with nothing left to fire come
 * last. Reminders keep their order within a section, and empty sections are left out.
 */
export function groupRemindersByFire<T extends Groupable>(
  reminders: readonly T[],
  timeZone: string,
  now: Date = new Date(),
): FireGroup<T>[] {
  const buckets = new Map<FireGroupKey, T[]>();
  for (const reminder of reminders) {
    const key = fireGroupOf(reminder, timeZone, now);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(reminder);
    else buckets.set(key, [reminder]);
  }
  return FIRE_GROUPS.flatMap(({ value, label }) => {
    const group = buckets.get(value);
    return group ? [{ key: value, label, reminders: group }] : [];
  });
}

export const STATUS_LABELS: Record<ReminderStatus, string> = {
  scheduled: "Upcoming",
  overdue: "Overdue",
  completed: "Completed",
  disabled: "Disabled",
};

/** Why a reminder that won't fire looks the way it does, for a short hint under it. */
export function statusHint(reminder: Reminder): string | null {
  if (reminder.status === "overdue") {
    return reminder.last_outcome === "failed"
      ? "The last delivery failed. Orbit will keep trying the next time."
      : "Due now. It will arrive in your notifications shortly.";
  }
  if (reminder.status === "completed" && reminder.task?.status === "completed") {
    return "Paused while its task is completed.";
  }
  return null;
}

const repeatField = mixed<Repeat>()
  .oneOf(REPEATS.map((item) => item.value))
  .defined();

export const reminderSchema = object({
  title: singleLineText(REMINDER_TITLE_MAX_LENGTH).required("Enter a title."),
  description: multiLineText(REMINDER_DESCRIPTION_MAX_LENGTH),
  /** `""` for a standalone reminder. */
  taskId: string().defined(),
  date: string().defined().required("Choose a date."),
  time: string()
    .defined()
    .required("Choose a time.")
    .matches(/^\d{2}:\d{2}$/, "Choose a time."),
  timeZone: string().defined().required("Choose a time zone."),
  repeat: repeatField,
  weekdays: array(mixed<Weekday>().defined())
    .defined()
    .when("repeat", {
      is: "weekly",
      then: (schema) => schema.min(1, "Choose at least one day."),
    }),
});

export type ReminderFormValues = {
  title: string;
  description: string;
  taskId: string;
  date: string;
  time: string;
  timeZone: string;
  repeat: Repeat;
  weekdays: Weekday[];
};

/** The form's values for an existing reminder. */
export function toFormValues(reminder: Reminder): ReminderFormValues {
  const repeat = toRepeat(reminder.recurrence);
  return {
    title: reminder.title,
    description: reminder.description,
    taskId: reminder.task?.id ?? "",
    date: reminder.start_date,
    time: reminder.time_of_day.slice(0, 5),
    timeZone: reminder.timezone,
    repeat,
    weekdays:
      repeat === "weekly"
        ? [...(reminder.recurrence?.weekdays ?? [])]
        : [weekdayOf(reminder.start_date)],
  };
}

/**
 * The reminder fields the form edits. `enabled` is left out, so editing a disabled reminder
 * doesn't switch it back on; new reminders are created enabled.
 */
export type ReminderFields = Omit<CreateReminderRequest, "enabled">;

/** The API request for the form's (validated) values. */
export function toReminderRequest(values: ReminderFormValues): ReminderFields {
  return {
    title: values.title,
    description: values.description,
    task_id: values.taskId || null,
    start_date: values.date,
    time_of_day: values.time,
    timezone: values.timeZone,
    recurrence: toRecurrence(values.repeat, values.weekdays),
  };
}
