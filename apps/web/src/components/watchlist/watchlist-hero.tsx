import type { WatchItem, WatchStatus } from "@orbit/contracts";
import { Clapperboard, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { countByStatus, STATUS_LABELS, watchlistHref } from "@/lib/watchlist";
import { cn } from "@/utils/common";

import { VIEW_ICONS } from "./watchlist-nav";

/** Colours for the Watchlist. Classes are written out in full so Tailwind sees them. */
export const WATCH_TONES = {
  violet: "bg-event-violet/12 text-event-violet",
  brand: "bg-brand-subtle text-brand",
  green: "bg-event-green/12 text-event-green",
  slate: "bg-event-slate/12 text-event-slate",
} as const;

/** A section's icon in a tinted chip, before its heading. */
export function WatchChip({
  icon: Icon,
  tone,
}: {
  icon: LucideIcon;
  tone: keyof typeof WATCH_TONES;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-xl",
        WATCH_TONES[tone],
      )}
    >
      <Icon className="size-4" />
    </span>
  );
}

const TILES: readonly { status: WatchStatus; tone: keyof typeof WATCH_TONES }[] = [
  { status: "watching", tone: "violet" },
  { status: "want", tone: "brand" },
  { status: "watched", tone: "green" },
];

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** What the watchlist holds right now, in a few words. */
function headline(counts: Record<WatchStatus, number>): string {
  if (counts.watching > 0) return `${plural(counts.watching, "title")} in progress`;
  if (counts.want > 0) return `${plural(counts.want, "title")} waiting in your queue`;
  if (counts.watched > 0) return "All caught up. Time to find something new";
  return "Your watchlist is ready";
}

/** The watchlist at a glance, with a way into each list. */
export function WatchlistHero({ items }: { items: readonly WatchItem[] }) {
  const counts = countByStatus(items);
  return (
    <section
      aria-labelledby="watchlist-hero-heading"
      className="relative overflow-hidden rounded-2xl border bg-linear-to-br from-event-violet/15 via-card to-card p-5 shadow-elevation-1 @3xl/view:p-6"
    >
      <Clapperboard
        aria-hidden="true"
        className="pointer-events-none absolute -top-6 -right-6 size-40 -rotate-12 text-event-violet opacity-[0.07]"
      />
      <div className="relative space-y-5">
        <div className="space-y-1">
          <p className="text-xs font-medium tracking-wide text-event-violet uppercase">
            Your watchlist
          </p>
          <h3
            id="watchlist-hero-heading"
            className="text-xl font-semibold tracking-tight @3xl/view:text-2xl"
          >
            {headline(counts)}
          </h3>
          <p className="text-sm text-muted-foreground">
            {plural(items.length, "title")} saved
            {counts.dropped > 0 ? ` · ${counts.dropped} dropped` : ""}
          </p>
        </div>
        <ul aria-label="Your lists" className="grid grid-cols-3 gap-3">
          {TILES.map(({ status, tone }) => {
            const Icon = VIEW_ICONS[status];
            return (
              <li key={status}>
                <Link
                  href={watchlistHref(status)}
                  className="relative flex min-w-0 flex-col gap-1 rounded-xl border bg-card/80 p-4 backdrop-blur-sm transition-[border-color,translate] duration-150 outline-none hover:-translate-y-0.5 hover:border-brand/40 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:hover:translate-y-0"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute top-3.5 right-3.5 hidden size-8 items-center justify-center rounded-lg @xl/view:flex",
                      WATCH_TONES[tone],
                    )}
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="truncate text-xs text-muted-foreground @xl/view:pr-10">
                    {STATUS_LABELS[status]}
                  </span>
                  <span className="text-2xl leading-tight font-semibold tabular-nums">
                    {counts[status]}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
