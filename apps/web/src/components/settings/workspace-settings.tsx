"use client";

import type { Workspace } from "@orbit/contracts";
import { type FormEvent, useState } from "react";

import { FormAlert, FormField } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspaces } from "@/components/workspace/workspace-provider";
import { WorkspaceAvatar } from "@/components/workspace/workspace-switcher";
import { describeApiError } from "@/lib/api";
import { validateName } from "@/lib/auth/validation";

export function WorkspaceSettings() {
  const { state, switchWorkspace, refresh } = useWorkspaces();

  if (state.status === "loading") {
    return (
      <div aria-busy="true" className="space-y-3">
        <span className="sr-only">Loading workspaces…</span>
        <Skeleton className="h-9" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div role="alert" className="space-y-3 rounded-xl border bg-card p-4 text-sm">
        <p>{state.message}</p>
        <Button variant="outline" size="sm" onClick={refresh}>
          Try again
        </Button>
      </div>
    );
  }

  const { workspaces, active } = state;
  return (
    <div className="space-y-8">
      {/* Keyed so the form resets when another workspace becomes active. */}
      <RenameWorkspaceForm key={active.id} workspace={active} />

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Your workspaces</h3>
        <ul className="divide-y rounded-xl border bg-card">
          {workspaces.map((workspace) => {
            const current = workspace.id === active.id;
            return (
              <li key={workspace.id} className="flex items-center gap-3 px-4 py-3">
                <WorkspaceAvatar name={workspace.name} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {workspace.name}
                </span>
                {workspace.is_personal ? <Badge variant="outline">Personal</Badge> : null}
                {current ? (
                  <Badge variant="brand">Current</Badge>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => switchWorkspace(workspace.id)}
                    aria-label={`Switch to ${workspace.name}`}
                  >
                    Switch
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <CreateWorkspaceForm />
    </div>
  );
}

function RenameWorkspaceForm({ workspace }: { workspace: Workspace }) {
  const { renameWorkspace } = useWorkspaces();
  const [name, setName] = useState(workspace.name);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = validateName(name, "a workspace name");
    setFieldError(error);
    setFormError(null);
    setSaved(false);
    if (error) return;
    setSaving(true);
    try {
      const renamed = await renameWorkspace(workspace.id, name.trim());
      setName(renamed.name);
      setSaved(true);
    } catch (reason) {
      setFormError(describeApiError(reason, "Couldn’t rename the workspace. Try again."));
    }
    setSaving(false);
  }

  return (
    <form noValidate onSubmit={onSubmit} className="space-y-3">
      <FormField
        label="Current workspace name"
        name="workspace-name"
        autoComplete="off"
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          setSaved(false);
        }}
        error={fieldError}
      />
      <FormAlert message={formError} />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={saving || name.trim() === workspace.name}>
          {saving ? "Saving…" : "Rename"}
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {saved ? "Saved." : null}
        </p>
      </div>
    </form>
  );
}

function CreateWorkspaceForm() {
  const { createWorkspace } = useWorkspaces();
  const [name, setName] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = validateName(name, "a workspace name");
    setFieldError(error);
    setFormError(null);
    setCreated(null);
    if (error) return;
    setCreating(true);
    try {
      const workspace = await createWorkspace(name.trim());
      setName("");
      setCreated(workspace.name);
    } catch (reason) {
      setFormError(describeApiError(reason, "Couldn’t create the workspace. Try again."));
    }
    setCreating(false);
  }

  return (
    <form noValidate onSubmit={onSubmit} className="space-y-3 border-t pt-6">
      <FormField
        label="New workspace"
        name="new-workspace"
        autoComplete="off"
        placeholder="For example, Side project"
        hint="Workspaces are private to you. Sharing isn’t available yet."
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={fieldError}
      />
      <FormAlert message={formError} />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="outline" disabled={creating}>
          {creating ? "Creating…" : "Create workspace"}
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {created ? `Created and switched to ${created}.` : null}
        </p>
      </div>
    </form>
  );
}
