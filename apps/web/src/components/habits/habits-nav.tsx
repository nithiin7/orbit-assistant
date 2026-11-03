import {
  Archive,
  CalendarCheck,
  ChartNoAxesColumn,
  LayoutTemplate,
  ListChecks,
  type LucideIcon,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

import { HABIT_VIEWS, habitsHref, type HabitView } from "@/lib/habits";
import { cn } from "@/utils/common";

export const VIEW_ICONS: Record<HabitView, LucideIcon> = {
  today: CalendarCheck,
  all: Sparkles,
  routines: ListChecks,
  analytics: ChartNoAxesColumn,
  templates: LayoutTemplate,
  archived: Archive,
};

/**
 * The Habits sections. A sticky side rail when the page is wide; below that, a row of chips
 * that scrolls sideways.
 */
export function HabitsNav({ section }: { section: HabitView }) {
  return (
    <nav aria-label="Habit views" className="min-w-0">
      <ul className="-mx-1 scrollbar-none flex gap-1 overflow-x-auto px-1 @5xl/habits:mx-0 @5xl/habits:flex-col @5xl/habits:overflow-visible @5xl/habits:px-0">
        {HABIT_VIEWS.map((option) => {
          const Icon = VIEW_ICONS[option.value];
          const selected = section === option.value;
          return (
            <li
              key={option.value}
              // Templates and the archive sit apart from the day-to-day views.
              className={cn(
                option.value === "templates" &&
                  "@5xl/habits:mt-3 @5xl/habits:border-t @5xl/habits:pt-3",
              )}
            >
              <Link
                href={habitsHref({ kind: "view", view: option.value })}
                aria-current={selected ? "page" : undefined}
                className={cn(
                  "flex h-9 shrink-0 items-center gap-2.5 rounded-full border px-3 text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring @5xl/habits:w-full @5xl/habits:rounded-lg @5xl/habits:border-transparent",
                  selected
                    ? "border-transparent bg-brand-subtle text-brand"
                    : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground @5xl/habits:bg-transparent",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                <span className="flex-1 text-left">{option.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
