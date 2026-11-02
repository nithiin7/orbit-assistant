"use client";

import type { SearchResults } from "@orbit/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { SEARCH_MIN_LENGTH, searchOptions } from "@/api/search";
import { useActiveWorkspaceId } from "@/hooks/use-calendar";
import { useAuth } from "@/providers/auth";

/** How long typing pauses before a search is sent. */
export const SEARCH_DELAY_MS = 200;

export type WorkspaceSearch = {
  /** The query that was searched, after the pause; empty until there is one. */
  query: string;
  results: SearchResults | undefined;
  /** A search is in flight; earlier results may still be shown. */
  searching: boolean;
  failed: boolean;
};

/**
 * Search the active workspace's modules for `text` once typing pauses. Nothing is sent while
 * `enabled` is false or the text is shorter than the API's minimum.
 */
export function useWorkspaceSearch(text: string, enabled: boolean, limit = 4): WorkspaceSearch {
  const { withToken } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const [query, setQuery] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(text.trim()), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [text]);

  const active = enabled && query.length >= SEARCH_MIN_LENGTH;
  const result = useQuery({
    ...searchOptions(withToken, workspaceId, { q: query, limit }),
    enabled: active,
  });
  return {
    query: active ? query : "",
    results: active ? result.data : undefined,
    searching: active && result.isFetching,
    failed: active && result.isError,
  };
}
