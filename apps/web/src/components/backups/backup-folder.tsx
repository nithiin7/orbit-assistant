"use client";

import { Copy, FolderOpen } from "lucide-react";
import { useState } from "react";

import { describeApiError } from "@/api/client";
import { FormAlert } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { useRevealBackupsFolder } from "@/hooks/use-backups";
import { revealLabel } from "@/lib/storage";

/**
 * Where this workspace's backups are kept, with buttons to open the folder and copy its path.
 * The API opens the folder on its own machine, which in local mode is this computer.
 */
export function BackupFolder({ folder, canReveal }: { folder: string; canReveal: boolean }) {
  const reveal = useRevealBackupsFolder();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function open() {
    setError(null);
    setMessage(null);
    try {
      await reveal.mutateAsync();
      setMessage("Opened on the computer running the Orbit API.");
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t open the folder. Try again."));
    }
  }

  async function copy() {
    setError(null);
    try {
      await navigator.clipboard.writeText(folder);
      setMessage("Path copied.");
    } catch {
      setError("Couldn’t copy the path. Select it and copy it instead.");
    }
  }

  return (
    <section
      aria-labelledby="backup-folder-heading"
      className="space-y-3 rounded-xl border bg-muted/30 p-4"
    >
      <div className="space-y-0.5">
        <h3 id="backup-folder-heading" className="text-sm font-medium">
          Where backups are kept
        </h3>
        <p className="text-xs text-pretty text-muted-foreground">
          Each backup is an <span className="font-mono">.orbit-backup</span> file in this folder. To
          restore one, choose it from here under Restore and import.
        </p>
      </div>
      <code className="block rounded-md border bg-card px-3 py-2 font-mono text-xs break-all">
        {folder}
      </code>
      <div className="flex flex-wrap items-center gap-2">
        {canReveal ? (
          <Button
            variant="outline"
            size="sm"
            disabled={reveal.isPending}
            onClick={() => void open()}
          >
            <FolderOpen aria-hidden="true" />
            {reveal.isPending ? "Opening…" : revealLabel(navigator.userAgent)}
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={() => void copy()}>
          <Copy aria-hidden="true" />
          Copy path
        </Button>
      </div>
      <FormAlert message={error} />
      <p role="status" className="text-xs text-muted-foreground empty:hidden">
        {message}
      </p>
    </section>
  );
}
