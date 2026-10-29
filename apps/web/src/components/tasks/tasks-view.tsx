"use client";

import type { CreateTaskRequest, Task, UpdateTaskRequest } from "@orbit/contracts";
import { CheckCheck, ListTodo, SearchX } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { describeApiError } from "@/api/client";
import { EmptyState } from "@/components/empty-state";
import { FormAlert } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTaskList, useTaskMutations } from "@/hooks/use-tasks";
import { isEditableTarget } from "@/lib/keyboard";
import {
  DEFAULT_TASK_FILTERS,
  isNarrowed,
  localDateString,
  type TaskFilters,
  toTaskListQuery,
} from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { useWorkspaces } from "@/providers/workspace-provider";

import { TaskComposer } from "./task-composer";
import { TaskEditDialog } from "./task-edit-dialog";
import { TaskItem } from "./task-item";
import { TaskToolbar } from "./task-toolbar";

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
  const mutations = useTaskMutations(workspaceId);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<Task | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
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

  return (
    <div className="space-y-6">
      <TaskComposer onCreate={create} titleRef={titleRef} />

      <section aria-labelledby="task-list-heading" className="space-y-3">
        <h2 id="task-list-heading" className="sr-only">
          Task list
        </h2>
        <TaskToolbar
          search={search}
          onSearchChange={setSearch}
          filters={filters}
          onFiltersChange={setFilters}
          searchRef={searchRef}
        />
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
            <div className="space-y-2">
              <ul
                aria-label={`${state.data.total} ${state.data.total === 1 ? "task" : "tasks"}`}
                className={cn(
                  "divide-y overflow-hidden rounded-xl border bg-card shadow-elevation-1 transition-opacity duration-150",
                  refreshing && "opacity-70",
                )}
              >
                {state.data.tasks.map((task) => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    today={today}
                    pending={pending.has(task.id)}
                    onToggle={(item) => void toggle(item)}
                    onEdit={setEditing}
                    onDelete={remove}
                  />
                ))}
              </ul>
              <p className="px-1 text-xs text-muted-foreground">
                {state.data.total > state.data.tasks.length
                  ? `Showing ${state.data.tasks.length} of ${state.data.total} tasks. Search or filter to find the rest.`
                  : `${state.data.total} ${state.data.total === 1 ? "task" : "tasks"}`}
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
    <div className="divide-y rounded-xl border bg-card">
      <span className="sr-only">Loading tasks…</span>
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-start gap-3 px-4 py-3.5">
          <Skeleton className="size-4 rounded" />
          <div className="flex-1 space-y-2">
            <Skeleton className={cn("h-4", row === 1 ? "w-1/3" : "w-1/2")} />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}
