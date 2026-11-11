"use client";

import type { DocumentFolder, IntegrationConnection, RemoteFile } from "@orbit/contracts";
import {
  ChevronRight,
  CircleCheck,
  ExternalLink,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderInput,
  type LucideIcon,
  MoreHorizontal,
  Presentation,
  Search,
} from "lucide-react";
import Link from "next/link";
import { type FormEvent, useState } from "react";

import { describeApiError } from "@/api/client";
import { FolderPickerDialog } from "@/components/notes/organize-dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Menu } from "@/components/ui/menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useConnectionMutations, useRemoteFiles } from "@/hooks/use-integrations";
import { capabilityName, formatFileSize, linkedRecordHref } from "@/lib/integrations";
import { cn } from "@/utils/common";

import { ErrorText } from "./section";

type Crumb = { id: string; name: string };

/** An icon for a provider's MIME type, so documents, sheets, and images read at a glance. */
function fileIcon(mimeType: string): { icon: LucideIcon; tone: string } {
  if (mimeType.startsWith("image/")) return { icon: FileImage, tone: "text-event-violet" };
  if (/spreadsheet|excel|csv/.test(mimeType))
    return { icon: FileSpreadsheet, tone: "text-success" };
  if (/presentation|powerpoint/.test(mimeType)) return { icon: Presentation, tone: "text-warning" };
  if (/pdf|document|word|text/.test(mimeType)) return { icon: FileText, tone: "text-brand" };
  return { icon: File, tone: "text-muted-foreground" };
}

/**
 * Browse and search the account's files, and import chosen ones into Documents (into
 * `importFolderId` when given). With `folders`, each file can also be imported straight into
 * a folder picked for it. Orbit keeps a copy; the file at the provider is never changed.
 */
export function FileBrowser({
  connection,
  importFolderId = null,
  folders,
}: {
  connection: IntegrationConnection;
  importFolderId?: string | null;
  folders?: readonly DocumentFolder[];
}) {
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
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {files.data.files.map((file) => (
            <FileRow
              key={file.id}
              connection={connection}
              file={file}
              importFolderId={importFolderId}
              folders={folders}
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
  importFolderId,
  folders,
  onOpen,
}: {
  connection: IntegrationConnection;
  file: RemoteFile;
  importFolderId: string | null;
  folders: readonly DocumentFolder[] | undefined;
  onOpen: () => void;
}) {
  const actions = useConnectionMutations(connection.id);
  const [error, setError] = useState<string | null>(null);
  const [choosingFolder, setChoosingFolder] = useState(false);
  const imported = file.imported;
  const fail = (fallback: string) => (cause: unknown) =>
    setError(describeApiError(cause, fallback));

  const { icon: Icon, tone } = fileIcon(file.mime_type);
  const openAtProvider = file.url ? (
    <a
      href={file.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open “${file.name}” in ${capabilityName(connection.provider, "files")}`}
      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ExternalLink className="size-4" aria-hidden="true" />
    </a>
  ) : null;

  if (file.folder) {
    return (
      <li>
        <button
          type="button"
          onClick={onOpen}
          className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand"
          >
            <Folder className="size-4" />
          </span>
          <span className="flex-1 truncate font-medium">{file.name}</span>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
        </button>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted"
      >
        <Icon className={cn("size-4", tone)} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
          <span className="truncate">{file.name}</span>
          {imported && imported.status !== "update_available" && imported.status !== "missing" ? (
            <CircleCheck className="size-3.5 shrink-0 text-success" aria-label="Imported" />
          ) : null}
        </p>
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
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="soft"
            disabled={actions.importFile.isPending}
            onClick={() => {
              setError(null);
              actions.importFile.mutate(
                { fileId: file.id, folderId: importFolderId },
                { onError: fail("Couldn’t import this file.") },
              );
            }}
          >
            Import
          </Button>
          {folders ? (
            <Menu
              aria-label={`More import options for “${file.name}”`}
              variant="ghost"
              size="icon"
              chevron={false}
              align="end"
              className="size-8"
              items={[
                {
                  id: "import-to",
                  label: "Import to folder…",
                  icon: FolderInput,
                  disabled: actions.importFile.isPending,
                  onSelect: () => setChoosingFolder(true),
                },
              ]}
            >
              <MoreHorizontal aria-hidden="true" />
            </Menu>
          ) : null}
        </div>
      )}
      {openAtProvider}
      {choosingFolder && folders ? (
        <FolderPickerDialog
          title={`Import “${file.name}”`}
          folders={folders}
          current={importFolderId}
          top="No folder"
          submitLabel="Import"
          onClose={() => setChoosingFolder(false)}
          onSubmit={(folderId) => {
            setError(null);
            return actions.importFile.mutateAsync({ fileId: file.id, folderId });
          }}
        />
      ) : null}
    </li>
  );
}
