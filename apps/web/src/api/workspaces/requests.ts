import type {
  CreateWorkspaceRequest,
  UpdateWorkspaceRequest,
  Workspace,
  WorkspaceList,
} from "@orbit/contracts";

import { request, type Signal, workspacePath } from "../client";

export function listWorkspaces(token: string, { signal }: Signal = {}): Promise<WorkspaceList> {
  return request<WorkspaceList>("/api/v1/workspaces", { token, signal });
}

export function createWorkspace(token: string, body: CreateWorkspaceRequest): Promise<Workspace> {
  return request<Workspace>("/api/v1/workspaces", { method: "POST", body, token });
}

export function getWorkspace(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<Workspace> {
  return request<Workspace>(workspacePath(workspaceId), { token, signal });
}

export function renameWorkspace(
  token: string,
  workspaceId: string,
  body: UpdateWorkspaceRequest,
): Promise<Workspace> {
  return request<Workspace>(workspacePath(workspaceId), { method: "PATCH", body, token });
}

export function deleteWorkspace(token: string, workspaceId: string): Promise<void> {
  return request<void>(workspacePath(workspaceId), { method: "DELETE", token });
}
