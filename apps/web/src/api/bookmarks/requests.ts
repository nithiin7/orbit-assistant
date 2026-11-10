import type {
  Bookmark,
  BookmarkCollection,
  BookmarkCollections,
  Bookmarks,
  BookmarkSettings,
  BookmarkSettingsRequest,
  CreateBookmarkCollectionRequest,
  CreateBookmarkRequest,
  UpdateBookmarkCollectionRequest,
  UpdateBookmarkRequest,
} from "@orbit/contracts";

import { request, send, type Signal, workspacePath } from "../client";

export type PreviewRole = "image" | "icon";

function bookmarksPath(workspaceId: string, suffix: string): string {
  return workspacePath(workspaceId, `/bookmarks${suffix}`);
}

function itemPath(workspaceId: string, bookmarkId: string, suffix = ""): string {
  return bookmarksPath(workspaceId, `/items/${encodeURIComponent(bookmarkId)}${suffix}`);
}

function collectionPath(workspaceId: string, collectionId: string): string {
  return bookmarksPath(workspaceId, `/collections/${encodeURIComponent(collectionId)}`);
}

/** Every saved link, newest first. */
export function listBookmarks(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<Bookmarks> {
  return request<Bookmarks>(bookmarksPath(workspaceId, "/items"), { token, signal });
}

export function createBookmark(
  token: string,
  workspaceId: string,
  body: CreateBookmarkRequest,
): Promise<Bookmark> {
  return request<Bookmark>(bookmarksPath(workspaceId, "/items"), {
    method: "POST",
    body,
    token,
  });
}

export function updateBookmark(
  token: string,
  workspaceId: string,
  bookmarkId: string,
  body: UpdateBookmarkRequest,
): Promise<Bookmark> {
  return request<Bookmark>(itemPath(workspaceId, bookmarkId), { method: "PATCH", body, token });
}

/** Count an open, so the most used links can come first. */
export function recordBookmarkOpen(
  token: string,
  workspaceId: string,
  bookmarkId: string,
): Promise<Bookmark> {
  return request<Bookmark>(itemPath(workspaceId, bookmarkId, "/opened"), {
    method: "POST",
    token,
  });
}

export function deleteBookmark(token: string, workspaceId: string, bookmarkId: string) {
  return request<void>(itemPath(workspaceId, bookmarkId), { method: "DELETE", token });
}

/** The workspace's collections, oldest first, with their bookmark counts. */
export function listBookmarkCollections(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<BookmarkCollections> {
  return request<BookmarkCollections>(bookmarksPath(workspaceId, "/collections"), {
    token,
    signal,
  });
}

export function createBookmarkCollection(
  token: string,
  workspaceId: string,
  body: CreateBookmarkCollectionRequest,
): Promise<BookmarkCollection> {
  return request<BookmarkCollection>(bookmarksPath(workspaceId, "/collections"), {
    method: "POST",
    body,
    token,
  });
}

export function updateBookmarkCollection(
  token: string,
  workspaceId: string,
  collectionId: string,
  body: UpdateBookmarkCollectionRequest,
): Promise<BookmarkCollection> {
  return request<BookmarkCollection>(collectionPath(workspaceId, collectionId), {
    method: "PATCH",
    body,
    token,
  });
}

/** Delete a collection; its links are kept, in no collection. */
export function deleteBookmarkCollection(token: string, workspaceId: string, collectionId: string) {
  return request<void>(collectionPath(workspaceId, collectionId), { method: "DELETE", token });
}

export function getBookmarkSettings(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<BookmarkSettings> {
  return request<BookmarkSettings>(bookmarksPath(workspaceId, "/settings"), { token, signal });
}

export function updateBookmarkSettings(
  token: string,
  workspaceId: string,
  body: BookmarkSettingsRequest,
): Promise<BookmarkSettings> {
  return request<BookmarkSettings>(bookmarksPath(workspaceId, "/settings"), {
    method: "PUT",
    body,
    token,
  });
}

/** Have the server visit the page for its description, image, and icon (previews must be on). */
export function refreshBookmarkPreview(
  token: string,
  workspaceId: string,
  bookmarkId: string,
): Promise<Bookmark> {
  return request<Bookmark>(itemPath(workspaceId, bookmarkId, "/preview"), {
    method: "POST",
    token,
  });
}

/** A link's stored preview image or site icon, or `null` when it has none. */
export async function getBookmarkPreviewFile(
  token: string,
  workspaceId: string,
  bookmarkId: string,
  role: PreviewRole,
  { signal }: Signal = {},
): Promise<Blob | null> {
  const response = await send(itemPath(workspaceId, bookmarkId, `/${role}`), { token, signal });
  return response.status === 204 ? null : response.blob();
}
