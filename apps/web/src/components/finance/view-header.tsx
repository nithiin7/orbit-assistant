"use client";

import type { Currency } from "@orbit/contracts";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useId } from "react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { currencyOptions } from "@/lib/finance";
import { cn } from "@/utils/common";
import { monthLabel, shiftMonth } from "@/utils/dates";

/**
 * The top of a finance view: its heading, a line of context, its controls (month, currency,
 * filters), and its one primary action. Stacks on narrow columns, one row on wide ones.
 */
export function ViewHeader({
  title,
  description,
  controls,
  action,
}: {
  title: string;
  description?: ReactNode;
  controls?: ReactNode;
  /** The view's primary action, last in the row. */
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 @3xl/list:flex-row @3xl/list:items-end @3xl/list:justify-between">
      <div className="min-w-0 space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description ? (
          <p className="max-w-prose text-sm text-pretty text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {controls || action ? (
        <div className="flex flex-wrap items-center gap-2 @3xl/list:shrink-0 @3xl/list:justify-end">
          {controls}
          {action}
        </div>
      ) : null}
    </header>
  );
}

/** Previous and next month around the month's name, with a way back to this month. */
export function MonthSwitcher({
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
      <div className="flex h-9 items-center rounded-md border bg-card shadow-elevation-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 rounded-r-none"
          aria-label="Previous month"
          onClick={() => onChange(shiftMonth(month, -1))}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <p
          className="min-w-32 px-1 text-center text-sm font-medium tabular-nums"
          aria-live="polite"
        >
          {monthLabel(month)}
        </p>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 rounded-l-none"
          aria-label="Next month"
          disabled={!allowFuture && month >= thisMonth}
          onClick={() => onChange(shiftMonth(month, 1))}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
      {month !== thisMonth ? (
        <Button variant="ghost" size="sm" onClick={() => onChange(thisMonth)}>
          This month
        </Button>
      ) : null}
    </div>
  );
}

/** Which currency a view reports in. Nothing to choose, and nothing shown, with only one. */
export function CurrencySwitcher({
  currencies,
  currency,
  onChange,
  className,
}: {
  currencies: readonly Currency[];
  currency: Currency;
  onChange: (currency: Currency) => void;
  className?: string;
}) {
  const id = useId();
  if (currencies.length < 2) return null;
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="sr-only">
        Currency
      </label>
      <Select
        id={id}
        className={cn("w-24", className)}
        value={currency}
        onValueChange={onChange}
        options={currencyOptions(currencies)}
      />
    </div>
  );
}
