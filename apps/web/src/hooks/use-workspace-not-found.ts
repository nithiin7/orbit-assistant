"use client";

import { useEffect } from "react";

import { ApiError } from "@/api/client";
import { useWorkspaces } from "@/components/workspace/workspace-provider";

/** When a workspace request comes back 404, the workspace is gone: re-validate the list. */
export function useWorkspaceNotFound(error: unknown): void {
  const { refresh } = useWorkspaces();
  useEffect(() => {
    if (error instanceof ApiError && error.status === 404) refresh();
  }, [error, refresh]);
}
