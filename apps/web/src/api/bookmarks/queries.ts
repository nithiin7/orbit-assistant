import type { Bookmark, Bookmarks } from "@orbit/contracts";
import { type QueryClient, queryOptions, skipToken } from "@tanstack/react-query";

import type { WithToken } from "../client";
import { getBookmarkSettings, listBookmarkCollections, listBookmarks } from "./requests";

/**
 * Cache keys for a workspace's saved links. Every key starts with the workspace ID, so one
 * workspace's results can never be served for another. `null` never fetches.
 */
export const bookmarkKeys = {
  all: (workspaceId: string | null) => ["workspaces", workspaceId, "bookmarks"] as const,
  items: (workspaceId: string | null) => [...bookmarkKeys.all(workspaceId), "items"] as const,
  collections: (workspaceId: string | null) =>
    [...bookmarkKeys.all(workspaceId), "collections"] as const,
  settings: (workspaceId: string | null) => [...bookmarkKeys.all(workspaceId), "settings"] as const,
  /** A stored image; `version` (when it was fetched) changes with each new preview. */
  previewFile: (workspaceId: string | null, bookmarkId: string, role: string, version: string) =>
    [...bookmarkKeys.all(workspaceId), "preview", bookmarkId, role, version] as const,
};

/** Every saved link. Shared by the Saved page and anything else that shows them. */
export function bookmarksOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: bookmarkKeys.items(workspaceId),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) => withToken((token) => listBookmarks(token, workspaceId, { signal })),
  });
}

export function bookmarkCollectionsOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: bookmarkKeys.collections(workspaceId),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => listBookmarkCollections(token, workspaceId, { signal })),
  });
}

export function bookmarkSettingsOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: bookmarkKeys.settings(workspaceId),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) => withToken((token) => getBookmarkSettings(token, workspaceId, { signal })),
  });
}

/** Change the cached links. */
export function updateCachedBookmarks(
  queryClient: QueryClient,
  workspaceId: string,
  change: (bookmarks: Bookmark[]) => Bookmark[],
) {
  queryClient.setQueryData<Bookmarks>(bookmarkKeys.items(workspaceId), (data) =>
    data ? { bookmarks: change(data.bookmarks) } : data,
  );
}

/** Put a changed or new link into the cache, keeping newest first. */
export function replaceCachedBookmark(
  queryClient: QueryClient,
  workspaceId: string,
  bookmark: Bookmark,
) {
  updateCachedBookmarks(queryClient, workspaceId, (bookmarks) => {
    const others = bookmarks.filter((entry) => entry.id !== bookmark.id);
    return [...others, bookmark].sort(
      (a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id),
    );
  });
}
