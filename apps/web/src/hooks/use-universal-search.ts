"use client";

import type {
  SavedSearch,
  SavedSearchCreate,
  SavedSearchUpdate,
  UniversalSearchFacet,
  UniversalSearchHit,
} from "@orbit/contracts";
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  clearRecentSearches,
  createSavedSearch,
  deleteSavedSearch,
  forgetRecentSearch,
  recentSearchesOptions,
  recordRecentSearch,
  savedSearchesOptions,
  SEARCH_MIN_LENGTH,
  searchKeys,
  universalSearch,
  updateSavedSearch,
} from "@/api/search";
import { useActiveWorkspaceId } from "@/hooks/use-calendar";
import { type SearchState, toSearchQuery } from "@/lib/search";
import { useAuth } from "@/providers/auth";

/** How long typing pauses before a search is sent. */
export const SEARCH_DELAY_MS = 200;

/** `value`, once it has stopped changing for `delay` milliseconds. */
export function useDebounced<T>(value: T, delay = SEARCH_DELAY_MS): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

export type UniversalSearch = {
  /** The text that was searched, after the pause; empty until there is one. */
  query: string;
  hits: UniversalSearchHit[];
  facets: UniversalSearchFacet[];
  total: number;
  hasMore: boolean;
  /** The first page is loading and there is nothing to show yet. */
  loading: boolean;
  /** Any request is in flight; earlier results may still be shown. */
  searching: boolean;
  loadingMore: boolean;
  failed: boolean;
  /** Modules that couldn't be searched; the rest answered. */
  unavailable: string[];
  loadMore: () => void;
  retry: () => void;
};

/**
 * Universal search for `state` in the active workspace, once typing pauses. Pages are fetched
 * by offset as "Load more" asks; changing the query or filters starts again. Each request
 * carries an abort signal, and results are keyed by the query, so a slow, older response
 * never replaces newer results.
 */
export function useUniversalSearch(
  state: SearchState,
  { enabled = true, limit }: { enabled?: boolean; limit: number },
): UniversalSearch {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const text = useDebounced(state.q.trim());
  const query = { ...toSearchQuery(state), q: text };
  const active = enabled && workspaceId !== null && text.length >= SEARCH_MIN_LENGTH;

  const result = useInfiniteQuery({
    queryKey: searchKeys.universal(workspaceId, { ...query, limit }),
    queryFn: ({ pageParam, signal }) =>
      withToken((token) =>
        universalSearch(
          token,
          workspaceId ?? "",
          { ...query, limit, offset: pageParam },
          { signal },
        ),
      ),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.has_more ? last.offset + last.hits.length : undefined),
    enabled: active,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const pages = active ? (result.data?.pages ?? []) : [];
  const first = pages[0];
  const seen = new Set<string>();
  const hits = pages
    .flatMap((page) => page.hits)
    .filter((hit) => {
      const key = `${hit.entity_type}:${hit.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return {
    query: active ? text : "",
    hits,
    facets: first?.facets ?? [],
    total: first?.total ?? 0,
    hasMore: active && result.hasNextPage,
    loading: active && result.isPending,
    searching: active && result.isFetching,
    loadingMore: result.isFetchingNextPage,
    failed: active && result.isError,
    unavailable: first?.unavailable ?? [],
    loadMore: () => {
      void result.fetchNextPage();
    },
    retry: () => {
      void result.refetch();
    },
  };
}

export function useRecentSearches(enabled = true) {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const result = useQuery({
    ...recentSearchesOptions(withToken, workspaceId),
    enabled: enabled && workspaceId !== null,
  });
  return { searches: result.data?.searches ?? [], failed: result.isError };
}

export function useSavedSearches(enabled = true) {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const result = useQuery({
    ...savedSearchesOptions(withToken, workspaceId),
    enabled: enabled && workspaceId !== null,
  });
  return {
    searches: result.data?.searches ?? [],
    loading: result.isPending && workspaceId !== null,
    failed: result.isError,
  };
}

/** Recording, forgetting, and clearing recent searches, and saving, renaming, and deleting. */
export function useSearchHistoryMutations() {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId() ?? "";
  const queryClient = useQueryClient();
  const refreshRecent = () =>
    queryClient.invalidateQueries({ queryKey: searchKeys.recent(workspaceId) });
  const refreshSaved = () =>
    queryClient.invalidateQueries({ queryKey: searchKeys.saved(workspaceId) });

  const record = useMutation({
    mutationFn: (query: string) =>
      withToken((token) => recordRecentSearch(token, workspaceId, query)),
    onSuccess: refreshRecent,
  });
  const forget = useMutation({
    mutationFn: (searchId: string) =>
      withToken((token) => forgetRecentSearch(token, workspaceId, searchId)),
    onSuccess: refreshRecent,
  });
  const clear = useMutation({
    mutationFn: () => withToken((token) => clearRecentSearches(token, workspaceId)),
    onSuccess: refreshRecent,
  });
  const save = useMutation({
    mutationFn: (body: SavedSearchCreate) =>
      withToken((token) => createSavedSearch(token, workspaceId, body)),
    onSuccess: refreshSaved,
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: SavedSearchUpdate }) =>
      withToken((token) => updateSavedSearch(token, workspaceId, id, body)),
    onSuccess: refreshSaved,
  });
  const remove = useMutation({
    mutationFn: (search: SavedSearch) =>
      withToken((token) => deleteSavedSearch(token, workspaceId, search.id)),
    onSuccess: refreshSaved,
  });

  /** Remembers a committed search. Failing to remember it never interrupts the person. */
  const remember = (query: string) => {
    const text = query.trim();
    if (text.length >= SEARCH_MIN_LENGTH && workspaceId) record.mutate(text);
  };

  return { remember, forget, clear, save, update, remove };
}
