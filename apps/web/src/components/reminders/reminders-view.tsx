"use client";

import type { Reminder, TaskListQuery } from "@orbit/contracts";
import { AlarmClock, BellOff, CheckCheck, Plus } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { describeApiError } from "@/api/client";
import { EmptyState } from "@/components/empty-state";
import { FormAlert } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useReminderList, useReminderMutations } from "@/hooks/use-reminders";
import { useTaskList } from "@/hooks/use-tasks";
import {
  browserTimeZone,
  REMINDER_FILTERS,
  type ReminderFields,
  type ReminderFilter,
  toReminderListQuery,
} from "@/lib/reminders";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/providers/auth";
import { useWorkspaces } from "@/providers/workspace";

import { ReminderDialog } from "./reminder-dialog";
import { ReminderItem } from "./reminder-item";

const OPEN_TASKS: TaskListQuery = { status: "open", sort: "due_date", limit: 200 };

/** The Reminders page for the active workspace. Remounts (and resets) when the workspace changes. */
export function RemindersPanel() {
  const { state, refresh } = useWorkspaces();

  if (state.status === "error") {
    return (
      <div role="alert" className="space-y-3 rounded-xl border bg-card p-4 text-sm">
        <p>{state.message}</p>
        <Button variant="outline" size="sm" onClick={refresh}>
          Try again
        </Button>
      </div>
    );
  }
  if (state.status === "loading") return <ReminderListSkeleton />;
  return <RemindersView key={state.active.id} workspaceId={state.active.id} />;
}

/** `null` while closed; `"new"` to create; a reminder to edit it. */
type DialogState = null | "new" | Reminder;

function RemindersView({ workspaceId }: { workspaceId: string }) {
  const user = useCurrentUser();
  const [filter, setFilter] = useState<ReminderFilter>("scheduled");
  const query = useMemo(() => toReminderListQuery(filter), [filter]);
  const { state, refreshing, reload } = useReminderList(workspaceId, query);
  const { state: openTasks } = useTaskList(workspaceId, OPEN_TASKS);
  const mutations = useReminderMutations(workspaceId);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const viewerTimeZone = browserTimeZone();
  const defaultTimeZone = user.timezone ?? viewerTimeZone;

  const setReminderPending = useCallback((reminderId: string, isPending: boolean) => {
    setPending((current) => {
      const next = new Set(current);
      if (isPending) next.add(reminderId);
      else next.delete(reminderId);
      return next;
    });
  }, []);

  const save = useCallback(
    async (fields: ReminderFields) => {
      const saved =
        dialog && dialog !== "new"
          ? await mutations.update.mutateAsync({ reminder: dialog, changes: fields })
          : await mutations.create.mutateAsync({ ...fields, enabled: true });
      setActionError(null);
      setAnnouncement(`Saved “${saved.title}”.`);
    },
    [dialog, mutations.create, mutations.update],
  );

  const toggle = useCallback(
    async (reminder: Reminder) => {
      const enabling = !reminder.enabled;
      setActionError(null);
      setReminderPending(reminder.id, true);
      try {
        await mutations.update.mutateAsync({ reminder, changes: { enabled: enabling } });
        setAnnouncement(
          enabling ? `Enabled “${reminder.title}”.` : `Disabled “${reminder.title}”.`,
        );
      } catch (reason) {
        setActionError(
          describeApiError(
            reason,
            enabling ? "Couldn’t enable the reminder." : "Couldn’t disable the reminder.",
          ),
        );
      }
      setReminderPending(reminder.id, false);
    },
    [mutations.update, setReminderPending],
  );

  const remove = useCallback(
    async (reminder: Reminder) => {
      setActionError(null);
      setReminderPending(reminder.id, true);
      try {
        await mutations.remove.mutateAsync(reminder);
        setAnnouncement(`Deleted “${reminder.title}”.`);
        listRef.current?.focus();
      } catch (reason) {
        setActionError(describeApiError(reason, "Couldn’t delete the reminder. Try again."));
      }
      setReminderPending(reminder.id, false);
    },
    [mutations.remove, setReminderPending],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="group"
          aria-label="Show"
          className="inline-flex h-9 max-w-full items-center self-start overflow-x-auto rounded-md border bg-muted/60 p-0.5"
        >
          {REMINDER_FILTERS.map((option) => {
            const selected = filter === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                onClick={() => setFilter(option.value)}
                className={cn(
                  "h-full shrink-0 rounded-[calc(var(--radius-md)-2px)] px-3 text-sm font-medium transition-[color,background-color,box-shadow] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected
                    ? "bg-card text-foreground shadow-elevation-1"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <Button onClick={() => setDialog("new")} className="self-start sm:self-auto">
          <Plus aria-hidden="true" />
          New reminder
        </Button>
      </div>

      <FormAlert message={actionError} />

      <section aria-labelledby="reminder-list-heading">
        <h2 id="reminder-list-heading" className="sr-only">
          Reminder list
        </h2>
        <div
          ref={listRef}
          tabIndex={-1}
          aria-busy={state.status === "loading" || refreshing}
          className="rounded-xl outline-none"
        >
          {state.status === "loading" ? (
            <ReminderListSkeleton />
          ) : state.status === "error" ? (
            <div role="alert" className="space-y-3 rounded-xl border bg-card p-4 text-sm">
              <p>{state.message}</p>
              <Button variant="outline" size="sm" onClick={reload}>
                Try again
              </Button>
            </div>
          ) : state.data.reminders.length === 0 ? (
            <ReminderEmptyState filter={filter} onCreate={() => setDialog("new")} />
          ) : (
            <div className="space-y-2">
              <ul
                aria-label={`${state.data.total} ${state.data.total === 1 ? "reminder" : "reminders"}`}
                className={cn(
                  "divide-y overflow-hidden rounded-xl border bg-card shadow-elevation-1 transition-opacity duration-150",
                  refreshing && "opacity-70",
                )}
              >
                {state.data.reminders.map((reminder) => (
                  <ReminderItem
                    key={reminder.id}
                    reminder={reminder}
                    viewerTimeZone={viewerTimeZone}
                    pending={pending.has(reminder.id)}
                    onToggle={(item) => void toggle(item)}
                    onEdit={setDialog}
                    onDelete={remove}
                  />
                ))}
              </ul>
              {state.data.total > state.data.reminders.length ? (
                <p className="px-1 text-xs text-muted-foreground">
                  Showing {state.data.reminders.length} of {state.data.total} reminders.
                </p>
              ) : null}
            </div>
          )}
        </div>
      </section>

      <p role="status" className="sr-only">
        {announcement}
      </p>

      {dialog ? (
        <ReminderDialog
          reminder={dialog === "new" ? null : dialog}
          tasks={openTasks.status === "success" ? openTasks.data.tasks : []}
          defaultTimeZone={defaultTimeZone}
          onSave={save}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

function ReminderEmptyState({
  filter,
  onCreate,
}: {
  filter: ReminderFilter;
  onCreate: () => void;
}) {
  switch (filter) {
    case "overdue":
      return (
        <EmptyState
          icon={CheckCheck}
          title="Nothing overdue"
          description="Every reminder that came due has been delivered to your notifications."
        />
      );
    case "completed":
      return (
        <EmptyState
          icon={CheckCheck}
          title="No completed reminders"
          description="One-time reminders appear here after they fire, along with reminders whose task is done."
        />
      );
    case "disabled":
      return (
        <EmptyState
          icon={BellOff}
          title="No disabled reminders"
          description="Switch a reminder off to pause it without deleting it."
        />
      );
    default:
      return (
        <EmptyState
          icon={AlarmClock}
          title={filter === "all" ? "No reminders yet" : "Nothing coming up"}
          description="Create a reminder for a task or anything else. It arrives in your notifications at the time you choose."
        >
          <Button variant="outline" size="sm" onClick={onCreate}>
            <Plus aria-hidden="true" />
            New reminder
          </Button>
        </EmptyState>
      );
  }
}

function ReminderListSkeleton() {
  return (
    <div className="divide-y rounded-xl border bg-card">
      <span className="sr-only">Loading reminders…</span>
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-start gap-3 px-4 py-3.5">
          <Skeleton className="h-5 w-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className={cn("h-4", row === 1 ? "w-1/3" : "w-1/2")} />
            <Skeleton className="h-3 w-40" />
          </div>
        </div>
      ))}
    </div>
  );
}
