"use client";

import type { CreateTaskRequest, Task, UpdateTaskRequest } from "@orbit/contracts";
import type { TaskListDetail } from "@orbit/contracts";
import { CheckCheck, ListTodo, MoreHorizontal, SearchX } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { describeApiError } from "@/api/client";
import { useConfirm } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { FormAlert } from "@/components/form-field";
import { TemplatePickerDialog } from "@/components/template-picker-dialog";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { SortableList, type SortableMove } from "@/components/ui/sortable";
import {
  useDeleteTaskWithUndo,
  useLinkedTask,
  useTaskFocusTimes,
  useTaskList,
  useTaskListMutations,
  useTaskLists,
  useTaskMutations,
  useTaskSummary,
} from "@/hooks/use-tasks";
import {
  DEFAULT_TASK_FILTERS,
  groupTasksByDue,
  isNarrowed,
  type StatusFilter,
  TASK_LIST_STYLES,
  TASK_TEMPLATES,
  type TaskFilters,
  taskMoveRequest,
  type TaskTemplate,
  taskTemplateRequests,
  toTaskListQuery,
} from "@/lib/tasks";
import { useFocusTimer } from "@/providers/focus";
import { useWorkspaces } from "@/providers/workspace";
import { cn } from "@/utils/common";
import { localDateString } from "@/utils/dates";
import { isEditableTarget } from "@/utils/keyboard";
import { animateListChanges } from "@/utils/list-motion";

import { TaskComposer } from "./task-composer";
import { TaskEditDialog } from "./task-edit-dialog";
import { TasksHero } from "./task-hero";
import { SortableTaskItem, TaskItem } from "./task-item";
import { TaskListDialog, type TaskListValues } from "./task-list-dialog";
import { TaskListFilter } from "./task-list-filter";
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
  if (state.status === "loading") return <TasksPageSkeleton />;
  return <TasksView key={state.active.id} workspaceId={state.active.id} />;
}

function TasksView({ workspaceId }: { workspaceId: string }) {
  const [filters, setFilters] = useState<TaskFilters>(DEFAULT_TASK_FILTERS);
  const [search, setSearch] = useState("");
  const query = useMemo(() => toTaskListQuery(filters), [filters]);
  const { state, refreshing, reload } = useTaskList(workspaceId, query);
  const summary = useTaskSummary(workspaceId);
  const mutations = useTaskMutations(workspaceId);
  const lists = useTaskLists(workspaceId);
  const focusTimes = useTaskFocusTimes(workspaceId);
  const focus = useFocusTimer();
  const listMutations = useTaskListMutations(workspaceId);
  const { confirm, confirmDialog } = useConfirm();
  // The list being created (`"new"`) or edited, in a dialog.
  const [listDialog, setListDialog] = useState<TaskListDetail | "new" | null>(null);
  const listOptions = lists.state.status === "success" ? lists.state.data : [];
  const selectedList =
    filters.list === "all" || filters.list === "none" ? undefined : lists.byId.get(filters.list);
  const [editing, setEditing] = useState<Task | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  // A note's link to a task opens it here.
  useLinkedTask(workspaceId, setEditing);
  const [actionError, setActionError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  /** Tasks whose rows folded away after they stopped belonging in the list in view. */
  const [departed, setDeparted] = useState<ReadonlySet<string>>(new Set());
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

  const create = useCallback(
    async (draft: CreateTaskRequest) => {
      const task = await mutations.create.mutateAsync(draft);
      setActionError(null);
      setAnnouncement(`Added “${task.title}”.`);
    },
    [mutations.create],
  );

  /** Adds a template's tasks, in order, to the list in view (or no list). */
  const applyTemplate = async (template: TaskTemplate) => {
    const listId = selectedList?.id ?? null;
    for (const draft of taskTemplateRequests(template, listId)) {
      await mutations.create.mutateAsync(draft);
    }
    setActionError(null);
    setAnnouncement(`Added ${template.tasks.length} tasks from “${template.name}”.`);
  };

  const toggle = useCallback(
    async (task: Task) => {
      const completing = task.status === "open";
      setActionError(null);
      // The row flips at once (see `useTaskMutations`), so it isn't dimmed meanwhile.
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
    },
    [mutations.toggle],
  );

  const save = useCallback(
    async (task: Task, changes: UpdateTaskRequest) => {
      const updated = await mutations.update.mutateAsync({ task, changes });
      setActionError(null);
      setAnnouncement(`Saved “${updated.title}”.`);
    },
    [mutations.update],
  );

  const deleteWithUndo = useDeleteTaskWithUndo(workspaceId, mutations.remove.mutateAsync);
  const remove = (task: Task) => {
    setActionError(null);
    deleteWithUndo(task);
    // The row and its focused button are gone; keep focus in the list.
    listRef.current?.focus();
  };

  const saveList = async (values: TaskListValues) => {
    if (listDialog === "new") {
      const created = await listMutations.create.mutateAsync(values);
      setAnnouncement(`Created the list “${created.name}”.`);
      // Show the new, empty list, ready for its first task.
      setFilters((current) => ({ ...current, list: created.id }));
    } else if (listDialog) {
      const updated = await listMutations.update.mutateAsync({ id: listDialog.id, body: values });
      setAnnouncement(`Saved the list “${updated.name}”.`);
    }
  };

  const removeList = async (list: TaskListDetail) => {
    const confirmed = await confirm({
      title: `Delete “${list.name}”?`,
      description: "Its tasks are kept, on no list.",
      confirmLabel: "Delete list",
      destructive: true,
    });
    if (!confirmed) return;
    setActionError(null);
    try {
      await listMutations.remove.mutateAsync(list.id);
      setFilters((current) => ({ ...current, list: "all" }));
      setAnnouncement(`Deleted the list “${list.name}”.`);
    } catch (reason) {
      setActionError(describeApiError(reason, "Couldn’t delete the list. Try again."));
    }
  };

  const clearNarrowing = () => {
    setSearch("");
    setFilters((current) => ({ ...current, search: "", priority: "all" }));
  };

  // In "My order" the tasks can be dragged into a new order.
  const manual = filters.sort === "manual";
  const move = ({ item, to, order }: SortableMove<Task>) => {
    const body = taskMoveRequest(order, to);
    if (!body) return;
    setActionError(null);
    mutations.move.mutateAsync({ task: item, body, query, order }).catch((reason: unknown) => {
      setActionError(describeApiError(reason, "Couldn’t move the task. Try again."));
    });
  };

  // A task completed (or reopened) here stays in the cached list until it refetches; its row
  // folds away instead, and is then left out.
  const belongs = (task: Task) => filters.status === "all" || task.status === filters.status;
  const shownTasks =
    state.status === "success"
      ? state.data.tasks.filter((task) => belongs(task) || !departed.has(task.id))
      : [];
  const shownTotal =
    state.status === "success"
      ? state.data.total - (state.data.tasks.length - shownTasks.length)
      : 0;

  const Row = manual ? SortableTaskItem : TaskItem;
  const renderRow = (task: Task) => (
    <Row
      key={task.id}
      task={task}
      leaving={!belongs(task)}
      onLeft={(item) => setDeparted((current) => new Set(current).add(item.id))}
      // The list in view goes without saying.
      list={
        task.list_id && task.list_id !== filters.list ? lists.byId.get(task.list_id) : undefined
      }
      today={today}
      onToggle={(item) => void toggle(item)}
      onEdit={setEditing}
      onDelete={remove}
      focusedSeconds={focusTimes.get(task.id)}
      focusing={focus.timer?.taskId === task.id}
      onFocus={(item) => {
        focus.start({ workspaceId, taskId: item.id, taskTitle: item.title });
        setAnnouncement(`Focusing on “${item.title}” for 25 minutes.`);
      }}
    />
  );
  const listClassName = cn(
    "@container/rows relative divide-y overflow-hidden rounded-2xl border bg-card shadow-elevation-1 transition-opacity duration-150",
    refreshing && "opacity-70",
  );
  // Sections by due date help most for open tasks in due order; other views read as one list.
  const grouped = filters.status === "open" && filters.sort === "due_date";

  // Layout follows the space the page actually gets (which depends on the app sidebar), not the
  // screen: container queries size the rail, the header, the composer, and the list columns.
  return (
    <div className="@container/tasks">
      <div className="grid gap-6 @4xl/tasks:grid-cols-[13rem_minmax(0,1fr)] @4xl/tasks:gap-8 @7xl/tasks:grid-cols-[15rem_minmax(0,1fr)] @7xl/tasks:gap-12">
        <aside className="min-w-0 space-y-3 @4xl/tasks:sticky @4xl/tasks:top-6 @4xl/tasks:space-y-6 @4xl/tasks:self-start">
          <TaskViews filters={filters} onFiltersChange={setFilters} summary={summary} />
          <TaskListFilter
            lists={lists.state}
            selected={filters.list}
            onSelect={(list) => setFilters((current) => ({ ...current, list }))}
            onCreate={() => setListDialog("new")}
          />
        </aside>

        <section aria-labelledby="task-list-heading" className="@container/list min-w-0 space-y-5">
          <TasksHero summary={summary} today={today} />
          <div className="flex flex-col gap-3 @3xl/list:flex-row @3xl/list:items-end @3xl/list:justify-between">
            <div className="min-w-0 space-y-1.5">
              <div className="flex min-w-0 items-center gap-1">
                <h2
                  id="task-list-heading"
                  className="flex min-w-0 items-center gap-2 text-lg font-semibold tracking-tight"
                >
                  {selectedList ? (
                    <>
                      <span
                        aria-hidden="true"
                        className={cn(
                          "size-2.5 shrink-0 rounded-full",
                          TASK_LIST_STYLES[selectedList.color].dot,
                        )}
                      />
                      <span className="truncate">{selectedList.name}</span>
                      <span className="shrink-0 font-normal text-muted-foreground">
                        · {VIEW_TITLES[filters.status]}
                      </span>
                    </>
                  ) : filters.list === "none" ? (
                    `${VIEW_TITLES[filters.status]} on no list`
                  ) : (
                    VIEW_TITLES[filters.status]
                  )}
                </h2>
                {selectedList ? (
                  <Menu
                    aria-label={`${selectedList.name} list options`}
                    variant="ghost"
                    size="icon"
                    chevron={false}
                    align="start"
                    className="size-8 shrink-0 text-muted-foreground"
                    items={[
                      {
                        id: "edit",
                        label: "Rename or recolor",
                        onSelect: () => setListDialog(selectedList),
                      },
                      {
                        id: "delete",
                        label: "Delete list",
                        destructive: true,
                        onSelect: () => void removeList(selectedList),
                      },
                    ]}
                  >
                    <MoreHorizontal aria-hidden="true" />
                  </Menu>
                ) : null}
              </div>
            </div>
            <TaskToolbar
              search={search}
              onSearchChange={setSearch}
              filters={filters}
              onFiltersChange={setFilters}
              searchRef={searchRef}
            />
          </div>

          <TaskComposer
            // A new task goes on the list in view; switching lists starts afresh.
            key={filters.list}
            onCreate={create}
            titleRef={titleRef}
            lists={listOptions}
            defaultListId={filters.list === "all" || filters.list === "none" ? null : filters.list}
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
            ) : shownTasks.length === 0 ? (
              <TaskEmptyState
                filters={filters}
                listName={selectedList?.name ?? null}
                onClear={clearNarrowing}
                onTemplates={() => setTemplatesOpen(true)}
              />
            ) : (
              <div className="space-y-6">
                {grouped ? (
                  // On very wide screens the sections sit side by side, like a board.
                  <div className="gap-6 @5xl/list:columns-2 @min-[100rem]/list:columns-3">
                    {groupTasksByDue(shownTasks, today).map((group) => {
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
                            ref={animateListChanges}
                            className={listClassName}
                          >
                            {group.tasks.map(renderRow)}
                          </ul>
                        </section>
                      );
                    })}
                  </div>
                ) : manual ? (
                  // One column, so a dragged row moves straight up or down.
                  <SortableList items={shownTasks} itemLabel={(task) => task.title} onMove={move}>
                    <ul
                      ref={animateListChanges}
                      aria-label={countLabel(shownTotal)}
                      className={listClassName}
                    >
                      {shownTasks.map(renderRow)}
                    </ul>
                  </SortableList>
                ) : (
                  <ul
                    ref={animateListChanges}
                    aria-label={countLabel(shownTotal)}
                    className={cn(
                      listClassName,
                      // Two columns of rows on very wide screens, with a rule between them.
                      "grid @5xl/list:grid-cols-2 @5xl/list:divide-y-0 @5xl/list:*:-mb-px @5xl/list:*:border-b @5xl/list:*:odd:border-r @5xl/list:*:odd:last:border-r-0",
                    )}
                  >
                    {shownTasks.map(renderRow)}
                  </ul>
                )}
                <p className="px-1 text-xs text-muted-foreground">
                  {shownTotal > shownTasks.length
                    ? `Showing ${shownTasks.length} of ${shownTotal} tasks. Search or filter to find the rest.`
                    : countLabel(shownTotal)}
                </p>
              </div>
            )}
          </div>
        </section>

        <p role="status" className="sr-only">
          {announcement}
        </p>

        {editing ? (
          <TaskEditDialog
            task={editing}
            lists={listOptions}
            onSave={save}
            onClose={() => setEditing(null)}
          />
        ) : null}
        {listDialog ? (
          <TaskListDialog
            title={listDialog === "new" ? "New list" : "Edit list"}
            submitLabel={listDialog === "new" ? "Create list" : "Save"}
            initial={
              listDialog === "new"
                ? { name: "", color: "blue" }
                : { name: listDialog.name, color: listDialog.color }
            }
            onSave={saveList}
            onClose={() => setListDialog(null)}
          />
        ) : null}
        {templatesOpen ? (
          <TemplatePickerDialog
            title="Start from a template"
            description={
              selectedList
                ? `Pick a checklist. Its tasks are added to ${selectedList.name}, ready to edit.`
                : "Pick a checklist. Its tasks are added to your list, ready to edit."
            }
            templates={TASK_TEMPLATES.map((template) => ({
              ...template,
              preview: template.tasks,
              actionLabel: `Add ${template.tasks.length} tasks`,
            }))}
            onUse={applyTemplate}
            errorMessage="Couldn’t add every task from that template. Check your tasks and try again."
            onClose={() => setTemplatesOpen(false)}
          />
        ) : null}
        {confirmDialog}
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

function TaskEmptyState({
  filters,
  listName,
  onClear,
  onTemplates,
}: {
  filters: TaskFilters;
  /** The list in view, if one is. */
  listName: string | null;
  onClear: () => void;
  onTemplates: () => void;
}) {
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
  if (listName !== null && filters.status !== "completed") {
    return (
      <EmptyState
        icon={ListTodo}
        title={`Nothing on ${listName}${filters.status === "open" ? " to do" : " yet"}`}
        description="Add a task above, or move one here from its details."
        template={{ onClick: onTemplates }}
      />
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
          : "Add your first task above, with a due date or priority to keep it in view."
      }
      template={{ onClick: onTemplates }}
    />
  );
}

/**
 * The Tasks page while the workspace loads: the same rail, hero, toolbar, composer, and list
 * frame as the real page, so it fills in without moving.
 */
function TasksPageSkeleton() {
  return (
    <div className="@container/tasks" aria-busy="true">
      <div className="grid gap-6 @4xl/tasks:grid-cols-[13rem_minmax(0,1fr)] @4xl/tasks:gap-8 @7xl/tasks:grid-cols-[15rem_minmax(0,1fr)] @7xl/tasks:gap-12">
        <div
          aria-hidden="true"
          className="min-w-0 space-y-3 @4xl/tasks:sticky @4xl/tasks:top-6 @4xl/tasks:space-y-6 @4xl/tasks:self-start"
        >
          <div className="flex gap-1 @4xl/tasks:flex-col">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-9 w-24 rounded-lg @4xl/tasks:w-full" />
            ))}
          </div>
          <div className="flex gap-1.5 @4xl/tasks:flex-wrap">
            {[0, 1, 2, 3].map((chip) => (
              <Skeleton key={chip} className="h-8 w-20 rounded-full" />
            ))}
          </div>
        </div>
        <div className="@container/list min-w-0 space-y-5">
          <TasksHero summary={undefined} today={localDateString()} />
          <div
            aria-hidden="true"
            className="flex flex-col gap-3 @3xl/list:flex-row @3xl/list:items-end @3xl/list:justify-between"
          >
            <SkeletonText className="w-24 text-lg" />
            <div className="flex w-full flex-col gap-2 @md/list:flex-row @3xl/list:w-auto">
              <Skeleton className="h-9 min-w-0 flex-1 @3xl/list:w-64 @3xl/list:flex-none @5xl/list:w-80" />
              <Skeleton className="h-9 @md/list:w-44" />
            </div>
          </div>
          <Skeleton className="h-15 rounded-2xl" />
          <TaskListSkeleton />
        </div>
      </div>
    </div>
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
