"use client";

import { useEffect } from "react";

import { ApiError } from "@/api/client";
import { useWorkspaces } from "@/components/workspace/workspace-provider";

/**
 * When a request fails because the workspace is gone or no longer accessible, re-validate the
 * workspace list. Other 404s (a deleted list or task) say so in their detail and are ignored.
 */
export function useWorkspaceNotFound(error: unknown): void {
  const { refresh } = useWorkspaces();
  useEffect(() => {
    if (
      error instanceof ApiError &&
      error.status === 404 &&
      error.detail === "Workspace not found."
    ) {
      refresh();
    }
  }, [error, refresh]);
}
