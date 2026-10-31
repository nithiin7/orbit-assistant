import type { Reminder } from "@orbit/contracts";
import { AlarmClock, CheckSquare, Globe, Landmark, Repeat } from "lucide-react";
import type { ReactNode } from "react";

import { describeRecurrence, type FireGroupKey, formatOccurrence } from "@/lib/reminders";
import { cn } from "@/utils/common";
import { timeZoneLabel } from "@/utils/time-zones";

const chipClassName =
  "inline-flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-full px-2 text-xs font-medium whitespace-nowrap";

const quietChip = "bg-muted/70 text-muted-foreground";

function Chip({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn(chipClassName, quietChip, className)}>{children}</span>;
}

const TIME_TONES: Partial<Record<FireGroupKey, string>> = {
  overdue: "bg-destructive/10 text-destructive",
  today: "bg-brand-subtle text-brand",
  tomorrow: "bg-muted/70 text-foreground",
  week: "bg-muted/70 text-foreground",
};

/**
 * When it fires next, or last fired, on the reminder's own clock, toned by how soon that is.
 * Overdue reminders say so in words, not only in color.
 */
export function FireTimeChip({ reminder, group }: { reminder: Reminder; group: FireGroupKey }) {
  const at = reminder.next_occurrence_at ?? reminder.last_occurrence_at;
  if (!at) return null;
  const label = formatOccurrence(at, reminder.timezone);
  const overdue = reminder.status === "overdue";
  return (
    <Chip className={cn(reminder.next_occurrence_at && TIME_TONES[group])}>
      <AlarmClock className="size-3 shrink-0" aria-hidden="true" />
      <span className="sr-only">{reminder.next_occurrence_at ? "Next: " : "Last: "}</span>
      <time dateTime={at}>{overdue ? `Overdue · ${label}` : label}</time>
    </Chip>
  );
}

export function RecurrenceChip({ reminder }: { reminder: Reminder }) {
  if (!reminder.recurrence) return null;
  return (
    <Chip>
      <Repeat className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate">
        {describeRecurrence(reminder.recurrence, reminder.start_date)}
      </span>
    </Chip>
  );
}

/** The task a reminder is about; struck through once the task is done. */
export function TaskChip({ task }: { task: NonNullable<Reminder["task"]> }) {
  const done = task.status === "completed";
  return (
    <Chip className="max-w-56">
      <CheckSquare className="size-3 shrink-0" aria-hidden="true" />
      <span className="sr-only">Task: </span>
      <span className={cn("truncate", done && "line-through decoration-1")}>{task.title}</span>
    </Chip>
  );
}

export function TimeZoneChip({ timeZone }: { timeZone: string }) {
  return (
    <Chip>
      <Globe className="size-3 shrink-0" aria-hidden="true" />
      <span className="sr-only">Time zone: </span>
      <span className="truncate">{timeZoneLabel(timeZone)}</span>
    </Chip>
  );
}

export function FinanceChip() {
  return (
    <Chip>
      <Landmark className="size-3 shrink-0" aria-hidden="true" />
      Managed in Finance
    </Chip>
  );
}

/** Only for reminders that won't fire as planned; upcoming ones need no label. */
export function StatusChip({ status }: { status: "completed" | "disabled" }) {
  return (
    <Chip className="border border-dashed bg-transparent">
      {status === "completed" ? "Completed" : "Disabled"}
    </Chip>
  );
}
