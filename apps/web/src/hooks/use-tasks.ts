"use client";

import type {
  CreateTaskRequest,
  Task,
  TaskList,
  TaskListQuery,
  TaskSummary,
  UpdateTaskRequest,
} from "@orbit/contracts";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";

import { describeApiError } from "@/api/client";
import {
  completeTask,
  createTask,
  deleteTask,
  getTask,
  removeCachedTask,
  reopenTask,
  replaceCachedTask,
  taskKeys,
  taskListOptions,
  taskSummaryOptions,
  updateTask,
} from "@/api/tasks";
import { queryResource, type Resource } from "@/hooks/query-resource";
import { useWorkspaceNotFound } from "@/hooks/use-workspace-not-found";
import { useAuth } from "@/providers/auth";
import { useWorkspaces } from "@/providers/workspace";
import { localDateString } from "@/utils/dates";

/**
 * The workspace's tasks for `query`. Within a workspace, the previous results stay visible
 * (`refreshing`) while a new query loads, so typing in the search box doesn't flash a skeleton.
 */
export function useTaskList(
  workspaceId: string,
  query: TaskListQuery,
): { state: Resource<TaskList>; refreshing: boolean; reload: () => void } {
  const { withToken } = useAuth();
  const result = useQuery({
    ...taskListOptions(withToken, workspaceId, query),
    placeholderData: keepPreviousData,
  });
  useWorkspaceNotFound(result.error);

  const state = queryResource(result, "Couldn’t load your tasks.");

  const { refetch } = result;
  const reload = useCallback(() => void refetch(), [refetch]);
  return { state, refreshing: state.status === "success" && result.isFetching, reload };
}

/** Task counts for the workspace, with overdue and due-today judged by the user's local date. */
export function useTaskSummary(workspaceId: string): TaskSummary | undefined {
  const { withToken } = useAuth();
  const today = localDateString();
  const { data } = useQuery(taskSummaryOptions(withToken, workspaceId, { today }));
  return data;
}

const UP_NEXT_QUERY: TaskListQuery = { status: "open", sort: "due_date", limit: 5 };

export type TaskOverviewData = { summary: TaskSummary; upNext: Task[]; today: string };

/** Task counts and the next open tasks in the active workspace, for the dashboard. */
export function useTaskOverview(): {
  resource: Resource<TaskOverviewData>;
  reload: () => void;
} {
  const { withToken } = useAuth();
  const { state: workspaces } = useWorkspaces();
  const workspaceId = workspaces.status === "ready" ? workspaces.active.id : null;
  // The user's local date decides what counts as overdue or due today.
  const today = localDateString();
  const summary = useQuery(taskSummaryOptions(withToken, workspaceId, { today }));
  const upNext = useQuery(taskListOptions(withToken, workspaceId, UP_NEXT_QUERY));
  const error = summary.error ?? upNext.error;
  useWorkspaceNotFound(error);

  let resource: Resource<TaskOverviewData>;
  if (error && !summary.isFetching && !upNext.isFetching) {
    resource = {
      status: "error",
      message: describeApiError(error, "Couldn’t load this workspace."),
    };
  } else if (summary.data && upNext.data) {
    resource = {
      status: "success",
      data: { summary: summary.data, upNext: upNext.data.tasks, today },
    };
  } else {
    resource = { status: "loading" };
  }

  const { refetch: refetchSummary } = summary;
  const { refetch: refetchUpNext } = upNext;
  const reload = useCallback(() => {
    void refetchSummary();
    void refetchUpNext();
  }, [refetchSummary, refetchUpNext]);
  return { resource, reload };
}

/**
 * Task changes for the workspace. Each updates the cached lists to match, and marks other task
 * data (such as the dashboard summary) stale. Await `mutateAsync` to handle failures.
 */
export function useTaskMutations(workspaceId: string) {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();

  /** Refetch the task queries on screen, so changed tasks land where the sort puts them. */
  const refetchTasks = () =>
    void queryClient.invalidateQueries({ queryKey: taskKeys.all(workspaceId) });
  /** Leave the lists on screen as they are, but refetch any task data the next time it's shown. */
  const markTasksStale = () =>
    void queryClient.invalidateQueries({
      queryKey: taskKeys.all(workspaceId),
      refetchType: "none",
    });
  /** Counts are shown beside the lists, so they refresh right away. */
  const refetchSummaries = () =>
    void queryClient.invalidateQueries({ queryKey: taskKeys.summaries(workspaceId) });

  const create = useMutation({
    mutationFn: (draft: CreateTaskRequest) =>
      withToken((token) => createTask(token, workspaceId, draft)),
    onSuccess: refetchTasks,
  });

  const update = useMutation({
    mutationFn: ({ task, changes }: { task: Task; changes: UpdateTaskRequest }) =>
      withToken((token) => updateTask(token, workspaceId, task.id, changes)),
    onSuccess: (updated) => {
      replaceCachedTask(queryClient, workspaceId, updated);
      // A new due date or priority can move the task in the current sort.
      refetchTasks();
    },
  });

  const toggle = useMutation({
    mutationFn: (task: Task) =>
      withToken((token) =>
        (task.status === "open" ? completeTask : reopenTask)(token, workspaceId, task.id),
      ),
    // Show the change immediately. The task stays in the list it's in until the list refetches.
    onMutate: async (task) => {
      await queryClient.cancelQueries({ queryKey: taskKeys.lists(workspaceId) });
      const completing = task.status === "open";
      replaceCachedTask(queryClient, workspaceId, {
        ...task,
        status: completing ? "completed" : "open",
        completed_at: completing ? new Date().toISOString() : null,
      });
    },
    onSuccess: (updated) => {
      replaceCachedTask(queryClient, workspaceId, updated);
      markTasksStale();
      refetchSummaries();
    },
    onError: (_error, task) => replaceCachedTask(queryClient, workspaceId, task),
  });

  const remove = useMutation({
    mutationFn: (task: Task) => withToken((token) => deleteTask(token, workspaceId, task.id)),
    onSuccess: (_result, task) => {
      removeCachedTask(queryClient, workspaceId, task.id);
      markTasksStale();
      refetchSummaries();
    },
  });

  return { create, update, toggle, remove };
}

/**
 * The task named by the page's `?task=` (a link from a note), fetched once, so the page can open
 * it. The parameter is removed from the address afterwards, so a reload doesn't reopen it.
 */
export function useLinkedTask(workspaceId: string, onFound: (task: Task) => void) {
  const { withToken } = useAuth();
  useEffect(() => {
    const url = new URL(window.location.href);
    const taskId = url.searchParams.get("task");
    if (!taskId) return;
    url.searchParams.delete("task");
    window.history.replaceState(window.history.state, "", url);
    const controller = new AbortController();
    withToken((token) => getTask(token, workspaceId, taskId, { signal: controller.signal })).then(
      onFound,
      // A task that no longer exists (or a stale link) simply opens nothing.
      () => undefined,
    );
    return () => controller.abort();
    // Once per page visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [workspaceId]);
}
