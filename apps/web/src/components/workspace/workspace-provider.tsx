"use client";

import type { Workspace } from "@orbit/contracts";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useAuth, useCurrentUser } from "@/components/auth/auth-provider";
import {
  createWorkspace as createWorkspaceRequest,
  describeApiError,
  listWorkspaces,
  renameWorkspace as renameWorkspaceRequest,
} from "@/lib/api";
import {
  pickActiveWorkspace,
  readWorkspacePreference,
  writeWorkspacePreference,
} from "@/lib/workspaces";

export type WorkspaceState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; workspaces: Workspace[]; active: Workspace };

type WorkspaceContextValue = {
  state: WorkspaceState;
  switchWorkspace: (workspaceId: string) => void;
  createWorkspace: (name: string) => Promise<Workspace>;
  renameWorkspace: (workspaceId: string, name: string) => Promise<Workspace>;
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
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    withToken((token) => listWorkspaces(token, { signal: controller.signal })).then(
      (list) => {
        setWorkspaces(list.workspaces);
        setActiveId(
          (current) =>
            pickActiveWorkspace(list.workspaces, current ?? readWorkspacePreference(user.id))?.id ??
            null,
        );
        setError(null);
      },
      (reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(describeApiError(reason, "Couldn’t load your workspaces."));
      },
    );
    return () => controller.abort();
  }, [withToken, user.id, reloads]);

  const switchWorkspace = useCallback(
    (workspaceId: string) => {
      if (!workspaces?.some((workspace) => workspace.id === workspaceId)) return;
      setActiveId(workspaceId);
      writeWorkspacePreference(user.id, workspaceId);
    },
    [workspaces, user.id],
  );

  const createWorkspace = useCallback(
    async (name: string) => {
      const workspace = await withToken((token) => createWorkspaceRequest(token, { name }));
      setWorkspaces((current) => [...(current ?? []), workspace]);
      setActiveId(workspace.id);
      writeWorkspacePreference(user.id, workspace.id);
      return workspace;
    },
    [withToken, user.id],
  );

  const renameWorkspace = useCallback(
    async (workspaceId: string, name: string) => {
      const renamed = await withToken((token) =>
        renameWorkspaceRequest(token, workspaceId, { name }),
      );
      setWorkspaces((current) =>
        (current ?? []).map((workspace) => (workspace.id === renamed.id ? renamed : workspace)),
      );
      return renamed;
    },
    [withToken],
  );

  const refresh = useCallback(() => {
    setError(null);
    setReloads((value) => value + 1);
  }, []);

  const state = useMemo<WorkspaceState>(() => {
    const active = workspaces?.find((workspace) => workspace.id === activeId);
    if (workspaces && active) return { status: "ready", workspaces, active };
    if (error) return { status: "error", message: error };
    return { status: "loading" };
  }, [workspaces, activeId, error]);

  const value = useMemo(
    () => ({ state, switchWorkspace, createWorkspace, renameWorkspace, refresh }),
    [state, switchWorkspace, createWorkspace, renameWorkspace, refresh],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
