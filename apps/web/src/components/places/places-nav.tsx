import { Earth, Footprints, type LucideIcon, Sparkles } from "lucide-react";
import Link from "next/link";

import { PLACES_VIEWS, placesHref, type PlacesView } from "@/lib/places";
import { cn } from "@/utils/common";

export const VIEW_ICONS: Record<PlacesView, LucideIcon> = {
  overview: Earth,
  visited: Footprints,
  wishlist: Sparkles,
};

/**
 * The Places sections with their counts. A sticky side rail when the page is wide; below that, a
 * row of chips that scrolls sideways.
 */
export function PlacesNav({
  view,
  counts,
}: {
  view: PlacesView;
  /** Places per list; left out while they load. */
  counts: Partial<Record<PlacesView, number>> | null;
}) {
  return (
    <nav aria-label="Places views" className="min-w-0">
      <ul className="-mx-1 scrollbar-none flex gap-1 overflow-x-auto px-1 @5xl/places:mx-0 @5xl/places:flex-col @5xl/places:overflow-visible @5xl/places:px-0">
        {PLACES_VIEWS.map((option) => {
          const Icon = VIEW_ICONS[option.value];
          const selected = view === option.value;
          const count = counts?.[option.value];
          return (
            <li key={option.value}>
              <Link
                href={placesHref(option.value)}
                aria-current={selected ? "page" : undefined}
                className={cn(
                  "flex h-9 shrink-0 items-center gap-2.5 rounded-full border px-3 text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring @5xl/places:w-full @5xl/places:rounded-lg @5xl/places:border-transparent",
                  selected
                    ? "border-transparent bg-brand-subtle text-brand"
                    : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground @5xl/places:bg-transparent",
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
