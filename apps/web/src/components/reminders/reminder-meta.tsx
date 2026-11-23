import type { Reminder } from "@orbit/contracts";
import {
  Bell,
  CalendarDays,
  CheckSquare,
  FileText,
  Globe,
  Landmark,
  type LucideIcon,
  Repeat,
  Repeat2,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";

import { describeRecurrence, type FireGroupKey } from "@/lib/reminders";
import { cn } from "@/utils/common";
import { timeZoneLabel } from "@/utils/time-zones";

const chipClassName =
  "inline-flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-full px-2 text-xs font-medium whitespace-nowrap";

const quietChip = "bg-muted/70 text-muted-foreground";

function Chip({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn(chipClassName, quietChip, className)}>{children}</span>;
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

type CommitmentKind = NonNullable<Reminder["commitment"]>["kind"];

/** The module that keeps a managed reminder up to date, by what manages it. */
export type ManagingModule = "finance" | "calendar" | "habits" | "documents" | "people";

const MANAGING_MODULE: Record<CommitmentKind, ManagingModule> = {
  loan: "finance",
  recurring_payment: "finance",
  deposit: "finance",
  calendar_alert: "calendar",
  habit_reminder: "habits",
  document: "documents",
  person: "people",
};

export const MODULE_LABEL: Record<ManagingModule, string> = {
  finance: "Finance",
  calendar: "Calendar",
  habits: "Habits",
  documents: "Documents",
  people: "People",
};

const MODULE_ICON: Record<ManagingModule, LucideIcon> = {
  finance: Landmark,
  calendar: CalendarDays,
  habits: Repeat2,
  documents: FileText,
  people: Users,
};

export function managingModule(kind: CommitmentKind): ManagingModule {
  return MANAGING_MODULE[kind];
}

/** Marks a reminder another module keeps up to date: Finance, Calendar, Habits, Documents, or
 * People. */
export function ManagedChip({ by }: { by: ManagingModule }) {
  const Icon = MODULE_ICON[by];
  return (
    <Chip>
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      Managed in {MODULE_LABEL[by]}
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

const ICON_TONES: Partial<Record<FireGroupKey, string>> = {
  overdue: "bg-destructive/10 text-destructive",
  today: "bg-brand-subtle text-brand",
};

/**
 * A tile showing where a reminder comes from: the module that manages it, its task, a repeat, or
 * a plain bell. Toned by how soon it fires; decorative, since the chips say the same in words.
 */
export function ReminderIcon({
  reminder,
  group,
  className,
}: {
  reminder: Reminder;
  group: FireGroupKey;
  className?: string;
}) {
  const managedBy = reminder.commitment ? managingModule(reminder.commitment.kind) : null;
  const Icon = managedBy
    ? MODULE_ICON[managedBy]
    : reminder.task
      ? CheckSquare
      : reminder.recurrence
        ? Repeat
        : Bell;
  const muted = reminder.status === "completed" || reminder.status === "disabled";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted/70 text-muted-foreground transition-colors duration-150",
        !muted && ICON_TONES[group],
        className,
      )}
    >
      <Icon className="size-4" />
    </span>
  );
}
