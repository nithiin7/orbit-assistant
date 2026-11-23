"use client";

import type { LucideIcon } from "lucide-react";
import { createContext, type ReactNode, useContext } from "react";

import { cn } from "@/utils/common";

/** A tile's accent: what the figure is about, shown as the color of its icon chip. */
export type TileAccent = "brand" | "income" | "spending" | "positive" | "negative" | "neutral";

export const ACCENTS: Record<TileAccent, string> = {
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

/** Whether tiles sit inside a hero card, where they turn translucent over its tint. */
const InHero = createContext(false);

/**
 * Headline figures as a description list of tiles. Tiles share the row evenly and wrap when a
 * tile would get narrower than about 13rem, so one figure or five fill the width without gaps.
 *
 * As a view's `hero`, the tiles sit together on one tinted card, with `icon` faint behind them.
 */
export function StatGrid({
  children,
  className,
  hero = false,
  icon: Icon,
}: {
  children: ReactNode;
  className?: string;
  hero?: boolean;
  /** A faint watermark in the hero card's corner. */
  icon?: LucideIcon;
}) {
  const grid = (
    <dl
      className={cn(
        "grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-3 @3xl/list:gap-4",
        hero && "relative",
        className,
      )}
    >
      {children}
    </dl>
  );
  if (!hero) return grid;
  return (
    <div className="relative overflow-hidden rounded-2xl border bg-linear-to-br from-brand-subtle/80 via-card to-card p-4 shadow-elevation-1 @3xl/list:p-5">
      {Icon ? (
        <Icon
          aria-hidden="true"
          className="pointer-events-none absolute -top-8 -right-8 size-44 -rotate-12 text-brand opacity-[0.05]"
        />
      ) : null}
      <InHero value={true}>{grid}</InHero>
    </div>
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
  const inHero = useContext(InHero);
  return (
    <div
      className={cn(
        // A container itself: a narrow tile drops its icon and shrinks the figure to fit.
        "@container/tile relative min-w-0 rounded-xl border p-4 @3xl/list:p-5",
        inHero ? "bg-card/80 backdrop-blur-sm" : "bg-card shadow-elevation-1",
        emphasis &&
          (inHero ? "border-brand/30 bg-brand-subtle/70" : "border-brand/25 bg-brand-subtle/40"),
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
