"use client";

import { Search } from "lucide-react";
import { type Ref, useId } from "react";

import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Select } from "@/components/ui/select";
import { SORTS, type TaskFilters } from "@/lib/tasks";
import { type Option } from "@/utils/common";

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

/** Search and sort for the task list. Views and priority live in `TaskViews`. */
export function TaskToolbar({
  search,
  onSearchChange,
  filters,
  onFiltersChange,
  searchRef,
}: TaskToolbarProps) {
  const id = useId();

  return (
    <div className="flex w-full flex-col gap-2 @md/list:flex-row @md/list:items-center @3xl/list:w-auto">
      <div className="relative min-w-0 flex-1 @3xl/list:w-64 @3xl/list:flex-none @5xl/list:w-80">
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

      <label htmlFor={`${id}-sort`} className="sr-only">
        Sort by
      </label>
      <Select
        id={`${id}-sort`}
        className="@md/list:w-44 @md/list:shrink-0"
        value={filters.sort}
        onValueChange={(sort) => onFiltersChange({ ...filters, sort })}
        options={SORT_OPTIONS}
      />
    </div>
  );
}
