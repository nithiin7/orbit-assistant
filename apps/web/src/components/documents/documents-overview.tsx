"use client";

import type { DocumentOverview, DocumentSummary } from "@orbit/contracts";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { type DocumentsLocation, formatFileSize } from "@/lib/documents";
import { cn } from "@/utils/common";

import { CATEGORY_ICONS, ExpiryChip, FileIcon } from "./document-meta";

type OverviewProps = {
  overview: DocumentOverview;
  today: string;
  onOpen: (documentId: string) => void;
  onNavigate: (location: Partial<DocumentsLocation>) => void;
};

/** What needs attention first (expired and expiring), then recent and favorite documents. */
export function DocumentsOverview({ overview, today, onOpen, onNavigate }: OverviewProps) {
  const { counts } = overview;
  const used = overview.categories.filter((category) => category.document_count > 0);
  const largest = Math.max(1, ...used.map((category) => category.document_count));
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 @2xl/list:grid-cols-4">
        <Stat label="Documents" value={counts.all} detail={formatFileSize(counts.total_bytes)} />
        <Stat
          label="Expiring in 30 days"
          value={counts.expiring_30}
          tone={counts.expiring_30 > 0 ? "warning" : undefined}
          onClick={() => onNavigate({ view: "expiring", window: 30 })}
        />
        <Stat
          label="Expired"
          value={counts.expired}
          tone={counts.expired > 0 ? "danger" : undefined}
          onClick={() => onNavigate({ view: "expired" })}
        />
        <Stat
          label="Renewals in 90 days"
          value={counts.renewals}
          onClick={() => onNavigate({ view: "renewals" })}
        />
      </div>

      <div className="grid gap-6 @4xl/list:grid-cols-2">
        <Panel
          title="Expiring soon"
          empty="Nothing expires in the next 90 days."
          documents={overview.expiring}
          today={today}
          onOpen={onOpen}
          more={
            counts.expiring_90 > overview.expiring.length
              ? () => onNavigate({ view: "expiring", window: 90 })
              : undefined
          }
        />
        <Panel
          title="Expired"
          empty="No expired documents."
          documents={overview.expired}
          today={today}
          onOpen={onOpen}
          more={
            counts.expired > overview.expired.length
              ? () => onNavigate({ view: "expired" })
              : undefined
          }
        />
        <Panel
          title="Recently added"
          empty="Upload a document to get started."
          documents={overview.recently_added}
          today={today}
          onOpen={onOpen}
          more={() => onNavigate({ view: "all" })}
        />
        <Panel
          title="Recently modified"
          empty="No documents yet."
          documents={overview.recently_updated}
          today={today}
          onOpen={onOpen}
          more={() => onNavigate({ view: "recent" })}
        />
        {overview.favorites.length > 0 ? (
          <Panel
            title="Favorites"
            empty=""
            documents={overview.favorites}
            today={today}
            onOpen={onOpen}
            more={
              counts.favorites > overview.favorites.length
                ? () => onNavigate({ view: "favorites" })
                : undefined
            }
          />
        ) : null}
        <section
          aria-labelledby="documents-by-category"
          className="rounded-xl border bg-card p-4 shadow-elevation-1"
        >
          <h3 id="documents-by-category" className="mb-3 text-sm font-semibold">
            By category
          </h3>
          {used.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Give documents a category to see them grouped here.
            </p>
          ) : (
            <ul className="space-y-2">
              {used.map((category) => {
                const Icon = CATEGORY_ICONS[category.icon];
                return (
                  <li key={category.id}>
                    <button
                      type="button"
                      onClick={() => onNavigate({ categoryId: category.id })}
                      className="w-full rounded-md text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex items-center gap-2">
                        <Icon
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate">{category.name}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {category.document_count}
                        </span>
                      </span>
                      <span aria-hidden="true" className="mt-1 block h-1.5 rounded-full bg-muted">
                        <span
                          className="block h-full rounded-full bg-brand/60"
                          style={{ width: `${(category.document_count / largest) * 100}%` }}
                        />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  detail,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  detail?: string;
  tone?: "warning" | "danger";
  onClick?: () => void;
}) {
  const body: ReactNode = (
    <>
      <span className="block text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "block text-2xl font-semibold tabular-nums",
          tone === "warning" && "text-warning",
          tone === "danger" && "text-destructive",
        )}
      >
        {value}
        {detail ? (
          <span className="ml-2 text-xs font-normal text-muted-foreground">{detail}</span>
        ) : null}
      </span>
    </>
  );
  const className = "rounded-xl border bg-card p-4 text-left shadow-elevation-1";
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        className,
        "transition-colors outline-none hover:border-brand/30 focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

function Panel({
  title,
  empty,
  documents,
  today,
  onOpen,
  more,
}: {
  title: string;
  empty: string;
  documents: readonly DocumentSummary[];
  today: string;
  onOpen: (documentId: string) => void;
  more?: () => void;
}) {
  const id = `documents-${title.toLowerCase().replaceAll(" ", "-")}`;
  return (
    <section aria-labelledby={id} className="rounded-xl border bg-card shadow-elevation-1">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-1">
        <h3 id={id} className="text-sm font-semibold">
          {title}
        </h3>
        {more && documents.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={more}>
            See all
            <ArrowRight aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      {documents.length === 0 ? (
        <p className="px-4 pt-1 pb-4 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="pb-2">
          {documents.map((document) => (
            <li key={document.id}>
              <button
                type="button"
                onClick={() => onOpen(document.id)}
                className="flex w-full items-center gap-3 px-4 py-2 text-left outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <FileIcon file={document.file} className="size-8" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {document.title}
                </span>
                <ExpiryChip document={document} today={today} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
