import type { BookmarkCollection } from "@orbit/contracts";
import { Clock, Inbox, Library, type LucideIcon, Pin, Plus, SquarePlay } from "lucide-react";
import Link from "next/link";

import {
  FIXED_VIEWS,
  type FixedCounts,
  type FixedView,
  sameView,
  savedHref,
  type SavedView,
} from "@/lib/bookmarks";
import { TASK_LIST_STYLES } from "@/lib/tasks";
import { cn } from "@/utils/common";

export const VIEW_ICONS: Record<FixedView, LucideIcon> = {
  all: Library,
  pinned: Pin,
  later: Clock,
  watch: SquarePlay,
  unfiled: Inbox,
};

const LINK_CLASS =
  "flex h-9 shrink-0 items-center gap-2.5 rounded-full border px-3 text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring @5xl/saved:w-full @5xl/saved:rounded-lg @5xl/saved:border-transparent";

function linkClass(selected: boolean) {
  return cn(
    LINK_CLASS,
    selected
      ? "border-transparent bg-brand-subtle text-brand"
      : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground @5xl/saved:bg-transparent",
  );
}

function Count({ value, selected }: { value: number | null; selected: boolean }) {
  if (value === null) return null;
  return (
    <span className={cn("text-xs tabular-nums", selected ? "text-brand" : "text-muted-foreground")}>
      {value}
    </span>
  );
}

/**
 * The Saved sections and collections with their counts. A sticky side rail when the page is
 * wide; below that, a row of chips that scrolls sideways.
 */
export function SavedNav({
  view,
  counts,
  collections,
  onNewCollection,
}: {
  view: SavedView;
  counts: FixedCounts | null;
  collections: readonly BookmarkCollection[];
  /** Left out while the page loads. */
  onNewCollection?: () => void;
}) {
  return (
    <nav aria-label="Saved views" className="min-w-0">
      <ul className="-mx-1 scrollbar-none flex gap-1 overflow-x-auto px-1 @5xl/saved:mx-0 @5xl/saved:flex-col @5xl/saved:overflow-visible @5xl/saved:px-0">
        {FIXED_VIEWS.map((option) => {
          const Icon = VIEW_ICONS[option.value];
          const selected = sameView(view, { kind: option.value });
          return (
            <li key={option.value}>
              <Link
                href={savedHref({ kind: option.value })}
                aria-current={selected ? "page" : undefined}
                className={linkClass(selected)}
              >
                <Icon className="size-4" aria-hidden="true" />
                <span className="flex-1 text-left">{option.label}</span>
                <Count value={counts ? counts[option.value] : null} selected={selected} />
              </Link>
            </li>
          );
        })}
        <li
          aria-hidden="true"
          className="hidden @5xl/saved:mt-3 @5xl/saved:block @5xl/saved:border-t @5xl/saved:px-3 @5xl/saved:pt-4 @5xl/saved:pb-1 @5xl/saved:text-xs @5xl/saved:font-medium @5xl/saved:tracking-wide @5xl/saved:text-muted-foreground @5xl/saved:uppercase"
        >
          Collections
        </li>
        {collections.map((collection) => {
          const target: SavedView = { kind: "collection", id: collection.id };
          const selected = sameView(view, target);
          return (
            <li key={collection.id}>
              <Link
                href={savedHref(target)}
                aria-current={selected ? "page" : undefined}
                className={linkClass(selected)}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "mx-[3px] size-2.5 rounded-full",
                    TASK_LIST_STYLES[collection.color].dot,
                  )}
                />
                <span className="flex-1 truncate text-left">{collection.name}</span>
                <Count value={collection.bookmarks} selected={selected} />
              </Link>
            </li>
          );
        })}
        {onNewCollection ? (
          <li>
            <button
              type="button"
              onClick={onNewCollection}
              className={cn(linkClass(false), "border-dashed @5xl/saved:border-transparent")}
            >
              <Plus className="size-4" aria-hidden="true" />
              <span className="flex-1 text-left">New collection</span>
            </button>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
