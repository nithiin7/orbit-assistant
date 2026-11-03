import type {
  RecentSearch,
  RecentSearchList,
  SavedSearch,
  SavedSearchCreate,
  SavedSearchList,
  SavedSearchUpdate,
  SearchQuery,
  SearchResults,
  UniversalSearchQuery,
  UniversalSearchResults,
} from "@orbit/contracts";

import { request, type Signal, toQueryString, workspacePath } from "../client";

/** Search the workspace's modules at once; results come grouped by module. */
export function searchWorkspace(
  token: string,
  workspaceId: string,
  query: SearchQuery,
  { signal }: Signal = {},
): Promise<SearchResults> {
  return request<SearchResults>(`${workspacePath(workspaceId, "/search")}${toQueryString(query)}`, {
    token,
    signal,
  });
}

/** One ranked page of results across every module, with per-module counts. */
export function universalSearch(
  token: string,
  workspaceId: string,
  query: UniversalSearchQuery,
  { signal }: Signal = {},
): Promise<UniversalSearchResults> {
  return request<UniversalSearchResults>(
    `${workspacePath(workspaceId, "/search/results")}${toQueryString(query)}`,
    { token, signal },
  );
}

export function listRecentSearches(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<RecentSearchList> {
  return request<RecentSearchList>(workspacePath(workspaceId, "/search/recent"), {
    token,
    signal,
  });
}

/** Remember a search the person committed to (not every keystroke). */
export function recordRecentSearch(
  token: string,
  workspaceId: string,
  query: string,
): Promise<RecentSearch> {
  return request<RecentSearch>(workspacePath(workspaceId, "/search/recent"), {
    method: "POST",
    body: { query },
    token,
  });
}

export function forgetRecentSearch(
  token: string,
  workspaceId: string,
  searchId: string,
): Promise<void> {
  return request<void>(
    workspacePath(workspaceId, `/search/recent/${encodeURIComponent(searchId)}`),
    { method: "DELETE", token },
  );
}

export function clearRecentSearches(token: string, workspaceId: string): Promise<void> {
  return request<void>(workspacePath(workspaceId, "/search/recent"), { method: "DELETE", token });
}

export function listSavedSearches(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<SavedSearchList> {
  return request<SavedSearchList>(workspacePath(workspaceId, "/search/saved"), {
    token,
    signal,
  });
}

export function createSavedSearch(
  token: string,
  workspaceId: string,
  body: SavedSearchCreate,
): Promise<SavedSearch> {
  return request<SavedSearch>(workspacePath(workspaceId, "/search/saved"), {
    method: "POST",
    body,
    token,
  });
}

export function updateSavedSearch(
  token: string,
  workspaceId: string,
  searchId: string,
  body: SavedSearchUpdate,
): Promise<SavedSearch> {
  return request<SavedSearch>(
    workspacePath(workspaceId, `/search/saved/${encodeURIComponent(searchId)}`),
    { method: "PATCH", body, token },
  );
}

export function deleteSavedSearch(
  token: string,
  workspaceId: string,
  searchId: string,
): Promise<void> {
  return request<void>(
    workspacePath(workspaceId, `/search/saved/${encodeURIComponent(searchId)}`),
    { method: "DELETE", token },
  );
}
