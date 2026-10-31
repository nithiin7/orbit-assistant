"use client";

import {
  AlarmClock,
  AlertCircle,
  BellOff,
  CheckCheck,
  Layers,
  type LucideIcon,
} from "lucide-react";

import { REMINDER_FILTERS, type ReminderFilter } from "@/lib/reminders";
import { cn } from "@/utils/common";

const ICONS: Record<ReminderFilter, LucideIcon> = {
  scheduled: AlarmClock,
  overdue: AlertCircle,
  completed: CheckCheck,
  disabled: BellOff,
  all: Layers,
};

type ReminderViewsProps = {
  filter: ReminderFilter;
  onFilterChange: (filter: ReminderFilter) => void;
};

/**
 * Which reminders to show, by status. A sticky side rail when the page has room (see the
 * `reminders` container in `RemindersView`); a row that scrolls sideways when not.
 */
export function ReminderViews({ filter, onFilterChange }: ReminderViewsProps) {
  return (
    <nav aria-label="Reminder views" className="min-w-0">
      <div
        role="group"
        aria-label="Show"
        className="-mx-1 scrollbar-none flex gap-1 overflow-x-auto px-1 @4xl/reminders:mx-0 @4xl/reminders:flex-col @4xl/reminders:overflow-visible @4xl/reminders:px-0"
      >
        {REMINDER_FILTERS.map(({ value, label }) => {
          const Icon = ICONS[value];
          const selected = filter === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={selected}
              onClick={() => onFilterChange(value)}
              className={cn(
                "flex h-9 shrink-0 items-center gap-2.5 rounded-lg px-3 text-sm font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring @4xl/reminders:w-full",
                selected
                  ? "bg-brand-subtle text-brand"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              <span className="flex-1 text-left">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
