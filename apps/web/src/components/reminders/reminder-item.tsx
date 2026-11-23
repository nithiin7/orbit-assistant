"use client";

import type { Reminder } from "@orbit/contracts";
import { AlarmClock, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { TaskListBadge } from "@/components/tasks/task-meta";
import { Button } from "@/components/ui/button";
import { fireGroupOf, formatOccurrence, occurrenceParts, statusHint } from "@/lib/reminders";
import { cn } from "@/utils/common";
import { sameTimeZone } from "@/utils/time-zones";

import {
  ManagedChip,
  type ManagingModule,
  managingModule,
  MODULE_LABEL,
  RecurrenceChip,
  ReminderIcon,
  StatusChip,
  TaskChip,
  TimeZoneChip,
} from "./reminder-meta";

type ReminderItemProps = {
  reminder: Reminder;
  /** The viewer's time zone; a reminder in another one says which. */
  viewerTimeZone: string;
  /** An enable, disable, or delete is in flight. */
  pending: boolean;
  onToggle: (reminder: Reminder) => void;
  onEdit: (reminder: Reminder) => void;
  onDelete: (reminder: Reminder) => Promise<void>;
};

/** When it fires next, or last fired, on the reminder's own clock. Plain text, for the dashboard. */
export function ReminderTime({ reminder }: { reminder: Reminder }) {
  const at = reminder.next_occurrence_at ?? reminder.last_occurrence_at;
  if (!at) return null;
  const label = formatOccurrence(at, reminder.timezone);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap",
        reminder.status === "overdue" ? "text-warning" : "text-muted-foreground",
        reminder.status === "scheduled" && "text-foreground",
      )}
    >
      <AlarmClock className="size-3.5" aria-hidden="true" />
      <span className="sr-only">{reminder.next_occurrence_at ? "Next: " : "Last: "}</span>
      <time dateTime={at}>{label}</time>
    </span>
  );
}

export function ReminderItem({
  reminder,
  viewerTimeZone,
  pending,
  onToggle,
  onEdit,
  onDelete,
}: ReminderItemProps) {
  const titleId = useId();
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const hint = statusHint(reminder);
  const muted = reminder.status === "disabled" || reminder.status === "completed";
  // A loan, subscription, or bill keeps this reminder on its next payment, an event's alert on its
  // next occurrence, a habit or routine on its reminder time, and a document on its next expiry,
  // renewal, or review alert; change it there.
  const managedBy = reminder.commitment ? managingModule(reminder.commitment.kind) : null;
  const managed = managedBy !== null;

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  const cancelDelete = () => {
    setConfirming(false);
    // The confirmation unmounts; put focus back on the button that opened it.
    requestAnimationFrame(() => deleteRef.current?.focus());
  };

  const title = (
    <span
      id={titleId}
      className={cn("transition-colors duration-150", muted && "text-muted-foreground")}
    >
      {reminder.title}
    </span>
  );
  const group = fireGroupOf(reminder, viewerTimeZone);
  const titleClassName =
    "block max-w-full rounded-sm text-left text-sm font-medium break-words outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <li
      className={cn(
        "group flex items-start gap-3 px-3 py-3.5 transition-[background-color,opacity] duration-150 hover:bg-accent/40 sm:gap-4 sm:px-4",
        pending && "opacity-70",
        muted && "bg-muted/20",
      )}
    >
      <ReminderWhen reminder={reminder} />

      <ReminderIcon reminder={reminder} group={group} className="hidden @md/rows:flex" />

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="space-y-0.5">
          {reminder.commitment?.kind === "document" ? (
            // A document's expiry reminder opens the document it's about.
            <Link
              href={`/documents?document=${encodeURIComponent(reminder.commitment.id)}`}
              className={titleClassName}
            >
              {title}
            </Link>
          ) : managed ? (
            <p className="text-sm font-medium break-words">{title}</p>
          ) : (
            <button
              type="button"
              onClick={() => onEdit(reminder)}
              aria-label={`Edit “${reminder.title}”`}
              className={titleClassName}
            >
              {title}
            </button>
          )}
          {reminder.description ? (
            <p className="line-clamp-1 text-sm break-words text-muted-foreground">
              {reminder.description}
            </p>
          ) : null}
          {hint ? (
            <p
              className={cn(
                "text-xs",
                reminder.status === "overdue" ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {hint}
            </p>
          ) : null}
        </div>
        <ReminderChips reminder={reminder} viewerTimeZone={viewerTimeZone} managedBy={managedBy} />
      </div>

      <div className="flex shrink-0 items-center gap-1 self-center">
        {managed ? null : confirming ? (
          <div
            role="group"
            aria-label={`Delete “${reminder.title}”?`}
            className="flex items-center gap-1"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                cancelDelete();
              }
            }}
          >
            <Button
              ref={confirmRef}
              variant="destructive"
              size="sm"
              disabled={pending}
              onClick={() => {
                // On success the row unmounts; on failure the page reports the error.
                void onDelete(reminder).finally(() => setConfirming(false));
              }}
            >
              Delete
            </Button>
            <Button variant="ghost" size="sm" disabled={pending} onClick={cancelDelete}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            ref={deleteRef}
            variant="ghost"
            size="icon"
            disabled={pending}
            aria-label={`Delete “${reminder.title}”`}
            onClick={() => setConfirming(true)}
            // Revealed on hover or focus where there is a mouse; always visible on touch screens.
            className="size-8 text-muted-foreground hover:text-destructive pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100"
          >
            <Trash2 aria-hidden="true" />
          </Button>
        )}
        {confirming ? null : (
          <button
            type="button"
            role="switch"
            aria-checked={reminder.enabled}
            aria-label={`${reminder.enabled ? "Disable" : "Enable"} “${reminder.title}”`}
            disabled={pending || managed}
            title={managedBy ? `Change this reminder in ${MODULE_LABEL[managedBy]}` : undefined}
            onClick={() => onToggle(reminder)}
            className={cn(
              "relative ml-1 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none",
              pending && "disabled:cursor-wait",
              reminder.enabled ? "border-transparent bg-brand" : "bg-muted",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "inline-block size-3.5 rounded-full bg-card shadow-elevation-1 transition-transform duration-150 motion-reduce:transition-none",
                reminder.enabled ? "translate-x-4.5" : "translate-x-0.5",
              )}
            />
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * The row's time column: the time it fires next (or last fired) on its own clock, and the day
 * below it, or "Overdue" in words when it is.
 */
function ReminderWhen({ reminder }: { reminder: Reminder }) {
  const at = reminder.next_occurrence_at ?? reminder.last_occurrence_at;
  const overdue = reminder.status === "overdue";
  const muted = reminder.status === "disabled" || reminder.status === "completed";
  if (!at) {
    return (
      <span className="flex w-16 shrink-0 flex-col pt-0.5 text-xs text-muted-foreground sm:w-20">
        <span aria-hidden="true" className="text-sm font-semibold">
          —
        </span>
        <span>No time</span>
      </span>
    );
  }
  const { day, time } = occurrenceParts(at, reminder.timezone);
  return (
    <time
      dateTime={at}
      className={cn(
        "flex w-16 shrink-0 flex-col pt-0.5 tabular-nums sm:w-20",
        muted ? "text-muted-foreground" : "text-foreground",
      )}
    >
      <span className="sr-only">{reminder.next_occurrence_at ? "Next: " : "Last: "}</span>
      <span className="text-sm font-semibold whitespace-nowrap">{time}</span>
      <span className="sr-only">, </span>
      <span
        className={cn(
          "truncate text-xs",
          overdue ? "font-medium text-destructive" : "text-muted-foreground",
        )}
      >
        {overdue ? "Overdue" : day}
      </span>
    </time>
  );
}

/** What else there is to know: whether it repeats, its task and list, another clock, its manager. */
function ReminderChips({
  reminder,
  viewerTimeZone,
  managedBy,
}: {
  reminder: Reminder;
  viewerTimeZone: string;
  managedBy: ManagingModule | null;
}) {
  const otherZone = !sameTimeZone(reminder.timezone, viewerTimeZone);
  const state =
    reminder.status === "completed" || reminder.status === "disabled" ? reminder.status : null;
  if (!state && !reminder.recurrence && !reminder.task && !otherZone && !managedBy) {
    return null;
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      {state ? <StatusChip status={state} /> : null}
      <RecurrenceChip reminder={reminder} />
      {reminder.task ? <TaskChip task={reminder.task} /> : null}
      {reminder.task?.list ? (
        <TaskListBadge name={reminder.task.list.name} color={reminder.task.list.color} />
      ) : null}
      {otherZone ? <TimeZoneChip timeZone={reminder.timezone} /> : null}
      {managedBy ? <ManagedChip by={managedBy} /> : null}
    </div>
  );
}
