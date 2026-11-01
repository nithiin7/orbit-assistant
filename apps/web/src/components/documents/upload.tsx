"use client";

import type { DocumentSettings } from "@orbit/contracts";
import { CheckCircle2, CircleAlert, Loader2, RotateCcw, UploadCloud, X } from "lucide-react";
import { type DragEvent, type ReactNode, useRef, useState } from "react";

import { describeApiError } from "@/api/client";
import type { UploadOptions } from "@/api/documents";
import { Button } from "@/components/ui/button";
import { useDocumentMutations } from "@/hooks/use-documents";
import { formatFileSize } from "@/lib/documents";
import { cn } from "@/utils/common";

export type UploadItem = {
  id: string;
  file: File;
  status: "queued" | "uploading" | "done" | "error";
  message: string | null;
  documentId: string | null;
};

/** Why a file can't be uploaded, checked before sending it; the API checks again. */
export function precheck(file: File, settings: DocumentSettings | undefined): string | null {
  if (file.size === 0) return "The file is empty.";
  if (!settings) return null;
  const extension = file.name.includes(".") ? (file.name.split(".").pop() ?? "") : "";
  if (!settings.accepted_extensions.includes(extension.toLowerCase())) {
    return `That type of file isn’t accepted. Use ${settings.accepted_extensions
      .map((item) => item.toUpperCase())
      .join(", ")}.`;
  }
  if (file.size > settings.max_bytes) {
    return `Files must be at most ${formatFileSize(settings.max_bytes)}.`;
  }
  return null;
}

let counter = 0;

/**
 * Uploads files one at a time, each its own document, with a status per file. Failures (a
 * rejected type, a lost connection) are shown on the file and can be retried; nothing half-saved
 * is left behind, because the API keeps the file only once its document is saved.
 */
export function useUploadQueue(
  workspaceId: string,
  settings: DocumentSettings | undefined,
  options: UploadOptions,
) {
  const { upload } = useDocumentMutations(workspaceId);
  const [items, setItems] = useState<UploadItem[]>([]);

  const change = (id: string, patch: Partial<UploadItem>) =>
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  const run = async (batch: UploadItem[]) => {
    for (const item of batch) {
      if (item.status === "error") continue;
      change(item.id, { status: "uploading", message: null });
      try {
        const detail = await upload.mutateAsync({ file: item.file, options });
        change(item.id, { status: "done", documentId: detail.document.id });
      } catch (reason) {
        change(item.id, {
          status: "error",
          message: describeApiError(reason, "Couldn’t upload this file. Try again."),
        });
      }
    }
  };

  const add = (files: Iterable<File>) => {
    const batch = [...files].map((file): UploadItem => {
      const problem = precheck(file, settings);
      counter += 1;
      return {
        id: `upload-${counter}`,
        file,
        status: problem ? "error" : "queued",
        message: problem,
        documentId: null,
      };
    });
    if (batch.length === 0) return;
    setItems((current) => [...current, ...batch]);
    void run(batch);
  };

  const retry = (item: UploadItem) => {
    // A file the checks refuse would only fail again.
    const problem = precheck(item.file, settings);
    if (problem) {
      change(item.id, { status: "error", message: problem });
      return;
    }
    const again: UploadItem = { ...item, status: "queued", message: null };
    change(item.id, again);
    void run([again]);
  };

  const dismiss = (id: string) => setItems((current) => current.filter((item) => item.id !== id));
  const clearFinished = () =>
    setItems((current) => current.filter((item) => item.status !== "done"));

  return { items, add, retry, dismiss, clearFinished };
}

/** A region that takes dropped files, highlighted while they're over it. */
export function DropZone({
  onFiles,
  children,
  className,
}: {
  onFiles: (files: File[]) => void;
  children: ReactNode;
  className?: string;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");
  return (
    <div
      className={cn("relative", className)}
      onDragEnter={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(event) => {
        if (hasFiles(event)) event.preventDefault();
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        depth.current = 0;
        setOver(false);
        onFiles([...event.dataTransfer.files]);
      }}
    >
      {children}
      {over ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-brand bg-brand-subtle/70"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-brand">
            <UploadCloud className="size-5" />
            Drop to upload
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** The files being uploaded, each with its state, and a way to retry or dismiss. */
export function UploadList({
  items,
  onRetry,
  onDismiss,
  onOpen,
  onClear,
}: {
  items: readonly UploadItem[];
  onRetry: (item: UploadItem) => void;
  onDismiss: (id: string) => void;
  onOpen: (documentId: string) => void;
  onClear: () => void;
}) {
  if (items.length === 0) return null;
  const done = items.filter((item) => item.status === "done").length;
  const busy = items.some((item) => item.status === "uploading" || item.status === "queued");
  return (
    <section aria-label="Uploads" className="rounded-xl border bg-card shadow-elevation-1">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
        <p className="text-sm font-medium" role="status">
          {busy
            ? `Uploading ${done + 1} of ${items.length}…`
            : `${done} of ${items.length} uploaded`}
        </p>
        {!busy ? (
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear finished
          </Button>
        ) : null}
      </div>
      <ul className="divide-y">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 px-4 py-2 text-sm">
            {item.status === "uploading" || item.status === "queued" ? (
              <Loader2
                className={cn(
                  "size-4 shrink-0 text-muted-foreground",
                  item.status === "uploading" && "animate-spin motion-reduce:animate-none",
                )}
                aria-hidden="true"
              />
            ) : item.status === "done" ? (
              <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
            ) : (
              <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              {item.status === "done" && item.documentId ? (
                <button
                  type="button"
                  className="block max-w-full truncate rounded-sm text-left font-medium outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => item.documentId && onOpen(item.documentId)}
                >
                  {item.file.name}
                </button>
              ) : (
                <p className="truncate font-medium">{item.file.name}</p>
              )}
              <p
                className={cn(
                  "text-xs",
                  item.status === "error" ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {item.status === "error"
                  ? item.message
                  : item.status === "done"
                    ? "Uploaded"
                    : item.status === "uploading"
                      ? `Uploading · ${formatFileSize(item.file.size)}`
                      : "Waiting"}
              </p>
            </div>
            {item.status === "error" ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={`Retry “${item.file.name}”`}
                onClick={() => onRetry(item)}
              >
                <RotateCcw aria-hidden="true" />
              </Button>
            ) : null}
            {item.status === "error" || item.status === "done" ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={`Dismiss “${item.file.name}”`}
                onClick={() => onDismiss(item.id)}
              >
                <X aria-hidden="true" />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
