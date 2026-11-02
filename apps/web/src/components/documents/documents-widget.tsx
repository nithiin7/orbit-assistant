"use client";

import type { DocumentSummary } from "@orbit/contracts";
import { FileText, FileUp, FolderLock, Star } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  WidgetBody,
  WidgetCard,
  WidgetEmpty,
  WidgetTabs,
} from "@/components/dashboard/widget-card";
import { buttonVariants } from "@/components/ui/button";
import { useActiveWorkspaceId } from "@/hooks/use-calendar";
import { useDocumentList, useDocumentOverview } from "@/hooks/use-documents";
import { documentsHref } from "@/lib/documents";
import { cn } from "@/utils/common";
import { formatCalendarDate, localDateString } from "@/utils/dates";

type Shelf = "attention" | "favorites" | "recent";

const SHOWN = 5;

/**
 * Documents that need attention (expired, then expiring within 90 days), favorites, and
 * recently opened ones, for the dashboard. Only titles and expiry dates show; each opens the
 * document in the vault, which applies its own access rules.
 */
export function DocumentsWidget() {
  const workspaceId = useActiveWorkspaceId();
  const [shelf, setShelf] = useState<Shelf>("attention");
  const overview = useDocumentOverview(workspaceId);
  const recent = useDocumentList(workspaceId, { sort: "recent", limit: SHOWN }, shelf === "recent");
  const counts = overview.state.status === "success" ? overview.state.data.counts : undefined;
  const attention = counts ? counts.expired + counts.expiring_90 : undefined;

  return (
    <WidgetCard
      title="Documents"
      icon={FolderLock}
      href={documentsHref({})}
      linkLabel="Open documents"
      busy={overview.state.status === "loading"}
      actions={
        <Link
          href={`${documentsHref({ view: "all" })}&upload=1`}
          className={buttonVariants({ variant: "soft", size: "sm" })}
        >
          <FileUp aria-hidden="true" />
          Upload
        </Link>
      }
    >
      <div className="px-5 pt-4">
        <WidgetTabs
          label="Show documents"
          options={[
            { value: "attention", label: "Expiring", count: attention },
            { value: "favorites", label: "Favorites" },
            { value: "recent", label: "Recent" },
          ]}
          value={shelf}
          onChange={setShelf}
        />
      </div>
      {shelf === "recent" ? (
        <WidgetBody resource={recent.state} reload={recent.reload} label="recent documents">
          {(data) => <DocumentLines documents={data.documents} empty="Nothing opened yet." />}
        </WidgetBody>
      ) : (
        <WidgetBody resource={overview.state} reload={overview.reload} label="documents">
          {(data) =>
            shelf === "attention" ? (
              <DocumentLines
                documents={[...data.expired, ...data.expiring].slice(0, SHOWN)}
                empty="Nothing expires in the next 90 days."
                showExpiry
              />
            ) : (
              <DocumentLines documents={data.favorites} empty="No favorite documents yet." />
            )
          }
        </WidgetBody>
      )}
    </WidgetCard>
  );
}

function DocumentLines({
  documents,
  empty,
  showExpiry = false,
}: {
  documents: readonly DocumentSummary[];
  empty: string;
  showExpiry?: boolean;
}) {
  if (documents.length === 0) return <WidgetEmpty>{empty}</WidgetEmpty>;
  const year = Number(localDateString().slice(0, 4));
  return (
    <ul className="space-y-1 p-5 pt-3">
      {documents.slice(0, SHOWN).map((document) => (
        <li key={document.id}>
          <Link
            href={documentsHref({ documentId: document.id })}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-sm">{document.title}</span>
            {document.is_favorite ? (
              <Star className="size-3 shrink-0 text-warning" aria-label="Favorite" />
            ) : null}
            {showExpiry && document.expiry_date ? (
              <span
                className={cn(
                  "shrink-0 text-xs",
                  document.expiry_status === "expired"
                    ? "font-medium text-destructive"
                    : "text-muted-foreground",
                )}
              >
                {document.expiry_status === "expired" ? "Expired " : "Expires "}
                {formatCalendarDate(document.expiry_date, { omitYearIn: year })}
              </span>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
