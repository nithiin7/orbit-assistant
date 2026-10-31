"use client";

import type { Task } from "@orbit/contracts";
import { Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/utils/common";

import { DueDateLabel, PriorityBadge } from "./task-meta";

type TaskItemProps = {
  task: Task;
  today: string;
  /** A completion change or deletion is in flight. */
  pending: boolean;
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => Promise<void>;
};

const completedFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

export function TaskItem({ task, today, pending, onToggle, onEdit, onDelete }: TaskItemProps) {
  const titleId = useId();
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const completed = task.status === "completed";

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  const cancelDelete = () => {
    setConfirming(false);
    // The confirmation unmounts; put focus back on the button that opened it.
    requestAnimationFrame(() => deleteRef.current?.focus());
  };

  return (
    <li
      className={cn(
        "group flex items-start gap-3 px-3 py-3 transition-[background-color,opacity] duration-150 hover:bg-accent/40 sm:px-4 @lg/rows:items-center",
        pending && "opacity-70",
        completed && "bg-muted/20",
      )}
    >
      <Checkbox
        shape="round"
        checked={completed}
        disabled={pending}
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
        {task.due_date || task.priority !== "none" || task.completed_at ? (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 @lg/rows:justify-end">
            <PriorityBadge priority={task.priority} />
            {task.due_date ? (
              <DueDateLabel dueDate={task.due_date} today={today} muted={completed} />
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
        {confirming ? (
          <div
            role="group"
            aria-label={`Delete “${task.title}”?`}
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
                void onDelete(task).finally(() => setConfirming(false));
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
            aria-label={`Delete “${task.title}”`}
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
