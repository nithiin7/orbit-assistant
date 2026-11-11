"use client";

import { Clapperboard, ExternalLink, KeyRound } from "lucide-react";
import { type FormEvent, useId, useState } from "react";

import { describeApiError } from "@/api/client";
import { useConfirm } from "@/components/confirm-dialog";
import { FormAlert } from "@/components/form-field";
import {
  PrivacyNote,
  SettingsCard,
  SettingsLoading,
  SettingsSwitch,
} from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveWorkspaceId } from "@/hooks/use-calendar";
import { useWatchlistLookup } from "@/hooks/use-watchlist";
import { settingsSectionsClassName } from "@/lib/settings";

const TMDB_API_SETTINGS = "https://www.themoviedb.org/settings/api";

/** Watchlist settings for the open workspace: the TMDB key behind title lookup. */
export function WatchlistSettings() {
  const workspaceId = useActiveWorkspaceId();
  if (workspaceId === null) {
    return <Skeleton className="h-48 w-full rounded-2xl" />;
  }
  return <LookupSettings key={workspaceId} workspaceId={workspaceId} />;
}

function LookupSettings({ workspaceId }: { workspaceId: string }) {
  const id = useId();
  const { lookup, isError, toggle, saveKey, removeKey } = useWatchlistLookup(workspaceId);
  const { confirm, confirmDialog } = useConfirm();
  const [replacing, setReplacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isError) {
    return <FormAlert message="Couldn’t load watchlist settings. Refresh to try again." />;
  }
  if (!lookup) {
    return <SettingsLoading label="Loading watchlist settings…" className="h-48" />;
  }

  async function run(action: () => Promise<unknown>, fallback: string) {
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(describeApiError(reason, fallback));
    }
  }

  const showKeyForm = !lookup.configured || replacing;

  return (
    <div className={settingsSectionsClassName}>
      <SettingsCard
        titleId={`${id}-title`}
        icon={Clapperboard}
        title="Title lookup"
        description="Search The Movie Database (TMDB) when adding titles, for posters, runtimes, genres, and episode counts. For this workspace."
      >
        {lookup.configured ? (
          <SettingsSwitch
            label="Look up titles"
            hint="Off, you can still add titles by hand. Posters you already have stay."
            checked={lookup.enabled}
            disabled={toggle.isPending}
            onCheckedChange={(checked) =>
              void run(() => toggle.mutateAsync(checked), "Couldn’t save. Try again.")
            }
          />
        ) : null}

        {lookup.configured && !replacing ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/50 px-3.5 py-3">
            <p className="flex items-center gap-2 text-sm">
              <KeyRound aria-hidden="true" className="size-4 text-muted-foreground" />
              <span>
                <span className="font-medium">TMDB key saved</span>
                <span className="text-muted-foreground"> · stored encrypted</span>
              </span>
            </p>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => setReplacing(true)}>
                Replace
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={removeKey.isPending}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() =>
                  void confirm({
                    title: "Remove the TMDB key?",
                    description:
                      "Title lookup turns off. Titles and posters you’ve already added stay.",
                    confirmLabel: "Remove key",
                    destructive: true,
                  }).then(async (ok) => {
                    if (ok) {
                      await run(
                        () => removeKey.mutateAsync(),
                        "Couldn’t remove the key. Try again.",
                      );
                    }
                  })
                }
              >
                Remove
              </Button>
            </div>
          </div>
        ) : null}

        {showKeyForm ? (
          <KeyForm
            replacing={replacing}
            saving={saveKey.isPending}
            onCancel={replacing ? () => setReplacing(false) : null}
            onSave={(apiKey) =>
              run(async () => {
                await saveKey.mutateAsync(apiKey);
                setReplacing(false);
              }, "Couldn’t save the key. Try again.")
            }
          />
        ) : null}

        <FormAlert message={error} />

        <PrivacyNote>
          Only what you search for and TMDB’s own IDs are sent to TMDB. Posters are downloaded by
          your Orbit server, so your browser never contacts TMDB. This product uses the TMDB API but
          is not endorsed or certified by TMDB.
        </PrivacyNote>
      </SettingsCard>
      {confirmDialog}
    </div>
  );
}

function KeyForm({
  replacing,
  saving,
  onSave,
  onCancel,
}: {
  replacing: boolean;
  saving: boolean;
  onSave: (apiKey: string) => Promise<void>;
  onCancel: (() => void) | null;
}) {
  const id = useId();
  const [value, setValue] = useState("");
  const trimmed = value.trim();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (trimmed) void onSave(trimmed);
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {replacing ? null : (
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground marker:text-muted-foreground">
          <li>Create a free account at themoviedb.org.</li>
          <li>
            Open{" "}
            <a
              href={TMDB_API_SETTINGS}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 font-medium text-brand underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              Settings → API
              <ExternalLink aria-hidden="true" className="size-3" />
            </a>{" "}
            and copy the API Read Access Token (or the API key).
          </li>
          <li>Paste it here. Orbit checks it with TMDB before saving.</li>
        </ol>
      )}
      <div className="space-y-1.5">
        <label htmlFor={`${id}-key`} className="block text-sm font-medium">
          {replacing ? "New TMDB key" : "TMDB key"}
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id={`${id}-key`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste your key or token"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="font-mono sm:flex-1"
          />
          <div className="flex gap-2">
            {onCancel ? (
              <Button variant="ghost" disabled={saving} onClick={onCancel}>
                Cancel
              </Button>
            ) : null}
            <Button type="submit" disabled={saving || !trimmed}>
              {saving ? "Checking…" : "Save key"}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
