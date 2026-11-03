import {
  ChartNoAxesColumn,
  Droplets,
  Dumbbell,
  Footprints,
  House,
  LayoutTemplate,
  ListChecks,
  type LucideIcon,
  Ruler,
  Settings2,
  Target,
  Utensils,
} from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";

import { FITNESS_VIEW_GROUPS, FITNESS_VIEWS, fitnessHref, type FitnessView } from "@/lib/fitness";
import { cn } from "@/utils/common";

export const VIEW_ICONS: Record<FitnessView, LucideIcon> = {
  overview: House,
  workouts: Dumbbell,
  templates: LayoutTemplate,
  exercises: ListChecks,
  nutrition: Utensils,
  water: Droplets,
  body: Ruler,
  activity: Footprints,
  goals: Target,
  progress: ChartNoAxesColumn,
  settings: Settings2,
};

export function viewLabel(view: FitnessView): string {
  return FITNESS_VIEWS.find((option) => option.value === view)?.label ?? view;
}

/**
 * The Health sections, grouped by what they're for. A sticky side rail when the page is wide;
 * below that, a row of chips that scrolls sideways.
 */
export function HealthNav({ section }: { section: FitnessView }) {
  return (
    <nav aria-label="Health views" className="min-w-0">
      <ul className="-mx-1 scrollbar-none flex gap-1 overflow-x-auto px-1 @5xl/health:mx-0 @5xl/health:flex-col @5xl/health:overflow-visible @5xl/health:px-0">
        {FITNESS_VIEW_GROUPS.map((group, index) => (
          <Fragment key={group.label ?? `group-${index}`}>
            {group.label ? (
              <li
                aria-hidden="true"
                className="hidden px-3 pt-4 pb-1 text-xs font-medium text-muted-foreground @5xl/health:block"
              >
                {group.label}
              </li>
            ) : null}
            {group.views.map((view) => {
              const Icon = VIEW_ICONS[view];
              const selected = section === view;
              return (
                <li
                  key={view}
                  // Settings sits apart from the views used day to day.
                  className={cn(
                    view === "settings" && "@5xl/health:mt-3 @5xl/health:border-t @5xl/health:pt-3",
                  )}
                >
                  <Link
                    href={fitnessHref({ kind: "view", view })}
                    aria-current={selected ? "page" : undefined}
                    className={cn(
                      "flex h-9 shrink-0 items-center gap-2.5 rounded-full border px-3 text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring @5xl/health:w-full @5xl/health:rounded-lg @5xl/health:border-transparent",
                      selected
                        ? "border-transparent bg-brand-subtle text-brand"
                        : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground @5xl/health:bg-transparent",
                    )}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    <span className="flex-1 text-left">{viewLabel(view)}</span>
                  </Link>
                </li>
              );
            })}
          </Fragment>
        ))}
      </ul>
    </nav>
  );
}
