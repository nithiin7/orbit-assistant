/** Task display rules, filters, and form schemas that mirror the API's. */

import type { TaskListQuery, TaskPriority, TaskStatus } from "@orbit/contracts";
import { mixed, object, string } from "yup";

import { type Option } from "@/lib/utils";
import { multiLineText, singleLineText } from "@/lib/validation";

export const TASK_TITLE_MAX_LENGTH = 200;
export const TASK_DESCRIPTION_MAX_LENGTH = 5000;
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

export function isTaskPriority(value: string): value is TaskPriority {
  return PRIORITIES.some((item) => item.value === value);
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

export function isTaskSort(value: string): value is TaskSort {
  return SORTS.some((item) => item.value === value);
}

export type TaskFilters = {
  status: StatusFilter;
  priority: TaskPriority | "all";
  /** Already trimmed. */
  search: string;
  sort: TaskSort;
};

export const DEFAULT_TASK_FILTERS: TaskFilters = {
  status: "open",
  priority: "all",
  search: "",
  sort: "due_date",
};

export function toTaskListQuery(filters: TaskFilters): TaskListQuery {
  return {
    status: filters.status === "all" ? undefined : filters.status,
    priority: filters.priority === "all" ? undefined : [filters.priority],
    q: filters.search || undefined,
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

export const newTaskSchema = object({
  title: taskTitleField,
  dueDate: dueDateField,
  priority: priorityField,
});

export const taskSchema = object({
  title: taskTitleField,
  description: multiLineText(TASK_DESCRIPTION_MAX_LENGTH),
  dueDate: dueDateField,
  priority: priorityField,
});

/** A date as `YYYY-MM-DD` in the user's time zone, the format of a task's `due_date`. */
export function localDateString(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function parseDate(value: string): { year: number; month: number; day: number } {
  const [year = 0, month = 1, day = 1] = value.split("-").map(Number);
  return { year, month, day };
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. Calendar days, so DST doesn't matter. */
export function daysBetween(from: string, to: string): number {
  const a = parseDate(from);
  const b = parseDate(to);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000,
  );
}

export type DueState = "overdue" | "today" | "soon" | "later";

export type DueDescription = { state: DueState; label: string };

/** How to show a due date relative to `today` (both `YYYY-MM-DD`, in the user's time zone). */
export function describeDueDate(dueDate: string, today: string): DueDescription {
  const days = daysBetween(today, dueDate);
  if (days === 0) return { state: "today", label: "Today" };
  if (days === 1) return { state: "soon", label: "Tomorrow" };
  if (days === -1) return { state: "overdue", label: "Yesterday" };

  const { year, month, day } = parseDate(dueDate);
  const sameYear = year === parseDate(today).year;
  const label = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
    // Format the calendar date itself, independent of the viewer's time zone.
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
  if (days < 0) return { state: "overdue", label };
  return { state: days < 7 ? "soon" : "later", label };
}
