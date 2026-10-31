"use client";

import type { NoteCounts, NoteFolder, Tag } from "@orbit/contracts";
import {
  Archive,
  BookOpen,
  ChevronRight,
  Clock,
  Folder,
  FolderOpen,
  FolderPlus,
  Hash,
  Inbox,
  Layers,
  type LucideIcon,
  MoreHorizontal,
  Pin,
  Star,
  Trash2,
} from "lucide-react";
import { type ReactNode, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import { useNoteOrganizer } from "@/hooks/use-notes";
import {
  buildFolderTree,
  folderSubtree,
  NOTE_VIEWS,
  type NotesLocation,
  type NoteView,
  visibleFolders,
} from "@/lib/notes";
import { cn } from "@/utils/common";

import { DeleteFolderDialog, FolderPickerDialog, NameDialog } from "./organize-dialogs";

export const VIEW_ICONS: Record<NoteView, LucideIcon> = {
  inbox: Inbox,
  all: Layers,
  recent: Clock,
  favorites: Star,
  pinned: Pin,
  journal: BookOpen,
  archive: Archive,
  trash: Trash2,
};

function viewCount(view: NoteView, counts: NoteCounts | undefined): number | null {
  if (!counts) return null;
  switch (view) {
    case "inbox":
      return counts.inbox;
    case "all":
      return counts.all;
    case "favorites":
      return counts.favorites;
    case "pinned":
      return counts.pinned;
    case "journal":
      return counts.journal;
    case "archive":
      return counts.archived;
    case "trash":
      return counts.trashed;
    case "recent":
      return null;
  }
}

type RailDialog =
  | { kind: "new-folder"; parent: NoteFolder | null }
  | { kind: "rename-folder"; folder: NoteFolder }
  | { kind: "move-folder"; folder: NoteFolder }
  | { kind: "delete-folder"; folder: NoteFolder }
  | { kind: "rename-tag"; tag: Tag };

type NotesRailProps = {
  workspaceId: string;
  location: NotesLocation;
  counts: NoteCounts | undefined;
  folders: readonly NoteFolder[];
  tags: readonly Tag[];
  onNavigate: (location: Partial<NotesLocation>) => void;
  onAnnounce: (message: string) => void;
};

/** Views, the folder tree, and tags: what the list shows. */
export function NotesRail({
  workspaceId,
  location,
  counts,
  folders,
  tags,
  onNavigate,
  onAnnounce,
}: NotesRailProps) {
  const organizer = useNoteOrganizer(workspaceId);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [dialog, setDialog] = useState<RailDialog | null>(null);
  const tree = buildFolderTree(folders);
  const rows = visibleFolders(tree, expanded);
  const parents = new Set(
    folders.flatMap((folder) => (folder.parent_id ? [folder.parent_id] : [])),
  );
  const foldersHeading = useId();
  const tagsHeading = useId();

  const toggle = (folderId: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });

  const notesInside = (folder: NoteFolder) => {
    const ids = folderSubtree(folders, folder.id);
    return folders
      .filter((item) => ids.has(item.id))
      .reduce((sum, item) => sum + item.note_count, 0);
  };

  return (
    <nav aria-label="Notes" className="min-w-0 space-y-6 text-sm">
      <ul className="space-y-0.5">
        {NOTE_VIEWS.map(({ id, label }) => {
          const Icon = VIEW_ICONS[id];
          const selected = !location.folderId && !location.tagId && location.view === id;
          const count = viewCount(id, counts);
          return (
            <li key={id}>
              <RailButton
                selected={selected}
                icon={Icon}
                label={label}
                count={count}
                onClick={() => onNavigate({ view: id })}
              />
            </li>
          );
        })}
      </ul>

      <section aria-labelledby={foldersHeading} className="space-y-1">
        <RailHeading id={foldersHeading} title="Folders">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="New folder"
            onClick={() => setDialog({ kind: "new-folder", parent: null })}
          >
            <FolderPlus className="size-4" aria-hidden="true" />
          </Button>
        </RailHeading>
        {rows.length === 0 ? (
          <p className="px-3 py-1 text-xs text-muted-foreground">
            Folders group related notes. Notes without one stay in the Inbox.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {rows.map(({ folder, depth }) => {
              const open = expanded.has(folder.id);
              const selected = location.folderId === folder.id;
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
                    onClick={() => toggle(folder.id)}
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                      !hasChildren && "invisible",
                    )}
                    tabIndex={hasChildren ? 0 : -1}
                  >
                    <ChevronRight
                      className={cn(
                        "size-3.5 transition-transform duration-150",
                        open && "rotate-90",
                      )}
                      aria-hidden="true"
                    />
                  </button>
                  <RailButton
                    selected={selected}
                    icon={selected || open ? FolderOpen : Folder}
                    label={folder.name}
                    count={folder.note_count}
                    onClick={() => onNavigate({ folderId: folder.id })}
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
                      items={[
                        {
                          id: "new",
                          label: "New subfolder",
                          onSelect: () => setDialog({ kind: "new-folder", parent: folder }),
                        },
                        {
                          id: "rename",
                          label: "Rename",
                          onSelect: () => setDialog({ kind: "rename-folder", folder }),
                        },
                        {
                          id: "move",
                          label: "Move to…",
                          onSelect: () => setDialog({ kind: "move-folder", folder }),
                        },
                        {
                          id: "delete",
                          label: "Delete…",
                          destructive: true,
                          onSelect: () => setDialog({ kind: "delete-folder", folder }),
                        },
                      ]}
                    >
                      <MoreHorizontal aria-hidden="true" />
                    </Menu>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby={tagsHeading} className="space-y-1">
        <RailHeading id={tagsHeading} title="Tags" />
        {tags.length === 0 ? (
          <p className="px-3 py-1 text-xs text-muted-foreground">
            Add tags to a note from its details to find related notes across folders.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {tags.map((tag) => (
              <li key={tag.id} className="group/tag relative">
                <RailButton
                  selected={location.tagId === tag.id}
                  icon={Hash}
                  label={tag.name}
                  count={tag.note_count}
                  onClick={() => onNavigate({ tagId: tag.id })}
                  className="pr-9"
                />
                <div className="absolute top-1 right-0.5 opacity-0 transition-opacity group-focus-within/tag:opacity-100 group-hover/tag:opacity-100 pointer-coarse:opacity-100">
                  <Menu
                    aria-label={`Actions for tag “${tag.name}”`}
                    variant="ghost"
                    size="icon"
                    chevron={false}
                    align="end"
                    className="size-7"
                    items={[
                      {
                        id: "rename",
                        label: "Rename",
                        onSelect: () => setDialog({ kind: "rename-tag", tag }),
                      },
                      {
                        id: "delete",
                        label: "Delete tag",
                        description: "Removes it from every note; the notes stay.",
                        destructive: true,
                        onSelect: () => {
                          if (
                            !window.confirm(
                              `Delete the tag “${tag.name}”? Notes keep their content.`,
                            )
                          )
                            return;
                          organizer.deleteTag.mutateAsync(tag.id).then(
                            () => {
                              onAnnounce(`Deleted tag “${tag.name}”.`);
                              if (location.tagId === tag.id) onNavigate({ view: "all" });
                            },
                            () => onAnnounce("Couldn’t delete the tag."),
                          );
                        },
                      },
                    ]}
                  >
                    <MoreHorizontal aria-hidden="true" />
                  </Menu>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {dialog?.kind === "new-folder" ? (
        <NameDialog
          title={dialog.parent ? `New folder in “${dialog.parent.name}”` : "New folder"}
          label="Name"
          maxLength={100}
          submitLabel="Create folder"
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            const created = await organizer.createFolder.mutateAsync({
              name,
              parent_id: dialog.parent?.id ?? null,
            });
            if (dialog.parent)
              setExpanded((current) => new Set([...current, dialog.parent?.id ?? ""]));
            onAnnounce(`Created folder “${created.name}”.`);
          }}
        />
      ) : null}
      {dialog?.kind === "rename-folder" ? (
        <NameDialog
          title="Rename folder"
          label="Name"
          initial={dialog.folder.name}
          maxLength={100}
          submitLabel="Rename"
          onClose={() => setDialog(null)}
          onSubmit={(name) =>
            organizer.updateFolder.mutateAsync({ folderId: dialog.folder.id, changes: { name } })
          }
        />
      ) : null}
      {dialog?.kind === "move-folder" ? (
        <FolderPickerDialog
          title={`Move “${dialog.folder.name}”`}
          folders={folders}
          current={dialog.folder.parent_id}
          moving={dialog.folder.id}
          top="Top level"
          submitLabel="Move"
          onClose={() => setDialog(null)}
          onSubmit={(parentId) =>
            organizer.updateFolder.mutateAsync({
              folderId: dialog.folder.id,
              changes: { parent_id: parentId },
            })
          }
        />
      ) : null}
      {dialog?.kind === "delete-folder" ? (
        <DeleteFolderDialog
          folder={dialog.folder}
          noteCount={notesInside(dialog.folder)}
          onClose={() => setDialog(null)}
          onSubmit={async (mode) => {
            await organizer.deleteFolder.mutateAsync({ folderId: dialog.folder.id, mode });
            onAnnounce(`Deleted folder “${dialog.folder.name}”.`);
            if (
              location.folderId &&
              folderSubtree(folders, dialog.folder.id).has(location.folderId)
            ) {
              onNavigate({ view: mode === "trash" ? "trash" : mode === "inbox" ? "inbox" : "all" });
            }
          }}
        />
      ) : null}
      {dialog?.kind === "rename-tag" ? (
        <NameDialog
          title="Rename tag"
          label="Name"
          initial={dialog.tag.name}
          maxLength={50}
          submitLabel="Rename"
          onClose={() => setDialog(null)}
          onSubmit={(name) => organizer.renameTag.mutateAsync({ tagId: dialog.tag.id, name })}
        />
      ) : null}
    </nav>
  );
}

function RailHeading({ id, title, children }: { id: string; title: string; children?: ReactNode }) {
  return (
    <div className="flex h-7 items-center justify-between pr-0.5 pl-3">
      <h2 id={id} className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      {children}
    </div>
  );
}

function RailButton({
  selected,
  icon: Icon,
  label,
  count,
  onClick,
  className,
}: {
  selected: boolean;
  icon: LucideIcon;
  label: string;
  count: number | null;
  onClick: () => void;
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
          <span aria-hidden="true" className="text-xs text-muted-foreground tabular-nums">
            {count}
          </span>
          <span className="sr-only">, {count === 1 ? "1 note" : `${count} notes`}</span>
        </>
      )}
    </button>
  );
}
