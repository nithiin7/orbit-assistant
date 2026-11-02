import type { SearchQuery } from "@orbit/contracts";
import { keepPreviousData, queryOptions, skipToken } from "@tanstack/react-query";

import type { WithToken } from "../client";
import { searchWorkspace } from "./requests";

export const searchKeys = {
  all: (workspaceId: string | null) => ["workspaces", workspaceId, "search"] as const,
  query: (workspaceId: string | null, query: SearchQuery) =>
    [...searchKeys.all(workspaceId), query] as const,
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
