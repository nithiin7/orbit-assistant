"use client";

import type { Reminder } from "@orbit/contracts";
import { AlarmClock, CheckSquare, Globe, Landmark, Repeat, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { describeRecurrence, formatOccurrence, STATUS_LABELS, statusHint } from "@/lib/reminders";
import { cn } from "@/utils/common";
import { timeZoneLabel } from "@/utils/time-zones";

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

const STATUS_TONES: Record<Reminder["status"], string> = {
  scheduled: "",
  overdue: "border-warning/40 text-warning",
  completed: "",
  disabled: "",
};

/** When it fires next, or last fired, on the reminder's own clock. */
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
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const hint = statusHint(reminder);
  const muted = reminder.status === "disabled" || reminder.status === "completed";
  // A loan, subscription, or bill keeps this reminder on its next payment; change it in Finance.
  const managed = reminder.commitment !== null && reminder.commitment !== undefined;

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  const cancelDelete = () => {
    setConfirming(false);
    requestAnimationFrame(() => deleteRef.current?.focus());
  };

  return (
    <li
      className={cn(
        "group flex items-start gap-3 px-3 py-3 transition-colors duration-150 hover:bg-accent/40 sm:px-4",
        pending && "opacity-70",
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={reminder.enabled}
        aria-label={`${reminder.enabled ? "Disable" : "Enable"} “${reminder.title}”`}
        disabled={pending || managed}
        title={managed ? "Change this reminder in Finance" : undefined}
        onClick={() => onToggle(reminder)}
        className={cn(
          "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-wait motion-reduce:transition-none",
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

      <div className="min-w-0 flex-1 space-y-1">
        {managed ? (
          <p className={cn("text-sm font-medium break-words", muted && "text-muted-foreground")}>
            {reminder.title}
          </p>
        ) : (
          <button
            type="button"
            onClick={() => onEdit(reminder)}
            aria-label={`Edit “${reminder.title}”`}
            className={cn(
              "block max-w-full rounded-sm text-left text-sm font-medium break-words outline-none hover:underline hover:decoration-muted-foreground/50 hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring",
              muted && "text-muted-foreground",
            )}
          >
            {reminder.title}
          </button>
        )}
        {reminder.description ? (
          <p className="line-clamp-2 text-sm break-words whitespace-pre-line text-muted-foreground">
            {reminder.description}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {reminder.status !== "scheduled" ? (
            <Badge variant="outline" className={STATUS_TONES[reminder.status]}>
              {STATUS_LABELS[reminder.status]}
            </Badge>
          ) : null}
          <ReminderTime reminder={reminder} />
          {reminder.recurrence ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Repeat className="size-3.5" aria-hidden="true" />
              {describeRecurrence(reminder.recurrence, reminder.start_date)}
            </span>
          ) : null}
          {reminder.timezone !== viewerTimeZone ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Globe className="size-3.5" aria-hidden="true" />
              <span className="sr-only">Time zone: </span>
              {timeZoneLabel(reminder.timezone)}
            </span>
          ) : null}
          {managed ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Landmark className="size-3.5" aria-hidden="true" />
              Managed in Finance
            </span>
          ) : null}
          {reminder.task ? (
            <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <CheckSquare className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="sr-only">Task: </span>
              <span
                className={cn(
                  "truncate",
                  reminder.task.status === "completed" && "line-through decoration-1",
                )}
              >
                {reminder.task.title}
              </span>
            </span>
          ) : null}
        </div>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
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
            className="size-8 text-muted-foreground hover:text-destructive pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100"
          >
            <Trash2 aria-hidden="true" />
          </Button>
        )}
      </div>
    </li>
  );
}
