"use client";

import type { DocumentFolder } from "@orbit/contracts";
import { Cloud, Settings2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { FileBrowser } from "@/components/integrations/file-browser";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useConnections } from "@/hooks/use-integrations";
import { capabilityName, connectionHref } from "@/lib/integrations";
import { folderPath } from "@/utils/folders";

const NO_FOLDER = "none";

/**
 * A connected drive inside Documents: browse and search it, and import files into an Orbit
 * folder. Imports are copies; when the file changes at the provider, its row offers the new
 * version.
 */
export function DrivePanel({
  connectionId,
  folders,
}: {
  connectionId: string;
  folders: readonly DocumentFolder[];
}) {
  const connections = useConnections();
  const [target, setTarget] = useState(NO_FOLDER);

  if (connections.status === "loading") {
    return (
      <div aria-busy="true" className="min-w-0 space-y-3">
        <span className="sr-only">Loading the drive…</span>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }
  if (connections.status === "error") {
    return (
      <p role="alert" className="text-sm text-destructive">
        {connections.message}
      </p>
    );
  }
  const connection = connections.data.connections.find(
    (c) => c.id === connectionId && c.capabilities.includes("files"),
  );
  if (!connection) {
    return (
      <div className="min-w-0 rounded-xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
        This drive isn’t connected any more.{" "}
        <Link href="/settings/integrations" className="font-medium text-brand hover:underline">
          Open integrations
        </Link>
      </div>
    );
  }
  const name = capabilityName(connection.provider, "files");
  const options = [
    { value: NO_FOLDER, label: "No folder" },
    ...folders
      .map((folder) => ({ value: folder.id, label: folderPath(folders, folder.id).join(" / ") }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];

  return (
    <section aria-labelledby="drive-heading" className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <h2
            id="drive-heading"
            className="flex items-center gap-2 text-lg font-semibold tracking-tight"
          >
            <Cloud className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {name}
          </h2>
          <p className="truncate text-sm text-muted-foreground">{connection.account_email}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Import to</span>
          <Select
            aria-label="Import into folder"
            className="w-48"
            value={options.some((o) => o.value === target) ? target : NO_FOLDER}
            options={options}
            onValueChange={setTarget}
          />
          <Link
            href={connectionHref(connection.id)}
            aria-label={`${name} settings`}
            className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Settings2 className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
      <p className="text-sm text-pretty text-muted-foreground">
        Importing keeps a copy in Documents. Orbit never changes your files in {name}; when one
        changes there, import its new version here.
      </p>
      <FileBrowser
        key={connection.id}
        connection={connection}
        importFolderId={target === NO_FOLDER ? null : target}
        folders={folders}
      />
    </section>
  );
}
