"use client";

import type {
  DocumentFileKind,
  DocumentRecord,
  DocumentSort,
  DocumentSummary,
} from "@orbit/contracts";
import {
  ChevronLeft,
  ChevronRight,
  FileArchive,
  FilePlus2,
  FolderOpen,
  LayoutGrid,
  List,
  Plus,
  Search,
  SearchX,
  Upload,
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";

import { describeApiError } from "@/api/client";
import { useConfirm } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { FormAlert } from "@/components/form-field";
import { FolderPickerDialog } from "@/components/notes/organize-dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Menu } from "@/components/ui/menu";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useViewerTimeZone } from "@/hooks/use-calendar";
import {
  useDocumentCategories,
  useDocumentCounts,
  useDocumentFolders,
  useDocumentList,
  useDocumentMutations,
  useDocumentOverview,
  useDocumentSettings,
  useDocumentTags,
} from "@/hooks/use-documents";
import { todayIn } from "@/lib/calendar";
import {
  DOCUMENT_SORTS,
  DOCUMENT_VIEWS,
  DOCUMENTS_PAGE_SIZE,
  documentsHref,
  type DocumentsLocation,
  EXPIRY_WINDOWS,
  FILE_KINDS,
  parseDocumentsLocation,
  toDocumentListQuery,
} from "@/lib/documents";
import { useWorkspaces } from "@/providers/workspace";
import { cn } from "@/utils/common";
import { folderPath } from "@/utils/folders";

import { DocumentPane } from "./document-detail";
import { NewDocumentDialog } from "./document-dialogs";
import { type DocumentLayout, DocumentList, type DocumentListAction } from "./document-list";
import { DocumentsOverview } from "./documents-overview";
import { DocumentsRail, VIEW_ICONS } from "./documents-rail";
import { DropZone, UploadList, useUploadQueue } from "./upload";

const SEARCH_DELAY_MS = 250;
const ALL_KINDS = "all";

/** Save a downloaded file with its name, without navigating away. */
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  link.click();
  // Give the browser a moment to start the download before the URL goes away.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The Documents page for the active workspace. Remounts (and resets) when the workspace changes. */
export function DocumentsPanel() {
  const { state, refresh } = useWorkspaces();
  if (state.status === "error") {
    return (
      <div role="alert" className="space-y-3 rounded-xl border bg-card p-4 text-sm">
        <p>{state.message}</p>
        <Button variant="outline" size="sm" onClick={refresh}>
          Try again
        </Button>
      </div>
    );
  }
  if (state.status === "loading") return <ListSkeleton />;
  return <DocumentsView key={state.active.id} workspaceId={state.active.id} />;
}

function ListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading documents" className="space-y-3">
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton key={index} className="h-16 w-full rounded-xl" />
      ))}
    </div>
  );
}

function DocumentsView({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const location = parseDocumentsLocation(params);
  const uploadRequested = params.get("upload") === "1";
  const today = todayIn(useViewerTimeZone());
  const counts = useDocumentCounts(workspaceId);
  const settings = useDocumentSettings(workspaceId);
  const { folders } = useDocumentFolders(workspaceId);
  const { categories } = useDocumentCategories(workspaceId);
  const tags = useDocumentTags(workspaceId);
  const mutations = useDocumentMutations(workspaceId);
  const { confirm, confirmDialog } = useConfirm();

  const [sort, setSort] = useState<DocumentSort>("updated");
  const [layout, setLayout] = useState<DocumentLayout>("list");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [searchText, setSearchText] = useState(location.search);
  const [railOpen, setRailOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [moving, setMoving] = useState<DocumentSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<number | undefined>(undefined);

  // A new place resets paging and selection (adjusted while rendering, not in an effect).
  const placeKey = documentsHref({ ...location, documentId: null });
  const [shownPlace, setShownPlace] = useState(placeKey);
  if (shownPlace !== placeKey) {
    setShownPlace(placeKey);
    setPage(0);
    setSelected(new Set());
    setSearchText(location.search);
  }

  const uploads = useUploadQueue(workspaceId, settings, {
    folderId: location.folderId,
    categoryId: location.categoryId,
  });
  const showOverview = location.view === "overview" && !location.search && !location.fileKind;
  const overview = useDocumentOverview(workspaceId);
  const list = useDocumentList(
    workspaceId,
    toDocumentListQuery(location, sort, page),
    !showOverview && !location.documentId,
  );

  const navigate = (next: Partial<DocumentsLocation>, keep: Partial<DocumentsLocation> = {}) => {
    setRailOpen(false);
    router.push(documentsHref({ fileKind: null, search: "", ...keep, ...next }));
  };
  const openDocument = (documentId: string) => {
    mutations.opened.mutate(documentId);
    router.push(documentsHref({ ...location, documentId }));
  };

  const download = (
    document: Pick<DocumentRecord, "id" | "title" | "file">,
    versionId: string | null = null,
  ) => {
    mutations.download(document.id, versionId).then(
      (blob) => saveBlob(blob, document.file?.filename ?? document.title),
      (reason: unknown) => setError(describeApiError(reason, "Couldn’t download the file.")),
    );
  };

  const exportArchive = (body: Parameters<typeof mutations.exportArchive>[0], name: string) => {
    setAnnouncement(`Preparing ${name}…`);
    mutations.exportArchive(body).then(
      (blob) => {
        saveBlob(blob, `${name.replace(/[\\/:*?"<>|]+/g, "_")}.zip`);
        setAnnouncement(`Exported ${name}.`);
      },
      (reason: unknown) => setError(describeApiError(reason, "Couldn’t export the documents.")),
    );
  };

  const withPending = (id: string, work: Promise<unknown>, done: string, failure: string) => {
    setPending((current) => new Set([...current, id]));
    work
      .then(
        () => setAnnouncement(done),
        (reason: unknown) => setError(describeApiError(reason, failure)),
      )
      .finally(() =>
        setPending((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        }),
      );
  };

  const act = (document: DocumentSummary, action: DocumentListAction) => {
    setError(null);
    switch (action) {
      case "download":
        download(document);
        return;
      case "move":
        setMoving(document);
        return;
      case "favorite":
        withPending(
          document.id,
          mutations.update.mutateAsync({
            documentId: document.id,
            changes: { is_favorite: !document.is_favorite },
          }),
          document.is_favorite ? "Removed from favorites." : "Added to favorites.",
          "Couldn’t change it.",
        );
        return;
      case "archive":
        withPending(
          document.id,
          mutations.update.mutateAsync({
            documentId: document.id,
            changes: { archived: !document.archived_at },
          }),
          document.archived_at
            ? `Unarchived “${document.title}”.`
            : `Archived “${document.title}”.`,
          "Couldn’t change it.",
        );
        return;
      case "trash":
      case "restore":
        withPending(
          document.id,
          mutations.act.mutateAsync({ documentId: document.id, action }),
          action === "trash"
            ? `Moved “${document.title}” to the Trash.`
            : `Restored “${document.title}”.`,
          "Couldn’t change it.",
        );
        return;
      case "delete":
        void confirm({
          title: `Delete “${document.title}” forever?`,
          description: "Its file and every earlier version are deleted. This can’t be undone.",
          confirmLabel: "Delete forever",
          destructive: true,
        }).then((confirmed) => {
          if (confirmed)
            withPending(
              document.id,
              mutations.remove.mutateAsync(document.id),
              "Deleted.",
              "Couldn’t delete it.",
            );
        });
        return;
    }
  };

  const confirmAction = (title: string, description: string, confirmLabel = "Delete") =>
    confirm({ title, description, confirmLabel, destructive: true });

  const pickFiles = () => fileInput.current?.click();

  const rail = (
    <DocumentsRail
      workspaceId={workspaceId}
      location={location}
      counts={counts}
      folders={folders}
      categories={categories}
      tags={tags}
      onNavigate={(next) => navigate(next)}
      onExport={(selection, name) =>
        exportArchive(
          {
            folder_id: selection.folderId ?? null,
            category_id: selection.categoryId ?? null,
            include_versions: true,
          },
          name,
        )
      }
      onAnnounce={setAnnouncement}
      onConfirm={(title, description) => confirmAction(title, description)}
    />
  );

  const folder = location.folderId
    ? folders.find((item) => item.id === location.folderId)
    : undefined;
  const category = location.categoryId
    ? categories.find((item) => item.id === location.categoryId)
    : undefined;
  const title = folder
    ? folderPath(folders, folder.id).join(" / ")
    : category
      ? category.name
      : location.tag
        ? `#${location.tag}`
        : (DOCUMENT_VIEWS.find((view) => view.id === location.view)?.label ?? "Documents");
  const ViewIcon = folder
    ? FolderOpen
    : !category && !location.tag
      ? VIEW_ICONS[location.view]
      : null;

  const addMenu = (
    <Menu
      variant="default"
      items={[
        { id: "upload", label: "Upload files…", icon: Upload, onSelect: pickFiles },
        {
          id: "record",
          label: "Record without a file…",
          description: "Track a document you haven’t scanned yet.",
          icon: FilePlus2,
          onSelect: () => setCreating(true),
        },
      ]}
    >
      <Plus aria-hidden="true" />
      Add
    </Menu>
  );

  const updateSearch = (value: string) => {
    setSearchText(value);
    window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => {
      router.replace(
        documentsHref({
          ...location,
          view: location.view === "overview" ? "all" : location.view,
          search: value,
        }),
      );
    }, SEARCH_DELAY_MS);
  };

  const listItems = list.state.status === "success" ? list.state.data.documents : [];
  const total = list.state.status === "success" ? list.state.data.total : 0;
  const pages = Math.max(1, Math.ceil(total / DOCUMENTS_PAGE_SIZE));

  return (
    <div className="@container/documents space-y-5">
      <input
        ref={fileInput}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        accept={settings?.accepted_extensions.map((extension) => `.${extension}`).join(",")}
        onChange={(event) => {
          uploads.add(event.target.files ?? []);
          event.target.value = "";
        }}
      />
      <header
        hidden={Boolean(location.documentId)}
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
          <p className="text-sm text-muted-foreground">
            Your personal records, kept on this Orbit server and never sent anywhere else.
          </p>
        </div>
        {addMenu}
      </header>

      <FormAlert message={error} />
      <p role="status" className="sr-only">
        {announcement}
      </p>

      {location.documentId ? (
        <DocumentPane
          key={location.documentId}
          workspaceId={workspaceId}
          documentId={location.documentId}
          folders={folders}
          categories={categories}
          today={today}
          onBack={() => router.push(documentsHref({ ...location, documentId: null }))}
          onDownload={(document, versionId) => download(document, versionId ?? null)}
          onDeleted={(name) => {
            setAnnouncement(`Deleted “${name}”.`);
            router.push(documentsHref({ ...location, documentId: null }));
          }}
          onAnnounce={setAnnouncement}
          onConfirm={(heading, description, label) => confirmAction(heading, description, label)}
        />
      ) : (
        <div className="grid gap-6 @5xl/documents:grid-cols-[15rem_minmax(0,1fr)]">
          <aside className="hidden min-w-0 @5xl/documents:sticky @5xl/documents:top-6 @5xl/documents:block @5xl/documents:max-h-[calc(100dvh-3rem)] @5xl/documents:scrollbar-thin @5xl/documents:self-start @5xl/documents:overflow-x-hidden @5xl/documents:overflow-y-auto @5xl/documents:overscroll-contain @5xl/documents:py-0.5 @5xl/documents:pr-2 @5xl/documents:pl-0.5">
            {rail}
          </aside>

          <DropZone onFiles={uploads.add} className="min-w-0">
            <section
              aria-labelledby="document-list-heading"
              className="@container/list min-w-0 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <h2
                  id="document-list-heading"
                  className="flex min-w-0 items-center gap-2 text-lg font-semibold tracking-tight"
                >
                  {ViewIcon ? (
                    <ViewIcon
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  ) : null}
                  <span className="truncate">{title}</span>
                </h2>
                <div className="flex shrink-0 items-center gap-1">
                  {location.view === "trash" && (counts?.trashed ?? 0) > 0 ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() =>
                        void confirmAction(
                          "Empty the Trash?",
                          "Every document in the Trash, with its files and versions, is deleted for good.",
                          "Empty Trash",
                        ).then((confirmed) => {
                          if (!confirmed) return;
                          mutations.emptyTrash.mutateAsync().then(
                            ({ deleted }) => setAnnouncement(`Deleted ${deleted} documents.`),
                            (reason: unknown) =>
                              setError(describeApiError(reason, "Couldn’t empty the Trash.")),
                          );
                        })
                      }
                    >
                      Empty Trash
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="@5xl/documents:hidden"
                    aria-expanded={railOpen}
                    aria-controls="documents-rail-panel"
                    onClick={() => setRailOpen((open) => !open)}
                  >
                    Browse
                  </Button>
                </div>
              </div>

              {railOpen ? (
                <div
                  id="documents-rail-panel"
                  className="rounded-xl border bg-card p-3 @5xl/documents:hidden"
                >
                  {rail}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-48 flex-1">
                  <Search
                    className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    type="search"
                    aria-label="Search documents"
                    placeholder="Search names, files, tags, issuers…"
                    value={searchText}
                    className="pl-8"
                    onChange={(event) => updateSearch(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape" && searchText) {
                        event.preventDefault();
                        updateSearch("");
                      }
                    }}
                  />
                </div>
                {!showOverview ? (
                  <>
                    <Select
                      aria-label="File type"
                      value={location.fileKind ?? ALL_KINDS}
                      onValueChange={(value) =>
                        router.replace(
                          documentsHref({
                            ...location,
                            fileKind: value === ALL_KINDS ? null : (value as DocumentFileKind),
                          }),
                        )
                      }
                      options={[{ value: ALL_KINDS, label: "All types" }, ...FILE_KINDS]}
                      className="w-36"
                    />
                    {location.view === "expiring" && !folder && !category && !location.tag ? (
                      <Select
                        aria-label="Expiring within"
                        value={String(location.window)}
                        onValueChange={(value) =>
                          router.replace(
                            documentsHref({ ...location, window: Number(value) as 7 | 30 | 90 }),
                          )
                        }
                        options={EXPIRY_WINDOWS.map((days) => ({
                          value: String(days),
                          label: `Next ${days} days`,
                        }))}
                        className="w-36"
                      />
                    ) : null}
                    {location.view !== "recent" &&
                    location.view !== "expiring" &&
                    location.view !== "expired" ? (
                      <Select
                        aria-label="Sort by"
                        value={sort}
                        onValueChange={(value) => setSort(value)}
                        options={DOCUMENT_SORTS}
                        className="w-40"
                      />
                    ) : null}
                    <div className="flex rounded-md border" role="group" aria-label="Layout">
                      <Button
                        variant="ghost"
                        size="icon"
                        className={cn("size-9 rounded-r-none", layout === "list" && "bg-accent")}
                        aria-pressed={layout === "list"}
                        aria-label="List"
                        onClick={() => setLayout("list")}
                      >
                        <List aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={cn("size-9 rounded-l-none", layout === "grid" && "bg-accent")}
                        aria-pressed={layout === "grid"}
                        aria-label="Grid"
                        onClick={() => setLayout("grid")}
                      >
                        <LayoutGrid aria-hidden="true" />
                      </Button>
                    </div>
                  </>
                ) : null}
              </div>

              {uploadRequested && uploads.items.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center">
                  <Upload className="size-6 text-muted-foreground" aria-hidden="true" />
                  <p className="text-sm text-muted-foreground">
                    Drop files here, or choose them from your device.
                  </p>
                  <Button onClick={pickFiles}>Choose files</Button>
                </div>
              ) : null}

              <UploadList
                items={uploads.items}
                onRetry={uploads.retry}
                onDismiss={uploads.dismiss}
                onClear={uploads.clearFinished}
                onOpen={openDocument}
              />

              {selected.size > 0 ? (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-brand-subtle/40 px-4 py-2 text-sm">
                  <span className="font-medium">{selected.size} selected</span>
                  <Button
                    variant="soft"
                    size="sm"
                    onClick={() =>
                      exportArchive(
                        { document_ids: [...selected], include_versions: true },
                        `${selected.size} documents`,
                      )
                    }
                  >
                    <FileArchive aria-hidden="true" />
                    Export
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                    <X aria-hidden="true" />
                    Clear
                  </Button>
                </div>
              ) : null}

              {showOverview ? (
                overview.state.status === "loading" ? (
                  <ListSkeleton />
                ) : overview.state.status === "error" ? (
                  <div role="alert" className="space-y-3 rounded-xl border bg-card p-4 text-sm">
                    <p>{overview.state.message}</p>
                    <Button variant="outline" size="sm" onClick={overview.reload}>
                      Try again
                    </Button>
                  </div>
                ) : overview.state.data.counts.all === 0 &&
                  overview.state.data.counts.archived === 0 &&
                  uploads.items.length === 0 ? (
                  <EmptyState
                    icon={FileArchive}
                    title="Keep your important documents in one place"
                    description="Upload passports, policies, payslips, receipts, and warranties, or drop files here. Orbit can remind you before they expire."
                  >
                    <Button onClick={pickFiles}>
                      <Upload aria-hidden="true" />
                      Upload files
                    </Button>
                    <Button variant="outline" onClick={() => setCreating(true)}>
                      Record without a file
                    </Button>
                  </EmptyState>
                ) : (
                  <DocumentsOverview
                    overview={overview.state.data}
                    today={today}
                    onOpen={openDocument}
                    onNavigate={(next) => navigate(next)}
                  />
                )
              ) : list.state.status === "loading" ? (
                <ListSkeleton />
              ) : list.state.status === "error" ? (
                <div role="alert" className="space-y-3 rounded-xl border bg-card p-4 text-sm">
                  <p>{list.state.message}</p>
                  <Button variant="outline" size="sm" onClick={list.reload}>
                    Try again
                  </Button>
                </div>
              ) : listItems.length === 0 ? (
                location.search || location.fileKind ? (
                  <EmptyState
                    icon={SearchX}
                    title="No documents match"
                    description="Try other words, or another file type. Document numbers aren’t searched, to keep them private."
                  >
                    <Button
                      variant="outline"
                      onClick={() =>
                        navigate(
                          { view: location.view },
                          {
                            folderId: location.folderId,
                            categoryId: location.categoryId,
                            tag: location.tag,
                          },
                        )
                      }
                    >
                      Clear search
                    </Button>
                  </EmptyState>
                ) : (
                  <EmptyState
                    icon={VIEW_ICONS[location.view]}
                    title={emptyTitle(location)}
                    description={emptyDescription(location)}
                  >
                    {location.view !== "trash" && location.view !== "archived" ? (
                      <Button variant="outline" onClick={pickFiles}>
                        <Upload aria-hidden="true" />
                        Upload files
                      </Button>
                    ) : null}
                  </EmptyState>
                )
              ) : (
                <>
                  <DocumentList
                    documents={listItems}
                    categories={categories}
                    search={location.search}
                    layout={layout}
                    today={today}
                    selected={selected}
                    pending={pending}
                    onToggleSelected={(document) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (next.has(document.id)) next.delete(document.id);
                        else next.add(document.id);
                        return next;
                      })
                    }
                    onOpen={(document) => openDocument(document.id)}
                    onAction={act}
                  />
                  {pages > 1 && location.view !== "recent" ? (
                    <nav
                      aria-label="Pages"
                      className="flex items-center justify-between text-sm text-muted-foreground"
                    >
                      <span>
                        {page * DOCUMENTS_PAGE_SIZE + 1}–
                        {Math.min(total, (page + 1) * DOCUMENTS_PAGE_SIZE)} of {total}
                      </span>
                      <span className="flex gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={page === 0}
                          onClick={() => setPage(page - 1)}
                        >
                          <ChevronLeft aria-hidden="true" />
                          Previous
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={page + 1 >= pages}
                          onClick={() => setPage(page + 1)}
                        >
                          Next
                          <ChevronRight aria-hidden="true" />
                        </Button>
                      </span>
                    </nav>
                  ) : null}
                </>
              )}
            </section>
          </DropZone>
        </div>
      )}

      {creating ? (
        <NewDocumentDialog
          folders={folders}
          categories={categories}
          initialFolderId={location.folderId}
          initialCategoryId={location.categoryId}
          onClose={() => setCreating(false)}
          onSubmit={async ({ title: name, folderId, categoryId, expiryDate }) => {
            const created = await mutations.create.mutateAsync({
              title: name,
              folder_id: folderId,
              category_id: categoryId,
              expiry_date: expiryDate,
              description: "",
              notes: "",
              is_favorite: false,
            });
            openDocument(created.document.id);
          }}
        />
      ) : null}
      {moving ? (
        <FolderPickerDialog
          title={`Move “${moving.title}”`}
          folders={folders}
          current={moving.folder_id}
          top="Unfiled"
          submitLabel="Move"
          onClose={() => setMoving(null)}
          onSubmit={async (folderId) => {
            await mutations.update.mutateAsync({
              documentId: moving.id,
              changes: { folder_id: folderId },
            });
            setAnnouncement(`Moved “${moving.title}”.`);
          }}
        />
      ) : null}
      {confirmDialog}
    </div>
  );
}

function emptyTitle(location: DocumentsLocation): string {
  if (location.folderId) return "This folder is empty";
  if (location.categoryId) return "Nothing in this category yet";
  if (location.tag) return "No documents with this tag";
  switch (location.view) {
    case "favorites":
      return "No favorites yet";
    case "expiring":
      return `Nothing expires in the next ${location.window} days`;
    case "expired":
      return "Nothing has expired";
    case "renewals":
      return "No renewals coming up";
    case "archived":
      return "Nothing archived";
    case "trash":
      return "The Trash is empty";
    default:
      return "No documents yet";
  }
}

function emptyDescription(location: DocumentsLocation): string {
  if (location.folderId || location.categoryId)
    return "Upload files here, or move documents in from their menu.";
  switch (location.view) {
    case "favorites":
      return "Star the documents you open most to keep them here.";
    case "expiring":
    case "expired":
      return "Add an expiry date to a document to track it here.";
    case "renewals":
      return "Documents with a renewal date in the next 90 days appear here.";
    case "archived":
      return "Archive documents you want to keep but don’t need to see. Their reminders pause.";
    case "trash":
      return "Documents you move to the Trash stay here, with their files, until you delete them.";
    default:
      return "Upload files, or drop them here.";
  }
}
