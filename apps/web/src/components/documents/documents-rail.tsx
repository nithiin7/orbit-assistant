"use client";

import type {
  DocumentCategory,
  DocumentCounts,
  DocumentFolder,
  DocumentTag,
} from "@orbit/contracts";
import {
  Archive,
  CalendarClock,
  Clock,
  Cloud,
  FolderPlus,
  Hash,
  Hourglass,
  Layers,
  LayoutDashboard,
  type LucideIcon,
  MoreHorizontal,
  Plus,
  RefreshCcw,
  Star,
  Trash2,
} from "lucide-react";
import { useId, useState } from "react";

import { FolderPickerDialog, NameDialog } from "@/components/folders/folder-dialogs";
import { FolderTree, RailButton, RailHeading } from "@/components/folders/folder-rail";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import { useDocumentOrganizer } from "@/hooks/use-documents";
import { useFolderTree } from "@/hooks/use-folder-tree";
import { useConnectionsWith } from "@/hooks/use-integrations";
import { DOCUMENT_VIEWS, type DocumentsLocation, type DocumentView } from "@/lib/documents";
import { capabilityName } from "@/lib/integrations";
import { folderAncestors, folderSubtree } from "@/utils/folders";

import { CategoryDialog, DeleteDocumentFolderDialog } from "./document-dialogs";
import { CATEGORY_ICONS } from "./document-meta";

export const VIEW_ICONS: Record<DocumentView, LucideIcon> = {
  overview: LayoutDashboard,
  all: Layers,
  recent: Clock,
  favorites: Star,
  expiring: Hourglass,
  expired: CalendarClock,
  renewals: RefreshCcw,
  archived: Archive,
  trash: Trash2,
};

function viewCount(view: DocumentView, counts: DocumentCounts | undefined): number | null {
  if (!counts) return null;
  switch (view) {
    case "all":
      return counts.all;
    case "favorites":
      return counts.favorites;
    case "expiring":
      return counts.expiring_30;
    case "expired":
      return counts.expired;
    case "renewals":
      return counts.renewals;
    case "archived":
      return counts.archived;
    case "trash":
      return counts.trashed;
    case "overview":
    case "recent":
      return null;
  }
}

type RailDialog =
  | { kind: "new-folder"; parent: DocumentFolder | null }
  | { kind: "rename-folder"; folder: DocumentFolder }
  | { kind: "move-folder"; folder: DocumentFolder }
  | { kind: "delete-folder"; folder: DocumentFolder }
  | { kind: "category"; category: DocumentCategory | null };

type DocumentsRailProps = {
  workspaceId: string;
  location: DocumentsLocation;
  counts: DocumentCounts | undefined;
  folders: readonly DocumentFolder[];
  categories: readonly DocumentCategory[];
  tags: readonly DocumentTag[];
  onNavigate: (location: Partial<DocumentsLocation>) => void;
  onExport: (selection: { folderId?: string; categoryId?: string }, name: string) => void;
  onAnnounce: (message: string) => void;
  onConfirm: (title: string, description: string) => Promise<boolean>;
};

/** Views, folders, categories, and tags: what the library shows. */
export function DocumentsRail({
  workspaceId,
  location,
  counts,
  folders,
  categories,
  tags,
  onNavigate,
  onExport,
  onAnnounce,
  onConfirm,
}: DocumentsRailProps) {
  const organizer = useDocumentOrganizer(workspaceId);
  // The open folder's ancestors start expanded, so it's visible after a reload.
  const { rows, expanded, parents, toggle, expand } = useFolderTree(folders, () =>
    location.folderId ? folderAncestors(folders, location.folderId) : [],
  );
  const [dialog, setDialog] = useState<RailDialog | null>(null);
  const foldersHeading = useId();
  const categoriesHeading = useId();
  const tagsHeading = useId();
  const drivesHeading = useId();
  const drives = useConnectionsWith("files");
  const narrowed = Boolean(
    location.folderId || location.categoryId || location.tag || location.driveId,
  );

  const documentsInside = (folder: DocumentFolder) => {
    const ids = folderSubtree(folders, folder.id);
    return folders
      .filter((item) => ids.has(item.id))
      .reduce((sum, item) => sum + item.document_count, 0);
  };

  return (
    <nav aria-label="Documents" className="min-w-0 space-y-6 text-sm">
      <ul className="space-y-0.5">
        {DOCUMENT_VIEWS.map(({ id, label }) => (
          <li key={id}>
            <RailButton
              noun="document"
              selected={!narrowed && location.view === id}
              icon={VIEW_ICONS[id]}
              label={label}
              count={viewCount(id, counts)}
              tone={id === "expired" && (counts?.expired ?? 0) > 0 ? "danger" : undefined}
              onClick={() => onNavigate({ view: id })}
            />
          </li>
        ))}
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
        <FolderTree
          rows={rows}
          expanded={expanded}
          parents={parents}
          onToggle={toggle}
          selectedId={location.folderId}
          count={(folder) => folder.document_count}
          noun="document"
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
              id: "export",
              label: "Export folder",
              onSelect: () => onExport({ folderId: folder.id }, folder.name),
            },
            {
              id: "delete",
              label: "Delete…",
              destructive: true,
              onSelect: () => setDialog({ kind: "delete-folder", folder }),
            },
          ]}
          empty="Folders hold documents however you like, such as by person or by year."
        />
      </section>

      <section aria-labelledby={categoriesHeading} className="space-y-1">
        <RailHeading id={categoriesHeading} title="Categories">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="New category"
            onClick={() => setDialog({ kind: "category", category: null })}
          >
            <Plus className="size-4" aria-hidden="true" />
          </Button>
        </RailHeading>
        <ul className="space-y-0.5">
          {categories.map((category) => (
            <li key={category.id} className="group/category relative">
              <RailButton
                noun="document"
                selected={location.categoryId === category.id}
                icon={CATEGORY_ICONS[category.icon]}
                label={category.name}
                count={category.document_count}
                onClick={() => onNavigate({ categoryId: category.id })}
                className="pr-9"
              />
              <div className="absolute top-0.5 right-0.5 opacity-0 transition-opacity group-focus-within/category:opacity-100 group-hover/category:opacity-100 pointer-coarse:opacity-100">
                <Menu
                  aria-label={`Actions for “${category.name}”`}
                  variant="ghost"
                  size="icon"
                  chevron={false}
                  align="end"
                  className="size-7"
                  items={[
                    {
                      id: "edit",
                      label: "Edit",
                      onSelect: () => setDialog({ kind: "category", category }),
                    },
                    {
                      id: "export",
                      label: "Export category",
                      onSelect: () => onExport({ categoryId: category.id }, category.name),
                    },
                    {
                      id: "delete",
                      label: "Delete category",
                      description: "Its documents stay, without a category.",
                      destructive: true,
                      onSelect: () => {
                        void onConfirm(
                          `Delete “${category.name}”?`,
                          "Its documents stay, without a category.",
                        ).then((confirmed) => {
                          if (!confirmed) return;
                          organizer.deleteCategory.mutateAsync(category.id).then(
                            () => {
                              onAnnounce(`Deleted category “${category.name}”.`);
                              if (location.categoryId === category.id) onNavigate({ view: "all" });
                            },
                            () => onAnnounce("Couldn’t delete the category."),
                          );
                        });
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
      </section>

      {tags.length > 0 ? (
        <section aria-labelledby={tagsHeading} className="space-y-1">
          <RailHeading id={tagsHeading} title="Tags" />
          <ul className="space-y-0.5">
            {tags.map((tag) => (
              <li key={tag.name}>
                <RailButton
                  noun="document"
                  selected={location.tag?.toLocaleLowerCase() === tag.name.toLocaleLowerCase()}
                  icon={Hash}
                  label={tag.name}
                  count={tag.document_count}
                  onClick={() => onNavigate({ tag: tag.name })}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {drives.length > 0 ? (
        <section aria-labelledby={drivesHeading} className="space-y-1">
          <RailHeading id={drivesHeading} title="Connected drives" />
          <ul className="space-y-0.5">
            {drives.map((drive) => {
              const name = capabilityName(drive.provider, "files");
              const shared = drives.filter((d) => d.provider === drive.provider).length > 1;
              return (
                <li key={drive.id}>
                  <RailButton
                    noun="document"
                    selected={location.driveId === drive.id}
                    icon={Cloud}
                    label={shared ? `${name} · ${drive.account_email}` : name}
                    count={null}
                    onClick={() => onNavigate({ driveId: drive.id })}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

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
            const parent = dialog.parent;
            if (parent) expand(parent.id);
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
        <DeleteDocumentFolderDialog
          folder={dialog.folder}
          folders={folders}
          documentCount={documentsInside(dialog.folder)}
          onClose={() => setDialog(null)}
          onSubmit={async (mode, targetId) => {
            await organizer.deleteFolder.mutateAsync({
              folderId: dialog.folder.id,
              mode,
              targetId,
            });
            onAnnounce(`Deleted folder “${dialog.folder.name}”. Its documents were kept.`);
            if (
              location.folderId &&
              folderSubtree(folders, dialog.folder.id).has(location.folderId)
            ) {
              onNavigate(targetId ? { folderId: targetId } : { view: "all" });
            }
          }}
        />
      ) : null}
      {dialog?.kind === "category" ? (
        <CategoryDialog
          category={dialog.category}
          onClose={() => setDialog(null)}
          onSubmit={async (values) => {
            const existing = dialog.category;
            if (existing) {
              await organizer.updateCategory.mutateAsync({
                categoryId: existing.id,
                changes: values,
              });
            } else {
              await organizer.createCategory.mutateAsync(values);
              onAnnounce(`Created category “${values.name}”.`);
            }
          }}
        />
      ) : null}
    </nav>
  );
}
