"use client";

import type { CategorySpending, Currency, FinanceCategory, MonthCashFlow } from "@orbit/contracts";

import { formatMoney } from "@/lib/finance";
import { cn } from "@/utils/common";
import { monthLabel } from "@/utils/dates";

/** Bars never shrink below this, so a small but non-zero month stays visible. */
const MIN_BAR_PERCENT = 2;

function percentOf(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.max(MIN_BAR_PERCENT, (value / max) * 100);
}

function Swatch({ className }: { className: string }) {
  return <span aria-hidden="true" className={cn("inline-block size-2.5 rounded-sm", className)} />;
}

/**
 * Income beside spending (net of refunds) for each month, oldest first. Bars share one axis.
 * Each month is focusable and shows its figures on hover or focus; its accessible name carries
 * the same figures, so nothing depends on seeing the bars.
 */
export function TrendChart({
  months,
  currency,
  selected,
}: {
  months: readonly MonthCashFlow[];
  currency: Currency;
  /** The month being viewed, which is emphasized. */
  selected: string;
}) {
  const max = Math.max(0, ...months.flatMap((month) => [month.income, month.net_expenses]));
  const empty = months.every((month) => month.transactions === 0);

  return (
    <figure className="space-y-3">
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Swatch className="bg-chart-1" />
          Income
        </span>
        <span className="flex items-center gap-1.5">
          <Swatch className="bg-chart-2" />
          Spending
        </span>
      </figcaption>

      {empty ? (
        <p className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          No income or spending in these months yet.
        </p>
      ) : (
        <ul aria-label="Income and spending by month" className="flex h-44 items-stretch gap-1">
          {months.map((month) => {
            const label = monthLabel(month.month);
            const current = month.month === selected;
            const income = formatMoney(month.income, currency);
            const spending = formatMoney(month.net_expenses, currency);
            const net = formatMoney(month.net, currency, { signDisplay: "always" });
            return (
              <li
                key={month.month}
                // Focusable so keyboard users get the same figures as the hover tooltip.
                tabIndex={0}
                aria-label={`${label}: income ${income}, spending ${spending}, net ${net}`}
                className="group relative flex flex-1 flex-col items-center gap-1.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div
                  aria-hidden="true"
                  className="flex w-full flex-1 items-end justify-center gap-0.5 border-b border-border px-1 transition-colors duration-150 group-hover:bg-accent/50"
                >
                  <span
                    className="w-full max-w-4 rounded-t-[4px] bg-chart-1 transition-[height] duration-300 ease-out"
                    style={{ height: `${percentOf(month.income, max)}%` }}
                  />
                  <span
                    className="w-full max-w-4 rounded-t-[4px] bg-chart-2 transition-[height] duration-300 ease-out"
                    style={{ height: `${percentOf(month.net_expenses, max)}%` }}
                  />
                </div>
                <span
                  aria-hidden="true"
                  className={cn(
                    "text-xs",
                    current ? "font-semibold text-foreground" : "text-muted-foreground",
                  )}
                >
                  {monthLabel(month.month, { short: true })}
                </span>
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden w-max -translate-x-1/2 animate-tooltip-in rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-elevation-2 group-hover:block group-focus-visible:block"
                >
                  <p className="mb-1 font-medium">{label}</p>
                  <p className="flex items-center gap-1.5 tabular-nums">
                    <Swatch className="bg-chart-1" /> Income {income}
                  </p>
                  <p className="flex items-center gap-1.5 tabular-nums">
                    <Swatch className="bg-chart-2" /> Spending {spending}
                  </p>
                  <p className="mt-1 text-muted-foreground tabular-nums">Net {net}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </figure>
  );
}

/** How many categories get their own row; the rest are added up into one. */
const TOP_CATEGORIES = 6;

/** Net spending per category, largest first, as labelled bars on one scale. */
export function CategoryBreakdown({
  spending,
  total,
  currency,
  categories,
}: {
  spending: readonly CategorySpending[];
  total: number;
  currency: Currency;
  categories: ReadonlyMap<string, FinanceCategory>;
}) {
  const rows = spending.slice(0, TOP_CATEGORIES).map((entry) => ({
    key: entry.category_id ?? "uncategorized",
    name: entry.category_id
      ? (categories.get(entry.category_id)?.name ?? "Unknown category")
      : "Uncategorized",
    net: entry.net,
  }));
  const rest = spending.slice(TOP_CATEGORIES);
  if (rest.length > 0) {
    rows.push({
      key: "rest",
      name: `${rest.length} more ${rest.length === 1 ? "category" : "categories"}`,
      net: rest.reduce((sum, entry) => sum + entry.net, 0),
    });
  }
  const max = Math.max(0, ...rows.map((row) => row.net));

  return (
    <ul className="space-y-3">
      {rows.map((row) => {
        const share = total > 0 ? Math.round((row.net / total) * 100) : 0;
        return (
          <li key={row.key} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{row.name}</span>
              <span className="shrink-0 tabular-nums">
                {formatMoney(row.net, currency)}
                <span className="ml-2 text-xs text-muted-foreground">{share}%</span>
              </span>
            </div>
            <div aria-hidden="true" className="h-1.5 rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-chart-2 transition-[width] duration-300 ease-out"
                style={{ width: `${percentOf(row.net, max)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
