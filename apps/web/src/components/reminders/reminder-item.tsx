"use client";

import type { Reminder } from "@orbit/contracts";
import { AlarmClock, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { fireGroupOf, formatOccurrence, statusHint } from "@/lib/reminders";
import { cn } from "@/utils/common";
import { sameTimeZone } from "@/utils/time-zones";

import {
  FireTimeChip,
  ManagedChip,
  RecurrenceChip,
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
  // A loan, subscription, or bill keeps this reminder on its next payment, or an event's alert on
  // its next occurrence; change it there.
  const managed = reminder.commitment !== null && reminder.commitment !== undefined;
  const managedBy = reminder.commitment?.kind === "calendar_alert" ? "calendar" : "finance";

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

  return (
    <li
      className={cn(
        "group flex items-start gap-3 px-3 py-3 transition-[background-color,opacity] duration-150 hover:bg-accent/40 sm:px-4 @2xl/rows:items-center",
        pending && "opacity-70",
        muted && "bg-muted/20",
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={reminder.enabled}
        aria-label={`${reminder.enabled ? "Disable" : "Enable"} “${reminder.title}”`}
        disabled={pending || managed}
        title={
          managed
            ? `Change this reminder in ${managedBy === "calendar" ? "Calendar" : "Finance"}`
            : undefined
        }
        onClick={() => onToggle(reminder)}
        className={cn(
          "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none @2xl/rows:mt-0",
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

      {/* Chips sit beside the title only in roomy rows; reminders carry more of them than tasks. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 @2xl/rows:flex-row @2xl/rows:items-center @2xl/rows:gap-4">
        <div className="min-w-0 flex-1 space-y-0.5">
          {managed ? (
            <p className="text-sm font-medium break-words">{title}</p>
          ) : (
            <button
              type="button"
              onClick={() => onEdit(reminder)}
              aria-label={`Edit “${reminder.title}”`}
              className="block max-w-full rounded-sm text-left text-sm font-medium break-words outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-ring"
            >
              {title}
            </button>
          )}
          {reminder.description ? (
            <p className="line-clamp-1 text-sm break-words text-muted-foreground">
              {reminder.description}
            </p>
          ) : null}
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-1.5 @2xl/rows:max-w-[60%] @2xl/rows:justify-end">
          {reminder.status === "completed" || reminder.status === "disabled" ? (
            <StatusChip status={reminder.status} />
          ) : null}
          <FireTimeChip reminder={reminder} group={fireGroupOf(reminder, viewerTimeZone)} />
          <RecurrenceChip reminder={reminder} />
          {reminder.task ? <TaskChip task={reminder.task} /> : null}
          {sameTimeZone(reminder.timezone, viewerTimeZone) ? null : (
            <TimeZoneChip timeZone={reminder.timezone} />
          )}
          {managed ? <ManagedChip by={managedBy} /> : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
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
      </div>
    </li>
  );
}
