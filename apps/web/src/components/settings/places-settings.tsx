"use client";

import { MapPinned, ShieldCheck } from "lucide-react";
import { useId, useState } from "react";

import { describeApiError } from "@/api/client";
import { FormAlert } from "@/components/form-field";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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
    return (
      <div aria-busy="true">
        <span className="sr-only">Loading Places settings…</span>
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }

  const allowed = settings.online_maps_allowed;

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
            <MapPinned className="size-4.5" />
          </span>
          <div className="min-w-0 flex-1 space-y-0.5">
            <h2 id={`${id}-title`} className="text-base font-semibold">
              Online maps
            </h2>
            <p className="text-sm text-pretty text-muted-foreground">
              Show streets and cities on the map, and find places by name so they get a pin. For
              this workspace.
            </p>
          </div>
        </header>

        <div className="space-y-5 px-4 py-5 sm:px-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <label htmlFor={`${id}-enabled`} className="text-sm font-medium">
                Use online maps and place search
              </label>
              <p id={`${id}-enabled-hint`} className="text-xs text-pretty text-muted-foreground">
                {allowed
                  ? "Off, Places shows a world map drawn in your browser, and you pick each place’s country yourself."
                  : "This Orbit server keeps maps offline."}
              </p>
            </div>
            <Switch
              id={`${id}-enabled`}
              checked={settings.online_maps}
              disabled={toggle.isPending || (!allowed && !settings.online_maps)}
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
            Map tiles come from OpenFreeMap, so it sees your browser’s address and the areas you
            look at. Place search goes through your Orbit server to OpenStreetMap’s Nominatim, which
            sees only what you type. Your saved places never leave Orbit.
          </p>
        </div>
      </section>
    </div>
  );
}
