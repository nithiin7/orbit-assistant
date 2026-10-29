import type { TaskPriority } from "@orbit/contracts";
import { CalendarDays, Flag } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { describeDueDate, type DueState, priorityLabel } from "@/lib/tasks";
import { cn } from "@/lib/utils";

const PRIORITY_TONES: Record<TaskPriority, string> = {
  high: "border-destructive/30 text-destructive",
  medium: "border-warning/40 text-warning",
  low: "text-muted-foreground",
  none: "",
};

/** Nothing for tasks without a priority, so only meaningful priorities draw the eye. */
export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  if (priority === "none") return null;
  return (
    <Badge variant="outline" className={PRIORITY_TONES[priority]}>
      <Flag className="size-3" aria-hidden="true" />
      {priorityLabel(priority)}
      <span className="sr-only"> priority</span>
    </Badge>
  );
}

const DUE_TONES: Record<DueState, string> = {
  overdue: "text-destructive",
  today: "text-brand",
  soon: "text-foreground",
  later: "text-muted-foreground",
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
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap",
        muted ? "text-muted-foreground" : DUE_TONES[state],
      )}
    >
      <CalendarDays className="size-3.5" aria-hidden="true" />
      <span className="sr-only">Due </span>
      <time dateTime={dueDate}>{text}</time>
    </span>
  );
}
