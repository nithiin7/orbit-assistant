import type { Task, TaskList, TaskListQuery, TaskSummaryQuery } from "@orbit/contracts";
import { type QueryClient, queryOptions, skipToken } from "@tanstack/react-query";

import type { WithToken } from "../client";
import { getTaskSummary, listTasks } from "./requests";

/**
 * Cache keys for a workspace's tasks. Every key starts with the workspace ID, so one workspace's
 * results can never be served for another. `null` (no active workspace yet) never fetches.
 */
export const taskKeys = {
  /** Everything cached for the workspace's tasks. Invalidate this after any task change. */
  all: (workspaceId: string | null) => ["workspaces", workspaceId, "tasks"] as const,
  lists: (workspaceId: string | null) => [...taskKeys.all(workspaceId), "list"] as const,
  list: (workspaceId: string | null, query: TaskListQuery) =>
    [...taskKeys.lists(workspaceId), query] as const,
  summary: (workspaceId: string | null, query: TaskSummaryQuery) =>
    [...taskKeys.all(workspaceId), "summary", query] as const,
};

export function taskListOptions(
  withToken: WithToken,
  workspaceId: string | null,
  query: TaskListQuery,
) {
  return queryOptions({
    queryKey: taskKeys.list(workspaceId, query),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) => withToken((token) => listTasks(token, workspaceId, query, { signal })),
  });
}

export function taskSummaryOptions(
  withToken: WithToken,
  workspaceId: string | null,
  query: TaskSummaryQuery,
) {
  return queryOptions({
    queryKey: taskKeys.summary(workspaceId, query),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => getTaskSummary(token, workspaceId, query, { signal })),
  });
}

/** Show a changed task in every cached list that contains it, without refetching. */
export function replaceCachedTask(queryClient: QueryClient, workspaceId: string, task: Task) {
  queryClient.setQueriesData<TaskList>(
    { queryKey: taskKeys.lists(workspaceId) },
    (list) =>
      list && { ...list, tasks: list.tasks.map((item) => (item.id === task.id ? task : item)) },
  );
}

/** Drop a deleted task from every cached list that contains it, without refetching. */
export function removeCachedTask(queryClient: QueryClient, workspaceId: string, taskId: string) {
  queryClient.setQueriesData<TaskList>({ queryKey: taskKeys.lists(workspaceId) }, (list) => {
    if (!list?.tasks.some((item) => item.id === taskId)) return list;
    return {
      tasks: list.tasks.filter((item) => item.id !== taskId),
      total: Math.max(0, list.total - 1),
    };
  });
}
