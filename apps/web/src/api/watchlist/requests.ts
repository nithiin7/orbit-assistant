import type {
  CreateWatchItemRequest,
  TitleMatches,
  UpdateWatchItemRequest,
  WatchItem,
  WatchItems,
  WatchKind,
  WatchlistLookup,
  WatchSuggestions,
} from "@orbit/contracts";

import { request, send, type Signal, toQueryString, workspacePath } from "../client";

function watchlistPath(workspaceId: string, suffix: string): string {
  return workspacePath(workspaceId, `/watchlist${suffix}`);
}

function itemPath(workspaceId: string, itemId: string, suffix = ""): string {
  return watchlistPath(workspaceId, `/items/${encodeURIComponent(itemId)}${suffix}`);
}

/** Every title, in queue order. */
export function listWatchItems(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<WatchItems> {
  return request<WatchItems>(watchlistPath(workspaceId, "/items"), { token, signal });
}

export function addWatchItem(
  token: string,
  workspaceId: string,
  body: CreateWatchItemRequest,
): Promise<WatchItem> {
  return request<WatchItem>(watchlistPath(workspaceId, "/items"), {
    method: "POST",
    body,
    token,
  });
}

export function updateWatchItem(
  token: string,
  workspaceId: string,
  itemId: string,
  body: UpdateWatchItemRequest,
): Promise<WatchItem> {
  return request<WatchItem>(itemPath(workspaceId, itemId), { method: "PATCH", body, token });
}

/** Log the next episode of a series; its last known episode marks it watched. */
export function logNextEpisode(token: string, workspaceId: string, itemId: string) {
  return request<WatchItem>(itemPath(workspaceId, itemId, "/next-episode"), {
    method: "POST",
    token,
  });
}

export function moveWatchItemToTop(token: string, workspaceId: string, itemId: string) {
  return request<WatchItem>(itemPath(workspaceId, itemId, "/move-to-top"), {
    method: "POST",
    token,
  });
}

/** Fetch a looked-up title's details again, such as a series' new season. */
export function refreshWatchItem(token: string, workspaceId: string, itemId: string) {
  return request<WatchItem>(itemPath(workspaceId, itemId, "/refresh"), {
    method: "POST",
    token,
  });
}

export function deleteWatchItem(token: string, workspaceId: string, itemId: string) {
  return request<void>(itemPath(workspaceId, itemId), { method: "DELETE", token });
}

/** The title's stored poster, or `null` when it has none. */
export async function getWatchPoster(
  token: string,
  workspaceId: string,
  itemId: string,
  { signal }: Signal = {},
): Promise<Blob | null> {
  const response = await send(itemPath(workspaceId, itemId, "/poster"), { token, signal });
  return response.status === 204 ? null : response.blob();
}

export function getWatchlistLookup(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<WatchlistLookup> {
  return request<WatchlistLookup>(watchlistPath(workspaceId, "/lookup"), { token, signal });
}

export function setWatchlistLookup(
  token: string,
  workspaceId: string,
  enabled: boolean,
): Promise<WatchlistLookup> {
  return request<WatchlistLookup>(watchlistPath(workspaceId, "/lookup"), {
    method: "PUT",
    body: { enabled },
    token,
  });
}

/** Movies and series at TMDB matching `q`; only the phrase leaves the server. */
/** TMDB matches for `q`; `kind` and `language` (original, ISO 639-1) narrow them. */
export function searchTitles(
  token: string,
  workspaceId: string,
  q: string,
  { kind = null, language = null }: { kind?: WatchKind | null; language?: string | null } = {},
  { signal }: Signal = {},
): Promise<TitleMatches> {
  const query = toQueryString({ q, kind, language });
  return request<TitleMatches>(watchlistPath(workspaceId, `/search${query}`), {
    token,
    signal,
  });
}

/** A search result's poster thumbnail, fetched through the API. */
export async function getSearchPoster(
  token: string,
  workspaceId: string,
  path: string,
  { signal }: Signal = {},
): Promise<Blob> {
  const response = await send(
    watchlistPath(workspaceId, `/search/poster${toQueryString({ path })}`),
    {
      token,
      signal,
    },
  );
  return response.blob();
}

/** Check the TMDB key with TMDB, store it encrypted, and turn lookup on. */
export function saveWatchlistKey(
  token: string,
  workspaceId: string,
  apiKey: string,
): Promise<WatchlistLookup> {
  return request<WatchlistLookup>(watchlistPath(workspaceId, "/lookup/key"), {
    method: "PUT",
    body: { api_key: apiKey },
    token,
  });
}

/** Forget the TMDB key and turn lookup off; titles already added keep their posters. */
export function removeWatchlistKey(token: string, workspaceId: string): Promise<WatchlistLookup> {
  return request<WatchlistLookup>(watchlistPath(workspaceId, "/lookup/key"), {
    method: "DELETE",
    token,
  });
}

/** TMDB's recommendations for titles on the watchlist, minus those already added. */
export function getWatchSuggestions(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<WatchSuggestions> {
  return request<WatchSuggestions>(watchlistPath(workspaceId, "/suggestions"), { token, signal });
}
