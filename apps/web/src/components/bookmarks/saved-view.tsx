"use client";

import type { Bookmark, BookmarkCollection, UpdateBookmarkRequest } from "@orbit/contracts";
import {
  Bookmark as BookmarkIcon,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useEffectEvent, useId, useState } from "react";

import { describeApiError } from "@/api/client";
import { useConfirm } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { FormAlert } from "@/components/form-field";
import { PageHeader } from "@/components/page-header";
import { ShortcutHint } from "@/components/shortcut-hint";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Menu } from "@/components/ui/menu";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ChoiceChips } from "@/components/watchlist/choice-chips";
import { useBookmarkCollections, useBookmarkMutations, useBookmarks } from "@/hooks/use-bookmarks";
import {
  bookmarksIn,
  bookmarkValues,
  changesOf,
  countViews,
  createRequestOf,
  isWebUrl,
  newBookmarkValues,
  parseSavedView,
  pinnedOf,
  savedHref,
  type SavedSort,
  type SavedView,
  SORTS,
  STATUS_LABELS,
  tagsOf,
  viewTitle,
} from "@/lib/bookmarks";
import { useWorkspaces } from "@/providers/workspace";
import { isEditableTarget } from "@/utils/keyboard";

import { BookmarkDialog } from "./bookmark-dialog";
import { type BookmarkActions, BookmarkRow, PinnedTile } from "./bookmark-row";
import { CollectionDialog } from "./collection-dialog";
import { SavedNav, VIEW_ICONS } from "./saved-nav";

const DESCRIPTION =
  "Pages you come back to, and reels, videos, and articles to get to later. Paste a link anywhere here to save it.";

const ALL_TAGS = "__all";
/** Above this many tags, filtering by typing works better than a row of chips. */
const MAX_TAG_CHIPS = 12;

const EMPTY_VIEWS: Record<SavedView["kind"], { title: string; description: string }> = {
  all: { title: "Nothing saved yet", description: "Saved links show up here." },
  pinned: {
    title: "Nothing pinned",
    description: "Pin the links you open every day; they get a one-click row on All links.",
  },
  later: {
    title: "Your later list is clear",
    description: "Reels, videos, and articles you save land here until you mark them done.",
  },
  watch: {
    title: "No reels or videos",
    description: "Save an Instagram, TikTok, YouTube, or Vimeo link and it shows up here.",
  },
  unfiled: {
    title: "Everything is in a collection",
    description: "Links you save without a collection wait here to be filed.",
  },
  collection: {
    title: "This collection is empty",
    description: "Save a link while you’re here and it goes straight in.",
  },
};

/** The Saved page for the active workspace. Remounts (and resets) when the workspace changes. */
export function SavedPanel() {
  const { state, refresh } = useWorkspaces();

  if (state.status === "error") {
    return (
      <Shell>
        <LoadError message={state.message} onRetry={refresh} />
      </Shell>
    );
  }
  if (state.status === "loading") {
    return (
      <Shell>
        <ListSkeleton />
      </Shell>
    );
  }
  return <SavedPage key={state.active.id} workspaceId={state.active.id} />;
}

type Dialog =
  | { kind: "add"; url: string }
  | { kind: "edit"; id: string }
  | { kind: "new-collection" }
  | { kind: "edit-collection"; id: string };

function SavedPage({ workspaceId }: { workspaceId: string }) {
  const { bookmarks, reload } = useBookmarks(workspaceId);
  const { collections: collectionsResource } = useBookmarkCollections(workspaceId);
  const mutations = useBookmarkMutations(workspaceId);
  const { confirm, confirmDialog } = useConfirm();
  const params = useSearchParams();
  const router = useRouter();
  const searchId = useId();
  const view = parseSavedView(params);
  const collections = collectionsResource.status === "success" ? collectionsResource.data : [];
  const currentCollection =
    view.kind === "collection" ? (collections.find((entry) => entry.id === view.id) ?? null) : null;
  const [text, setText] = useState("");
  const [sort, setSort] = useState<SavedSort>("recent");
  const [tag, setTag] = useState(ALL_TAGS);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  // `?bookmark=<id>` (from search) opens that link for editing, and `?add=<url>` (from the
  // command palette) opens "Save a link" with it filled in; once per address.
  const linkParams = `${params.get("bookmark") ?? ""} ${params.get("add") ?? ""}`;
  const [handledLink, setHandledLink] = useState<string | null>(null);
  if (linkParams !== handledLink) {
    setHandledLink(linkParams);
    const editing = params.get("bookmark");
    const adding = params.get("add");
    if (editing) setDialog({ kind: "edit", id: editing });
    else if (adding !== null)
      setDialog({ kind: "add", url: isWebUrl(adding) ? adding.trim() : "" });
  }

  function clearLinkParams() {
    if (params.has("bookmark") || params.has("add")) router.replace(savedHref(view));
  }

  const collectionForNew = view.kind === "collection" ? view.id : null;

  /** Save a pasted link straight away, into the collection on screen. */
  const savePasted = useEffectEvent(async (url: string) => {
    setError(null);
    try {
      const saved = await mutations.add.mutateAsync(
        createRequestOf(newBookmarkValues(url, collectionForNew)),
      );
      setAnnouncement(`Saved “${saved.title}”.`);
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t save the link. Try again."));
    }
  });

  // N opens "Save a link", and pasting a link (outside a text field) saves it, unless a dialog
  // is open.
  useEffect(() => {
    const blocked = (target: EventTarget | null) =>
      isEditableTarget(target) || document.querySelector("dialog[open]") !== null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (blocked(event.target) || event.key.toLowerCase() !== "n") return;
      event.preventDefault();
      setDialog({ kind: "add", url: "" });
    };
    const onPaste = (event: ClipboardEvent) => {
      if (blocked(event.target)) return;
      const pasted = event.clipboardData?.getData("text/plain").trim() ?? "";
      if (!isWebUrl(pasted)) return;
      event.preventDefault();
      void savePasted(pasted);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("paste", onPaste);
    };
  }, []);

  function markPending(id: string, isPending: boolean) {
    setPending((current) => {
      const next = new Set(current);
      if (isPending) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function update(bookmark: Bookmark, changes: UpdateBookmarkRequest, done: string) {
    setError(null);
    markPending(bookmark.id, true);
    try {
      await mutations.update.mutateAsync({ bookmark, changes });
      setAnnouncement(done);
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t update the link. Try again."));
    } finally {
      markPending(bookmark.id, false);
    }
  }

  function remove(bookmark: Bookmark) {
    void confirm({
      title: `Delete “${bookmark.title}”?`,
      description: "The link and its note are removed from Orbit. The page itself isn’t affected.",
      confirmLabel: "Delete",
      destructive: true,
    }).then(async (ok) => {
      if (!ok) return;
      setError(null);
      markPending(bookmark.id, true);
      try {
        await mutations.remove.mutateAsync(bookmark);
        setAnnouncement(`Deleted “${bookmark.title}”.`);
      } catch (reason) {
        setError(describeApiError(reason, "Couldn’t delete the link. Try again."));
      }
      markPending(bookmark.id, false);
    });
  }

  function removeCollection(collection: BookmarkCollection) {
    void confirm({
      title: `Delete the “${collection.name}” collection?`,
      description: "Its links are kept, just not in a collection.",
      confirmLabel: "Delete collection",
      destructive: true,
    }).then(async (ok) => {
      if (!ok) return;
      setError(null);
      try {
        await mutations.removeCollection.mutateAsync(collection);
        setAnnouncement(`Deleted the “${collection.name}” collection.`);
        router.replace(savedHref({ kind: "all" }));
      } catch (reason) {
        setError(describeApiError(reason, "Couldn’t delete the collection. Try again."));
      }
    });
  }

  const actions: BookmarkActions = {
    // Counting is best effort: the page has already opened.
    opened: (bookmark) => mutations.opened.mutate(bookmark),
    edit: (bookmark) => setDialog({ kind: "edit", id: bookmark.id }),
    togglePin: (bookmark) =>
      void update(
        bookmark,
        { pinned: !bookmark.pinned },
        bookmark.pinned ? `Unpinned “${bookmark.title}”.` : `Pinned “${bookmark.title}”.`,
      ),
    setStatus: (bookmark, status) =>
      void update(bookmark, { status }, `Moved “${bookmark.title}” to ${STATUS_LABELS[status]}.`),
    copy: (bookmark) =>
      void navigator.clipboard.writeText(bookmark.url).then(
        () => setAnnouncement(`Copied the link to “${bookmark.title}”.`),
        () => setError("Couldn’t copy the link. Copy it from Edit instead."),
      ),
    remove,
  };

  const headerActions = (
    <Button onClick={() => setDialog({ kind: "add", url: "" })}>
      <Plus aria-hidden="true" />
      Save link
    </Button>
  );

  let body: ReactNode;
  if (bookmarks.status === "loading") body = <ListSkeleton />;
  else if (bookmarks.status === "error") {
    body = <LoadError message={bookmarks.message} onRetry={() => void reload()} />;
  } else if (bookmarks.data.length === 0) {
    body = (
      <EmptyState
        icon={BookmarkIcon}
        title="Save your first link"
        description="Keep the pages you open all the time one click away, and park reels, videos, and articles to get to later."
      >
        <Button onClick={() => setDialog({ kind: "add", url: "" })}>
          <Plus aria-hidden="true" />
          Save a link
        </Button>
        <p className="text-xs text-muted-foreground">
          Or paste a link anywhere on this page, or into the command palette (
          <ShortcutHint keyName="K" />) from anywhere.
        </p>
      </EmptyState>
    );
  } else {
    const all = bookmarks.data;
    const inView = bookmarksIn(all, view);
    const tags = tagsOf(inView);
    const activeTag = tags.includes(tag) ? tag : ALL_TAGS;
    const shown = bookmarksIn(all, view, {
      text,
      sort,
      tag: activeTag === ALL_TAGS ? null : activeTag,
    });
    const filtered = text.trim() !== "" || activeTag !== ALL_TAGS;
    const pinned = view.kind === "all" && !filtered ? pinnedOf(all) : [];
    const empty = EMPTY_VIEWS[view.kind];

    body = (
      <div className="space-y-6">
        {pinned.length > 0 ? (
          <section aria-labelledby={`${searchId}-pinned`} className="space-y-3">
            <h3 id={`${searchId}-pinned`} className="text-sm font-semibold">
              Quick launch
            </h3>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2">
              {pinned.map((bookmark) => (
                <PinnedTile key={bookmark.id} bookmark={bookmark} actions={actions} />
              ))}
            </ul>
          </section>
        ) : null}

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 basis-56">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <label htmlFor={searchId} className="sr-only">
                Filter links
              </label>
              <Input
                id={searchId}
                type="search"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Filter by name, site, note, or tag"
                className="pl-9"
                autoComplete="off"
              />
            </div>
            <Select
              aria-label="Sort links"
              variant="ghost"
              className="w-auto"
              value={sort}
              onValueChange={setSort}
              options={SORTS}
            />
          </div>
          {tags.length > 1 && tags.length <= MAX_TAG_CHIPS ? (
            <ChoiceChips
              label="Tag"
              hideLabel
              size="sm"
              value={activeTag}
              onChange={setTag}
              options={[
                { value: ALL_TAGS, label: "All tags" },
                ...tags.map((entry) => ({ value: entry, label: `#${entry}` })),
              ]}
            />
          ) : null}
        </div>

        {shown.length === 0 ? (
          <div className="rounded-xl border border-dashed px-4 py-10 text-center">
            <p className="text-sm font-medium">{filtered ? "No links match" : empty.title}</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-pretty text-muted-foreground">
              {filtered ? "Try other words or another tag." : empty.description}
            </p>
          </div>
        ) : (
          <ul aria-label={viewTitle(view, collections)} className="space-y-2">
            {shown.map((bookmark) => (
              <BookmarkRow
                key={bookmark.id}
                bookmark={bookmark}
                collection={
                  view.kind === "collection"
                    ? null
                    : (collections.find((entry) => entry.id === bookmark.collection_id) ?? null)
                }
                actions={actions}
                pending={pending.has(bookmark.id)}
              />
            ))}
          </ul>
        )}
      </div>
    );
  }

  const editing =
    dialog?.kind === "edit" && bookmarks.status === "success"
      ? (bookmarks.data.find((entry) => entry.id === dialog.id) ?? null)
      : null;
  const editingCollection =
    dialog?.kind === "edit-collection"
      ? (collections.find((entry) => entry.id === dialog.id) ?? null)
      : null;
  const closeDialog = (kind: Dialog["kind"]) => {
    setDialog((current) => (current?.kind === kind ? null : current));
    clearLinkParams();
  };

  const viewActions = currentCollection ? (
    <Menu
      items={[
        {
          id: "edit",
          label: "Rename or recolor",
          icon: Pencil,
          onSelect: () => setDialog({ kind: "edit-collection", id: currentCollection.id }),
        },
        {
          id: "delete",
          label: "Delete collection",
          icon: Trash2,
          destructive: true,
          onSelect: () => removeCollection(currentCollection),
        },
      ]}
      variant="ghost"
      size="icon"
      chevron={false}
      align="end"
      aria-label={`Actions for the ${currentCollection.name} collection`}
      className="size-8"
    >
      <MoreHorizontal aria-hidden="true" />
    </Menu>
  ) : null;

  return (
    <Shell
      view={view}
      title={viewTitle(view, collections)}
      counts={bookmarks.status === "success" ? countViews(bookmarks.data) : null}
      collections={collections}
      onNewCollection={() => setDialog({ kind: "new-collection" })}
      actions={headerActions}
      viewActions={viewActions}
    >
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <FormAlert message={error} />
      {body}

      {dialog?.kind === "add" ? (
        <BookmarkDialog
          mode="add"
          initial={newBookmarkValues(dialog.url, collectionForNew)}
          collections={collections}
          onSave={async (values) => {
            const saved = await mutations.add.mutateAsync(createRequestOf(values));
            setAnnouncement(`Saved “${saved.title}”.`);
          }}
          onClose={() => closeDialog("add")}
        />
      ) : null}
      {editing ? (
        <BookmarkDialog
          key={editing.id}
          mode="edit"
          initial={bookmarkValues(editing)}
          collections={collections}
          onSave={async (values) => {
            const changes = changesOf(editing, values);
            if (!changes) return;
            const saved = await mutations.update.mutateAsync({ bookmark: editing, changes });
            setAnnouncement(`Saved “${saved.title}”.`);
          }}
          onClose={() => closeDialog("edit")}
        />
      ) : null}
      {dialog?.kind === "new-collection" ? (
        <CollectionDialog
          title="New collection"
          submitLabel="Create collection"
          initial={{ name: "", color: "blue" }}
          onSave={async (values) => {
            const created = await mutations.createCollection.mutateAsync(values);
            setAnnouncement(`Created the “${created.name}” collection.`);
            router.push(savedHref({ kind: "collection", id: created.id }));
          }}
          onClose={() => closeDialog("new-collection")}
        />
      ) : null}
      {editingCollection ? (
        <CollectionDialog
          title="Edit collection"
          submitLabel="Save changes"
          initial={{ name: editingCollection.name, color: editingCollection.color }}
          onSave={async (values) => {
            const saved = await mutations.updateCollection.mutateAsync({
              collection: editingCollection,
              changes: values,
            });
            setAnnouncement(`Saved the “${saved.name}” collection.`);
          }}
          onClose={() => closeDialog("edit-collection")}
        />
      ) : null}
      {confirmDialog}
    </Shell>
  );
}

function Shell({
  view = { kind: "all" },
  title = "All links",
  counts = null,
  collections = [],
  onNewCollection,
  actions,
  viewActions,
  children,
}: {
  view?: SavedView;
  title?: string;
  counts?: ReturnType<typeof countViews> | null;
  collections?: readonly BookmarkCollection[];
  onNewCollection?: () => void;
  actions?: ReactNode;
  viewActions?: ReactNode;
  children: ReactNode;
}) {
  const Icon = view.kind === "collection" ? FolderOpen : VIEW_ICONS[view.kind];
  const viewKey = view.kind === "collection" ? `collection-${view.id}` : view.kind;
  return (
    <div className="space-y-8">
      <PageHeader title="Saved" description={DESCRIPTION} actions={actions} />
      {/* Layout follows the space the page gets (which depends on the app sidebar), not the screen. */}
      <div className="@container/saved">
        <div className="grid gap-6 @5xl/saved:grid-cols-[13rem_minmax(0,1fr)] @5xl/saved:gap-8 @7xl/saved:grid-cols-[15rem_minmax(0,1fr)] @7xl/saved:gap-12">
          <aside className="min-w-0 @5xl/saved:sticky @5xl/saved:top-6 @5xl/saved:self-start">
            <SavedNav
              view={view}
              counts={counts}
              collections={collections}
              onNewCollection={onNewCollection}
            />
          </aside>
          <div key={viewKey} className="min-w-0 animate-page-in space-y-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold tracking-tight">
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate">{title}</span>
              </h2>
              {viewActions}
            </div>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="space-y-3 rounded-xl border bg-card p-4 text-sm">
      <p>{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-3">
      <span className="sr-only">Loading your saved links…</span>
      <Skeleton className="h-9 w-full" />
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex items-start gap-3 rounded-xl border p-3">
          <Skeleton className="size-10 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
