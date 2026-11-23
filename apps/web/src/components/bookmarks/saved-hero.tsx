import { Bookmark, Clock, Inbox, type LucideIcon, Pin, SquarePlay } from "lucide-react";
import Link from "next/link";

import { type countViews, type FixedView, savedHref } from "@/lib/bookmarks";
import { cn } from "@/utils/common";

/** Each tile's colour. Classes are written out in full so Tailwind sees them. */
const TILES: readonly { view: FixedView; label: string; icon: LucideIcon; tone: string }[] = [
  { view: "pinned", label: "Pinned", icon: Pin, tone: "bg-brand-subtle text-brand" },
  {
    view: "later",
    label: "Read & watch later",
    icon: Clock,
    tone: "bg-event-amber/12 text-event-amber",
  },
  {
    view: "watch",
    label: "Reels & videos",
    icon: SquarePlay,
    tone: "bg-event-rose/12 text-event-rose",
  },
  {
    view: "unfiled",
    label: "Not in a collection",
    icon: Inbox,
    tone: "bg-event-slate/12 text-event-slate",
  },
];

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Saved links at a glance, with a way into the views people use most. */
export function SavedHero({
  counts,
  collections,
}: {
  counts: ReturnType<typeof countViews>;
  collections: number;
}) {
  const headline =
    counts.later > 0
      ? `${plural(counts.later, "link")} to read or watch later`
      : `${plural(counts.all, "link")} saved`;
  return (
    <section
      aria-labelledby="saved-hero-heading"
      className="relative overflow-hidden rounded-2xl border bg-linear-to-br from-brand-subtle/80 via-card to-card p-5 shadow-elevation-1 @3xl/saved:p-6"
    >
      <Bookmark
        aria-hidden="true"
        className="pointer-events-none absolute -top-6 -right-6 size-40 -rotate-12 text-brand opacity-[0.06]"
      />
      <div className="relative space-y-5">
        <div className="space-y-1">
          <p className="text-xs font-medium tracking-wide text-brand uppercase">Your links</p>
          <h3
            id="saved-hero-heading"
            className="text-xl font-semibold tracking-tight @3xl/saved:text-2xl"
          >
            {headline}
          </h3>
          <p className="text-sm text-muted-foreground">
            {plural(counts.all, "link")} · {plural(collections, "collection")}
          </p>
        </div>
        <ul aria-label="Jump to" className="grid grid-cols-2 gap-3 @3xl/saved:grid-cols-4">
          {TILES.map(({ view, label, icon: Icon, tone }) => (
            <li key={view}>
              <Link
                href={savedHref({ kind: view })}
                className="relative flex h-full min-w-0 flex-col gap-1 rounded-xl border bg-card/80 p-4 backdrop-blur-sm transition-[border-color,translate] duration-150 outline-none hover:-translate-y-0.5 hover:border-brand/40 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:hover:translate-y-0"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute top-3.5 right-3.5 flex size-8 items-center justify-center rounded-lg",
                    tone,
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <span className="pr-10 text-xs text-muted-foreground">{label}</span>
                <span className="text-2xl leading-tight font-semibold tabular-nums">
                  {counts[view]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
