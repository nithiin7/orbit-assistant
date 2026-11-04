"use client";

import type { DocumentCategory, DocumentOverview, DocumentSummary } from "@orbit/contracts";
import {
  ArrowRight,
  CalendarClock,
  CircleCheck,
  Files,
  Hourglass,
  type LucideIcon,
  RefreshCcw,
} from "lucide-react";
import { type ReactNode, useId } from "react";

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

/**
 * The library at a glance: a few counts, one list of what needs attention (expired first, then
 * expiring), what changed lately, favorites, and a way in by category.
 */
export function DocumentsOverview({ overview, today, onOpen, onNavigate }: OverviewProps) {
  const { counts } = overview;
  const categoryNames = new Map(
    overview.categories.map((category) => [category.id, category.name]),
  );
  const attention = [...overview.expired, ...overview.expiring];
  const hiddenAttention =
    counts.expired + counts.expiring_90 - overview.expired.length - overview.expiring.length;
  const used = overview.categories.filter((category) => category.document_count > 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 @2xl/list:grid-cols-4">
        <Stat
          icon={Files}
          label="Documents"
          value={counts.all}
          detail={formatFileSize(counts.total_bytes)}
          onClick={() => onNavigate({ view: "all" })}
        />
        <Stat
          icon={Hourglass}
          label="Expiring in 30 days"
          value={counts.expiring_30}
          tone={counts.expiring_30 > 0 ? "warning" : undefined}
          onClick={() => onNavigate({ view: "expiring", window: 30 })}
        />
        <Stat
          icon={CalendarClock}
          label="Expired"
          value={counts.expired}
          tone={counts.expired > 0 ? "danger" : undefined}
          onClick={() => onNavigate({ view: "expired" })}
        />
        <Stat
          icon={RefreshCcw}
          label="Renewals in 90 days"
          value={counts.renewals}
          onClick={() => onNavigate({ view: "renewals" })}
        />
      </div>

      <div className="grid items-start gap-6 @4xl/list:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 space-y-6">
          <Panel
            title="Needs attention"
            action={
              hiddenAttention > 0 ? (
                <SeeAll
                  onClick={() =>
                    onNavigate(
                      counts.expired > overview.expired.length
                        ? { view: "expired" }
                        : { view: "expiring", window: 90 },
                    )
                  }
                />
              ) : null
            }
          >
            {attention.length === 0 ? (
              <p className="flex items-center gap-3 px-4 py-5 text-sm text-muted-foreground">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
                  <CircleCheck className="size-4" aria-hidden="true" />
                </span>
                All clear. Nothing is expired or expires in the next 90 days.
              </p>
            ) : (
              <DocumentRows
                documents={attention}
                categoryNames={categoryNames}
                today={today}
                onOpen={onOpen}
              />
            )}
          </Panel>

          <Panel
            title="Recently updated"
            action={
              overview.recently_updated.length > 0 ? (
                <SeeAll onClick={() => onNavigate({ view: "recent" })} />
              ) : null
            }
          >
            {overview.recently_updated.length === 0 ? (
              <p className="px-4 py-5 text-sm text-muted-foreground">
                Upload a document to get started.
              </p>
            ) : (
              <DocumentRows
                documents={overview.recently_updated}
                categoryNames={categoryNames}
                today={today}
                onOpen={onOpen}
              />
            )}
          </Panel>
        </div>

        <div className="min-w-0 space-y-6">
          {overview.favorites.length > 0 ? (
            <Panel
              title="Favorites"
              action={
                counts.favorites > overview.favorites.length ? (
                  <SeeAll onClick={() => onNavigate({ view: "favorites" })} />
                ) : null
              }
            >
              <DocumentRows
                documents={overview.favorites}
                categoryNames={categoryNames}
                today={today}
                onOpen={onOpen}
              />
            </Panel>
          ) : null}

          <Panel title="Browse by category">
            {used.length === 0 ? (
              <p className="px-4 py-5 text-sm text-muted-foreground">
                Give documents a category to see them grouped here.
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-2 p-3">
                {used.map((category) => (
                  <li key={category.id}>
                    <CategoryTile
                      category={category}
                      onClick={() => onNavigate({ categoryId: category.id })}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  detail,
  tone,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  detail?: string;
  tone?: "warning" | "danger";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-start gap-3 rounded-xl border bg-card p-4 text-left shadow-elevation-1 transition-colors outline-none hover:border-brand/30 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          tone === "warning"
            ? "bg-warning/10 text-warning"
            : tone === "danger"
              ? "bg-destructive/10 text-destructive"
              : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-4.5" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-xs text-muted-foreground">{label}</span>
        <span
          className={cn(
            "block text-2xl leading-tight font-semibold tabular-nums",
            tone === "warning" && "text-warning",
            tone === "danger" && "text-destructive",
          )}
        >
          {value}
        </span>
        {detail ? <span className="block text-xs text-muted-foreground">{detail}</span> : null}
      </span>
    </button>
  );
}

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="overflow-hidden rounded-xl border bg-card shadow-elevation-1"
    >
      <div className="flex min-h-12 items-center justify-between gap-2 border-b px-4 py-2">
        <h3 id={id} className="text-sm font-semibold">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function SeeAll({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick}>
      See all
      <ArrowRight aria-hidden="true" />
    </Button>
  );
}

function DocumentRows({
  documents,
  categoryNames,
  today,
  onOpen,
}: {
  documents: readonly DocumentSummary[];
  categoryNames: ReadonlyMap<string, string>;
  today: string;
  onOpen: (documentId: string) => void;
}) {
  return (
    <ul className="divide-y">
      {documents.map((document) => {
        const detail = [
          document.category_id ? categoryNames.get(document.category_id) : undefined,
          document.provider ?? document.issuing_authority ?? undefined,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <li key={document.id}>
            <button
              type="button"
              onClick={() => onOpen(document.id)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              <FileIcon file={document.file} className="size-8" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{document.title}</span>
                {detail ? (
                  <span className="block truncate text-xs text-muted-foreground">{detail}</span>
                ) : null}
              </span>
              <ExpiryChip document={document} today={today} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function CategoryTile({ category, onClick }: { category: DocumentCategory; onClick: () => void }) {
  const Icon = CATEGORY_ICONS[category.icon];
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg border bg-background/60 px-3 py-2.5 text-left text-sm transition-colors outline-none hover:border-brand/30 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand-subtle text-brand">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{category.name}</span>
        <span className="block text-xs text-muted-foreground tabular-nums">
          {category.document_count === 1 ? "1 document" : `${category.document_count} documents`}
        </span>
      </span>
    </button>
  );
}
