import type { UseQueryResult } from "@tanstack/react-query";

import { describeApiError } from "@/api/client";

export type WorkspaceResource<T> =
  { status: "loading" } | { status: "error"; message: string } | { status: "success"; data: T };

/**
 * A query's result as a loading, error, or success state for a view. A retry after an error
 * shows the loading state again; `fallback` is the message when the API didn't send one.
 */
export function queryResource<T>(
  result: UseQueryResult<T>,
  fallback: string,
): WorkspaceResource<T> {
  if (result.isError && !result.isFetching) {
    return { status: "error", message: describeApiError(result.error, fallback) };
  }
  if (result.data !== undefined) return { status: "success", data: result.data };
  return { status: "loading" };
}
