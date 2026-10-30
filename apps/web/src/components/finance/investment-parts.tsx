"use client";

import type { Currency, Freshness, PortfolioSlice, ValueSource } from "@orbit/contracts";
import { AlertTriangle, Calculator, CircleHelp, type LucideIcon } from "lucide-react";
import { type ReactNode, useId } from "react";

import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import { formatMoney } from "@/lib/finance";
import { FRESHNESS_LABELS, gainTone, SOURCE_LABELS } from "@/lib/investments";
import { cn } from "@/utils/common";

const FRESHNESS: Record<Freshness, { icon: LucideIcon | null; tone: string }> = {
  current: { icon: null, tone: "" },
  stale: { icon: AlertTriangle, tone: "border-warning/40 text-warning" },
  missing: { icon: CircleHelp, tone: "border-warning/40 text-warning" },
  estimated: { icon: Calculator, tone: "" },
};

/**
 * How current a value is, with an icon and a word so it never depends on color. Current values
 * show nothing unless `always`.
 */
export function FreshnessBadge({
  freshness,
  source,
  always = false,
}: {
  freshness: Freshness;
  source?: ValueSource;
  always?: boolean;
}) {
  if (freshness === "current" && !always) return null;
  const { icon: Icon, tone } = FRESHNESS[freshness];
  const label =
    freshness === "current" && source ? SOURCE_LABELS[source] : FRESHNESS_LABELS[freshness];
  return (
    <Badge variant="outline" className={cn("gap-1", tone)}>
      {Icon ? <Icon aria-hidden="true" className="size-3" /> : null}
      {label}
    </Badge>
  );
}

/** A gain or loss with its sign, colored by direction; unknown gains are a dash. */
export function Gain({ amount, currency }: { amount: number | null; currency: Currency }) {
  return (
    <span className={cn("tabular-nums", gainTone(amount))}>
      {amount === null
        ? "—"
        : formatMoney(amount, currency, { signDisplay: amount === 0 ? "auto" : "always" })}
    </span>
  );
}

/**
 * Shares of a total as labelled bars on one axis, largest first: one hue, direct labels, and each
 * row's figures in its text, so nothing depends on reading the bars.
 */
export function ProportionBars({
  slices,
  currency,
  label,
}: {
  slices: readonly PortfolioSlice[];
  currency: Currency;
  label: string;
}) {
  const total = slices.reduce((sum, slice) => sum + Math.max(slice.value, 0), 0);
  if (total <= 0) {
    return <p className="text-sm text-muted-foreground">Nothing to show yet.</p>;
  }
  return (
    <ul aria-label={label} className="space-y-3">
      {slices.map((slice) => {
        const share = (Math.max(slice.value, 0) / total) * 100;
        return (
          <li key={slice.key} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate">{slice.label}</span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {formatMoney(slice.value, currency)} · {share.toFixed(1)}%
              </span>
            </div>
            <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-chart-1"
                style={{ width: `${Math.max(share, 1)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** A compact labelled select for toolbars (currency, date range). */
export function InlineSelect({
  label,
  value,
  onChange,
  children,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm whitespace-nowrap text-muted-foreground">
        {label}
      </label>
      <NativeSelect
        id={id}
        className={className ?? "w-32"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </NativeSelect>
    </div>
  );
}

/** A label and a figure in a definition list row. */
export function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium tabular-nums">{children}</dd>
    </div>
  );
}
