/** Habit and routine display rules, views, and the form schemas mirroring the API. */

import type {
  CreateHabitRequest,
  CreateRoutineRequest,
  Habit,
  HabitColor,
  HabitDayState,
  HabitHeatmapDay,
  HabitIcon,
  HabitKind,
  HabitProgress,
  HabitReminderTime,
  HabitSchedule,
  HabitScheduleType,
  Routine,
  RoutineSession,
  UpdateHabitRequest,
  Weekday,
} from "@orbit/contracts";
import { array, mixed, number, object, string } from "yup";

import { WEEKDAYS } from "@/lib/reminders";
import { type Option } from "@/utils/common";
import { multiLineText, singleLineText } from "@/utils/validation";

export const HABIT_NAME_MAX_LENGTH = 100;
export const HABIT_DESCRIPTION_MAX_LENGTH = 2000;
export const HABIT_UNIT_MAX_LENGTH = 20;
export const MAX_REMINDERS = 5;
export const MAX_STEPS = 30;

// Views

export type HabitView = "today" | "all" | "routines" | "analytics" | "templates" | "archived";

export const HABIT_VIEWS: readonly Option<HabitView>[] = [
  { value: "today", label: "Today" },
  { value: "all", label: "All habits" },
  { value: "routines", label: "Routines" },
  { value: "analytics", label: "Analytics" },
  { value: "templates", label: "Templates" },
  { value: "archived", label: "Archived" },
];

/** The rail section a location belongs to: detail pages sit under their list. */
export function habitSection(location: HabitLocation): HabitView {
  if (location.kind === "habit") return "all";
  if (location.kind === "routine") return "routines";
  return location.view;
}

/** Where the page is: a view, or a habit's or routine's detail page. */
export type HabitLocation =
  | { kind: "view"; view: HabitView }
  | { kind: "habit"; id: string }
  | { kind: "routine"; id: string };

export function parseHabitLocation(params: URLSearchParams): HabitLocation {
  const habit = params.get("habit");
  if (habit) return { kind: "habit", id: habit };
  const routine = params.get("routine");
  if (routine) return { kind: "routine", id: routine };
  const view = params.get("view");
  const known = HABIT_VIEWS.find((option) => option.value === view);
  return { kind: "view", view: known?.value ?? "today" };
}

export function habitsHref(location: HabitLocation): string {
  switch (location.kind) {
    case "habit":
      return `/habits?habit=${encodeURIComponent(location.id)}`;
    case "routine":
      return `/habits?routine=${encodeURIComponent(location.id)}`;
    case "view":
      return location.view === "today" ? "/habits" : `/habits?view=${location.view}`;
  }
}

// Choices

export const HABIT_KINDS: readonly Option<HabitKind>[] = [
  { value: "boolean", label: "Yes or no" },
  { value: "numeric", label: "An amount" },
  { value: "duration", label: "Time spent" },
];

export const SCHEDULE_TYPES: readonly Option<HabitScheduleType>[] = [
  { value: "daily", label: "Every day, or every few days" },
  { value: "weekdays", label: "On chosen weekdays" },
  { value: "weekly_target", label: "A number of times each week" },
  { value: "monthly", label: "On days of the month" },
];

export const HABIT_ICONS: readonly Option<HabitIcon>[] = [
  { value: "sparkles", label: "Sparkles" },
  { value: "book", label: "Book" },
  { value: "dumbbell", label: "Dumbbell" },
  { value: "droplet", label: "Water" },
  { value: "brain", label: "Mind" },
  { value: "moon", label: "Moon" },
  { value: "sun", label: "Sun" },
  { value: "heart", label: "Heart" },
  { value: "leaf", label: "Leaf" },
  { value: "pen", label: "Pen" },
  { value: "music", label: "Music" },
  { value: "coffee", label: "Coffee" },
  { value: "bike", label: "Bike" },
  { value: "footprints", label: "Walk" },
  { value: "wallet", label: "Wallet" },
  { value: "graduation", label: "Study" },
  { value: "briefcase", label: "Work" },
  { value: "smile", label: "Smile" },
];

const WORKDAYS: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri"];

// Descriptions

function ordinal(day: number): string {
  const rule = new Intl.PluralRules("en", { type: "ordinal" }).select(day);
  const suffix = { one: "st", two: "nd", few: "rd" }[rule as "one" | "two" | "few"] ?? "th";
  return `${day}${suffix}`;
}

function listOf(items: readonly string[]): string {
  return new Intl.ListFormat("en", { type: "conjunction" }).format(items);
}

export function describeWeekdays(days: readonly Weekday[]): string {
  if (days.length === 0 || days.length === 7) return "Every day";
  if (days.length === 5 && WORKDAYS.every((day) => days.includes(day))) return "Weekdays";
  if (days.length === 2 && days.includes("sat") && days.includes("sun")) return "Weekends";
  return WEEKDAYS.filter((day) => days.includes(day.value))
    .map((day) => day.label)
    .join(", ");
}

/** "Every day", "Every 3 days", "Mon, Wed, Fri", "On the 1st and 15th", "4 times a week". */
export function describeSchedule(schedule: HabitSchedule): string {
  switch (schedule.type) {
    case "daily": {
      const every = schedule.every ?? 1;
      return every === 1 ? "Every day" : every === 2 ? "Every other day" : `Every ${every} days`;
    }
    case "weekdays":
      return describeWeekdays(schedule.weekdays ?? []);
    case "monthly":
      return `On the ${listOf((schedule.month_days ?? []).map(ordinal))}`;
    case "weekly_target": {
      const times = schedule.times_per_week ?? 1;
      return times === 1 ? "Once a week" : times === 7 ? "7 times a week" : `${times} times a week`;
    }
  }
}

function amount(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

/** "20 min", "1 h 30 min" */
export function formatMinutes(minutes: number): string {
  const whole = Math.round(minutes);
  if (whole < 60) return `${whole} min`;
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** "3 litres", "15 min", or `null` for yes-or-no habits. */
export function describeTarget(habit: Pick<Habit, "kind" | "target" | "unit">): string | null {
  if (habit.kind === "boolean" || habit.target === null) return null;
  if (habit.kind === "duration") return formatMinutes(habit.target);
  return `${amount(habit.target)}${habit.unit ? ` ${habit.unit}` : ""}`;
}

/** "1.5 of 3 litres", "10 of 15 min". */
export function describeProgress(
  habit: Pick<Habit, "kind" | "target" | "unit">,
  value: number,
): string {
  if (habit.kind === "duration") return `${formatMinutes(value)} of ${describeTarget(habit) ?? ""}`;
  return `${amount(value)} of ${describeTarget(habit) ?? ""}`;
}

/** How far the day's entry is toward its target, from 0 to 1. */
export function progressFraction(item: Pick<HabitProgress, "log" | "state">): number {
  if (item.state === "completed" || item.state === "bonus") return 1;
  const log = item.log;
  if (!log || log.status === "skipped" || log.target <= 0) return 0;
  return Math.min(1, log.value / log.target);
}

/** Encouraging, plain labels: a missed day is "Not done", never a failure. */
export const STATE_LABELS: Record<HabitDayState, string> = {
  completed: "Done",
  partial: "In progress",
  skipped: "Skipped",
  missed: "Not done",
  pending: "Not started",
  open: "Any day this week",
  bonus: "Extra",
  unscheduled: "Rest day",
  paused: "Paused",
  inactive: "Not started yet",
};

/** Whether the day still needs doing: shown in Today's "to do" group. */
export function isRemaining(item: Pick<HabitProgress, "state" | "period">): boolean {
  if (item.state === "pending" || item.state === "partial") return true;
  return item.state === "open" && item.period?.state === "pending";
}

export function formatRate(rate: number | null | undefined): string {
  return rate === null || rate === undefined ? "—" : `${Math.round(rate * 100)}%`;
}

export function describeStreak(count: number, unit: "day" | "week"): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** 0 (nothing) to 4 (everything due done) for one heatmap day. */
export function heatLevel(day: HabitHeatmapDay): 0 | 1 | 2 | 3 | 4 {
  if (day.due === 0) return day.extra > 0 ? 2 : 0;
  const share = (day.completed + Math.min(day.extra, day.due - day.completed)) / day.due;
  if (share <= 0) return 0;
  if (share < 0.34) return 1;
  if (share < 0.67) return 2;
  if (share < 1) return 3;
  return 4;
}

// Celebrations

/** The icon shown beside a cheer; the toast maps each to a lucide icon. */
export type CheerIcon =
  | "party"
  | "sparkles"
  | "strength"
  | "star"
  | "thumbs-up"
  | "trophy"
  | "flame"
  | "moon"
  | "popcorn"
  | "film";

/** What to say when a habit's day is done: louder for milestones and a finished day. */
export type Cheer = { icon: CheerIcon; title: string; message: string; big: boolean };

const FIRST_CHEER: { icon: CheerIcon; title: string } = {
  icon: "party",
  title: "Yay, target met!",
};

const CHEERS: readonly { icon: CheerIcon; title: string }[] = [
  FIRST_CHEER,
  { icon: "sparkles", title: "Nailed it!" },
  { icon: "strength", title: "Way to show up!" },
  { icon: "star", title: "Another one done!" },
  { icon: "thumbs-up", title: "Done and dusted!" },
];

/** Streak lengths worth a bigger cheer. */
export const STREAK_MILESTONES: ReadonlySet<number> = new Set([
  3, 7, 14, 21, 30, 50, 75, 100, 150, 200, 365,
]);

/**
 * The cheer for a habit that was just completed. `doneToday` is how many were already done
 * before it, so consecutive check-offs vary; `allDone` means nothing else is left today.
 */
export function cheerFor(
  result: Pick<HabitProgress, "habit" | "current_streak" | "streak_unit">,
  { allDone, doneToday }: { allDone: boolean; doneToday: number },
): Cheer {
  const { habit, current_streak: streak, streak_unit: unit } = result;
  if (allDone) {
    return {
      icon: "trophy",
      title: "All done for today!",
      message: "Every habit for today is checked off. See you tomorrow.",
      big: true,
    };
  }
  if (STREAK_MILESTONES.has(streak)) {
    return {
      icon: "flame",
      title: `${streak}-${unit} streak!`,
      message: `${habit.name}, ${describeStreak(streak, unit)} running. Keep it alive.`,
      big: true,
    };
  }
  const cheer = CHEERS[doneToday % CHEERS.length] ?? FIRST_CHEER;
  return {
    ...cheer,
    message:
      streak > 1
        ? `${habit.name} is done. That’s a ${streak}-${unit} streak.`
        : `${habit.name} is done for today.`,
    big: false,
  };
}

/** Whether the routine's latest session finished (`completed`) on `day`: done for that day. */
export function routineDoneOn(
  routine: { last_session: Pick<RoutineSession, "status" | "day"> | null },
  day: string,
): boolean {
  return routine.last_session?.status === "completed" && routine.last_session.day === day;
}

export function routineMinutes(routine: Pick<Routine, "estimated_minutes">): string | null {
  return routine.estimated_minutes > 0 ? formatMinutes(routine.estimated_minutes) : null;
}

// Habit form

export type ReminderFields = { time: string; weekdays: Weekday[] };

export type HabitFormValues = {
  name: string;
  description: string;
  categoryId: string;
  icon: HabitIcon;
  color: HabitColor;
  kind: HabitKind;
  unit: string;
  target: string;
  scheduleType: HabitScheduleType;
  every: string;
  weekdays: Weekday[];
  monthDays: number[];
  timesPerWeek: string;
  startDate: string;
  endDate: string;
  timeOfDay: string;
  timeZone: string;
  reminders: ReminderFields[];
};

const TIME = /^\d{2}:\d{2}$/;
const positive = (message: string) =>
  string()
    .defined()
    .test("positive", message, (value) => Number(value) > 0 && Number(value) <= 1_000_000);

export const habitSchema = object({
  name: singleLineText(HABIT_NAME_MAX_LENGTH).required("Name the habit."),
  description: multiLineText(HABIT_DESCRIPTION_MAX_LENGTH),
  categoryId: string().defined(),
  icon: mixed<HabitIcon>().defined(),
  color: mixed<HabitColor>().defined(),
  kind: mixed<HabitKind>().defined(),
  unit: singleLineText(HABIT_UNIT_MAX_LENGTH),
  target: string()
    .defined()
    .when("kind", {
      is: (kind: HabitKind) => kind !== "boolean",
      then: () => positive("Enter a target above zero."),
    }),
  scheduleType: mixed<HabitScheduleType>().defined(),
  every: string()
    .defined()
    .when("scheduleType", {
      is: "daily",
      then: (schema) =>
        schema.test("every", "Use 1 to 365 days.", (value) => {
          const every = Number(value);
          return Number.isInteger(every) && every >= 1 && every <= 365;
        }),
    }),
  weekdays: array(mixed<Weekday>().defined())
    .defined()
    .when("scheduleType", {
      is: "weekdays",
      then: (schema) => schema.min(1, "Choose at least one day."),
    }),
  monthDays: array(number().defined())
    .defined()
    .when("scheduleType", {
      is: "monthly",
      then: (schema) => schema.min(1, "Choose at least one day."),
    }),
  timesPerWeek: string()
    .defined()
    .when("scheduleType", {
      is: "weekly_target",
      then: (schema) =>
        schema.test("times", "Use 1 to 7 times.", (value) => {
          const times = Number(value);
          return Number.isInteger(times) && times >= 1 && times <= 7;
        }),
    }),
  startDate: string().defined().required("Choose a start date."),
  endDate: string()
    .defined()
    .test(
      "after-start",
      "End on or after the start date.",
      (value, context) => !value || value >= String(context.parent.startDate),
    ),
  timeOfDay: string()
    .defined()
    .test("time", "Choose a time.", (value) => !value || TIME.test(value)),
  timeZone: string().defined().required("Choose a time zone."),
  reminders: array(
    object({
      time: string().defined().matches(TIME, "Choose a time."),
      weekdays: array(mixed<Weekday>().defined()).defined(),
    }),
  )
    .defined()
    .max(MAX_REMINDERS, `Use at most ${MAX_REMINDERS} reminders.`)
    .test(
      "unique",
      "Two reminders can’t share a time.",
      (value) => new Set(value.map((r) => r.time)).size === value.length,
    ),
});

/** The schedule as the API takes it: every field present, only the type's own ones set. */
export function toSchedule(values: HabitFormValues): HabitSchedule {
  const type = values.scheduleType;
  return {
    type,
    every: type === "daily" ? Number(values.every) || 1 : 1,
    weekdays:
      type === "weekdays"
        ? WEEKDAYS.map((day) => day.value).filter((day) => values.weekdays.includes(day))
        : [],
    month_days: type === "monthly" ? [...values.monthDays].sort((a, b) => a - b) : [],
    times_per_week: type === "weekly_target" ? Number(values.timesPerWeek) || 1 : 0,
  };
}

function toReminders(values: { reminders: ReminderFields[] }): HabitReminderTime[] {
  return values.reminders.map((r) => ({ time: r.time, weekdays: r.weekdays }));
}

export function newHabitValues(today: string, timeZone: string): HabitFormValues {
  return {
    name: "",
    description: "",
    categoryId: "",
    icon: "sparkles",
    color: "blue",
    kind: "boolean",
    unit: "",
    target: "",
    scheduleType: "daily",
    every: "1",
    weekdays: ["mon", "wed", "fri"],
    monthDays: [1],
    timesPerWeek: "3",
    startDate: today,
    endDate: "",
    timeOfDay: "",
    timeZone,
    reminders: [],
  };
}

export function toHabitFormValues(
  habit: Habit,
  reminders: readonly { time: string; weekdays?: Weekday[] }[],
): HabitFormValues {
  const schedule = habit.schedule;
  return {
    name: habit.name,
    description: habit.description,
    categoryId: habit.category_id ?? "",
    icon: habit.icon,
    color: habit.color,
    kind: habit.kind,
    unit: habit.unit,
    target: habit.target === null ? "" : String(habit.target),
    scheduleType: schedule.type,
    every: String(schedule.every ?? 1),
    weekdays: schedule.weekdays?.length ? schedule.weekdays : ["mon", "wed", "fri"],
    monthDays: schedule.month_days?.length ? schedule.month_days : [1],
    timesPerWeek: String(schedule.times_per_week || 3),
    startDate: habit.start_date,
    endDate: habit.end_date ?? "",
    timeOfDay: habit.time_of_day?.slice(0, 5) ?? "",
    timeZone: habit.timezone,
    reminders: reminders.map((r) => ({ time: r.time.slice(0, 5), weekdays: r.weekdays ?? [] })),
  };
}

export function toCreateHabitRequest(values: HabitFormValues): CreateHabitRequest {
  return {
    name: values.name,
    description: values.description,
    category_id: values.categoryId || null,
    icon: values.icon,
    color: values.color,
    kind: values.kind,
    unit: values.kind === "numeric" ? values.unit : "",
    target: values.kind === "boolean" ? null : Number(values.target),
    schedule: toSchedule(values),
    start_date: values.startDate,
    end_date: values.endDate || null,
    time_of_day: values.timeOfDay || null,
    timezone: values.timeZone,
    reminders: toReminders(values),
  };
}

/** The changes to send for an edit. The schedule is sent only when it changed, so an edit
 * that leaves it alone doesn't start a new schedule version. */
export function toUpdateHabitRequest(
  habit: Habit,
  values: HabitFormValues,
): { changes: UpdateHabitRequest; reminders: HabitReminderTime[] } {
  const request = toCreateHabitRequest(values);
  const schedule = toSchedule(values);
  const changed = JSON.stringify(schedule) !== JSON.stringify(normalizeSchedule(habit.schedule));
  return {
    changes: {
      name: request.name,
      description: request.description,
      category_id: request.category_id,
      icon: request.icon,
      color: request.color,
      unit: request.unit,
      ...(habit.kind === "boolean" ? {} : { target: request.target }),
      start_date: request.start_date,
      end_date: request.end_date,
      time_of_day: request.time_of_day,
      timezone: request.timezone,
      ...(changed ? { schedule } : {}),
    },
    reminders: toReminders(values),
  };
}

function normalizeSchedule(schedule: HabitSchedule): HabitSchedule {
  return toSchedule({
    ...newHabitValues("", ""),
    scheduleType: schedule.type,
    every: String(schedule.every ?? 1),
    weekdays: schedule.weekdays ?? [],
    monthDays: schedule.month_days ?? [],
    timesPerWeek: String(schedule.times_per_week ?? 0),
  });
}

// Routine form

export type StepFields = { id: string; name: string; duration: string; habitId: string };

export type RoutineFormValues = {
  name: string;
  description: string;
  icon: HabitIcon;
  color: HabitColor;
  timeOfDay: string;
  weekdays: Weekday[];
  timeZone: string;
  steps: StepFields[];
  reminders: ReminderFields[];
};

export const routineSchema = object({
  name: singleLineText(HABIT_NAME_MAX_LENGTH).required("Name the routine."),
  description: multiLineText(HABIT_DESCRIPTION_MAX_LENGTH),
  icon: mixed<HabitIcon>().defined(),
  color: mixed<HabitColor>().defined(),
  timeOfDay: string()
    .defined()
    .test("time", "Choose a time.", (value) => !value || TIME.test(value)),
  weekdays: array(mixed<Weekday>().defined()).defined(),
  timeZone: string().defined().required("Choose a time zone."),
  steps: array(
    object({
      id: string().defined(),
      name: singleLineText(HABIT_NAME_MAX_LENGTH).required("Name the step."),
      duration: string()
        .defined()
        .test("minutes", "Use 1 to 1440 minutes.", (value) => {
          if (!value) return true;
          const minutes = Number(value);
          return Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440;
        }),
      habitId: string().defined(),
    }),
  )
    .defined()
    .max(MAX_STEPS, `Use at most ${MAX_STEPS} steps.`),
  reminders: array(
    object({
      time: string().defined().matches(TIME, "Choose a time."),
      weekdays: array(mixed<Weekday>().defined()).defined(),
    }),
  )
    .defined()
    .max(MAX_REMINDERS, `Use at most ${MAX_REMINDERS} reminders.`)
    .test(
      "unique",
      "Two reminders can’t share a time.",
      (value) => new Set(value.map((r) => r.time)).size === value.length,
    ),
});

export function newRoutineValues(timeZone: string): RoutineFormValues {
  return {
    name: "",
    description: "",
    icon: "sun",
    color: "amber",
    timeOfDay: "",
    weekdays: [],
    timeZone,
    steps: [{ id: "", name: "", duration: "", habitId: "" }],
    reminders: [],
  };
}

export function toRoutineFormValues(routine: Routine): RoutineFormValues {
  return {
    name: routine.name,
    description: routine.description,
    icon: routine.icon,
    color: routine.color,
    timeOfDay: routine.time_of_day?.slice(0, 5) ?? "",
    weekdays: routine.weekdays,
    timeZone: routine.timezone,
    steps: routine.steps.map((step) => ({
      id: step.id,
      name: step.name,
      duration: step.duration_minutes === null ? "" : String(step.duration_minutes),
      habitId: step.habit_id ?? "",
    })),
    reminders: routine.reminders.map((r) => ({
      time: r.time.slice(0, 5),
      weekdays: r.weekdays ?? [],
    })),
  };
}

/** The routine's fields; steps keep their IDs, task and note links, and descriptions. */
export function toRoutineRequest(
  values: RoutineFormValues,
  existing?: Routine,
): CreateRoutineRequest {
  const byId = new Map(existing?.steps.map((step) => [step.id, step]));
  return {
    name: values.name,
    description: values.description,
    icon: values.icon,
    color: values.color,
    time_of_day: values.timeOfDay || null,
    weekdays: WEEKDAYS.map((day) => day.value).filter((day) => values.weekdays.includes(day)),
    timezone: values.timeZone,
    steps: values.steps.map((step) => {
      const previous = step.id ? byId.get(step.id) : undefined;
      return {
        id: step.id || null,
        name: step.name.trim(),
        description: previous?.description ?? "",
        duration_minutes: step.duration ? Number(step.duration) : null,
        habit_id: step.habitId || null,
        task_id: previous?.task_id ?? null,
        note_id: previous?.note_id ?? null,
      };
    }),
    reminders: toReminders(values),
  };
}
