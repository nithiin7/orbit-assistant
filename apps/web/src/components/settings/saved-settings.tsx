"use client";

import { Bookmark } from "lucide-react";
import { useId, useState } from "react";

import { describeApiError } from "@/api/client";
import { FormAlert } from "@/components/form-field";
import {
  PrivacyNote,
  SettingsCard,
  SettingsLoading,
  SettingsSwitch,
} from "@/components/settings/settings-card";
import { Skeleton } from "@/components/ui/skeleton";
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
    return <SettingsLoading label="Loading Saved settings…" className="h-48" />;
  }

  return (
    <div className={settingsSectionsClassName}>
      <SettingsCard
        titleId={`${id}-title`}
        icon={Bookmark}
        title="Link previews"
        description="Fill in a saved link’s name, description, preview image, and site icon from the page itself. For this workspace."
      >
        <SettingsSwitch
          label="Fetch link previews"
          hint="Each link gets a preview when you save it."
          checked={settings.previews_enabled}
          disabled={toggle.isPending}
          onCheckedChange={(checked) => {
            setError(null);
            toggle
              .mutateAsync(checked)
              .catch((reason: unknown) =>
                setError(describeApiError(reason, "Couldn’t save. Try again.")),
              );
          }}
        />

        <FormAlert message={error} />

        <PrivacyNote>
          Your Orbit server, not your browser, visits each page, so the site sees the server’s
          address. It only contacts public web addresses on the standard ports, never your local
          network, and stores the images with your data. Some sites, like Instagram, share little or
          nothing with visitors who aren’t signed in.
        </PrivacyNote>
      </SettingsCard>
    </div>
  );
}
