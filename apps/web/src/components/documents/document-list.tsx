"use client";

import type { DocumentCategory, DocumentSummary } from "@orbit/contracts";
import { Archive, Download, Folder, MoreHorizontal, Star } from "lucide-react";

import { Highlighted } from "@/components/notes/note-list";
import { Checkbox } from "@/components/ui/checkbox";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { formatFileSize } from "@/lib/documents";
import { cn } from "@/utils/common";
import { formatCalendarDate } from "@/utils/dates";

import { CATEGORY_ICONS, ExpiryChip, FileIcon, fileTypeLabel } from "./document-meta";

export type DocumentListAction =
  "download" | "favorite" | "move" | "archive" | "trash" | "restore" | "delete";

export type DocumentLayout = "list" | "grid";

export function documentActions(
  document: DocumentSummary,
  onAction: (action: DocumentListAction) => void,
): MenuItem[] {
  if (document.trashed_at) {
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
  const items: MenuItem[] = [];
  if (document.file) {
    items.push({
      id: "download",
      label: "Download",
      icon: Download,
      onSelect: () => onAction("download"),
    });
  }
  items.push(
    {
      id: "favorite",
      label: document.is_favorite ? "Remove from favorites" : "Add to favorites",
      icon: Star,
      onSelect: () => onAction("favorite"),
    },
    { id: "move", label: "Move to folder…", icon: Folder, onSelect: () => onAction("move") },
    {
      id: "archive",
      label: document.archived_at ? "Unarchive" : "Archive",
      icon: Archive,
      onSelect: () => onAction("archive"),
    },
    { id: "trash", label: "Move to Trash", destructive: true, onSelect: () => onAction("trash") },
  );
  return items;
}

type DocumentListProps = {
  documents: readonly DocumentSummary[];
  categories: readonly DocumentCategory[];
  search: string;
  layout: DocumentLayout;
  today: string;
  selected: ReadonlySet<string>;
  pending: ReadonlySet<string>;
  onToggleSelected: (document: DocumentSummary) => void;
  onOpen: (document: DocumentSummary) => void;
  onAction: (document: DocumentSummary, action: DocumentListAction) => void;
};

export function DocumentList({
  documents,
  categories,
  search,
  layout,
  today,
  selected,
  pending,
  onToggleSelected,
  onOpen,
  onAction,
}: DocumentListProps) {
  const byId = new Map(categories.map((category) => [category.id, category]));
  return (
    <ul
      aria-label="Documents"
      className={cn(
        layout === "grid"
          ? "grid grid-cols-1 gap-3 @md/list:grid-cols-2 @3xl/list:grid-cols-3 @6xl/list:grid-cols-4"
          : "divide-y overflow-hidden rounded-xl border bg-card shadow-elevation-1",
      )}
    >
      {documents.map((document) => {
        const category = document.category_id ? byId.get(document.category_id) : undefined;
        const CategoryIcon = category ? CATEGORY_ICONS[category.icon] : null;
        const checked = selected.has(document.id);
        return (
          <li
            key={document.id}
            className={cn(
              "group relative transition-[background-color,opacity] duration-150",
              layout === "grid"
                ? "rounded-xl border bg-card shadow-elevation-1 hover:border-brand/30"
                : "hover:bg-accent/40",
              checked &&
                (layout === "grid" ? "border-brand/50 ring-1 ring-brand/30" : "bg-brand-subtle/50"),
              pending.has(document.id) && "opacity-60",
            )}
          >
            <div className="absolute top-3.5 left-3 z-[1]">
              <Checkbox
                aria-label={`Select “${document.title}”`}
                checked={checked}
                onChange={() => onToggleSelected(document)}
              />
            </div>
            <button
              type="button"
              onClick={() => onOpen(document)}
              className={cn(
                "flex w-full gap-3 rounded-[inherit] text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                layout === "grid"
                  ? "min-h-32 flex-col p-4 pt-10 pr-10"
                  : "items-center py-3 pr-11 pl-11",
              )}
            >
              <FileIcon file={document.file} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="min-w-0 truncate text-sm font-medium">
                    <Highlighted text={document.title} search={search} />
                  </span>
                  {document.is_favorite ? (
                    <Star
                      className="size-3.5 shrink-0 fill-current text-warning"
                      aria-label="Favorite"
                    />
                  ) : null}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  {category && CategoryIcon ? (
                    <span className="flex min-w-0 items-center gap-1">
                      <CategoryIcon className="size-3 shrink-0" aria-hidden="true" />
                      <span className="truncate">{category.name}</span>
                    </span>
                  ) : null}
                  <span>
                    {fileTypeLabel(document.file)}
                    {document.file ? ` · ${formatFileSize(document.file.size_bytes)}` : ""}
                  </span>
                  <span>
                    <span className="sr-only">Added </span>
                    <time dateTime={document.created_at}>
                      {formatCalendarDate(document.created_at.slice(0, 10), {
                        omitYearIn: Number(today.slice(0, 4)),
                      })}
                    </time>
                  </span>
                  {document.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="rounded-full bg-muted px-1.5 py-px">
                      #{tag}
                    </span>
                  ))}
                </span>
              </span>
              {document.expiry_date ? (
                <span className={cn(layout === "list" && "hidden @xl/list:block")}>
                  <ExpiryChip document={document} today={today} />
                </span>
              ) : null}
            </button>
            <div
              className={cn(
                "absolute top-2 right-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100",
                checked && "opacity-100",
              )}
            >
              <Menu
                aria-label={`More actions for “${document.title}”`}
                variant="ghost"
                size="icon"
                chevron={false}
                align="end"
                className="size-8"
                items={documentActions(document, (action) => onAction(document, action))}
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
