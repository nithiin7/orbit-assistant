import type { Workspace } from "@orbit/contracts";

/**
 * The active workspace is a per-browser preference, remembered per user. It only selects what
 * to show: the API authorizes every workspace request on its own.
 */
export function workspacePreferenceKey(userId: string): string {
  return `orbit:workspace:${userId}`;
}

export function readWorkspacePreference(userId: string): string | null {
  try {
    return localStorage.getItem(workspacePreferenceKey(userId));
  } catch {
    return null;
  }
}

export function writeWorkspacePreference(userId: string, workspaceId: string): void {
  try {
    localStorage.setItem(workspacePreferenceKey(userId), workspaceId);
  } catch {
    // Storage unavailable: the choice lasts for this page view only.
  }
}

/** The preferred workspace if the user still has it, else the personal one, else the first. */
export function pickActiveWorkspace(
  workspaces: readonly Workspace[],
  preferredId: string | null,
): Workspace | null {
  return (
    workspaces.find((workspace) => workspace.id === preferredId) ??
    workspaces.find((workspace) => workspace.is_personal) ??
    workspaces[0] ??
    null
  );
}

export function workspaceInitial(name: string): string {
  return (Array.from(name.trim())[0] ?? "?").toUpperCase();
}
