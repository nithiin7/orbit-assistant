"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Copy, FolderOpen } from "lucide-react";
import { useCallback, useState } from "react";

import { describeApiError } from "@/api/client";
import { revealStorageLocation, storageLocationOptions } from "@/api/storage";
import { FormAlert } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { queryResource } from "@/hooks/query-resource";
import { revealLabel } from "@/lib/storage";
import { useAuth } from "@/providers/auth";

/**
 * Where the SQLite database lives, with a button that opens its folder. The API does the
 * opening, on its own machine, which in local mode is this computer. Renders nothing when the
 * API doesn't share the location (cloud mode, or a production server).
 */
export function DatabaseLocation() {
  const { withToken } = useAuth();
  const location = useQuery(storageLocationOptions(withToken));
  const state = queryResource(location, "Couldn’t find where your data is stored.");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const { mutateAsync: revealFolder, isPending: revealing } = useMutation({
    mutationFn: () => withToken((token) => revealStorageLocation(token)),
  });

  const reveal = useCallback(async () => {
    setError(null);
    setMessage(null);
    try {
      await revealFolder();
      setMessage("Opened on the computer running the Orbit API.");
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t open the folder. Try again."));
    }
  }, [revealFolder]);

  const copy = useCallback(async (path: string) => {
    setError(null);
    try {
      await navigator.clipboard.writeText(path);
      setMessage("Path copied.");
    } catch {
      setError("Couldn’t copy the path. Select it and copy it instead.");
    }
  }, []);

  if (state.status === "loading") {
    return (
      <div aria-busy="true" className="space-y-2 rounded-xl border bg-card p-4">
        <span className="sr-only">Loading the database location…</span>
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-9" />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div role="alert" className="space-y-3 rounded-xl border bg-card p-4 text-sm">
        <p>{state.message}</p>
        <Button variant="outline" size="sm" onClick={() => void location.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const path = state.data.database_path;
  if (!path) return null;

  return (
    <section
      aria-labelledby="database-location-heading"
      className="space-y-3 rounded-xl border bg-card p-4"
    >
      <h2 id="database-location-heading" className="text-sm font-medium">
        Database file
      </h2>
      <code className="block rounded-md bg-muted px-3 py-2 font-mono text-xs break-all">
        {path}
      </code>
      <div className="flex flex-wrap items-center gap-2">
        {state.data.can_reveal ? (
          <Button variant="outline" size="sm" disabled={revealing} onClick={() => void reveal()}>
            <FolderOpen aria-hidden="true" />
            {revealing ? "Opening…" : revealLabel(navigator.userAgent)}
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={() => void copy(path)}>
          <Copy aria-hidden="true" />
          Copy path
        </Button>
      </div>
      <FormAlert message={error} />
      <p role="status" className="text-sm text-muted-foreground">
        {message}
      </p>
    </section>
  );
}
