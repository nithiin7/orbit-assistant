import type { WatchItem, WatchItems } from "@orbit/contracts";
import { type QueryClient, queryOptions, skipToken } from "@tanstack/react-query";

import type { WithToken } from "../client";
import { getWatchlistLookup, listWatchItems } from "./requests";

/**
 * Cache keys for a workspace's watchlist. Every key starts with the workspace ID, so one
 * workspace's results can never be served for another. `null` never fetches.
 */
export const watchlistKeys = {
  all: (workspaceId: string | null) => ["workspaces", workspaceId, "watchlist"] as const,
  items: (workspaceId: string | null) => [...watchlistKeys.all(workspaceId), "items"] as const,
  lookup: (workspaceId: string | null) => [...watchlistKeys.all(workspaceId), "lookup"] as const,
  suggestions: (workspaceId: string | null) =>
    [...watchlistKeys.all(workspaceId), "suggestions"] as const,
  search: (workspaceId: string | null, q: string, kind = "all", language: string | null = null) =>
    [...watchlistKeys.all(workspaceId), "search", q, kind, language] as const,
  poster: (workspaceId: string | null, itemId: string, version: string) =>
    [...watchlistKeys.all(workspaceId), "poster", itemId, version] as const,
  searchPoster: (workspaceId: string | null, path: string) =>
    [...watchlistKeys.all(workspaceId), "search-poster", path] as const,
};

/** Every title. Shared by the Watchlist page and anything else that shows it. */
export function watchItemsOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: watchlistKeys.items(workspaceId),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) => withToken((token) => listWatchItems(token, workspaceId, { signal })),
  });
}

export function watchlistLookupOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: watchlistKeys.lookup(workspaceId),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) => withToken((token) => getWatchlistLookup(token, workspaceId, { signal })),
  });
}

/** Change the cached titles. */
export function updateCachedWatchItems(
  queryClient: QueryClient,
  workspaceId: string,
  change: (items: WatchItem[]) => WatchItem[],
) {
  queryClient.setQueryData<WatchItems>(watchlistKeys.items(workspaceId), (data) =>
    data ? { items: change(data.items) } : data,
  );
}

/** Put a changed or new title into the cache, in position order. */
export function replaceCachedWatchItem(
  queryClient: QueryClient,
  workspaceId: string,
  item: WatchItem,
) {
  updateCachedWatchItems(queryClient, workspaceId, (items) => {
    const others = items.filter((entry) => entry.id !== item.id);
    return [...others, item].sort((a, b) => a.position - b.position);
  });
}
