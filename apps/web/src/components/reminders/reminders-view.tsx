"use client";

import type { Reminder, ReminderList, TaskListQuery } from "@orbit/contracts";
import { AlarmClock, BellOff, CheckCheck, Plus } from "lucide-react";
import { useCallback, useId, useMemo, useRef, useState } from "react";

import { describeApiError } from "@/api/client";
import { EmptyState } from "@/components/empty-state";
import { FormAlert } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Resource } from "@/hooks/query-resource";
import { useReminderList, useReminderMutations } from "@/hooks/use-reminders";
import { useTaskList } from "@/hooks/use-tasks";
import {
  formatOccurrence,
  groupRemindersByFire,
  type ReminderFields,
  type ReminderFilter,
  toReminderListQuery,
} from "@/lib/reminders";
import { useCurrentUser } from "@/providers/auth";
import { useWorkspaces } from "@/providers/workspace";
import { cn } from "@/utils/common";
import { browserTimeZone } from "@/utils/time-zones";

import { ReminderDialog } from "./reminder-dialog";
import { ReminderItem } from "./reminder-item";
import { ReminderViews } from "./reminder-views";

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
  const groupIdPrefix = useId();
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

  const renderRow = (reminder: Reminder) => (
    <ReminderItem
      key={reminder.id}
      reminder={reminder}
      viewerTimeZone={viewerTimeZone}
      pending={pending.has(reminder.id)}
      onToggle={(item) => void toggle(item)}
      onEdit={setDialog}
      onDelete={remove}
    />
  );
  const listClassName = cn(
    "@container/rows divide-y overflow-hidden rounded-xl border bg-card shadow-elevation-1 transition-opacity duration-150",
    refreshing && "opacity-70",
  );
  // Sections by when they fire help where reminders have times ahead; other views read as one list.
  const grouped = filter === "scheduled" || filter === "all";

  // Layout follows the space the page actually gets (which depends on the app sidebar), not the
  // screen: container queries place the views rail, the header, and the list columns.
  return (
    <div className="@container/reminders">
      <div className="grid gap-6 @4xl/reminders:grid-cols-[13rem_minmax(0,1fr)] @4xl/reminders:gap-8 @7xl/reminders:grid-cols-[15rem_minmax(0,1fr)] @7xl/reminders:gap-12">
        <aside className="min-w-0 @4xl/reminders:sticky @4xl/reminders:top-6 @4xl/reminders:self-start">
          <ReminderViews
            filter={filter}
            onFilterChange={(next) => {
              setActionError(null);
              setFilter(next);
            }}
          />
        </aside>

        <section
          aria-labelledby="reminder-list-heading"
          className="@container/list min-w-0 space-y-5"
        >
          <div className="flex flex-col gap-3 @lg/list:flex-row @lg/list:items-end @lg/list:justify-between">
            <div className="min-w-0 space-y-1.5">
              <h2 id="reminder-list-heading" className="text-lg font-semibold tracking-tight">
                {VIEW_TITLES[filter]}
              </h2>
              <ListSummary state={state} filter={filter} />
            </div>
            <Button
              onClick={() => setDialog("new")}
              className="shrink-0 self-start @lg/list:self-auto"
            >
              <Plus aria-hidden="true" />
              New reminder
            </Button>
          </div>

          <FormAlert message={actionError} />

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
              <div className="space-y-6">
                {grouped ? (
                  // On very wide screens the sections sit side by side, like a board.
                  <div className="gap-6 @5xl/list:columns-2 @min-[100rem]/list:columns-3">
                    {groupRemindersByFire(state.data.reminders, viewerTimeZone).map((group) => {
                      const headingId = `${groupIdPrefix}-${group.key}`;
                      return (
                        <section
                          key={group.key}
                          aria-labelledby={headingId}
                          className="mb-6 break-inside-avoid space-y-2 last:mb-0"
                        >
                          <h3
                            id={headingId}
                            className={cn(
                              "flex items-center gap-2 px-1 text-xs font-semibold tracking-wide uppercase",
                              group.key === "overdue"
                                ? "text-destructive"
                                : group.key === "today"
                                  ? "text-brand"
                                  : "text-muted-foreground",
                            )}
                          >
                            {group.label}
                            <span
                              aria-hidden="true"
                              className="rounded-full bg-muted px-1.5 font-medium text-muted-foreground tabular-nums"
                            >
                              {group.reminders.length}
                            </span>
                          </h3>
                          <ul
                            aria-label={`${group.label}, ${countLabel(group.reminders.length)}`}
                            className={listClassName}
                          >
                            {group.reminders.map(renderRow)}
                          </ul>
                        </section>
                      );
                    })}
                  </div>
                ) : (
                  <ul
                    aria-label={countLabel(state.data.total)}
                    className={cn(
                      listClassName,
                      // Two columns of rows on very wide screens, with a rule between them.
                      state.data.reminders.length > 1 &&
                        "grid @5xl/list:grid-cols-2 @5xl/list:divide-y-0 @5xl/list:*:-mb-px @5xl/list:*:border-b @5xl/list:*:odd:border-r @5xl/list:*:odd:last:border-r-0",
                    )}
                  >
                    {state.data.reminders.map(renderRow)}
                  </ul>
                )}
                <p className="px-1 text-xs text-muted-foreground">
                  {state.data.total > state.data.reminders.length
                    ? `Showing ${state.data.reminders.length} of ${state.data.total} reminders.`
                    : countLabel(state.data.total)}
                </p>
              </div>
            )}
          </div>
        </section>
      </div>

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

const VIEW_TITLES: Record<ReminderFilter, string> = {
  scheduled: "Upcoming reminders",
  overdue: "Overdue reminders",
  completed: "Completed reminders",
  disabled: "Disabled reminders",
  all: "All reminders",
};

function countLabel(count: number): string {
  return `${count} ${count === 1 ? "reminder" : "reminders"}`;
}

/** How many reminders the view holds and, for upcoming ones, when the next one fires. */
function ListSummary({ state, filter }: { state: Resource<ReminderList>; filter: ReminderFilter }) {
  if (state.status !== "success") {
    return <p className="text-sm text-muted-foreground">&nbsp;</p>;
  }
  const { reminders, total } = state.data;
  const next =
    filter === "scheduled"
      ? reminders.find((r) => r.status === "scheduled" && r.next_occurrence_at)
      : undefined;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
      <span>{total === 0 ? "None right now" : countLabel(total)}</span>
      {next?.next_occurrence_at ? (
        <>
          <span aria-hidden="true">·</span>
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <AlarmClock className="size-3.5 shrink-0 text-brand" aria-hidden="true" />
            <span>
              Next{" "}
              <time dateTime={next.next_occurrence_at} className="font-medium text-foreground">
                {formatOccurrence(next.next_occurrence_at, next.timezone)}
              </time>
            </span>
          </span>
        </>
      ) : null}
    </p>
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
    <div className="divide-y overflow-hidden rounded-xl border bg-card">
      <span className="sr-only">Loading reminders…</span>
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex items-center gap-3 px-4 py-3.5">
          <Skeleton className="h-5 w-9 rounded-full" />
          <Skeleton className={cn("h-4", row % 2 === 1 ? "w-1/3" : "w-1/2")} />
          <Skeleton className="ml-auto hidden h-6 w-28 rounded-full md:block" />
        </div>
      ))}
    </div>
  );
}
