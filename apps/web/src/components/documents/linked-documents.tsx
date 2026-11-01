"use client";

import type { DocumentLinkKind } from "@orbit/contracts";
import { Link2, X } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { createPortal } from "react-dom";

import { describeApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { useDocumentList, useDocumentMutations } from "@/hooks/use-documents";
import { documentsHref } from "@/lib/documents";

import { DocumentPickerDialog } from "./document-dialogs";
import { FileIcon } from "./document-meta";

type LinkedDocumentsProps = {
  workspaceId: string;
  kind: DocumentLinkKind;
  recordId: string;
  /** Shown above the list; headings follow the host's own sections. */
  heading?: string;
  readOnly?: boolean;
};

/**
 * Documents linked to a record in another module (a note, task, event, or finance record),
 * with links to open them and a picker to link more. The files stay in Documents; nothing is
 * copied.
 */
export function LinkedDocuments({
  workspaceId,
  kind,
  recordId,
  heading = "Documents",
  readOnly = false,
}: LinkedDocumentsProps) {
  const { state } = useDocumentList(workspaceId, {
    linked_kind: kind,
    linked_id: recordId,
    state: "any",
    sort: "title",
    limit: 50,
  });
  const mutations = useDocumentMutations(workspaceId);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingId = useId();
  const documents = state.status === "success" ? state.data.documents : [];

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 id={headingId} className="text-sm font-medium">
          {heading}
        </h3>
        {!readOnly ? (
          <Button variant="ghost" size="sm" onClick={() => setPicking(true)}>
            <Link2 aria-hidden="true" />
            Link document
          </Button>
        ) : null}
      </div>
      {state.status === "loading" ? (
        <p className="text-xs text-muted-foreground">Loading documents…</p>
      ) : state.status === "error" ? (
        <p role="alert" className="text-xs text-destructive">
          {state.message}
        </p>
      ) : documents.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No documents linked. Link a receipt, policy, or agreement from your vault.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {documents.map((document) => (
            <li key={document.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
              <FileIcon file={document.file} className="size-7" />
              <Link
                href={documentsHref({ documentId: document.id })}
                className="min-w-0 flex-1 truncate rounded-sm font-medium outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-ring"
              >
                {document.title}
              </Link>
              {!readOnly ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={`Unlink “${document.title}”`}
                  onClick={() => {
                    setError(null);
                    mutations.unlink
                      .mutateAsync({ documentId: document.id, kind, id: recordId })
                      .catch((reason: unknown) =>
                        setError(describeApiError(reason, "Couldn’t unlink the document.")),
                      );
                  }}
                >
                  <X aria-hidden="true" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {/* In a portal: hosts such as the task dialog are forms, and forms can't nest. */}
      {picking
        ? createPortal(
            <DocumentPickerDialog
              workspaceId={workspaceId}
              linked={new Set(documents.map((document) => document.id))}
              onClose={() => setPicking(false)}
              onPick={(documentId) =>
                mutations.link.mutateAsync({ documentId, kind, id: recordId })
              }
            />,
            window.document.body,
          )
        : null}
    </section>
  );
}
