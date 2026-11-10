"use client";

import { Bookmark, ShieldCheck } from "lucide-react";
import { useId, useState } from "react";

import { describeApiError } from "@/api/client";
import { FormAlert } from "@/components/form-field";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useBookmarkSettings } from "@/hooks/use-bookmarks";
import { useActiveWorkspaceId } from "@/hooks/use-calendar";
import { settingsSectionsClassName } from "@/lib/settings";

/** Saved settings for the open workspace: whether the server fetches link previews. */
export function SavedSettings() {
  const workspaceId = useActiveWorkspaceId();
  if (workspaceId === null) {
    return <Skeleton className="h-48 w-full rounded-2xl" />;
  }
  return <PreviewSettings key={workspaceId} workspaceId={workspaceId} />;
}

function PreviewSettings({ workspaceId }: { workspaceId: string }) {
  const id = useId();
  const { settings, isError, toggle } = useBookmarkSettings(workspaceId);
  const [error, setError] = useState<string | null>(null);

  if (isError) {
    return <FormAlert message="Couldn’t load Saved settings. Refresh to try again." />;
  }
  if (!settings) {
    return (
      <div aria-busy="true">
        <span className="sr-only">Loading Saved settings…</span>
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className={settingsSectionsClassName}>
      <section
        aria-labelledby={`${id}-title`}
        className="rounded-2xl border bg-card shadow-elevation-1"
      >
        <header className="flex items-start gap-3 border-b px-4 py-4 sm:px-5">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-subtle text-brand"
          >
            <Bookmark className="size-4.5" />
          </span>
          <div className="min-w-0 flex-1 space-y-0.5">
            <h2 id={`${id}-title`} className="text-base font-semibold">
              Link previews
            </h2>
            <p className="text-sm text-pretty text-muted-foreground">
              Fill in a saved link’s name, description, preview image, and site icon from the page
              itself. For this workspace.
            </p>
          </div>
        </header>

        <div className="space-y-5 px-4 py-5 sm:px-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <label htmlFor={`${id}-enabled`} className="text-sm font-medium">
                Fetch link previews
              </label>
              <p id={`${id}-enabled-hint`} className="text-xs text-pretty text-muted-foreground">
                Each link gets a preview when you save it.
              </p>
            </div>
            <Switch
              id={`${id}-enabled`}
              checked={settings.previews_enabled}
              disabled={toggle.isPending}
              aria-describedby={`${id}-enabled-hint`}
              onCheckedChange={(checked) => {
                setError(null);
                toggle
                  .mutateAsync(checked)
                  .catch((reason: unknown) =>
                    setError(describeApiError(reason, "Couldn’t save. Try again.")),
                  );
              }}
            />
          </div>

          <FormAlert message={error} />

          <p className="flex items-start gap-2 text-xs text-pretty text-muted-foreground">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            Your Orbit server, not your browser, visits each page, so the site sees the server’s
            address. It only contacts public web addresses on the standard ports, never your local
            network, and stores the images with your data. Some sites, like Instagram, share little
            or nothing with visitors who aren’t signed in.
          </p>
        </div>
      </section>
    </div>
  );
}
