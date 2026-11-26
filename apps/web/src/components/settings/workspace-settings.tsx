"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { Workspace } from "@orbit/contracts";
import { Layers, PencilLine, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { FormAlert, FormField } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspaceAvatar } from "@/components/workspace/workspace-switcher";
import { workspaceNameSchema } from "@/lib/auth/validation";
import { settingsSectionsClassName } from "@/lib/settings";
import { useWorkspaces } from "@/providers/workspace";
import { cn } from "@/utils/common";

import { SettingsCard } from "./settings-card";

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
    <div className={settingsSectionsClassName}>
      {/* Keyed so the form resets when another workspace becomes active. */}
      <RenameWorkspaceForm key={`rename-${active.id}`} workspace={active} />

      <SettingsCard
        titleId="your-workspaces-title"
        icon={Layers}
        title="Your workspaces"
        description="Each keeps its own records. Switch any time."
        bodyClassName="p-2 sm:p-2"
      >
        <ul className="space-y-1">
          {workspaces.map((workspace) => {
            const current = workspace.id === active.id;
            return (
              <li
                key={workspace.id}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors duration-150",
                  current ? "bg-brand-subtle/60" : "hover:bg-accent",
                )}
              >
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
      </SettingsCard>

      <CreateWorkspaceForm />

      {active.is_personal ? null : (
        <DeleteWorkspaceSection key={`delete-${active.id}`} workspace={active} />
      )}
    </div>
  );
}

function RenameWorkspaceForm({ workspace }: { workspace: Workspace }) {
  const { renameWorkspace } = useWorkspaces();
  const {
    register,
    handleSubmit,
    setError,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: yupResolver(workspaceNameSchema),
    defaultValues: { name: workspace.name },
  });
  const unchanged = useWatch({ control, name: "name" }).trim() === workspace.name;
  const [saved, setSaved] = useState(false);

  const onSubmit = handleSubmit(async ({ name }) => {
    setSaved(false);
    try {
      const renamed = await renameWorkspace(workspace.id, name);
      reset({ name: renamed.name });
      setSaved(true);
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t rename the workspace. Try again."),
      });
    }
  });

  return (
    <SettingsCard
      titleId="rename-workspace-title"
      icon={PencilLine}
      title="This workspace"
      description="The name shown in the sidebar and the workspace switcher."
    >
      <form noValidate onSubmit={onSubmit} className="space-y-3">
        <FormField
          label="Workspace name"
          autoComplete="off"
          {...register("name", { onChange: () => setSaved(false) })}
          error={errors.name?.message}
        />
        <FormAlert message={errors.root?.server?.message ?? null} />
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={isSubmitting || unchanged}>
            {isSubmitting ? "Saving…" : "Rename"}
          </Button>
          <p role="status" className="text-sm text-muted-foreground">
            {saved ? "Saved." : null}
          </p>
        </div>
      </form>
    </SettingsCard>
  );
}

function CreateWorkspaceForm() {
  const { createWorkspace } = useWorkspaces();
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: yupResolver(workspaceNameSchema), defaultValues: { name: "" } });
  const [created, setCreated] = useState<string | null>(null);

  const onSubmit = handleSubmit(async ({ name }) => {
    setCreated(null);
    try {
      const workspace = await createWorkspace(name);
      reset();
      setCreated(workspace.name);
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t create the workspace. Try again."),
      });
    }
  });

  return (
    <SettingsCard
      titleId="new-workspace-title"
      icon={Plus}
      title="Create a workspace"
      description="Start fresh for a project or another part of life."
    >
      <form noValidate onSubmit={onSubmit} className="space-y-3">
        <FormField
          label="New workspace"
          autoComplete="off"
          placeholder="For example, Side project"
          {...register("name")}
          error={errors.name?.message}
        />
        <FormAlert message={errors.root?.server?.message ?? null} />
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" variant="outline" disabled={isSubmitting}>
            {isSubmitting ? "Creating…" : "Create workspace"}
          </Button>
          <p role="status" className="text-sm text-muted-foreground">
            {created ? `Created and switched to ${created}.` : null}
          </p>
        </div>
      </form>
    </SettingsCard>
  );
}

/** Deleting is permanent, so it asks for the workspace's name before enabling the button. */
function DeleteWorkspaceSection({ workspace }: { workspace: Workspace }) {
  const { deleteWorkspace } = useWorkspaces();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const matches = typed.trim() === workspace.name;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!matches) return;
    setFormError(null);
    setDeleting(true);
    try {
      // On success the section unmounts, because another workspace becomes active.
      await deleteWorkspace(workspace.id);
    } catch (reason) {
      setFormError(describeApiError(reason, "Couldn’t delete the workspace. Try again."));
      setDeleting(false);
    }
  }

  return (
    <SettingsCard
      titleId="delete-workspace-heading"
      icon={Trash2}
      tone="danger"
      title="Delete this workspace"
      description={`Deletes ${workspace.name} and everything in it. This can’t be undone.`}
      bodyClassName="space-y-3"
    >
      {confirming ? (
        <form noValidate onSubmit={onSubmit} className="space-y-3">
          <FormField
            label={`Type ${workspace.name} to confirm`}
            name="confirm-workspace-name"
            autoComplete="off"
            autoFocus
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
          <FormAlert message={formError} />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="destructive" size="sm" disabled={!matches || deleting}>
              <Trash2 aria-hidden="true" />
              {deleting ? "Deleting…" : "Delete workspace"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={deleting}
              onClick={() => {
                setConfirming(false);
                setTyped("");
                setFormError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="destructive" size="sm" onClick={() => setConfirming(true)}>
          <Trash2 aria-hidden="true" />
          Delete workspace…
        </Button>
      )}
    </SettingsCard>
  );
}
