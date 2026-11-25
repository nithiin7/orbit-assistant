import type { NoteCounts } from "@orbit/contracts";
import { BookOpen, Inbox, type LucideIcon, NotebookPen, Pin, Star } from "lucide-react";

import { Kbd } from "@/components/ui/kbd";
import type { NoteView } from "@/lib/notes";
import { cn } from "@/utils/common";

/** Each tile's colour. Classes are written out in full so Tailwind sees them. */
const TILES: readonly {
  view: NoteView;
  label: string;
  icon: LucideIcon;
  tone: string;
  count: (counts: NoteCounts) => number;
}[] = [
  {
    view: "inbox",
    label: "Inbox",
    icon: Inbox,
    tone: "bg-event-blue/12 text-event-blue",
    count: (c) => c.inbox,
  },
  {
    view: "pinned",
    label: "Pinned",
    icon: Pin,
    tone: "bg-brand-subtle text-brand",
    count: (c) => c.pinned,
  },
  {
    view: "favorites",
    label: "Favorites",
    icon: Star,
    tone: "bg-event-amber/12 text-event-amber",
    count: (c) => c.favorites,
  },
  {
    view: "journal",
    label: "Journal",
    icon: BookOpen,
    tone: "bg-event-violet/12 text-event-violet",
    count: (c) => c.journal,
  },
];

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** The notes library at a glance, with a way into the views people use most. */
export function NotesHero({
  counts,
  onNavigate,
}: {
  counts: NoteCounts;
  onNavigate: (view: NoteView) => void;
}) {
  return (
    <section
      aria-labelledby="notes-hero-heading"
      className="relative overflow-hidden rounded-2xl border bg-linear-to-br from-brand-subtle/80 via-card to-card p-5 shadow-elevation-1 @3xl/list:p-6"
    >
      <NotebookPen
        aria-hidden="true"
        className="pointer-events-none absolute -top-6 -right-6 size-40 -rotate-12 text-brand opacity-[0.06]"
      />
      <div className="relative space-y-5">
        <div className="space-y-1">
          <p className="text-xs font-medium tracking-wide text-brand uppercase">Your notes</p>
          <h3
            id="notes-hero-heading"
            className="text-xl font-semibold tracking-tight @3xl/list:text-2xl"
          >
            {counts.all === 0
              ? "A blank page, ready for you"
              : `${plural(counts.all, "note")} in your library`}
          </h3>
          <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            Press <Kbd>N</Kbd> for a new note or <Kbd>/</Kbd> to search.
          </p>
        </div>
        <ul aria-label="Jump to" className="grid grid-cols-2 gap-3 @2xl/list:grid-cols-4">
          {TILES.map(({ view, label, icon: Icon, tone, count }) => (
            <li key={view}>
              <button
                type="button"
                onClick={() => onNavigate(view)}
                className="relative flex w-full min-w-0 flex-col gap-1 rounded-xl border bg-card/80 p-4 text-left backdrop-blur-sm transition-[border-color,translate] duration-150 outline-none hover:-translate-y-0.5 hover:border-brand/40 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:hover:translate-y-0"
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
                  {count(counts)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
