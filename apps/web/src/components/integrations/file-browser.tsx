"use client";

import type { IntegrationConnection, RemoteFile } from "@orbit/contracts";
import { ChevronRight, FileText, Folder, Search } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useState } from "react";

import { describeApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useConnectionMutations, useRemoteFiles } from "@/hooks/use-integrations";
import { capabilityName, formatFileSize, linkedRecordHref } from "@/lib/integrations";

import { ErrorText } from "./section";

type Crumb = { id: string; name: string };

/** Browse and search the account's files, and import chosen ones into Documents. */
export function FileBrowser({ connection }: { connection: IntegrationConnection }) {
  const [path, setPath] = useState<Crumb[]>([]);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const folder = path.at(-1);
  const files = useRemoteFiles(connection.id, {
    folderId: search ? undefined : folder?.id,
    search: search || undefined,
  });
  const root = capabilityName(connection.provider, "files");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSearch(draft.trim());
  };

  return (
    <div className="space-y-4">
      <form role="search" onSubmit={submit} className="flex gap-2">
        <Input
          aria-label="Search files"
          placeholder="Search files by name"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="ghost" size="icon" aria-label="Search">
          <Search className="size-4" aria-hidden="true" />
        </Button>
      </form>
      {search ? (
        <p className="text-sm text-muted-foreground">
          Results for “{search}”.{" "}
          <button
            type="button"
            className="font-medium text-brand hover:underline"
            onClick={() => {
              setSearch("");
              setDraft("");
            }}
          >
            Clear search
          </button>
        </p>
      ) : (
        <nav aria-label="Folder" className="flex flex-wrap items-center gap-1 text-sm">
          <button
            type="button"
            className="rounded px-1 font-medium text-brand hover:underline"
            onClick={() => setPath([])}
            aria-current={path.length === 0 ? "location" : undefined}
          >
            {root}
          </button>
          {path.map((crumb, index) => (
            <span key={crumb.id} className="flex items-center gap-1">
              <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <button
                type="button"
                className="rounded px-1 hover:underline"
                onClick={() => setPath(path.slice(0, index + 1))}
                aria-current={index === path.length - 1 ? "location" : undefined}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </nav>
      )}
      {files.status === "loading" ? (
        <Skeleton className="h-32 w-full rounded-xl" />
      ) : files.status === "error" ? (
        <ErrorText message={files.message} />
      ) : files.data.files.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {search ? "No files match." : "This folder is empty."}
        </p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {files.data.files.map((file) => (
            <FileRow
              key={file.id}
              connection={connection}
              file={file}
              onOpen={() => setPath([...path, { id: file.id, name: file.name }])}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function FileRow({
  connection,
  file,
  onOpen,
}: {
  connection: IntegrationConnection;
  file: RemoteFile;
  onOpen: () => void;
}) {
  const actions = useConnectionMutations(connection.id);
  const [error, setError] = useState<string | null>(null);
  const imported = file.imported;
  const fail = (fallback: string) => (cause: unknown) =>
    setError(describeApiError(cause, fallback));

  if (file.folder) {
    return (
      <li>
        <button
          type="button"
          onClick={onOpen}
          className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <Folder className="size-4 text-brand" aria-hidden="true" />
          <span className="flex-1 truncate font-medium">{file.name}</span>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
        </button>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{file.name}</p>
        <p className="text-xs text-muted-foreground">
          {[
            formatFileSize(file.size),
            file.modified_at ? new Date(file.modified_at).toLocaleDateString() : "",
          ]
            .filter(Boolean)
            .join(" · ")}
          {imported?.status === "update_available" ? " · Changed since you imported it" : ""}
          {imported?.status === "missing" ? " · No longer available there" : ""}
        </p>
        <ErrorText message={error} />
      </div>
      {imported ? (
        <div className="flex items-center gap-2">
          {imported.status === "update_available" ? (
            <Button
              size="sm"
              variant="soft"
              disabled={actions.updateFile.isPending}
              onClick={() => {
                setError(null);
                actions.updateFile.mutate(imported.id, { onError: fail("Couldn’t update it.") });
              }}
            >
              Import new version
            </Button>
          ) : null}
          <Link
            href={linkedRecordHref("document", imported.entity_id)}
            className="text-sm font-medium text-brand hover:underline"
          >
            In Documents
          </Link>
        </div>
      ) : (
        <Button
          size="sm"
          variant="soft"
          disabled={actions.importFile.isPending}
          onClick={() => {
            setError(null);
            actions.importFile.mutate(file.id, { onError: fail("Couldn’t import this file.") });
          }}
        >
          Import
        </Button>
      )}
    </li>
  );
}
