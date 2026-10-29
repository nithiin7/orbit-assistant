import type { Workspace, WorkspaceList } from "@orbit/contracts";
import { type QueryClient, queryOptions, skipToken } from "@tanstack/react-query";

import type { WithToken } from "../client";
import { getWorkspace, listWorkspaces } from "./requests";

/**
 * The signed-in user's workspace list has its own key. Everything about one workspace starts
 * with `["workspaces", workspaceId]` (as task and shopping keys do), so it can be dropped at once.
 */
export const workspaceKeys = {
  list: () => ["workspace-list"] as const,
  workspace: (workspaceId: string | null) => ["workspaces", workspaceId] as const,
  detail: (workspaceId: string | null) =>
    [...workspaceKeys.workspace(workspaceId), "detail"] as const,
};

export function workspaceListOptions(withToken: WithToken) {
  return queryOptions({
    queryKey: workspaceKeys.list(),
    queryFn: ({ signal }) => withToken((token) => listWorkspaces(token, { signal })),
  });
}

export function workspaceOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: workspaceKeys.detail(workspaceId),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) => withToken((token) => getWorkspace(token, workspaceId, { signal })),
  });
}

/** Change the cached workspace list. */
export function updateCachedWorkspaces(
  queryClient: QueryClient,
  change: (workspaces: Workspace[]) => Workspace[],
) {
  queryClient.setQueryData<WorkspaceList>(
    workspaceKeys.list(),
    (current) => current && { ...current, workspaces: change(current.workspaces) },
  );
}

/** Show a renamed workspace in the list and its detail, without refetching. */
export function replaceCachedWorkspace(queryClient: QueryClient, workspace: Workspace) {
  updateCachedWorkspaces(queryClient, (workspaces) =>
    workspaces.map((entry) => (entry.id === workspace.id ? workspace : entry)),
  );
  queryClient.setQueryData(workspaceKeys.detail(workspace.id), workspace);
}

/** Forget a deleted workspace: drop it from the list and every cached query about it. */
export function removeCachedWorkspace(queryClient: QueryClient, workspaceId: string) {
  updateCachedWorkspaces(queryClient, (workspaces) =>
    workspaces.filter((entry) => entry.id !== workspaceId),
  );
  queryClient.removeQueries({ queryKey: workspaceKeys.workspace(workspaceId) });
}
