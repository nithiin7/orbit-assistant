"use client";

import type { TaskListDetail } from "@orbit/contracts";

import { Select } from "@/components/ui/select";
import { cn } from "@/utils/common";

/** The select's value for a task on no list. */
export const NO_LIST = "none";

type ListSelectProps = {
  id: string;
  lists: readonly TaskListDetail[];
  /** A list's ID, or `NO_LIST`. */
  value: string;
  onChange: (value: string) => void;
  className?: string;
  /** Keep the label for assistive technology only, in compact layouts. */
  hiddenLabel?: boolean;
};

/** Picks which of the workspace's lists a task is on, or none. */
export function ListSelect({
  id,
  lists,
  value,
  onChange,
  className,
  hiddenLabel = false,
}: ListSelectProps) {
  const options = [
    { value: NO_LIST, label: "No list" },
    ...lists.map((entry) => ({ value: entry.id, label: entry.name })),
  ];
  return (
    <div className={cn(hiddenLabel ? null : "space-y-1.5", className)}>
      <label htmlFor={id} className={hiddenLabel ? "sr-only" : "block text-sm font-medium"}>
        List
      </label>
      <Select id={id} value={value} onValueChange={onChange} options={options} />
    </div>
  );
}
