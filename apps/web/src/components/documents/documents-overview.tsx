"use client";

import type { DocumentCategory, DocumentOverview, DocumentSummary } from "@orbit/contracts";
import {
  ArrowRight,
  CalendarClock,
  CircleCheck,
  Files,
  FolderOpen,
  History,
  Hourglass,
  type LucideIcon,
  RefreshCcw,
  ShieldAlert,
  ShieldCheck,
  Star,
  TriangleAlert,
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
      <VaultHero counts={counts} onNavigate={onNavigate} />

      <div className="grid items-start gap-6 @4xl/list:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 space-y-6">
          <Panel
            title="Needs attention"
            icon={attention.length === 0 ? CircleCheck : TriangleAlert}
            tone={attention.length === 0 ? "success" : "warning"}
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
              <Empty>All clear. Nothing is expired or expires in the next 90 days.</Empty>
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
            icon={History}
            tone="blue"
            action={
              overview.recently_updated.length > 0 ? (
                <SeeAll onClick={() => onNavigate({ view: "recent" })} />
              ) : null
            }
          >
            {overview.recently_updated.length === 0 ? (
              <Empty>Upload a document to get started.</Empty>
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
              icon={Star}
              tone="amber"
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

          <Panel title="Browse by category" icon={FolderOpen} tone="brand">
            {used.length === 0 ? (
              <Empty>Give documents a category to see them grouped here.</Empty>
            ) : (
              <ul className="grid grid-cols-2 gap-2 px-3 pb-3">
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

/** Each card's colour. Classes are written out in full so Tailwind sees them. */
const TONES = {
  brand: "bg-brand-subtle text-brand",
  blue: "bg-event-blue/12 text-event-blue",
  amber: "bg-event-amber/12 text-event-amber",
  success: "bg-success/12 text-success",
  warning: "bg-warning/12 text-warning",
  danger: "bg-destructive/10 text-destructive",
  muted: "bg-muted text-muted-foreground",
} as const;

type Tone = keyof typeof TONES;

/** What the vault's state is, in a few words, with how it should read. */
function vaultStatus(counts: DocumentOverview["counts"]): {
  headline: string;
  icon: LucideIcon;
  tone: Tone;
} {
  if (counts.expired > 0)
    return {
      headline: `${plural(counts.expired, "document")} ${counts.expired === 1 ? "has" : "have"} expired`,
      icon: ShieldAlert,
      tone: "danger",
    };
  if (counts.expiring_30 > 0)
    return {
      headline: `${plural(counts.expiring_30, "document")} ${counts.expiring_30 === 1 ? "expires" : "expire"} within 30 days`,
      icon: ShieldAlert,
      tone: "warning",
    };
  return { headline: "Everything is up to date", icon: ShieldCheck, tone: "success" };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** The vault at a glance: its state in one line, and the counts that lead to each list. */
function VaultHero({
  counts,
  onNavigate,
}: {
  counts: DocumentOverview["counts"];
  onNavigate: (location: Partial<DocumentsLocation>) => void;
}) {
  const status = vaultStatus(counts);
  const StatusIcon = status.icon;
  return (
    <section
      aria-labelledby="documents-vault-heading"
      className="relative overflow-hidden rounded-2xl border bg-linear-to-br from-brand-subtle/80 via-card to-card p-5 shadow-elevation-1 @3xl/list:p-6"
    >
      <Files
        aria-hidden="true"
        className="pointer-events-none absolute -top-8 -right-8 size-44 -rotate-12 text-brand opacity-[0.05]"
      />
      <div className="relative space-y-5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-2xl",
              TONES[status.tone],
            )}
          >
            <StatusIcon className="size-5" />
          </span>
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-medium tracking-wide text-brand uppercase">Your vault</p>
            <h3
              id="documents-vault-heading"
              className="text-xl font-semibold tracking-tight @3xl/list:text-2xl"
            >
              {status.headline}
            </h3>
            <p className="text-sm text-muted-foreground">
              {plural(counts.all, "document")} · {formatFileSize(counts.total_bytes)} stored
              {counts.favorites > 0 ? ` · ${plural(counts.favorites, "favorite")}` : ""}
            </p>
          </div>
        </div>
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
      </div>
    </section>
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
      className="group relative flex min-w-0 flex-col gap-1 rounded-xl border bg-card/80 p-4 text-left backdrop-blur-sm transition-[border-color,translate] duration-150 outline-none hover:-translate-y-0.5 hover:border-brand/40 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:hover:translate-y-0"
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-3.5 right-3.5 flex size-8 items-center justify-center rounded-lg",
          TONES[tone ?? "muted"],
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="pr-10 text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-2xl leading-tight font-semibold tabular-nums",
          tone === "warning" && "text-warning",
          tone === "danger" && "text-destructive",
        )}
      >
        {value}
      </span>
      {detail ? <span className="text-xs text-muted-foreground">{detail}</span> : null}
    </button>
  );
}

function Panel({
  title,
  icon: Icon,
  tone,
  action,
  children,
}: {
  title: string;
  icon: LucideIcon;
  tone: Tone;
  action?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="overflow-hidden rounded-2xl border bg-card shadow-elevation-1"
    >
      <div className="flex min-h-14 items-center justify-between gap-2 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden="true"
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-xl",
              TONES[tone],
            )}
          >
            <Icon className="size-4" />
          </span>
          <h3 id={id} className="truncate text-sm font-semibold">
            {title}
          </h3>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="mx-4 mb-4 rounded-xl border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
      {children}
    </p>
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
    <ul className="divide-y border-t">
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
      className="flex w-full items-center gap-2.5 rounded-xl border bg-background/60 px-3 py-2.5 text-left text-sm transition-[border-color,background-color,translate] duration-150 outline-none hover:-translate-y-0.5 hover:border-brand/40 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:hover:translate-y-0"
    >
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand"
      >
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
