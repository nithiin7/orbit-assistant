"use client";

import type { NoteFolder, NoteSummary } from "@orbit/contracts";
import { Archive, BookOpen, Folder, MoreHorizontal, Pin, Star, Zap } from "lucide-react";

import { Menu, type MenuItem } from "@/components/ui/menu";
import { folderPath, highlightParts, noteDisplayTitle } from "@/lib/notes";
import { cn } from "@/utils/common";

export type NoteListAction =
  "pin" | "favorite" | "move" | "duplicate" | "archive" | "trash" | "restore" | "delete";

export type NoteLayout = "list" | "grid";

const editedFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

function editedLabel(updatedAt: string, now = new Date()): string {
  const date = new Date(updatedAt);
  return date.toDateString() === now.toDateString()
    ? timeFormat.format(date)
    : editedFormat.format(date);
}

/** Highlights the search's words in `text` with `<mark>`, safely (text nodes only). */
export function Highlighted({ text, search }: { text: string; search: string }) {
  return (
    <>
      {highlightParts(text, search).map((part, index) =>
        part.match ? (
          <mark key={index} className="rounded-sm bg-brand/20 px-0.5 text-inherit">
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

function noteActions(note: NoteSummary, onAction: (action: NoteListAction) => void): MenuItem[] {
  if (note.trashed_at) {
    return [
      { id: "restore", label: "Restore", onSelect: () => onAction("restore") },
      {
        id: "delete",
        label: "Delete forever…",
        destructive: true,
        onSelect: () => onAction("delete"),
      },
    ];
  }
  const items: MenuItem[] = [
    {
      id: "pin",
      label: note.is_pinned ? "Unpin" : "Pin to top",
      icon: Pin,
      onSelect: () => onAction("pin"),
    },
    {
      id: "favorite",
      label: note.is_favorite ? "Remove from favorites" : "Add to favorites",
      icon: Star,
      onSelect: () => onAction("favorite"),
    },
  ];
  if (note.note_type !== "journal") {
    items.push({
      id: "move",
      label: "Move to folder…",
      icon: Folder,
      onSelect: () => onAction("move"),
    });
  }
  items.push(
    { id: "duplicate", label: "Duplicate", onSelect: () => onAction("duplicate") },
    {
      id: "archive",
      label: note.archived_at ? "Unarchive" : "Archive",
      icon: Archive,
      onSelect: () => onAction("archive"),
    },
    { id: "trash", label: "Move to Trash", destructive: true, onSelect: () => onAction("trash") },
  );
  return items;
}

type NoteListProps = {
  notes: readonly NoteSummary[];
  folders: readonly NoteFolder[];
  selectedId: string | null;
  search: string;
  layout: NoteLayout;
  /** Show each note's folder, in views that mix folders. */
  showFolder: boolean;
  pending: ReadonlySet<string>;
  onOpen: (note: NoteSummary) => void;
  onAction: (note: NoteSummary, action: NoteListAction) => void;
};

export function NoteList({
  notes,
  folders,
  selectedId,
  search,
  layout,
  showFolder,
  pending,
  onOpen,
  onAction,
}: NoteListProps) {
  return (
    <ul
      aria-label="Notes"
      className={cn(
        layout === "grid"
          ? "grid grid-cols-1 gap-3 @md/list:grid-cols-2 @3xl/list:grid-cols-3"
          : "divide-y overflow-hidden rounded-xl border bg-card shadow-elevation-1",
      )}
    >
      {notes.map((note) => {
        const selected = note.id === selectedId;
        const path = showFolder ? folderPath(folders, note.folder_id) : [];
        const title = noteDisplayTitle(note);
        return (
          <li
            key={note.id}
            className={cn(
              "group relative transition-[background-color,opacity] duration-150",
              layout === "grid"
                ? "rounded-xl border bg-card shadow-elevation-1 hover:border-brand/30"
                : "hover:bg-accent/40",
              selected &&
                (layout === "grid"
                  ? "border-brand/50 ring-1 ring-brand/30"
                  : "bg-brand-subtle/60 hover:bg-brand-subtle/60"),
              pending.has(note.id) && "opacity-60",
            )}
          >
            <button
              type="button"
              aria-current={selected ? "true" : undefined}
              onClick={() => onOpen(note)}
              className={cn(
                "block w-full rounded-[inherit] text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                layout === "grid" ? "min-h-36 p-4 pr-10" : "px-4 py-3 pr-11",
              )}
            >
              <span className="flex items-center gap-1.5">
                {note.is_pinned ? (
                  <Pin className="size-3.5 shrink-0 text-brand" aria-label="Pinned" />
                ) : null}
                {note.note_type === "journal" ? (
                  <BookOpen
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-label="Journal entry"
                  />
                ) : note.note_type === "quick" ? (
                  <Zap
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-label="Quick note"
                  />
                ) : null}
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-sm font-medium",
                    !note.title.trim() && !note.journal_date && "text-muted-foreground",
                  )}
                >
                  <Highlighted text={title} search={search} />
                </span>
                {note.is_favorite ? (
                  <Star
                    className="size-3.5 shrink-0 fill-current text-warning"
                    aria-label="Favorite"
                  />
                ) : null}
              </span>
              {note.excerpt ? (
                <span
                  className={cn(
                    "mt-1 block text-sm break-words text-muted-foreground",
                    layout === "grid" ? "line-clamp-4" : "line-clamp-2",
                  )}
                >
                  <Highlighted text={note.excerpt} search={search} />
                </span>
              ) : null}
              <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span>
                  <span className="sr-only">Edited </span>
                  <time dateTime={note.updated_at}>{editedLabel(note.updated_at)}</time>
                </span>
                {path.length ? (
                  <span className="flex min-w-0 items-center gap-1">
                    <Folder className="size-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{path.join(" / ")}</span>
                  </span>
                ) : null}
                {note.tags.slice(0, 3).map((tag) => (
                  <span key={tag.id} className="rounded-full bg-muted px-1.5 py-px">
                    #{tag.name}
                  </span>
                ))}
                {note.tags.length > 3 ? <span>+{note.tags.length - 3}</span> : null}
              </span>
            </button>
            <div
              className={cn(
                "absolute top-2 right-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100",
                selected && "opacity-100",
              )}
            >
              <Menu
                aria-label={`More actions for “${title}”`}
                variant="ghost"
                size="icon"
                chevron={false}
                align="end"
                className="size-8"
                items={noteActions(note, (action) => onAction(note, action))}
              >
                <MoreHorizontal aria-hidden="true" />
              </Menu>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export { noteActions };
