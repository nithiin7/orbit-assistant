"use client";

import type { DocumentFile } from "@orbit/contracts";
import { useQuery } from "@tanstack/react-query";
import { Download, FileQuestion } from "lucide-react";
import { useEffect, useRef } from "react";

import { describeApiError } from "@/api/client";
import { documentKeys } from "@/api/documents";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocumentMutations } from "@/hooks/use-documents";
import { formatFileSize, previewKind } from "@/lib/documents";

/** Text previews show the start of a file; the rest is a download away. */
const TEXT_PREVIEW_CHARACTERS = 100_000;

type PreviewProps = {
  workspaceId: string;
  documentId: string;
  file: DocumentFile;
  title: string;
  onDownload: () => void;
};

/**
 * The current file, shown in the app when it's a PDF, an image, or text. The bytes are fetched
 * with the session's token (there is no public URL) and shown from a local object URL, typed as
 * the API detected them, so nothing uploaded runs as a page: images render as images, text as
 * text nodes, and PDFs in the browser's PDF viewer. Other files show their details and a download.
 */
export function DocumentPreview({
  workspaceId,
  documentId,
  file,
  title,
  onDownload,
}: PreviewProps) {
  const kind = previewKind(file);
  const { download } = useDocumentMutations(workspaceId);
  const result = useQuery({
    queryKey: [...documentKeys.all(workspaceId), "file", documentId, file.version_id] as const,
    queryFn: async () => {
      const blob = await download(documentId, file.version_id);
      // Use the detected type, whatever the response said.
      const typed = new Blob([blob], { type: file.content_type });
      return kind === "text"
        ? { blob: typed, text: (await typed.text()).slice(0, TEXT_PREVIEW_CHARACTERS) }
        : { blob: typed, text: null };
    },
    enabled: kind !== null,
    staleTime: Infinity,
    gcTime: 60_000,
  });

  if (kind === null) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-card/40 px-6 py-12 text-center">
        <FileQuestion className="size-8 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-sm font-medium">No preview for {file.extension.toUpperCase()} files</p>
          <p className="text-xs text-muted-foreground">
            {file.filename} · {formatFileSize(file.size_bytes)}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onDownload}>
          <Download aria-hidden="true" />
          Download to open
        </Button>
      </div>
    );
  }
  if (result.isError) {
    return (
      <div role="alert" className="space-y-3 rounded-xl border bg-card p-4 text-sm">
        <p>{describeApiError(result.error, "Couldn’t load the preview.")}</p>
        <Button variant="outline" size="sm" onClick={() => void result.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  if (!result.data) {
    return (
      <div aria-busy="true" aria-label="Loading preview">
        <Skeleton className="h-[28rem] w-full rounded-xl" />
      </div>
    );
  }
  if (kind === "text") {
    return (
      <pre
        tabIndex={0}
        aria-label={`Contents of ${title}`}
        className="max-h-[32rem] overflow-auto rounded-xl border bg-card p-4 font-mono text-xs whitespace-pre-wrap outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {result.data.text}
      </pre>
    );
  }
  return <BlobView blob={result.data.blob} kind={kind} title={title} />;
}

/** Shows a blob through an object URL, revoked when the blob changes or the view goes away. */
function BlobView({ blob, kind, title }: { blob: Blob; kind: "pdf" | "image"; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const image = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const url = URL.createObjectURL(blob);
    if (frame.current) frame.current.src = url;
    if (image.current) image.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  if (kind === "image") {
    return (
      <div className="flex justify-center overflow-hidden rounded-xl border bg-muted/30 p-2">
        {/* An object URL can't go through the Next.js image loader. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={image} alt={title} className="max-h-[36rem] max-w-full object-contain" />
      </div>
    );
  }
  return (
    <iframe
      ref={frame}
      title={`Preview of ${title}`}
      className="h-[36rem] w-full rounded-xl border bg-card"
    />
  );
}
