"use client";

import { MapPinned } from "lucide-react";
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
import { useActiveWorkspaceId } from "@/hooks/use-calendar";
import { usePlaceSettings } from "@/hooks/use-places";
import { settingsSectionsClassName } from "@/lib/settings";

/** Places settings for the open workspace: whether the map goes online. */
export function PlacesSettings() {
  const workspaceId = useActiveWorkspaceId();
  if (workspaceId === null) {
    return <Skeleton className="h-48 w-full rounded-2xl" />;
  }
  return <OnlineMapSettings key={workspaceId} workspaceId={workspaceId} />;
}

function OnlineMapSettings({ workspaceId }: { workspaceId: string }) {
  const id = useId();
  const { settings, isError, toggle } = usePlaceSettings(workspaceId);
  const [error, setError] = useState<string | null>(null);

  if (isError) {
    return <FormAlert message="Couldn’t load Places settings. Refresh to try again." />;
  }
  if (!settings) {
    return <SettingsLoading label="Loading Places settings…" className="h-48" />;
  }

  const allowed = settings.online_maps_allowed;

  return (
    <div className={settingsSectionsClassName}>
      <SettingsCard
        titleId={`${id}-title`}
        icon={MapPinned}
        title="Online maps"
        description="Show streets and cities on the map, and find places by name so they get a pin. For this workspace."
      >
        <SettingsSwitch
          label="Use online maps and place search"
          hint={
            allowed
              ? "Off, Places shows a world map drawn in your browser, and you pick each place’s country yourself."
              : "This Orbit server keeps maps offline."
          }
          checked={settings.online_maps}
          disabled={toggle.isPending || (!allowed && !settings.online_maps)}
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
          Map tiles come from OpenFreeMap, so it sees your browser’s address and the areas you look
          at. Place search goes through your Orbit server to OpenStreetMap’s Nominatim, which sees
          only what you type. Your saved places never leave Orbit.
        </PrivacyNote>
      </SettingsCard>
    </div>
  );
}
