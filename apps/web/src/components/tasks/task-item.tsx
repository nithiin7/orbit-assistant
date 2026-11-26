"use client";

import type { Task, TaskListDetail } from "@orbit/contracts";
import { Timer, Trash2 } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DragHandle, type SortableItem, useSortableItem } from "@/components/ui/sortable";
import { cn } from "@/utils/common";

import { DueDateLabel, FocusBadge, PriorityBadge, RepeatBadge, TaskListBadge } from "./task-meta";

type TaskItemProps = {
  task: Task;
  /** The list the task is on, when it's on one and that isn't already the list in view. */
  list?: TaskListDetail;
  today: string;
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  /** Time spent on the task with the focus timer, in seconds. */
  focusedSeconds?: number;
  /** The focus timer is on this task. */
  focusing?: boolean;
  /** Start the focus timer on the task; open tasks only. */
  onFocus?: (task: Task) => void;
  /** Set by `SortableTaskItem`: the row can be dragged by a handle. */
  sortable?: SortableItem;
};

const completedFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

export function TaskItem({
  task,
  list,
  today,
  onToggle,
  onEdit,
  onDelete,
  focusedSeconds = 0,
  focusing = false,
  onFocus,
  sortable,
}: TaskItemProps) {
  const titleId = useId();
  const completed = task.status === "completed";

  return (
    <li
      {...sortable?.row}
      className={cn(
        "group flex items-start gap-3 px-3 py-3 transition-[background-color,opacity] duration-150 hover:bg-accent/40 sm:px-4 @lg/rows:items-center",
        completed && "bg-muted/20",
        sortable && "pl-1 sm:pl-2",
        sortable?.dragging && "relative z-10 bg-card shadow-elevation-2",
      )}
    >
      {sortable ? (
        <DragHandle
          {...sortable.handle}
          aria-label={`Move “${task.title}”`}
          className="-my-1.5 @lg/rows:my-0"
        />
      ) : null}
      <Checkbox
        shape="round"
        checked={completed}
        onChange={() => onToggle(task)}
        aria-labelledby={titleId}
        className="mt-0.5 @lg/rows:mt-0"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 @lg/rows:flex-row @lg/rows:items-center @lg/rows:gap-4">
        <div className="min-w-0 flex-1 space-y-0.5">
          <button
            type="button"
            onClick={() => onEdit(task)}
            aria-label={`Edit “${task.title}”`}
            className="block max-w-full rounded-sm text-left text-sm font-medium break-words outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              id={titleId}
              className={cn(
                "transition-colors duration-150",
                completed && "text-muted-foreground line-through decoration-1",
              )}
            >
              {task.title}
            </span>
          </button>
          {task.description ? (
            <p className="line-clamp-1 text-sm break-words text-muted-foreground">
              {task.description}
            </p>
          ) : null}
        </div>
        {list ||
        task.due_date ||
        task.recurrence ||
        task.priority !== "none" ||
        task.completed_at ||
        focusedSeconds > 0 ||
        focusing ? (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 @lg/rows:justify-end">
            {list ? <TaskListBadge name={list.name} color={list.color} /> : null}
            <PriorityBadge priority={task.priority} />
            {task.due_date ? (
              <DueDateLabel dueDate={task.due_date} today={today} muted={completed} />
            ) : null}
            {task.recurrence ? <RepeatBadge repeat={task.recurrence} /> : null}
            {focusedSeconds > 0 || focusing ? (
              <FocusBadge seconds={focusedSeconds} active={focusing} />
            ) : null}
            {task.completed_at ? (
              <span className="text-xs text-muted-foreground">
                Completed {completedFormat.format(new Date(task.completed_at))}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {onFocus && !completed && !focusing ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Focus on “${task.title}”`}
            onClick={() => onFocus(task)}
            className="size-8 text-muted-foreground hover:text-brand pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100"
          >
            <Timer aria-hidden="true" />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Delete “${task.title}”`}
          // Deleting offers Undo in a toast, so it doesn't ask first.
          onClick={() => onDelete(task)}
          // Revealed on hover or focus where there is a mouse; always visible on touch screens.
          className="size-8 text-muted-foreground hover:text-destructive pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100"
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
    </li>
  );
}

/** A task row that can be dragged into a new place, inside `SortableList`. */
export function SortableTaskItem(props: Omit<TaskItemProps, "sortable">) {
  const sortable = useSortableItem(props.task.id);
  return <TaskItem {...props} sortable={sortable} />;
}
