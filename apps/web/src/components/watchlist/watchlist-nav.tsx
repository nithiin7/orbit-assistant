import type { WatchStatus } from "@orbit/contracts";
import {
  Bookmark,
  CircleCheckBig,
  CirclePause,
  CirclePlay,
  type LucideIcon,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

import { WATCH_VIEWS, watchlistHref, type WatchView } from "@/lib/watchlist";
import { cn } from "@/utils/common";

export const VIEW_ICONS: Record<WatchView, LucideIcon> = {
  overview: Sparkles,
  want: Bookmark,
  watching: CirclePlay,
  watched: CircleCheckBig,
  dropped: CirclePause,
};

/**
 * The Watchlist sections with their counts. A sticky side rail when the page is wide; below
 * that, a row of chips that scrolls sideways.
 */
export function WatchlistNav({
  view,
  counts,
}: {
  view: WatchView;
  counts: Record<WatchStatus, number> | null;
}) {
  return (
    <nav aria-label="Watchlist views" className="min-w-0">
      <ul className="-mx-1 scrollbar-none flex gap-1 overflow-x-auto px-1 @5xl/watchlist:mx-0 @5xl/watchlist:flex-col @5xl/watchlist:overflow-visible @5xl/watchlist:px-0">
        {WATCH_VIEWS.map((option) => {
          const Icon = VIEW_ICONS[option.value];
          const selected = view === option.value;
          const count = option.value === "overview" || !counts ? null : counts[option.value];
          return (
            <li
              key={option.value}
              // The overview sits apart from the status lists.
              className={cn(
                option.value === "want" &&
                  "@5xl/watchlist:mt-3 @5xl/watchlist:border-t @5xl/watchlist:pt-3",
              )}
            >
              <Link
                href={watchlistHref(option.value)}
                aria-current={selected ? "page" : undefined}
                className={cn(
                  "flex h-9 shrink-0 items-center gap-2.5 rounded-full border px-3 text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring @5xl/watchlist:w-full @5xl/watchlist:rounded-lg @5xl/watchlist:border-transparent",
                  selected
                    ? "border-transparent bg-brand-subtle text-brand"
                    : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground @5xl/watchlist:bg-transparent",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                <span className="flex-1 text-left">{option.label}</span>
                {count !== null ? (
                  <span
                    className={cn(
                      "text-xs tabular-nums",
                      selected ? "text-brand" : "text-muted-foreground",
                    )}
                  >
                    {count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
