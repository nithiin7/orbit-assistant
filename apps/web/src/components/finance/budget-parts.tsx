"use client";

import type { BudgetPeriod, Currency, UtilizationStatus } from "@orbit/contracts";

import { barWidth, UTILIZATION_LABELS, wholePercent } from "@/lib/budgets";
import { formatMoney } from "@/lib/finance";
import { cn } from "@/utils/common";
import { daysBetween } from "@/utils/dates";

import { Chip, type ChipTone } from "./finance-meta";

const BAR_TONES: Record<UtilizationStatus, string> = {
  on_track: "bg-brand",
  approaching: "bg-warning",
  near: "bg-warning",
  exceeded: "bg-destructive",
};

const CHIP_TONES: Record<UtilizationStatus, ChipTone> = {
  on_track: "success",
  approaching: "warning",
  near: "warning",
  exceeded: "danger",
};

/** How much of a budget is used, as a status chip. */
export function UtilizationBadge({ status }: { status: UtilizationStatus }) {
  return <Chip tone={CHIP_TONES[status]}>{UTILIZATION_LABELS[status]}</Chip>;
}

/**
 * A progress bar for spending against a budget, or savings against a target. The bar stops at
 * 100%; the figures beside it say by how much a budget is over.
 */
export function UtilizationBar({
  label,
  percent,
  status = "on_track",
  size = "sm",
  pace,
  className,
}: {
  label: string;
  /** Decimal text from the API, such as `"87.50"`; `null` when nothing is available. */
  percent: string | null;
  status?: UtilizationStatus;
  size?: "sm" | "lg";
  /** How far through its period the budget is, 0–100, drawn as a tick on the track. */
  pace?: number | null;
  className?: string;
}) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={wholePercent(percent)}
      aria-valuetext={percent === null ? "No budget available" : `${percent}%`}
      className={cn(
        "relative overflow-hidden rounded-full bg-muted",
        size === "lg" ? "h-2.5" : "h-1.5",
        className,
      )}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none",
          BAR_TONES[status],
        )}
        style={{ width: `${percent === null && status === "exceeded" ? 100 : barWidth(percent)}%` }}
      />
      {pace != null ? (
        <div
          aria-hidden="true"
          className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-foreground/45"
          style={{ left: `${Math.min(Math.max(pace, 0), 100)}%` }}
        />
      ) : null}
    </div>
  );
}

/**
 * How far through a period `today` is, 0–100, counting today as passed; `null` outside the
 * period. Lets a budget's bar show where spending would be if it were even across the period.
 */
export function periodPace(period: BudgetPeriod, today: string): number | null {
  if (period.closed || today < period.start || today > period.end) return null;
  const days = daysBetween(period.start, period.end) + 1;
  return ((daysBetween(period.start, today) + 1) / days) * 100;
}

/** "₹7,600 of ₹10,000 · ₹2,400 left", or "… · ₹500 over". */
export function PeriodFigures({ period, currency }: { period: BudgetPeriod; currency: Currency }) {
  const over = period.remaining < 0;
  return (
    <p className="text-xs text-muted-foreground tabular-nums">
      <span className="font-medium text-foreground">{formatMoney(period.spent, currency)}</span> of{" "}
      {formatMoney(period.available, currency)} ·{" "}
      <span className={cn(over && "font-medium text-destructive")}>
        {formatMoney(Math.abs(period.remaining), currency)} {over ? "over" : "left"}
      </span>
      {period.utilization_percent !== null ? ` · ${period.utilization_percent}%` : null}
    </p>
  );
}
