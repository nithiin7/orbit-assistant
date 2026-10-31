"use client";

import type { BudgetPeriod, Currency, UtilizationStatus } from "@orbit/contracts";

import { barWidth, UTILIZATION_LABELS, wholePercent } from "@/lib/budgets";
import { formatMoney } from "@/lib/finance";
import { cn } from "@/utils/common";

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
  className,
}: {
  label: string;
  /** Decimal text from the API, such as `"87.50"`; `null` when nothing is available. */
  percent: string | null;
  status?: UtilizationStatus;
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
      className={cn("h-1.5 overflow-hidden rounded-full bg-muted", className)}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none",
          BAR_TONES[status],
        )}
        style={{ width: `${percent === null && status === "exceeded" ? 100 : barWidth(percent)}%` }}
      />
    </div>
  );
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
