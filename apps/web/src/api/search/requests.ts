import type { SearchQuery, SearchResults } from "@orbit/contracts";

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
