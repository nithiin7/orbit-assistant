import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/utils/common";

/** A tile's accent: what the figure is about, shown as the color of its icon chip. */
export type TileAccent = "brand" | "income" | "spending" | "positive" | "negative" | "neutral";

const ACCENTS: Record<TileAccent, string> = {
  brand: "bg-brand-subtle text-brand",
  income: "bg-chart-1/12 text-chart-1",
  spending: "bg-chart-2/12 text-chart-2",
  positive: "bg-success/12 text-success",
  negative: "bg-destructive/10 text-destructive",
  neutral: "bg-muted text-muted-foreground",
};

export type Tone = "default" | "positive" | "negative" | "warning";

const TONES: Record<Tone, string> = {
  default: "",
  positive: "text-success",
  negative: "text-destructive",
  warning: "text-warning",
};

/**
 * Headline figures as a description list of tiles. Tiles share the row evenly and wrap when a
 * tile would get narrower than about 13rem, so one figure or five fill the width without gaps.
 */
export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <dl
      className={cn(
        "grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-3 @3xl/list:gap-4",
        className,
      )}
    >
      {children}
    </dl>
  );
}

/** One headline figure: a label, the value, and a line saying what it means. */
export function StatTile({
  label,
  value,
  icon: Icon,
  tone = "default",
  accent = "neutral",
  emphasis = false,
  children,
}: {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  accent?: TileAccent;
  /** The view's headline figure, on a tinted card. */
  emphasis?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        // A container itself: a narrow tile drops its icon and shrinks the figure to fit.
        "@container/tile relative min-w-0 rounded-xl border bg-card p-4 shadow-elevation-1 @3xl/list:p-5",
        emphasis && "border-brand/25 bg-brand-subtle/40",
      )}
    >
      {Icon ? (
        <span
          aria-hidden="true"
          className={cn(
            "absolute top-4 right-4 hidden size-9 items-center justify-center rounded-lg @[15rem]/tile:flex",
            ACCENTS[accent],
          )}
        >
          <Icon className="size-[1.125rem]" />
        </span>
      ) : null}
      <dt className={cn("text-sm text-muted-foreground", Icon && "@[15rem]/tile:pr-12")}>
        {label}
      </dt>
      <dd
        className={cn(
          // Money never breaks across lines: a sign or currency symbol stays with its digits.
          "mt-1 text-xl font-semibold tracking-tight whitespace-nowrap tabular-nums @[15rem]/tile:text-2xl",
          Icon && "@[15rem]/tile:pr-12",
          TONES[tone],
        )}
      >
        {value}
      </dd>
      {children ? <dd className="mt-1 text-xs text-muted-foreground">{children}</dd> : null}
    </div>
  );
}

/** A small figure inside a panel or row: a label over a value. */
export function Figure({
  label,
  tone = "default",
  children,
  hint,
}: {
  label: string;
  tone?: Tone;
  children: ReactNode;
  /** A line under the value. */
  hint?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("truncate text-sm font-medium tabular-nums", TONES[tone])}>{children}</dd>
      {hint ? <dd className="text-xs text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}
