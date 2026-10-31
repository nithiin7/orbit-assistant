"use client";

import type { TaskPriority } from "@orbit/contracts";

import { Select } from "@/components/ui/select";
import { PRIORITIES } from "@/lib/tasks";
import { cn } from "@/utils/common";

type PrioritySelectProps = {
  id: string;
  value: TaskPriority;
  onChange: (priority: TaskPriority) => void;
  className?: string;
  /** Keep the label for assistive technology only, in compact layouts. */
  hiddenLabel?: boolean;
};

export function PrioritySelect({
  id,
  value,
  onChange,
  className,
  hiddenLabel = false,
}: PrioritySelectProps) {
  return (
    <div className={cn(hiddenLabel ? null : "space-y-1.5", className)}>
      <label htmlFor={id} className={hiddenLabel ? "sr-only" : "block text-sm font-medium"}>
        Priority
      </label>
      <Select id={id} value={value} onValueChange={onChange} options={PRIORITIES} />
    </div>
  );
}
