/** Task display rules, filters, and form schemas that mirror the API's. */

import type {
  TaskListColor,
  TaskListQuery,
  TaskPriority,
  TaskRepeat,
  TaskStatus,
} from "@orbit/contracts";
import { mixed, object, string } from "yup";

import { type Option } from "@/utils/common";
import { daysBetween, formatCalendarDate, parseCalendarDate } from "@/utils/dates";
import { multiLineText, singleLineText } from "@/utils/validation";

export const TASK_TITLE_MAX_LENGTH = 200;
export const TASK_DESCRIPTION_MAX_LENGTH = 5000;
export const TASK_LIST_NAME_MAX_LENGTH = 50;
/** The most tasks the Tasks page loads at once; beyond that it asks the user to narrow down. */
export const TASK_PAGE_SIZE = 200;

/** Highest first, the order people scan them in. */
export const PRIORITIES: readonly Option<TaskPriority>[] = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "none", label: "No priority" },
];

export function priorityLabel(priority: TaskPriority): string {
  return PRIORITIES.find((item) => item.value === priority)?.label ?? priority;
}

const REPEAT_UNITS: Record<TaskRepeat["frequency"], string> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
  yearly: "year",
};

/** "Every week", "Every 3 months". */
export function repeatLabel({ frequency, interval }: TaskRepeat): string {
  const unit = REPEAT_UNITS[frequency];
  return interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`;
}

/** The repeat picker's value for no repeat. */
export const NO_REPEAT = "none";

const REPEAT_PRESETS: readonly TaskRepeat[] = [
  { frequency: "daily", interval: 1 },
  { frequency: "weekly", interval: 1 },
  { frequency: "weekly", interval: 2 },
  { frequency: "monthly", interval: 1 },
  { frequency: "monthly", interval: 3 },
  { frequency: "yearly", interval: 1 },
];

/** A repeat as the picker's value, such as `weekly:2`. */
export function toRepeatValue(repeat: TaskRepeat | null): string {
  return repeat ? `${repeat.frequency}:${repeat.interval}` : NO_REPEAT;
}

/** The picker's value as a repeat, or `null` for no repeat. */
export function fromRepeatValue(value: string): TaskRepeat | null {
  const [frequency, interval] = value.split(":");
  const match = REPEAT_PRESETS.find((repeat) => repeat.frequency === frequency);
  return match ? { frequency: match.frequency, interval: Number(interval) } : null;
}

/** The picker's choices, keeping a repeat set through the API that isn't one of the presets. */
export function repeatOptions(current: TaskRepeat | null): Option<string>[] {
  const presets = REPEAT_PRESETS.map(toRepeatValue);
  const repeats =
    current && !presets.includes(toRepeatValue(current))
      ? [...REPEAT_PRESETS, current]
      : REPEAT_PRESETS;
  return [
    { value: NO_REPEAT, label: "Does not repeat" },
    ...repeats.map((repeat) => ({ value: toRepeatValue(repeat), label: repeatLabel(repeat) })),
  ];
}

export type StatusFilter = TaskStatus | "all";
export type TaskSort = NonNullable<TaskListQuery["sort"]>;

export const STATUS_FILTERS: readonly Option<StatusFilter>[] = [
  { value: "open", label: "Open" },
  { value: "completed", label: "Completed" },
  { value: "all", label: "All" },
];

export const SORTS: readonly Option<TaskSort>[] = [
  { value: "due_date", label: "Due date" },
  { value: "priority", label: "Priority" },
  { value: "created_at", label: "Newest" },
];

/** Every list, tasks on no list, or one list's ID. */
export type ListFilter = "all" | "none" | (string & {});

export type TaskFilters = {
  status: StatusFilter;
  priority: TaskPriority | "all";
  list: ListFilter;
  /** Already trimmed. */
  search: string;
  sort: TaskSort;
};

export const DEFAULT_TASK_FILTERS: TaskFilters = {
  status: "open",
  priority: "all",
  list: "all",
  search: "",
  sort: "due_date",
};

export function toTaskListQuery(filters: TaskFilters): TaskListQuery {
  return {
    status: filters.status === "all" ? undefined : filters.status,
    priority: filters.priority === "all" ? undefined : [filters.priority],
    q: filters.search || undefined,
    list_id: filters.list === "all" || filters.list === "none" ? undefined : filters.list,
    unlisted: filters.list === "none" ? true : undefined,
    sort: filters.sort,
    limit: TASK_PAGE_SIZE,
  };
}

/** True when a search or priority filter hides tasks that the status view would show. */
export function isNarrowed(filters: TaskFilters): boolean {
  return filters.search !== "" || filters.priority !== "all";
}

const taskTitleField = singleLineText(TASK_TITLE_MAX_LENGTH).required("Enter a title.");
const priorityField = mixed<TaskPriority>()
  .oneOf(PRIORITIES.map((item) => item.value))
  .defined();
/** `""` when no due date is set. */
const dueDateField = string().defined();

/** A list's ID, or `"none"` for no list. */
const listField = string().defined();

export const newTaskSchema = object({
  title: taskTitleField,
  dueDate: dueDateField,
  priority: priorityField,
  list: listField,
});

export const taskSchema = object({
  title: taskTitleField,
  description: multiLineText(TASK_DESCRIPTION_MAX_LENGTH),
  dueDate: dueDateField,
  priority: priorityField,
  list: listField,
  repeat: string()
    .defined()
    .when("dueDate", {
      is: "",
      then: (field) => field.oneOf([NO_REPEAT], "Set a due date to repeat this task."),
    }),
});

// Lists

/** The palette a list's color comes from; the API accepts the same names. */
export const TASK_LIST_COLORS: readonly Option<TaskListColor>[] = [
  { value: "blue", label: "Blue" },
  { value: "green", label: "Green" },
  { value: "amber", label: "Amber" },
  { value: "rose", label: "Rose" },
  { value: "violet", label: "Violet" },
  { value: "teal", label: "Teal" },
  { value: "orange", label: "Orange" },
  { value: "slate", label: "Slate" },
];

/** Classes for each list color: a solid dot, and a soft chip. */
export const TASK_LIST_STYLES: Record<TaskListColor, { dot: string; chip: string }> = {
  blue: { dot: "bg-event-blue", chip: "bg-event-blue/12 text-foreground" },
  green: { dot: "bg-event-green", chip: "bg-event-green/12 text-foreground" },
  amber: { dot: "bg-event-amber", chip: "bg-event-amber/15 text-foreground" },
  rose: { dot: "bg-event-rose", chip: "bg-event-rose/12 text-foreground" },
  violet: { dot: "bg-event-violet", chip: "bg-event-violet/12 text-foreground" },
  teal: { dot: "bg-event-teal", chip: "bg-event-teal/12 text-foreground" },
  orange: { dot: "bg-event-orange", chip: "bg-event-orange/12 text-foreground" },
  slate: { dot: "bg-event-slate", chip: "bg-event-slate/12 text-foreground" },
};

export const taskListSchema = object({
  name: singleLineText(TASK_LIST_NAME_MAX_LENGTH).required("Enter a name."),
  color: mixed<TaskListColor>()
    .oneOf(TASK_LIST_COLORS.map((item) => item.value))
    .defined(),
});

export type DueState = "overdue" | "today" | "soon" | "later";

export type DueDescription = { state: DueState; label: string };

/** How to show a due date relative to `today` (both `YYYY-MM-DD`, in the user's time zone). */
export function describeDueDate(dueDate: string, today: string): DueDescription {
  const days = daysBetween(today, dueDate);
  if (days === 0) return { state: "today", label: "Today" };
  if (days === 1) return { state: "soon", label: "Tomorrow" };
  if (days === -1) return { state: "overdue", label: "Yesterday" };

  const label = formatCalendarDate(dueDate, { omitYearIn: parseCalendarDate(today).year });
  if (days < 0) return { state: "overdue", label };
  return { state: days < 7 ? "soon" : "later", label };
}

export type DueGroupKey = "overdue" | "today" | "tomorrow" | "week" | "later" | "none";

export type DueGroup<T> = { key: DueGroupKey; label: string; tasks: T[] };

const DUE_GROUPS: readonly Option<DueGroupKey>[] = [
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "week", label: "Next 7 days" },
  { value: "later", label: "Later" },
  { value: "none", label: "No due date" },
];

function dueGroupOf(dueDate: string | null, today: string): DueGroupKey {
  if (dueDate === null) return "none";
  const days = daysBetween(today, dueDate);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return days < 7 ? "week" : "later";
}

/**
 * Tasks split into sections by when they're due relative to `today`, soonest first. Tasks keep
 * their order within a section, and empty sections are left out.
 */
export function groupTasksByDue<T extends { due_date: string | null }>(
  tasks: readonly T[],
  today: string,
): DueGroup<T>[] {
  const buckets = new Map<DueGroupKey, T[]>();
  for (const task of tasks) {
    const key = dueGroupOf(task.due_date, today);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(task);
    else buckets.set(key, [task]);
  }
  return DUE_GROUPS.flatMap(({ value, label }) => {
    const group = buckets.get(value);
    return group ? [{ key: value, label, tasks: group }] : [];
  });
}
