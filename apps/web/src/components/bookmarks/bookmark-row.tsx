"use client";

import type { Bookmark, BookmarkCollection, BookmarkKind } from "@orbit/contracts";
import {
  BookmarkCheck,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  Film,
  GitBranch,
  Link2,
  type LucideIcon,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  SquarePlay,
  Trash2,
  Wrench,
} from "lucide-react";
import type { ReactNode } from "react";

import { Menu, type MenuItem } from "@/components/ui/menu";
import { hostOf, initialOf, KIND_LABELS } from "@/lib/bookmarks";
import { TASK_LIST_STYLES } from "@/lib/tasks";
import { cn } from "@/utils/common";

export const KIND_ICONS: Record<BookmarkKind, LucideIcon> = {
  link: Link2,
  article: FileText,
  video: SquarePlay,
  reel: Film,
  repo: GitBranch,
  tool: Wrench,
};

export type BookmarkActions = {
  /** Called as the link opens in a new tab, to count the open. */
  opened: (bookmark: Bookmark) => void;
  edit: (bookmark: Bookmark) => void;
  togglePin: (bookmark: Bookmark) => void;
  setStatus: (bookmark: Bookmark, status: Bookmark["status"]) => void;
  copy: (bookmark: Bookmark) => void;
  remove: (bookmark: Bookmark) => void;
};

function menuItems(bookmark: Bookmark, actions: BookmarkActions): MenuItem[] {
  const items: MenuItem[] = [
    { id: "edit", label: "Edit", icon: Pencil, onSelect: () => actions.edit(bookmark) },
    {
      id: "pin",
      label: bookmark.pinned ? "Unpin" : "Pin to quick launch",
      icon: bookmark.pinned ? PinOff : Pin,
      onSelect: () => actions.togglePin(bookmark),
    },
  ];
  if (bookmark.status === "later") {
    items.push({
      id: "done",
      label: "Mark as done",
      icon: BookmarkCheck,
      onSelect: () => actions.setStatus(bookmark, "done"),
    });
  } else {
    items.push({
      id: "later",
      label: "Read or watch later",
      icon: Clock,
      onSelect: () => actions.setStatus(bookmark, "later"),
    });
  }
  items.push(
    { id: "copy", label: "Copy link", icon: Copy, onSelect: () => actions.copy(bookmark) },
    {
      id: "delete",
      label: "Delete",
      icon: Trash2,
      destructive: true,
      onSelect: () => actions.remove(bookmark),
    },
  );
  return items;
}

/** A link that opens the page in a new tab and counts the open (middle clicks too). */
function OutboundLink({
  bookmark,
  actions,
  className,
  children,
}: {
  bookmark: Bookmark;
  actions: BookmarkActions;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={bookmark.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => actions.opened(bookmark)}
      onAuxClick={(event) => {
        if (event.button === 1) actions.opened(bookmark);
      }}
      className={className}
    >
      {children}
    </a>
  );
}

function SiteBadge({ bookmark, size }: { bookmark: Bookmark; size: "sm" | "md" }) {
  const Icon = KIND_ICONS[bookmark.kind];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-lg bg-brand-subtle font-semibold text-brand",
        size === "md" ? "size-10 text-base" : "size-9 text-sm",
      )}
    >
      {initialOf(bookmark)}
      <span className="absolute -right-1 -bottom-1 flex size-4.5 items-center justify-center rounded-full border bg-card text-muted-foreground">
        <Icon className="size-2.5" />
      </span>
    </span>
  );
}

/** One saved link in a list: its site, name, what it's for, tags, and actions. */
export function BookmarkRow({
  bookmark,
  collection,
  actions,
  pending,
}: {
  bookmark: Bookmark;
  collection: BookmarkCollection | null;
  actions: BookmarkActions;
  pending: boolean;
}) {
  const host = hostOf(bookmark.url);
  return (
    <li
      aria-busy={pending || undefined}
      className={cn(
        "group relative flex items-start gap-3 rounded-xl border bg-card p-3 transition-colors duration-150 hover:border-brand/30",
        pending && "opacity-60",
        bookmark.status === "done" && "bg-card/60",
      )}
    >
      <SiteBadge bookmark={bookmark} size="md" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <OutboundLink
            bookmark={bookmark}
            actions={actions}
            className={cn(
              "truncate rounded-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring",
              bookmark.status === "done" && "text-muted-foreground",
            )}
          >
            {bookmark.title}
            <span className="sr-only"> (opens in a new tab)</span>
          </OutboundLink>
          {bookmark.pinned ? (
            <Pin className="size-3.5 shrink-0 text-brand" aria-label="Pinned" />
          ) : null}
        </div>
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
          <span className="max-w-full truncate">{host}</span>
          <span aria-hidden="true">·</span>
          <span>{KIND_LABELS[bookmark.kind]}</span>
          {bookmark.status === "later" ? (
            <span className="rounded-full bg-event-amber/15 px-1.5 py-px font-medium text-foreground">
              Later
            </span>
          ) : null}
          {bookmark.status === "done" ? (
            <span className="rounded-full bg-muted px-1.5 py-px font-medium">Done</span>
          ) : null}
          {collection ? (
            <span
              className={cn(
                "rounded-full px-1.5 py-px font-medium",
                TASK_LIST_STYLES[collection.color].chip,
              )}
            >
              {collection.name}
            </span>
          ) : null}
        </p>
        {bookmark.note ? (
          <p className="line-clamp-2 text-sm text-pretty whitespace-pre-line text-muted-foreground">
            {bookmark.note}
          </p>
        ) : null}
        {bookmark.tags.length > 0 ? (
          <ul aria-label="Tags" className="flex flex-wrap gap-1 pt-0.5">
            {bookmark.tags.map((tag) => (
              <li
                key={tag}
                className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
              >
                #{tag}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <OutboundLink
          bookmark={bookmark}
          actions={actions}
          className="hidden size-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:flex"
        >
          <ExternalLink className="size-4" aria-hidden="true" />
          <span className="sr-only">Open {bookmark.title} in a new tab</span>
        </OutboundLink>
        <Menu
          items={menuItems(bookmark, actions)}
          variant="ghost"
          size="icon"
          chevron={false}
          align="end"
          aria-label={`Actions for ${bookmark.title}`}
          className="size-8"
        >
          <MoreHorizontal aria-hidden="true" />
        </Menu>
      </div>
    </li>
  );
}

/** A pinned link in the quick-launch grid: one click opens it. */
export function PinnedTile({
  bookmark,
  actions,
}: {
  bookmark: Bookmark;
  actions: BookmarkActions;
}) {
  return (
    <li className="min-w-0">
      <OutboundLink
        bookmark={bookmark}
        actions={actions}
        className="flex items-center gap-2.5 rounded-xl border bg-card p-2.5 transition-[border-color,translate,box-shadow] duration-150 outline-none hover:-translate-y-px hover:border-brand/30 hover:shadow-elevation-1 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      >
        <SiteBadge bookmark={bookmark} size="sm" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{bookmark.title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {hostOf(bookmark.url)}
          </span>
        </span>
        <span className="sr-only"> (opens in a new tab)</span>
      </OutboundLink>
    </li>
  );
}
