"use client";

import type { DocumentCategory } from "@orbit/contracts";
import { X } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  activeFilterCount,
  clearFilters,
  HABIT_KINDS,
  moduleFilters,
  type SearchState,
  SORTS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TRANSACTION_TYPES,
} from "@/lib/search";
import { cn } from "@/utils/common";

type Choice<T extends string> = { value: T; label: string };

/** A group of on/off chips for a filter that takes several values. */
function Chips<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly Choice<T>[];
  value: readonly T[];
  onChange: (value: T[]) => void;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-xs font-medium text-muted-foreground">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const on = value.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={on}
              onClick={() =>
                onChange(on ? value.filter((v) => v !== option.value) : [...value, option.value])
              }
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                on ? "border-transparent bg-brand-subtle text-brand" : "hover:bg-accent",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function DateRange({
  label,
  from,
  to,
  onChange,
}: {
  label: string;
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-xs font-medium text-muted-foreground">{label}</legend>
      <div className="flex flex-wrap items-center gap-2">
        <DatePicker
          value={from}
          onValueChange={(value) => onChange(value, to)}
          placeholder="From"
          aria-label={`${label} from`}
          clearable
          className="w-40"
        />
        <DatePicker
          value={to}
          onValueChange={(value) => onChange(from, value)}
          placeholder="To"
          aria-label={`${label} to`}
          clearable
          className="w-40"
        />
      </div>
    </fieldset>
  );
}

const ANY = "any";

type SearchFiltersProps = {
  state: SearchState;
  categories: readonly DocumentCategory[];
  onChange: (state: SearchState) => void;
};

/**
 * Filters for the current tab. Dates, last update, archived records, and sort apply to every
 * module; status, priority, category, transaction type, and habit kind appear only on the tab
 * whose records have them.
 */
export function SearchFilters({ state, categories, onChange }: SearchFiltersProps) {
  const archivedId = useId();
  const offered = moduleFilters(state.module);
  const set = (changes: Partial<SearchState>) => onChange({ ...state, ...changes });
  const count = activeFilterCount(state);

  return (
    <section aria-label="Filters" className="space-y-4 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <span className="block text-xs font-medium text-muted-foreground">Sort</span>
          <Select
            value={state.sort}
            onValueChange={(sort) => set({ sort })}
            options={SORTS}
            aria-label="Sort results"
            className="w-44"
          />
        </div>
        <DateRange
          label="Date"
          from={state.dateFrom}
          to={state.dateTo}
          onChange={(dateFrom, dateTo) => set({ dateFrom, dateTo })}
        />
        <DateRange
          label="Last updated"
          from={state.updatedFrom}
          to={state.updatedTo}
          onChange={(updatedFrom, updatedTo) => set({ updatedFrom, updatedTo })}
        />
        <div className="flex items-center gap-2 pb-1.5">
          <Switch
            id={archivedId}
            checked={state.includeArchived}
            onCheckedChange={(includeArchived) => set({ includeArchived })}
          />
          <label htmlFor={archivedId} className="text-sm">
            Include archived
          </label>
        </div>
      </div>

      {offered.length > 0 ? (
        <div className="flex flex-wrap items-end gap-4 border-t pt-4">
          {offered.includes("taskStatus") ? (
            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-muted-foreground">Status</span>
              <Select
                value={state.taskStatus ?? ANY}
                onValueChange={(value) => set({ taskStatus: value === ANY ? null : value })}
                options={[{ value: ANY, label: "Any status" }, ...TASK_STATUSES]}
                aria-label="Task status"
                className="w-40"
              />
            </div>
          ) : null}
          {offered.includes("taskPriority") ? (
            <Chips
              label="Priority"
              options={TASK_PRIORITIES}
              value={state.taskPriority}
              onChange={(taskPriority) => set({ taskPriority })}
            />
          ) : null}
          {offered.includes("transactionType") ? (
            <Chips
              label="Transaction type"
              options={TRANSACTION_TYPES}
              value={state.transactionType}
              onChange={(transactionType) => set({ transactionType })}
            />
          ) : null}
          {offered.includes("habitKind") ? (
            <Chips
              label="Habit type"
              options={HABIT_KINDS}
              value={state.habitKind}
              onChange={(habitKind) => set({ habitKind })}
            />
          ) : null}
          {offered.includes("documentCategory") ? (
            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-muted-foreground">Category</span>
              <Select
                value={state.documentCategory ?? ANY}
                onValueChange={(value) => set({ documentCategory: value === ANY ? null : value })}
                options={[
                  { value: ANY, label: "Any category" },
                  ...categories.map((category) => ({ value: category.id, label: category.name })),
                ]}
                aria-label="Document category"
                className="w-48"
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {count > 0 ? (
        <Button variant="ghost" size="sm" onClick={() => onChange(clearFilters(state))}>
          <X aria-hidden="true" />
          Clear filters
        </Button>
      ) : null}
    </section>
  );
}
