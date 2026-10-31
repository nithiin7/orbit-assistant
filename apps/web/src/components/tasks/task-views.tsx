"use client";

import type { TaskSummary } from "@orbit/contracts";
import { CheckCheck, Inbox, Layers, type LucideIcon } from "lucide-react";
import { useId } from "react";

import { PRIORITIES, type StatusFilter, type TaskFilters } from "@/lib/tasks";
import { cn, type Option } from "@/utils/common";

import { PRIORITY_DOTS } from "./task-meta";

const VIEWS: readonly { value: StatusFilter; label: string; icon: LucideIcon }[] = [
  { value: "open", label: "Open", icon: Inbox },
  { value: "completed", label: "Completed", icon: CheckCheck },
  { value: "all", label: "All", icon: Layers },
];

const PRIORITY_FILTERS: readonly Option<TaskFilters["priority"]>[] = [
  { value: "all", label: "Any priority" },
  ...PRIORITIES,
];

function viewCount(view: StatusFilter, summary: TaskSummary | undefined): number | null {
  if (!summary) return null;
  if (view === "open") return summary.open;
  if (view === "completed") return summary.completed;
  return summary.open + summary.completed;
}

type TaskViewsProps = {
  filters: TaskFilters;
  onFiltersChange: (filters: TaskFilters) => void;
  /** Counts beside each view; left out until they load. */
  summary: TaskSummary | undefined;
};

/**
 * Which tasks to show: a view by status, then a priority. A sticky side rail on wide screens;
 * rows of chips that scroll sideways on narrow ones.
 */
export function TaskViews({ filters, onFiltersChange, summary }: TaskViewsProps) {
  const priorityHeadingId = useId();
  return (
    <nav aria-label="Task views" className="min-w-0 space-y-3 @4xl/tasks:space-y-6">
      <div
        role="group"
        aria-label="Show"
        className="-mx-1 scrollbar-none flex gap-1 overflow-x-auto px-1 @4xl/tasks:mx-0 @4xl/tasks:flex-col @4xl/tasks:overflow-visible @4xl/tasks:px-0"
      >
        {VIEWS.map(({ value, label, icon: Icon }) => {
          const selected = filters.status === value;
          const count = viewCount(value, summary);
          return (
            <button
              key={value}
              type="button"
              aria-pressed={selected}
              onClick={() => onFiltersChange({ ...filters, status: value })}
              className={cn(
                "flex h-9 shrink-0 items-center gap-2.5 rounded-lg px-3 text-sm font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring @4xl/tasks:w-full",
                selected
                  ? "bg-brand-subtle text-brand"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              <span className="flex-1 text-left">{label}</span>
              {count === null ? null : (
                // The list itself announces how many tasks it holds.
                <span
                  aria-hidden="true"
                  className={cn(
                    "min-w-6 rounded-full px-1.5 text-center text-xs tabular-nums",
                    selected ? "bg-brand/15" : "bg-muted",
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="space-y-2">
        <h3
          id={priorityHeadingId}
          className="hidden px-3 text-xs font-medium tracking-wide text-muted-foreground uppercase @4xl/tasks:block"
        >
          Priority
        </h3>
        <div
          role="group"
          aria-labelledby={priorityHeadingId}
          className="-mx-1 scrollbar-none flex gap-1.5 overflow-x-auto px-1 @4xl/tasks:mx-0 @4xl/tasks:flex-wrap @4xl/tasks:px-0"
        >
          {PRIORITY_FILTERS.map(({ value, label }) => {
            const selected = filters.priority === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={selected}
                onClick={() => onFiltersChange({ ...filters, priority: value })}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected
                    ? "border-transparent bg-primary text-primary-foreground shadow-elevation-1"
                    : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {value === "all" ? null : (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-2 rounded-full",
                      PRIORITY_DOTS[value],
                      selected && value === "none" && "border-primary-foreground/70",
                    )}
                  />
                )}
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
