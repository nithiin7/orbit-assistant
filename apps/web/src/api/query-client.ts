import {
  MutationCache,
  QueryClient,
  type QueryClientConfig,
  type QueryKey,
} from "@tanstack/react-query";

import { ApiError } from "./client";

const MAX_RETRIES = 2;

/** The mutation scope that saves the dashboard layout, one change at a time. */
export const DASHBOARD_LAYOUT_SCOPE = "dashboard-layout";

/** Retry network failures and server errors, but not client errors: asking again won't help. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status < 500) return false;
  return failureCount < MAX_RETRIES;
}

/**
 * Workspace data that summarizes other modules rather than owning any: the dashboard's daily
 * overview and cross-module search. Any change can affect them, so they go stale after every
 * successful mutation. Only those on screen refetch; the rest wait until they're shown again.
 */
export function isSummaryQueryKey(key: QueryKey): boolean {
  return key[0] === "workspaces" && (key[2] === "dashboard" || key[2] === "search");
}

/** The app's query cache. `queries` overrides the defaults, for example `retry: false` in tests. */
export function createQueryClient(
  queries: NonNullable<QueryClientConfig["defaultOptions"]>["queries"] = {},
): QueryClient {
  const client: QueryClient = new QueryClient({
    defaultOptions: {
      // Mutations invalidate what they change, so cached data can be reused for a while.
      queries: { staleTime: 30_000, retry: shouldRetry, ...queries },
    },
    mutationCache: new MutationCache({
      onSuccess: (_data, _variables, _context, mutation) => {
        // Arranging the dashboard changes no workspace data.
        if (mutation.options.scope?.id === DASHBOARD_LAYOUT_SCOPE) return;
        void client.invalidateQueries({
          predicate: (query) => isSummaryQueryKey(query.queryKey),
        });
      },
    }),
  });
  return client;
}
