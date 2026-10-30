"use client";

import { Search } from "lucide-react";
import { type Ref, useId } from "react";

import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Select } from "@/components/ui/select";
import { PRIORITIES, SORTS, STATUS_FILTERS, type TaskFilters } from "@/lib/tasks";
import { cn, type Option } from "@/utils/common";

const PRIORITY_FILTERS: readonly Option<TaskFilters["priority"]>[] = [
  { value: "all", label: "Any priority" },
  ...PRIORITIES,
];
const SORT_OPTIONS: readonly Option<TaskFilters["sort"]>[] = SORTS.map((option) => ({
  ...option,
  label: `Sort: ${option.label}`,
}));

type TaskToolbarProps = {
  /** The search box's text, which `filters.search` follows after a short pause. */
  search: string;
  onSearchChange: (value: string) => void;
  filters: TaskFilters;
  onFiltersChange: (filters: TaskFilters) => void;
  searchRef?: Ref<HTMLInputElement>;
};

export function TaskToolbar({
  search,
  onSearchChange,
  filters,
  onFiltersChange,
  searchRef,
}: TaskToolbarProps) {
  const id = useId();

  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
      <div className="relative min-w-0 flex-1">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <label htmlFor={`${id}-search`} className="sr-only">
          Search tasks
        </label>
        <Input
          ref={searchRef}
          id={`${id}-search`}
          type="search"
          autoComplete="off"
          placeholder="Search tasks"
          aria-keyshortcuts="/"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && search) {
              event.preventDefault();
              onSearchChange("");
            }
          }}
          className="pr-9 pl-9"
        />
        <Kbd
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 sm:inline-flex"
        >
          /
        </Kbd>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Show"
          className="inline-flex h-9 items-center rounded-md border bg-muted/60 p-0.5"
        >
          {STATUS_FILTERS.map((option) => {
            const selected = filters.status === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                onClick={() => onFiltersChange({ ...filters, status: option.value })}
                className={cn(
                  "h-full rounded-[calc(var(--radius-md)-2px)] px-3 text-sm font-medium transition-[color,background-color,box-shadow] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring",
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

        <label htmlFor={`${id}-priority`} className="sr-only">
          Filter by priority
        </label>
        <Select
          id={`${id}-priority`}
          className="min-w-36 flex-1 sm:flex-none"
          value={filters.priority}
          onValueChange={(priority) => onFiltersChange({ ...filters, priority })}
          options={PRIORITY_FILTERS}
        />

        <label htmlFor={`${id}-sort`} className="sr-only">
          Sort by
        </label>
        <Select
          id={`${id}-sort`}
          className="min-w-36 flex-1 sm:flex-none"
          value={filters.sort}
          onValueChange={(sort) => onFiltersChange({ ...filters, sort })}
          options={SORT_OPTIONS}
        />
      </div>
    </div>
  );
}
