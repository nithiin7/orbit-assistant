"use client";

import type { Task, TaskListQuery } from "@orbit/contracts";
import { useCallback, useEffect, useState } from "react";

import { ApiError, describeApiError } from "@/api/client";
import { listTasks } from "@/api/tasks";
import { useAuth } from "@/components/auth/auth-provider";
import { useWorkspaces } from "@/components/workspace/workspace-provider";

export type TaskListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; tasks: Task[]; total: number };

type Loaded = { workspaceId: string; query: TaskListQuery; version: number };
type Data = Loaded & { tasks: Task[]; total: number };
type Failure = Loaded & { message: string };

/**
 * The active workspace's tasks for `query`, which must be memoized. Like `useWorkspaceResource`,
 * switching workspaces aborts the request in flight and never shows another workspace's tasks.
 * Within a workspace, the previous results stay visible (`refreshing`) while a new query loads,
 * so typing in the search box doesn't flash a skeleton.
 */
export function useTaskList(query: TaskListQuery): {
  state: TaskListState;
  refreshing: boolean;
  /** Load again, showing the loading state. For retrying after an error. */
  reload: () => void;
  /** Load again in the background, keeping the current list visible. */
  refresh: () => void;
  /** Show a changed task in place, without reloading. */
  replaceTask: (task: Task) => void;
  removeTask: (taskId: string) => void;
} {
  const { withToken } = useAuth();
  const { state: workspaces, refresh: refreshWorkspaces } = useWorkspaces();
  const workspaceId = workspaces.status === "ready" ? workspaces.active.id : null;
  const [data, setData] = useState<Data | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!workspaceId) return;
    const controller = new AbortController();
    const loaded = { workspaceId, query, version };
    withToken((token) => listTasks(token, workspaceId, query, { signal: controller.signal })).then(
      (list) => {
        if (controller.signal.aborted) return;
        setData({ ...loaded, tasks: list.tasks, total: list.total });
        setFailure(null);
      },
      (reason: unknown) => {
        if (controller.signal.aborted) return;
        // The workspace is gone or no longer accessible: re-validate the workspace list.
        if (reason instanceof ApiError && reason.status === 404) refreshWorkspaces();
        setFailure({ ...loaded, message: describeApiError(reason, "Couldn’t load your tasks.") });
      },
    );
    return () => controller.abort();
  }, [workspaceId, query, version, withToken, refreshWorkspaces]);

  const reload = useCallback(() => {
    setData(null);
    setFailure(null);
    setVersion((value) => value + 1);
  }, []);

  const refresh = useCallback(() => setVersion((value) => value + 1), []);

  const replaceTask = useCallback((task: Task) => {
    setData(
      (current) =>
        current && {
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? task : item)),
        },
    );
  }, []);

  const removeTask = useCallback((taskId: string) => {
    setData((current) => {
      if (!current?.tasks.some((item) => item.id === taskId)) return current;
      return {
        ...current,
        tasks: current.tasks.filter((item) => item.id !== taskId),
        total: Math.max(0, current.total - 1),
      };
    });
  }, []);

  const isCurrent = (loaded: Loaded | null) =>
    loaded?.workspaceId === workspaceId && loaded.query === query && loaded.version === version;
  // Results from this workspace, possibly for an earlier query.
  const shown = workspaceId && data?.workspaceId === workspaceId ? data : null;

  let state: TaskListState;
  if (failure && isCurrent(failure)) state = { status: "error", message: failure.message };
  else if (shown) state = { status: "success", tasks: shown.tasks, total: shown.total };
  else state = { status: "loading" };

  return {
    state,
    refreshing: state.status === "success" && !isCurrent(shown),
    reload,
    refresh,
    replaceTask,
    removeTask,
  };
}
