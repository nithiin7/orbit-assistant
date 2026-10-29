"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useWorkspaces } from "@/components/workspace/workspace-provider";
import { ApiError, describeApiError } from "@/lib/api";

export type WorkspaceResource<T> =
  { status: "loading" } | { status: "error"; message: string } | { status: "success"; data: T };

type Loader<T> = (workspaceId: string, token: string, signal: AbortSignal) => Promise<T>;

type Result<T> = { workspaceId: string; resource: WorkspaceResource<T> };

/**
 * Loads data scoped to the active workspace. Switching workspaces aborts the request in flight,
 * and a result is shown only while its workspace is still active, so data from the previous
 * workspace can never appear under the new one. `load` must be stable (e.g. module-level).
 */
export function useWorkspaceResource<T>(load: Loader<T>): {
  resource: WorkspaceResource<T>;
  reload: () => void;
} {
  const { withToken } = useAuth();
  const { state, refresh } = useWorkspaces();
  const workspaceId = state.status === "ready" ? state.active.id : null;
  const [result, setResult] = useState<Result<T> | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    if (!workspaceId) return;
    const controller = new AbortController();
    withToken((token) => load(workspaceId, token, controller.signal)).then(
      (data) => {
        if (!controller.signal.aborted) {
          setResult({ workspaceId, resource: { status: "success", data } });
        }
      },
      (reason: unknown) => {
        if (controller.signal.aborted) return;
        // The workspace is gone or no longer accessible: re-validate the workspace list.
        if (reason instanceof ApiError && reason.status === 404) refresh();
        const message = describeApiError(reason, "Couldn’t load this workspace.");
        setResult({ workspaceId, resource: { status: "error", message } });
      },
    );
    return () => controller.abort();
  }, [workspaceId, load, withToken, refresh, reloads]);

  const reload = useCallback(() => {
    setResult(null);
    setReloads((value) => value + 1);
  }, []);

  const resource: WorkspaceResource<T> =
    workspaceId && result?.workspaceId === workspaceId ? result.resource : { status: "loading" };
  return { resource, reload };
}
