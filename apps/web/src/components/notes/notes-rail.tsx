"use client";

import type { NoteCounts, NoteFolder, Tag } from "@orbit/contracts";
import {
  Archive,
  BookOpen,
  Clock,
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
import { useId, useState } from "react";

import { FolderPickerDialog, NameDialog } from "@/components/folders/folder-dialogs";
import { FolderTree, RailButton, RailHeading } from "@/components/folders/folder-rail";
import { Menu } from "@/components/ui/menu";
import { useFolderTree } from "@/hooks/use-folder-tree";
import { useNoteOrganizer } from "@/hooks/use-notes";
import { folderSubtree, NOTE_VIEWS, type NotesLocation, type NoteView } from "@/lib/notes";

import { DeleteFolderDialog } from "./organize-dialogs";

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
  const { rows, expanded, parents, toggle, expand } = useFolderTree(folders);
  const [dialog, setDialog] = useState<RailDialog | null>(null);
  const foldersHeading = useId();
  const tagsHeading = useId();

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
                noun="note"
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
        <RailHeading id={foldersHeading} title="Folders" />
        <FolderTree
          rows={rows}
          expanded={expanded}
          parents={parents}
          onToggle={toggle}
          selectedId={location.folderId}
          count={(folder) => folder.note_count}
          noun="note"
          onOpen={(folder) => onNavigate({ folderId: folder.id })}
          menuItems={(folder) => [
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
          empty="Folders group related notes. Notes without one stay in the Inbox."
        />
        <button
          type="button"
          onClick={() => setDialog({ kind: "new-folder", parent: null })}
          className="flex h-8 w-full items-center gap-2.5 rounded-lg px-3 text-left font-medium text-muted-foreground transition-colors duration-150 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <FolderPlus className="size-4 shrink-0" aria-hidden="true" />
          New folder
        </button>
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
                  noun="note"
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
            if (dialog.parent) expand(dialog.parent?.id ?? "");
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
