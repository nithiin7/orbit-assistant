import { CalendarHeart, type LucideIcon, Users } from "lucide-react";
import Link from "next/link";

import { PEOPLE_VIEWS, peopleHref, type PeopleView } from "@/lib/people";
import { cn } from "@/utils/common";

export const VIEW_ICONS: Record<PeopleView, LucideIcon> = {
  everyone: Users,
  upcoming: CalendarHeart,
};

/**
 * The People sections with their counts. A sticky side rail when the page is wide; below that, a
 * row of chips that scrolls sideways.
 */
export function PeopleNav({
  view,
  counts,
}: {
  view: PeopleView;
  /** People, and dates in the next 30 days; left out while they load. */
  counts: Partial<Record<PeopleView, number>> | null;
}) {
  return (
    <nav aria-label="People views" className="min-w-0">
      <ul className="-mx-1 scrollbar-none flex gap-1 overflow-x-auto px-1 @5xl/people:mx-0 @5xl/people:flex-col @5xl/people:overflow-visible @5xl/people:px-0">
        {PEOPLE_VIEWS.map((option) => {
          const Icon = VIEW_ICONS[option.value];
          const selected = view === option.value;
          const count = counts?.[option.value];
          return (
            <li key={option.value}>
              <Link
                href={peopleHref(option.value)}
                aria-current={selected ? "page" : undefined}
                className={cn(
                  "flex h-9 shrink-0 items-center gap-2.5 rounded-full border px-3 text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring @5xl/people:w-full @5xl/people:rounded-lg @5xl/people:border-transparent",
                  selected
                    ? "border-transparent bg-brand-subtle text-brand"
                    : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground @5xl/people:bg-transparent",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                <span className="flex-1 text-left">{option.label}</span>
                {count === undefined ? null : (
                  <span
                    className={cn(
                      "text-xs tabular-nums",
                      selected ? "text-brand" : "text-muted-foreground",
                    )}
                  >
                    {count}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
