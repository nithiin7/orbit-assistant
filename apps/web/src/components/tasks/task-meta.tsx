import type { TaskPriority } from "@orbit/contracts";
import { CalendarDays } from "lucide-react";

import { describeDueDate, type DueState, priorityLabel } from "@/lib/tasks";
import { cn } from "@/utils/common";

/** The dot that marks a priority, here and in the priority filter. */
export const PRIORITY_DOTS: Record<TaskPriority, string> = {
  high: "bg-destructive",
  medium: "bg-warning",
  low: "bg-muted-foreground/60",
  none: "border border-muted-foreground/50",
};

const PRIORITY_TEXT: Record<TaskPriority, string> = {
  high: "text-destructive",
  medium: "text-warning",
  low: "text-muted-foreground",
  none: "",
};

const chipClassName =
  "inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-xs font-medium whitespace-nowrap";

/** Nothing for tasks without a priority, so only meaningful priorities draw the eye. */
export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  if (priority === "none") return null;
  return (
    <span className={cn(chipClassName, "bg-muted/70", PRIORITY_TEXT[priority])}>
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", PRIORITY_DOTS[priority])} />
      {priorityLabel(priority)}
      <span className="sr-only"> priority</span>
    </span>
  );
}

const DUE_TONES: Record<DueState, string> = {
  overdue: "bg-destructive/10 text-destructive",
  today: "bg-brand-subtle text-brand",
  soon: "bg-muted/70 text-foreground",
  later: "bg-muted/70 text-muted-foreground",
};

/** A due date relative to `today`. Overdue dates say so in words, not only in color. */
export function DueDateLabel({
  dueDate,
  today,
  muted = false,
}: {
  dueDate: string;
  today: string;
  /** For completed tasks, where the date no longer needs attention. */
  muted?: boolean;
}) {
  const { state, label } = describeDueDate(dueDate, today);
  const text = state === "overdue" && !muted ? `Overdue · ${label}` : label;
  return (
    <span
      className={cn(chipClassName, muted ? "bg-muted/50 text-muted-foreground" : DUE_TONES[state])}
    >
      <CalendarDays className="size-3" aria-hidden="true" />
      <span className="sr-only">Due </span>
      <time dateTime={dueDate}>{text}</time>
    </span>
  );
}
