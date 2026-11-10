"use client";

import type { TaskListDetail } from "@orbit/contracts";
import { Plus } from "lucide-react";
import { useId } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import type { Resource } from "@/hooks/query-resource";
import { type ListFilter, TASK_LIST_STYLES } from "@/lib/tasks";
import { cn } from "@/utils/common";

type TaskListFilterProps = {
  lists: Resource<TaskListDetail[]>;
  selected: ListFilter;
  onSelect: (list: ListFilter) => void;
  onCreate: () => void;
};

const itemClassName =
  "flex h-8 shrink-0 items-center gap-2.5 rounded-full border px-3 text-xs font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring @4xl/tasks:h-9 @4xl/tasks:w-full @4xl/tasks:rounded-lg @4xl/tasks:border-0 @4xl/tasks:text-sm";

/**
 * Which list's tasks to show (Work, Personal, ...), and a way to add a list. Rows in the side
 * rail on wide screens; chips that scroll sideways on narrow ones.
 */
export function TaskListFilter({ lists, selected, onSelect, onCreate }: TaskListFilterProps) {
  const headingId = useId();
  const entries = lists.status === "success" ? lists.data : [];

  const option = (value: ListFilter, label: string, dot: string | null, count?: number) => {
    const isSelected = selected === value;
    return (
      <button
        key={value}
        type="button"
        aria-pressed={isSelected}
        aria-label={count === undefined ? undefined : `${label}, ${count} open`}
        onClick={() => onSelect(value)}
        className={cn(
          itemClassName,
          isSelected
            ? "border-transparent bg-brand-subtle text-brand"
            : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground @4xl/tasks:bg-transparent",
        )}
      >
        {dot === null ? null : (
          <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", dot)} />
        )}
        <span className="max-w-40 truncate text-left @4xl/tasks:max-w-none @4xl/tasks:flex-1">
          {label}
        </span>
        {count === undefined ? null : (
          <span
            aria-hidden="true"
            className={cn(
              "min-w-6 rounded-full px-1.5 text-center text-xs tabular-nums",
              isSelected ? "bg-brand/15" : "bg-muted",
            )}
          >
            {count}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="space-y-2">
      <h3
        id={headingId}
        className="hidden px-3 text-xs font-medium tracking-wide text-muted-foreground uppercase @4xl/tasks:block"
      >
        Lists
      </h3>
      {lists.status === "loading" ? (
        <div className="flex gap-1.5 @4xl/tasks:flex-col @4xl/tasks:px-3" aria-hidden="true">
          <Skeleton className="h-6 w-20 @4xl/tasks:w-2/3" />
          <Skeleton className="h-6 w-16 @4xl/tasks:w-1/2" />
        </div>
      ) : lists.status === "error" ? (
        <p role="alert" className="px-3 text-xs text-muted-foreground">
          {lists.message}
        </p>
      ) : (
        <div
          role="group"
          aria-labelledby={headingId}
          className="-mx-1 scrollbar-none flex gap-1.5 overflow-x-auto px-1 @4xl/tasks:mx-0 @4xl/tasks:flex-col @4xl/tasks:gap-0.5 @4xl/tasks:overflow-visible @4xl/tasks:px-0"
        >
          {entries.length > 0 ? (
            <>
              {option("all", "All lists", null)}
              {entries.map((entry) =>
                option(entry.id, entry.name, TASK_LIST_STYLES[entry.color].dot, entry.open_tasks),
              )}
              {option("none", "No list", "border border-dashed border-muted-foreground/60")}
            </>
          ) : (
            <p className="hidden px-3 pb-1 text-xs text-muted-foreground @4xl/tasks:block">
              Group tasks into lists, like Work or Personal.
            </p>
          )}
          <button
            type="button"
            onClick={onCreate}
            className={cn(
              itemClassName,
              "border-dashed bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Plus className="size-3.5 shrink-0 @4xl/tasks:size-4" aria-hidden="true" />
            <span className="text-left @4xl/tasks:flex-1">New list</span>
          </button>
        </div>
      )}
    </div>
  );
}
