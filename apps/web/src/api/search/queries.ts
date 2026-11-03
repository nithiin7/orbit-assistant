import type { SearchQuery, UniversalSearchQuery } from "@orbit/contracts";
import { keepPreviousData, queryOptions, skipToken } from "@tanstack/react-query";

import type { WithToken } from "../client";
import { listRecentSearches, listSavedSearches, searchWorkspace } from "./requests";

/**
 * Search keys sit under `["workspaces", id, "search"]`, so they are per workspace and, as
 * summaries of other modules, marked stale after any mutation (`isSummaryQueryKey`).
 */
export const searchKeys = {
  all: (workspaceId: string | null) => ["workspaces", workspaceId, "search"] as const,
  query: (workspaceId: string | null, query: SearchQuery) =>
    [...searchKeys.all(workspaceId), query] as const,
  universal: (workspaceId: string | null, query: Omit<UniversalSearchQuery, "offset">) =>
    [...searchKeys.all(workspaceId), "results", query] as const,
  recent: (workspaceId: string | null) => [...searchKeys.all(workspaceId), "recent"] as const,
  saved: (workspaceId: string | null) => [...searchKeys.all(workspaceId), "saved"] as const,
};

/** The shortest query the API searches for. */
export const SEARCH_MIN_LENGTH = 2;

/**
 * Results for `query` across the workspace. Queries shorter than {@link SEARCH_MIN_LENGTH}
 * never fetch. While a new query loads, the previous results stay on screen. Results are
 * cached briefly per workspace, so retyping a recent query is instant.
 */
export function searchOptions(
  withToken: WithToken,
  workspaceId: string | null,
  query: SearchQuery,
) {
  const searchable = workspaceId !== null && query.q.trim().length >= SEARCH_MIN_LENGTH;
  return queryOptions({
    queryKey: searchKeys.query(workspaceId, query),
    queryFn:
      !searchable || workspaceId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => searchWorkspace(token, workspaceId, query, { signal })),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function recentSearchesOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: searchKeys.recent(workspaceId),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) => withToken((token) => listRecentSearches(token, workspaceId, { signal })),
  });
}

export function savedSearchesOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: searchKeys.saved(workspaceId),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) => withToken((token) => listSavedSearches(token, workspaceId, { signal })),
  });
}
