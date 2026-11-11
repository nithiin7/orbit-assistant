"use client";

import { ChevronRight, Folder, FolderOpen, type LucideIcon, MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";

import { Menu, type MenuItem } from "@/components/ui/menu";
import { cn } from "@/utils/common";
import type { FolderLike, FolderNode } from "@/utils/folders";

/** A small uppercase section heading in a module rail, with optional actions beside it. */
export function RailHeading({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-7 items-center justify-between pr-0.5 pl-3">
      <h2 id={id} className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      {children}
    </div>
  );
}

/** A rail entry: icon, label, and an item count that screen readers hear as "3 notes". */
export function RailButton({
  selected,
  icon: Icon,
  label,
  count,
  noun,
  onClick,
  tone,
  className,
}: {
  selected: boolean;
  icon: LucideIcon;
  label: string;
  count: number | null;
  /** What's counted, singular ("note"); the count reads "1 note" or "3 notes". */
  noun: string;
  onClick: () => void;
  tone?: "danger";
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-current={selected ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "flex h-8 w-full min-w-0 items-center gap-2.5 rounded-lg px-3 text-left font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "bg-brand-subtle text-brand"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count === null || count === 0 ? null : (
        <>
          <span
            aria-hidden="true"
            className={cn(
              "text-xs tabular-nums",
              tone === "danger" ? "font-semibold text-destructive" : "text-muted-foreground",
            )}
          >
            {count}
          </span>
          <span className="sr-only">, {count === 1 ? `1 ${noun}` : `${count} ${noun}s`}</span>
        </>
      )}
    </button>
  );
}

type FolderTreeProps<T extends FolderLike> = {
  rows: readonly FolderNode<T>[];
  expanded: ReadonlySet<string>;
  parents: ReadonlySet<string>;
  onToggle: (folderId: string) => void;
  selectedId: string | null | undefined;
  /** Items directly in a folder, and what they are ("note"). */
  count: (folder: T) => number;
  noun: string;
  onOpen: (folder: T) => void;
  /** A folder's actions menu. */
  menuItems: (folder: T) => MenuItem[];
  /** Shown when there are no folders yet. */
  empty: ReactNode;
};

/** A rail's collapsible folder tree: expand toggles, folder entries, and actions menus. */
export function FolderTree<T extends FolderLike>({
  rows,
  expanded,
  parents,
  onToggle,
  selectedId,
  count,
  noun,
  onOpen,
  menuItems,
  empty,
}: FolderTreeProps<T>) {
  if (rows.length === 0) {
    return <p className="px-3 py-1 text-xs text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="space-y-0.5">
      {rows.map(({ folder, depth }) => {
        const open = expanded.has(folder.id);
        const selected = selectedId === folder.id;
        const hasChildren = parents.has(folder.id);
        return (
          <li
            key={folder.id}
            className="group/folder relative flex items-center"
            style={{ paddingLeft: `${depth * 0.875}rem` }}
          >
            <button
              type="button"
              aria-label={`${open ? "Collapse" : "Expand"} “${folder.name}”`}
              aria-expanded={open}
              onClick={() => onToggle(folder.id)}
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                !hasChildren && "invisible",
              )}
              tabIndex={hasChildren ? 0 : -1}
            >
              <ChevronRight
                className={cn("size-3.5 transition-transform duration-150", open && "rotate-90")}
                aria-hidden="true"
              />
            </button>
            <RailButton
              selected={selected}
              icon={selected || open ? FolderOpen : Folder}
              label={folder.name}
              count={count(folder)}
              noun={noun}
              onClick={() => onOpen(folder)}
              className="pr-9 pl-1.5"
            />
            <div className="absolute right-0.5 opacity-0 transition-opacity group-focus-within/folder:opacity-100 group-hover/folder:opacity-100 pointer-coarse:opacity-100">
              <Menu
                aria-label={`Actions for “${folder.name}”`}
                variant="ghost"
                size="icon"
                chevron={false}
                align="end"
                className="size-7"
                items={menuItems(folder)}
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
