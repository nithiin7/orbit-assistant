"use client";

import type { Workspace } from "@orbit/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

import { describeApiError } from "@/api/client";
import {
  createWorkspace as createWorkspaceRequest,
  deleteWorkspace as deleteWorkspaceRequest,
  removeCachedWorkspace,
  renameWorkspace as renameWorkspaceRequest,
  replaceCachedWorkspace,
  updateCachedWorkspaces,
  workspaceListOptions,
} from "@/api/workspaces";
import {
  pickActiveWorkspace,
  readWorkspacePreference,
  writeWorkspacePreference,
} from "@/lib/workspaces";
import { useAuth, useCurrentUser } from "@/providers/auth";

export type WorkspaceState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; workspaces: Workspace[]; active: Workspace };

type WorkspaceContextValue = {
  state: WorkspaceState;
  switchWorkspace: (workspaceId: string) => void;
  createWorkspace: (name: string) => Promise<Workspace>;
  renameWorkspace: (workspaceId: string, name: string) => Promise<Workspace>;
  /** Delete a workspace; if it was active, the personal workspace becomes active. */
  deleteWorkspace: (workspaceId: string) => Promise<void>;
  /** Reload the list, e.g. after the API reported the active workspace as gone. */
  refresh: () => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspaces(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspaces must be used within WorkspaceProvider.");
  return context;
}

/** Loads the signed-in user's workspaces and tracks which one is active. */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { withToken } = useAuth();
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const list = useQuery(workspaceListOptions(withToken));
  // The user's choice; falls back to the personal workspace when it's no longer in the list.
  const [selectedId, setSelectedId] = useState(() => readWorkspacePreference(user.id));
  const workspaces = list.data?.workspaces;
  const active = workspaces ? pickActiveWorkspace(workspaces, selectedId) : null;

  const choose = useCallback(
    (workspaceId: string) => {
      setSelectedId(workspaceId);
      writeWorkspacePreference(user.id, workspaceId);
    },
    [user.id],
  );

  const switchWorkspace = useCallback(
    (workspaceId: string) => {
      if (workspaces?.some((workspace) => workspace.id === workspaceId)) choose(workspaceId);
    },
    [workspaces, choose],
  );

  const { mutateAsync: create } = useMutation({
    mutationFn: (name: string) => withToken((token) => createWorkspaceRequest(token, { name })),
    onSuccess: (workspace) => {
      updateCachedWorkspaces(queryClient, (current) => [...current, workspace]);
      choose(workspace.id);
    },
  });

  const { mutateAsync: rename } = useMutation({
    mutationFn: ({ workspaceId, name }: { workspaceId: string; name: string }) =>
      withToken((token) => renameWorkspaceRequest(token, workspaceId, { name })),
    onSuccess: (renamed) => replaceCachedWorkspace(queryClient, renamed),
  });

  const { mutateAsync: remove } = useMutation({
    mutationFn: (workspaceId: string) =>
      withToken((token) => deleteWorkspaceRequest(token, workspaceId)),
    onSuccess: (_result, workspaceId) => {
      if (active?.id === workspaceId) {
        const next = pickActiveWorkspace(
          (workspaces ?? []).filter((workspace) => workspace.id !== workspaceId),
          null,
        );
        if (next) choose(next.id);
      }
      removeCachedWorkspace(queryClient, workspaceId);
    },
  });

  const renameWorkspace = useCallback(
    (workspaceId: string, name: string) => rename({ workspaceId, name }),
    [rename],
  );

  const { refetch } = list;
  const refresh = useCallback(() => void refetch(), [refetch]);

  const listError = list.isError && !list.isFetching ? list.error : null;
  const state = useMemo<WorkspaceState>(() => {
    if (workspaces && active) return { status: "ready", workspaces, active };
    if (listError) {
      return {
        status: "error",
        message: describeApiError(listError, "Couldn’t load your workspaces."),
      };
    }
    return { status: "loading" };
  }, [workspaces, active, listError]);

  const value = useMemo(
    () => ({
      state,
      switchWorkspace,
      createWorkspace: create,
      renameWorkspace,
      deleteWorkspace: remove,
      refresh,
    }),
    [state, switchWorkspace, create, renameWorkspace, remove, refresh],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
