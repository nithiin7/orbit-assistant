"use client";

import type { BudgetPeriod, Currency, UtilizationStatus } from "@orbit/contracts";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useId } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { barWidth, UTILIZATION_LABELS, wholePercent } from "@/lib/budgets";
import { currencyOptions, formatMoney } from "@/lib/finance";
import { cn } from "@/utils/common";
import { monthLabel, shiftMonth } from "@/utils/dates";

const BAR_TONES: Record<UtilizationStatus, string> = {
  on_track: "bg-brand",
  approaching: "bg-warning",
  near: "bg-warning",
  exceeded: "bg-destructive",
};

const BADGE_TONES: Record<UtilizationStatus, string> = {
  on_track: "border-success/40 text-success",
  approaching: "border-warning/40 text-warning",
  near: "border-warning/40 text-warning",
  exceeded: "border-destructive/40 text-destructive",
};

/** How much of a budget is used, as a status badge. */
export function UtilizationBadge({ status }: { status: UtilizationStatus }) {
  return (
    <Badge variant="outline" className={BADGE_TONES[status]}>
      {UTILIZATION_LABELS[status]}
    </Badge>
  );
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

/** Previous and next month, with a way back to this month. */
export function MonthNavigator({
  month,
  thisMonth,
  onChange,
  allowFuture = false,
}: {
  month: string;
  thisMonth: string;
  onChange: (month: string) => void;
  /** Budgets and plans can be looked at ahead; reports of what happened can't. */
  allowFuture?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Previous month"
        onClick={() => onChange(shiftMonth(month, -1))}
      >
        <ChevronLeft aria-hidden="true" />
      </Button>
      <h2 className="min-w-36 text-center text-base font-semibold" aria-live="polite">
        {monthLabel(month)}
      </h2>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Next month"
        disabled={!allowFuture && month >= thisMonth}
        onClick={() => onChange(shiftMonth(month, 1))}
      >
        <ChevronRight aria-hidden="true" />
      </Button>
      {month !== thisMonth ? (
        <Button variant="ghost" size="sm" onClick={() => onChange(thisMonth)}>
          This month
        </Button>
      ) : null}
    </div>
  );
}

/** A currency picker shown only when there is more than one to choose from. */
export function CurrencyPicker({
  currencies,
  currency,
  onChange,
}: {
  currencies: readonly Currency[];
  currency: Currency;
  onChange: (currency: Currency) => void;
}) {
  const id = useId();
  if (currencies.length < 2) return null;
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm text-muted-foreground">
        Currency
      </label>
      <Select
        id={id}
        className="w-28"
        value={currency}
        onValueChange={onChange}
        options={currencyOptions(currencies)}
      />
    </div>
  );
}
