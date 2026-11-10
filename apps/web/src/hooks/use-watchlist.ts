"use client";

import type {
  CreateWatchItemRequest,
  TitleMatch,
  UpdateWatchItemRequest,
  WatchItem,
  WatchlistLookup,
} from "@orbit/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  addWatchItem,
  deleteWatchItem,
  getSearchPoster,
  getWatchPoster,
  logNextEpisode,
  moveWatchItemToTop,
  refreshWatchItem,
  removeWatchlistKey,
  replaceCachedWatchItem,
  saveWatchlistKey,
  searchTitles,
  setWatchlistLookup,
  updateCachedWatchItems,
  updateWatchItem,
  watchItemsOptions,
  watchlistKeys,
  watchlistLookupOptions,
} from "@/api/watchlist";
import { queryResource } from "@/hooks/query-resource";
import { useWorkspaceNotFound } from "@/hooks/use-workspace-not-found";
import { useAuth } from "@/providers/auth";

const SEARCH_DELAY_MS = 300;

const selectItems = (data: { items: WatchItem[] }) => data.items;

/** The workspace's titles. */
export function useWatchlist(workspaceId: string) {
  const { withToken } = useAuth();
  const query = useQuery({ ...watchItemsOptions(withToken, workspaceId), select: selectItems });
  useWorkspaceNotFound(query.error);
  return { items: queryResource(query, "Couldn’t load your watchlist."), reload: query.refetch };
}

/** Whether this workspace has a TMDB key and lookup on, and the changes to both. */
export function useWatchlistLookup(workspaceId: string) {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery(watchlistLookupOptions(withToken, workspaceId));
  const store = (lookup: WatchlistLookup) =>
    queryClient.setQueryData<WatchlistLookup>(watchlistKeys.lookup(workspaceId), lookup);
  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      withToken((token) => setWatchlistLookup(token, workspaceId, enabled)),
    onSuccess: store,
  });
  const saveKey = useMutation({
    mutationFn: (apiKey: string) =>
      withToken((token) => saveWatchlistKey(token, workspaceId, apiKey)),
    onSuccess: store,
  });
  const removeKey = useMutation({
    mutationFn: () => withToken((token) => removeWatchlistKey(token, workspaceId)),
    onSuccess: store,
  });
  return {
    lookup: query.data ?? null,
    isError: query.isError,
    toggle,
    saveKey,
    removeKey,
  };
}

/**
 * TMDB matches for `q`, searched once typing pauses. A new phrase cancels the wait for the old
 * one, so only the last pause reaches the server.
 */
export function useTitleSearch(workspaceId: string, q: string, enabled: boolean) {
  const { withToken } = useAuth();
  const phrase = q.trim();
  return useQuery({
    queryKey: watchlistKeys.search(workspaceId, phrase),
    queryFn: async ({ signal }): Promise<TitleMatch[]> => {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(resolve, SEARCH_DELAY_MS);
        signal.addEventListener("abort", () => {
          window.clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
      const found = await withToken((token) =>
        searchTitles(token, workspaceId, phrase, { signal }),
      );
      return found.results;
    },
    enabled: enabled && phrase.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** A title's poster, or `null` when it has none. Posters rarely change, so they stay cached. */
export function useWatchPoster(workspaceId: string, item: WatchItem) {
  const { withToken } = useAuth();
  return useQuery({
    queryKey: watchlistKeys.poster(workspaceId, item.id, String(item.has_poster)),
    queryFn: ({ signal }) =>
      withToken((token) => getWatchPoster(token, workspaceId, item.id, { signal })),
    enabled: item.has_poster,
    staleTime: Infinity,
  });
}

export function useSearchPoster(workspaceId: string, path: string | null) {
  const { withToken } = useAuth();
  return useQuery({
    queryKey: watchlistKeys.searchPoster(workspaceId, path ?? ""),
    queryFn: ({ signal }) =>
      withToken((token) => getSearchPoster(token, workspaceId, path ?? "", { signal })),
    enabled: path !== null,
    staleTime: Infinity,
    retry: false,
  });
}

/** Title changes for the workspace. Each updates the cached titles to match. */
export function useWatchlistMutations(workspaceId: string) {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  const store = (item: WatchItem) => replaceCachedWatchItem(queryClient, workspaceId, item);
  // Search results know which titles are added. Mark them stale without refetching the open
  // search, which tracks its own adds.
  const forgetSearches = () =>
    void queryClient.invalidateQueries({
      queryKey: [...watchlistKeys.all(workspaceId), "search"],
      refetchType: "none",
    });

  const add = useMutation({
    mutationFn: (body: CreateWatchItemRequest) =>
      withToken((token) => addWatchItem(token, workspaceId, body)),
    onSuccess: (item) => {
      store(item);
      forgetSearches();
    },
  });

  const update = useMutation({
    mutationFn: ({ item, changes }: { item: WatchItem; changes: UpdateWatchItemRequest }) =>
      withToken((token) => updateWatchItem(token, workspaceId, item.id, changes)),
    onSuccess: store,
  });

  const nextEpisode = useMutation({
    mutationFn: (item: WatchItem) =>
      withToken((token) => logNextEpisode(token, workspaceId, item.id)),
    onSuccess: store,
  });

  const moveToTop = useMutation({
    mutationFn: (item: WatchItem) =>
      withToken((token) => moveWatchItemToTop(token, workspaceId, item.id)),
    onSuccess: store,
  });

  const refresh = useMutation({
    mutationFn: (item: WatchItem) =>
      withToken((token) => refreshWatchItem(token, workspaceId, item.id)),
    onSuccess: store,
  });

  const remove = useMutation({
    mutationFn: (item: WatchItem) =>
      withToken((token) => deleteWatchItem(token, workspaceId, item.id)),
    onSuccess: (_result, item) => {
      updateCachedWatchItems(queryClient, workspaceId, (items) =>
        items.filter((entry) => entry.id !== item.id),
      );
      forgetSearches();
    },
  });

  return { add, update, nextEpisode, moveToTop, refresh, remove };
}
