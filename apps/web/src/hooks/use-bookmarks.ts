"use client";

import type {
  Bookmark,
  BookmarkCollection,
  BookmarkCollections,
  BookmarkSettings,
  CreateBookmarkCollectionRequest,
  CreateBookmarkRequest,
  UpdateBookmarkCollectionRequest,
  UpdateBookmarkRequest,
} from "@orbit/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  bookmarkCollectionsOptions,
  bookmarkKeys,
  bookmarkSettingsOptions,
  bookmarksOptions,
  createBookmark,
  createBookmarkCollection,
  deleteBookmark,
  deleteBookmarkCollection,
  getBookmarkPreviewFile,
  type PreviewRole,
  recordBookmarkOpen,
  refreshBookmarkPreview,
  replaceCachedBookmark,
  updateBookmark,
  updateBookmarkCollection,
  updateBookmarkSettings,
  updateCachedBookmarks,
} from "@/api/bookmarks";
import { queryResource } from "@/hooks/query-resource";
import { useWorkspaceNotFound } from "@/hooks/use-workspace-not-found";
import { useAuth } from "@/providers/auth";

const selectBookmarks = (data: { bookmarks: Bookmark[] }) => data.bookmarks;
const selectCollections = (data: BookmarkCollections) => data.collections;

/** The workspace's saved links. */
export function useBookmarks(workspaceId: string) {
  const { withToken } = useAuth();
  const query = useQuery({ ...bookmarksOptions(withToken, workspaceId), select: selectBookmarks });
  useWorkspaceNotFound(query.error);
  return {
    bookmarks: queryResource(query, "Couldn’t load your saved links."),
    reload: query.refetch,
  };
}

/** The workspace's collections, with their link counts. */
export function useBookmarkCollections(workspaceId: string) {
  const { withToken } = useAuth();
  const query = useQuery({
    ...bookmarkCollectionsOptions(withToken, workspaceId),
    select: selectCollections,
  });
  return {
    collections: queryResource(query, "Couldn’t load your collections."),
    reload: query.refetch,
  };
}

/**
 * Changes to saved links and collections. Each updates the cached links to match; collection
 * counts are refetched when a link moves, arrives, or goes.
 */
export function useBookmarkMutations(workspaceId: string) {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  const store = (bookmark: Bookmark) => replaceCachedBookmark(queryClient, workspaceId, bookmark);
  const recount = () =>
    void queryClient.invalidateQueries({ queryKey: bookmarkKeys.collections(workspaceId) });

  const add = useMutation({
    mutationFn: (body: CreateBookmarkRequest) =>
      withToken((token) => createBookmark(token, workspaceId, body)),
    onSuccess: (bookmark) => {
      store(bookmark);
      if (bookmark.collection_id) recount();
    },
  });

  const update = useMutation({
    mutationFn: ({ bookmark, changes }: { bookmark: Bookmark; changes: UpdateBookmarkRequest }) =>
      withToken((token) => updateBookmark(token, workspaceId, bookmark.id, changes)),
    onSuccess: (bookmark, { changes }) => {
      store(bookmark);
      if ("collection_id" in changes) recount();
    },
  });

  const preview = useMutation({
    mutationFn: (bookmark: Pick<Bookmark, "id">) =>
      withToken((token) => refreshBookmarkPreview(token, workspaceId, bookmark.id)),
    onSuccess: store,
  });

  const opened = useMutation({
    mutationFn: (bookmark: Pick<Bookmark, "id">) =>
      withToken((token) => recordBookmarkOpen(token, workspaceId, bookmark.id)),
    onSuccess: store,
  });

  const remove = useMutation({
    mutationFn: (bookmark: Bookmark) =>
      withToken((token) => deleteBookmark(token, workspaceId, bookmark.id)),
    onSuccess: (_result, bookmark) => {
      updateCachedBookmarks(queryClient, workspaceId, (bookmarks) =>
        bookmarks.filter((entry) => entry.id !== bookmark.id),
      );
      if (bookmark.collection_id) recount();
    },
  });

  const createCollection = useMutation({
    mutationFn: (body: CreateBookmarkCollectionRequest) =>
      withToken((token) => createBookmarkCollection(token, workspaceId, body)),
    onSuccess: recount,
  });

  const updateCollection = useMutation({
    mutationFn: ({
      collection,
      changes,
    }: {
      collection: BookmarkCollection;
      changes: UpdateBookmarkCollectionRequest;
    }) =>
      withToken((token) => updateBookmarkCollection(token, workspaceId, collection.id, changes)),
    onSuccess: recount,
  });

  const removeCollection = useMutation({
    mutationFn: (collection: BookmarkCollection) =>
      withToken((token) => deleteBookmarkCollection(token, workspaceId, collection.id)),
    onSuccess: (_result, collection) => {
      // Its links stay, in no collection.
      updateCachedBookmarks(queryClient, workspaceId, (bookmarks) =>
        bookmarks.map((entry) =>
          entry.collection_id === collection.id ? { ...entry, collection_id: null } : entry,
        ),
      );
      recount();
    },
  });

  return {
    add,
    update,
    preview,
    opened,
    remove,
    createCollection,
    updateCollection,
    removeCollection,
  };
}

/** Whether this workspace fetches link previews, and the switch for it. */
export function useBookmarkSettings(workspaceId: string) {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery(bookmarkSettingsOptions(withToken, workspaceId));
  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      withToken((token) =>
        updateBookmarkSettings(token, workspaceId, { previews_enabled: enabled }),
      ),
    onSuccess: (settings) =>
      queryClient.setQueryData<BookmarkSettings>(bookmarkKeys.settings(workspaceId), settings),
  });
  return { settings: query.data ?? null, isError: query.isError, toggle };
}

/** A link's stored preview image or icon, fetched once per preview. */
export function useBookmarkPreviewFile(workspaceId: string, bookmark: Bookmark, role: PreviewRole) {
  const { withToken } = useAuth();
  const stored = role === "image" ? bookmark.has_image : bookmark.has_icon;
  return useQuery({
    queryKey: bookmarkKeys.previewFile(workspaceId, bookmark.id, role, bookmark.previewed_at ?? ""),
    queryFn: ({ signal }) =>
      withToken((token) =>
        getBookmarkPreviewFile(token, workspaceId, bookmark.id, role, { signal }),
      ),
    enabled: stored,
    staleTime: Infinity,
    retry: false,
  });
}
