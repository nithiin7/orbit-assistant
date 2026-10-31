"use client";

import type { CreateTaskRequest, Task, UpdateTaskRequest } from "@orbit/contracts";
import { AlertCircle, CalendarClock, CheckCheck, ListTodo, SearchX } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { describeApiError } from "@/api/client";
import { EmptyState } from "@/components/empty-state";
import { FormAlert } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTaskList, useTaskMutations, useTaskSummary } from "@/hooks/use-tasks";
import {
  DEFAULT_TASK_FILTERS,
  groupTasksByDue,
  isNarrowed,
  type StatusFilter,
  type TaskFilters,
  toTaskListQuery,
} from "@/lib/tasks";
import { useWorkspaces } from "@/providers/workspace";
import { cn } from "@/utils/common";
import { localDateString } from "@/utils/dates";
import { isEditableTarget } from "@/utils/keyboard";

import { TaskComposer } from "./task-composer";
import { TaskEditDialog } from "./task-edit-dialog";
import { TaskItem } from "./task-item";
import { TaskToolbar } from "./task-toolbar";
import { TaskViews } from "./task-views";

const SEARCH_DELAY_MS = 250;

/** The Tasks page for the active workspace. Remounts (and resets) when the workspace changes. */
export function TasksPanel() {
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
  if (state.status === "loading") return <TaskListSkeleton />;
  return <TasksView key={state.active.id} workspaceId={state.active.id} />;
}

function TasksView({ workspaceId }: { workspaceId: string }) {
  const [filters, setFilters] = useState<TaskFilters>(DEFAULT_TASK_FILTERS);
  const [search, setSearch] = useState("");
  const query = useMemo(() => toTaskListQuery(filters), [filters]);
  const { state, refreshing, reload } = useTaskList(workspaceId, query);
  const summary = useTaskSummary(workspaceId);
  const mutations = useTaskMutations(workspaceId);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<Task | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const groupIdPrefix = useId();
  // Recomputed on each render, so "today" moves on if the page is left open past midnight.
  const today = localDateString();

  // Search follows the box after a pause, so each keystroke doesn't send a request.
  useEffect(() => {
    const next = search.trim();
    const timer = window.setTimeout(() => {
      setFilters((current) => (current.search === next ? current : { ...current, search: next }));
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  // N focuses the new-task field and / focuses search, unless the user is typing somewhere.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target) || document.querySelector("dialog[open]")) return;
      const target =
        event.key === "/" ? searchRef : event.key.toLowerCase() === "n" ? titleRef : null;
      if (!target?.current) return;
      event.preventDefault();
      target.current.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const setTaskPending = useCallback((taskId: string, isPending: boolean) => {
    setPending((current) => {
      const next = new Set(current);
      if (isPending) next.add(taskId);
      else next.delete(taskId);
      return next;
    });
  }, []);

  const create = useCallback(
    async (draft: CreateTaskRequest) => {
      const task = await mutations.create.mutateAsync(draft);
      setActionError(null);
      setAnnouncement(`Added “${task.title}”.`);
    },
    [mutations.create],
  );

  const toggle = useCallback(
    async (task: Task) => {
      const completing = task.status === "open";
      setActionError(null);
      setTaskPending(task.id, true);
      try {
        await mutations.toggle.mutateAsync(task);
        setAnnouncement(completing ? `Completed “${task.title}”.` : `Reopened “${task.title}”.`);
      } catch (reason) {
        setActionError(
          describeApiError(
            reason,
            completing ? "Couldn’t complete the task. Try again." : "Couldn’t reopen the task.",
          ),
        );
      }
      setTaskPending(task.id, false);
    },
    [mutations.toggle, setTaskPending],
  );

  const save = useCallback(
    async (task: Task, changes: UpdateTaskRequest) => {
      const updated = await mutations.update.mutateAsync({ task, changes });
      setActionError(null);
      setAnnouncement(`Saved “${updated.title}”.`);
    },
    [mutations.update],
  );

  const remove = useCallback(
    async (task: Task) => {
      setActionError(null);
      setTaskPending(task.id, true);
      try {
        await mutations.remove.mutateAsync(task);
        setAnnouncement(`Deleted “${task.title}”.`);
        // The row and its focused button are gone; keep focus in the list.
        listRef.current?.focus();
      } catch (reason) {
        setActionError(describeApiError(reason, "Couldn’t delete the task. Try again."));
      }
      setTaskPending(task.id, false);
    },
    [mutations.remove, setTaskPending],
  );

  const clearNarrowing = () => {
    setSearch("");
    setFilters((current) => ({ ...current, search: "", priority: "all" }));
  };

  const renderRow = (task: Task) => (
    <TaskItem
      key={task.id}
      task={task}
      today={today}
      pending={pending.has(task.id)}
      onToggle={(item) => void toggle(item)}
      onEdit={setEditing}
      onDelete={remove}
    />
  );
  const listClassName = cn(
    "@container/rows divide-y overflow-hidden rounded-xl border bg-card shadow-elevation-1 transition-opacity duration-150",
    refreshing && "opacity-70",
  );
  // Sections by due date help most for open tasks in due order; other views read as one list.
  const grouped = filters.status === "open" && filters.sort === "due_date";

  // Layout follows the space the page actually gets (which depends on the app sidebar), not the
  // screen: container queries size the rail, the header, the composer, and the list columns.
  return (
    <div className="@container/tasks">
      <div className="grid gap-6 @4xl/tasks:grid-cols-[13rem_minmax(0,1fr)] @4xl/tasks:gap-8 @7xl/tasks:grid-cols-[15rem_minmax(0,1fr)] @7xl/tasks:gap-12">
        <aside className="min-w-0 @4xl/tasks:sticky @4xl/tasks:top-6 @4xl/tasks:self-start">
          <TaskViews filters={filters} onFiltersChange={setFilters} summary={summary} />
        </aside>

        <section aria-labelledby="task-list-heading" className="@container/list min-w-0 space-y-5">
          <div className="flex flex-col gap-3 @3xl/list:flex-row @3xl/list:items-end @3xl/list:justify-between">
            <div className="min-w-0 space-y-1.5">
              <h2 id="task-list-heading" className="text-lg font-semibold tracking-tight">
                {VIEW_TITLES[filters.status]}
              </h2>
              <AttentionSummary
                overdue={summary?.overdue ?? 0}
                dueToday={summary?.due_today ?? 0}
              />
            </div>
            <TaskToolbar
              search={search}
              onSearchChange={setSearch}
              filters={filters}
              onFiltersChange={setFilters}
              searchRef={searchRef}
            />
          </div>

          <TaskComposer onCreate={create} titleRef={titleRef} />
          <FormAlert message={actionError} />

          <div
            ref={listRef}
            tabIndex={-1}
            aria-busy={state.status === "loading" || refreshing}
            className="rounded-xl outline-none"
          >
            {state.status === "loading" ? (
              <TaskListSkeleton />
            ) : state.status === "error" ? (
              <div role="alert" className="space-y-3 rounded-xl border bg-card p-4 text-sm">
                <p>{state.message}</p>
                <Button variant="outline" size="sm" onClick={reload}>
                  Try again
                </Button>
              </div>
            ) : state.data.tasks.length === 0 ? (
              <TaskEmptyState filters={filters} onClear={clearNarrowing} />
            ) : (
              <div className="space-y-6">
                {grouped ? (
                  // On very wide screens the sections sit side by side, like a board.
                  <div className="gap-6 @5xl/list:columns-2 @min-[100rem]/list:columns-3">
                    {groupTasksByDue(state.data.tasks, today).map((group) => {
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
                              {group.tasks.length}
                            </span>
                          </h3>
                          <ul
                            aria-label={`${group.label}, ${countLabel(group.tasks.length)}`}
                            className={listClassName}
                          >
                            {group.tasks.map(renderRow)}
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
                      "grid @5xl/list:grid-cols-2 @5xl/list:divide-y-0 @5xl/list:*:-mb-px @5xl/list:*:border-b @5xl/list:*:odd:border-r @5xl/list:*:odd:last:border-r-0",
                    )}
                  >
                    {state.data.tasks.map(renderRow)}
                  </ul>
                )}
                <p className="px-1 text-xs text-muted-foreground">
                  {state.data.total > state.data.tasks.length
                    ? `Showing ${state.data.tasks.length} of ${state.data.total} tasks. Search or filter to find the rest.`
                    : countLabel(state.data.total)}
                </p>
              </div>
            )}
          </div>
        </section>

        <p role="status" className="sr-only">
          {announcement}
        </p>

        {editing ? (
          <TaskEditDialog task={editing} onSave={save} onClose={() => setEditing(null)} />
        ) : null}
      </div>
    </div>
  );
}

const VIEW_TITLES: Record<StatusFilter, string> = {
  open: "Open tasks",
  completed: "Completed tasks",
  all: "All tasks",
};

function countLabel(count: number): string {
  return `${count} ${count === 1 ? "task" : "tasks"}`;
}

/** What needs attention now, in words as well as color. Nothing when all is calm. */
function AttentionSummary({ overdue, dueToday }: { overdue: number; dueToday: number }) {
  if (overdue === 0 && dueToday === 0) {
    return <p className="text-sm text-muted-foreground">Nothing overdue or due today.</p>;
  }
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm">
      {overdue > 0 ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-0.5 font-medium text-destructive">
          <AlertCircle className="size-3.5" aria-hidden="true" />
          {overdue} overdue
        </span>
      ) : null}
      {dueToday > 0 ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-subtle px-2.5 py-0.5 font-medium text-brand">
          <CalendarClock className="size-3.5" aria-hidden="true" />
          {dueToday} due today
        </span>
      ) : null}
    </p>
  );
}

function TaskEmptyState({ filters, onClear }: { filters: TaskFilters; onClear: () => void }) {
  if (isNarrowed(filters)) {
    return (
      <EmptyState
        icon={SearchX}
        title="No matching tasks"
        description="Nothing matches this search and priority. Try other words, or clear the filters."
      >
        <Button variant="outline" size="sm" onClick={onClear}>
          Clear search and filters
        </Button>
      </EmptyState>
    );
  }
  if (filters.status === "completed") {
    return (
      <EmptyState
        icon={CheckCheck}
        title="No completed tasks yet"
        description="Tasks you check off appear here, so you can look back or reopen them."
      />
    );
  }
  return (
    <EmptyState
      icon={ListTodo}
      title={filters.status === "open" ? "No open tasks" : "No tasks yet"}
      description={
        filters.status === "open"
          ? "You’re all caught up. Add a task above when something new comes up."
          : "Add your first task above. Give it a due date or priority to keep it in view."
      }
    />
  );
}

function TaskListSkeleton() {
  return (
    <div className="divide-y overflow-hidden rounded-xl border bg-card">
      <span className="sr-only">Loading tasks…</span>
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex items-center gap-3 px-4 py-3.5">
          <Skeleton className="size-5 rounded-full" />
          <Skeleton className={cn("h-4", row % 2 === 1 ? "w-1/3" : "w-1/2")} />
          <Skeleton className="ml-auto hidden h-6 w-20 rounded-full md:block" />
        </div>
      ))}
    </div>
  );
}
