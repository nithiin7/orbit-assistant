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
  ChevronRight,
  Clock,
  Folder,
  FolderOpen,
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
import { type ReactNode, useId, useState } from "react";

import { NameDialog } from "@/components/notes/organize-dialogs";
import { FolderPickerDialog } from "@/components/notes/organize-dialogs";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import { useDocumentOrganizer } from "@/hooks/use-documents";
import { DOCUMENT_VIEWS, type DocumentsLocation, type DocumentView } from "@/lib/documents";
import { cn } from "@/utils/common";
import { buildFolderTree, folderAncestors, folderSubtree, visibleFolders } from "@/utils/folders";

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
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(location.folderId ? folderAncestors(folders, location.folderId) : []),
  );
  const [dialog, setDialog] = useState<RailDialog | null>(null);
  const rows = visibleFolders(buildFolderTree(folders), expanded);
  const parents = new Set(
    folders.flatMap((folder) => (folder.parent_id ? [folder.parent_id] : [])),
  );
  const foldersHeading = useId();
  const categoriesHeading = useId();
  const tagsHeading = useId();
  const narrowed = Boolean(location.folderId || location.categoryId || location.tag);

  const toggle = (folderId: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });

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
        {rows.length === 0 ? (
          <p className="px-3 py-1 text-xs text-muted-foreground">
            Folders hold documents however you like, such as by person or by year.
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
                    count={folder.document_count}
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
            if (parent) setExpanded((current) => new Set([...current, parent.id]));
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
  tone,
  className,
}: {
  selected: boolean;
  icon: LucideIcon;
  label: string;
  count: number | null;
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
          <span className="sr-only">, {count === 1 ? "1 document" : `${count} documents`}</span>
        </>
      )}
    </button>
  );
}
