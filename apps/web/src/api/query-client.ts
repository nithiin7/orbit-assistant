import { QueryClient, type QueryClientConfig } from "@tanstack/react-query";

import { ApiError } from "./client";

const MAX_RETRIES = 2;

/** Retry network failures and server errors, but not client errors: asking again won't help. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status < 500) return false;
  return failureCount < MAX_RETRIES;
}

/** The app's query cache. `queries` overrides the defaults, for example `retry: false` in tests. */
export function createQueryClient(
  queries: NonNullable<QueryClientConfig["defaultOptions"]>["queries"] = {},
): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // Mutations invalidate what they change, so cached data can be reused for a while.
      queries: { staleTime: 30_000, retry: shouldRetry, ...queries },
    },
  });
}
