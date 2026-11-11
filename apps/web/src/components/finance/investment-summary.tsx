"use client";

import type { Currency, Deposit, Holding, HoldingKind, SipPlan } from "@orbit/contracts";
import {
  BriefcaseBusiness,
  CalendarClock,
  ChevronRight,
  CircleHelp,
  Coins,
  LineChart,
  PiggyBank,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { type ReactNode, useId } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { usePortfolio } from "@/hooks/use-investments";
import { formatMoney } from "@/lib/finance";
import { formatPercent, gainTone, rangeStart } from "@/lib/investments";
import { formatCalendarDate } from "@/utils/dates";

import { SectionHeading } from "./finance-meta";
import { Gain, ProportionBars } from "./investment-parts";
import {
  HOLDING_SECTIONS,
  type Range,
  RANGES,
  type Section,
  SECTION_ICONS,
} from "./investments-sections";
import { LoadError, Panel } from "./panel";
import { StatGrid, StatTile } from "./stat-tile";

/** The total of what was paid, what it's worth, and the gain, across priced holdings. */
function sumHoldings(holdings: readonly Holding[]) {
  let value = 0;
  let cost = 0;
  let gain = 0;
  let pricedCost = 0;
  for (const holding of holdings) {
    value += holding.value;
    cost += holding.cost;
    if (holding.unrealized_gain !== null) {
      gain += holding.unrealized_gain;
      pricedCost += holding.cost;
    }
  }
  const percent = pricedCost > 0 ? (gain / pricedCost) * 100 : null;
  return { value, cost, gain, percent };
}

/** A gain as a signed percent, such as "+6.5%". */
function gainPercent(percent: number | null): string | null {
  if (percent === null) return null;
  return formatPercent(percent.toFixed(1));
}

/** One card per kind of investment on the overview, each opening its tab. */
export function WhatYouHold({
  loaded,
  holdings,
  deposits,
  currency,
  onOpen,
}: {
  loaded: boolean;
  holdings: readonly Holding[];
  deposits: readonly Deposit[];
  currency: Currency;
  onOpen: (section: Section) => void;
}) {
  const headingId = useId();
  if (!loaded) return <Skeleton className="h-32 rounded-xl" />;
  const openDeposits = deposits.filter((deposit) => deposit.status === "active");
  const nextMaturity = openDeposits.map((deposit) => deposit.maturity_date).sort()[0];
  const cards = [
    ...HOLDING_SECTIONS.map(({ kind, label }) => {
      const rows = holdings.filter((holding) => holding.kind === kind);
      const held = rows.filter((holding) => holding.quantity !== "0").length;
      const { value, gain, percent } = sumHoldings(rows);
      return {
        id: kind as Section,
        label,
        count: held,
        value,
        detail:
          held === 0 ? (
            "None yet"
          ) : (
            <span className={gainTone(gain)}>
              <Gain amount={gain} currency={currency} />
              {gainPercent(percent) ? ` (${gainPercent(percent)})` : ""} unrealized
            </span>
          ),
      };
    }),
    {
      id: "deposits" as Section,
      label: "Deposits",
      count: openDeposits.length,
      value: openDeposits.reduce((sum, deposit) => sum + deposit.value, 0),
      detail: nextMaturity ? `Next matures ${formatCalendarDate(nextMaturity)}` : "None yet",
    },
  ];

  return (
    <section aria-labelledby={headingId} className="space-y-2.5">
      <SectionHeading id={headingId}>What you hold</SectionHeading>
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3 @3xl/list:gap-4">
        {cards.map((card) => {
          const Icon = SECTION_ICONS[card.id];
          const value = formatMoney(card.value, currency);
          return (
            <li key={card.id} className="min-w-0">
              <button
                type="button"
                onClick={() => onOpen(card.id)}
                aria-label={`${card.label}: ${card.count} held, ${value}`}
                aria-describedby={`${headingId}-${card.id}`}
                className="group flex h-full w-full flex-col rounded-xl border bg-card p-4 text-left shadow-elevation-1 transition-[box-shadow,border-color] duration-150 outline-none hover:border-brand/30 hover:shadow-elevation-2 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex w-full items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand"
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {card.label}
                    <span className="text-muted-foreground"> · {card.count}</span>
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5"
                  />
                </span>
                <span className="mt-3 text-xl font-semibold tracking-tight whitespace-nowrap tabular-nums">
                  {value}
                </span>
                <span
                  id={`${headingId}-${card.id}`}
                  className="mt-0.5 text-xs text-muted-foreground"
                >
                  {card.detail}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The headline figures for one kind of holding. */
export function HoldingTotals({
  kind,
  holdings,
  sips,
  currency,
}: {
  kind: HoldingKind;
  holdings: readonly Holding[];
  sips: readonly SipPlan[];
  currency: Currency;
}) {
  if (holdings.length === 0) return null;
  const { value, cost, gain, percent } = sumHoldings(holdings);
  const held = holdings.filter((holding) => holding.quantity !== "0").length;
  const ids = new Set(holdings.map((holding) => holding.id));
  const activeSips = sips.filter((plan) => ids.has(plan.holding_id) && plan.state === "active");
  const nextSip = activeSips
    .map((plan) => plan.next_due_date)
    .filter((date): date is string => date !== null)
    .sort()[0];
  return (
    <StatGrid>
      <StatTile
        label="Current value"
        icon={BriefcaseBusiness}
        accent="brand"
        value={formatMoney(value, currency)}
      >
        {held} {held === 1 ? "holding" : "holdings"}
      </StatTile>
      <StatTile label="Cost of what you hold" icon={Coins} value={formatMoney(cost, currency)}>
        What you paid for the units you still hold
      </StatTile>
      <StatTile
        label="Unrealized gain"
        icon={gain < 0 ? TrendingDown : TrendingUp}
        value={formatMoney(gain, currency, { signDisplay: gain === 0 ? "auto" : "always" })}
        tone={signTone(gain)}
        accent={gain < 0 ? "negative" : "positive"}
      >
        {gainPercent(percent) ? `${gainPercent(percent)} on cost, ` : ""}priced holdings only
      </StatTile>
      {kind === "mutual_fund" && activeSips.length > 0 ? (
        <StatTile label="Active SIPs" icon={CalendarClock} value={activeSips.length}>
          {nextSip ? `Next installment ${formatCalendarDate(nextSip)}` : "None due"}
        </StatTile>
      ) : null}
    </StatGrid>
  );
}

/** The headline figures for deposits. */
export function DepositTotals({
  deposits,
  currency,
}: {
  deposits: readonly Deposit[];
  currency: Currency;
}) {
  const open = deposits.filter((deposit) => deposit.status === "active");
  const value = open.reduce((sum, deposit) => sum + deposit.value, 0);
  const atMaturity = open.reduce((sum, deposit) => sum + deposit.projected_maturity_amount, 0);
  const next = [...open].sort((a, b) => a.maturity_date.localeCompare(b.maturity_date))[0];
  return (
    <StatGrid>
      <StatTile
        label="Current value"
        icon={PiggyBank}
        accent="brand"
        value={formatMoney(value, currency)}
      >
        {open.length} open {open.length === 1 ? "deposit" : "deposits"}
      </StatTile>
      <StatTile
        label="Expected at maturity"
        icon={TrendingUp}
        accent="positive"
        value={formatMoney(atMaturity, currency)}
      >
        An estimate from the rates, not a guarantee
      </StatTile>
      {next ? (
        <StatTile
          label="Next to mature"
          icon={CalendarClock}
          value={formatCalendarDate(next.maturity_date)}
        >
          {next.name}
        </StatTile>
      ) : null}
    </StatGrid>
  );
}

/** Gains read green, losses red, and nothing neutral. */
function signTone(amount: number): "default" | "positive" | "negative" {
  return amount > 0 ? "positive" : amount < 0 ? "negative" : "default";
}

export function PortfolioSummary({
  workspaceId,
  currency,
  today,
  range,
  children,
}: {
  workspaceId: string;
  currency: Currency;
  today: string;
  range: Range;
  /** Shown after the headline figures, before allocation. */
  children?: ReactNode;
}) {
  const from = rangeStart(today, range === "12" ? 12 : range);
  const portfolio = usePortfolio(workspaceId, {
    currency,
    today,
    date_from: from ?? null,
    date_to: range === "all" ? null : today,
  });
  const state = portfolio.state;
  if (state.status === "error") {
    return <LoadError message={state.message} onRetry={portfolio.reload} />;
  }
  if (state.status === "loading") {
    return (
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-4">
        {[0, 1, 2, 3].map((tile) => (
          <Skeleton key={tile} className="h-28 rounded-xl" />
        ))}
      </div>
    );
  }
  const data = state.data;
  const rangeLabel = RANGES.find((option) => option.value === range)?.label.toLowerCase();
  return (
    <div className="space-y-6">
      <StatGrid>
        <StatTile
          label="Current value"
          icon={BriefcaseBusiness}
          accent="brand"
          value={formatMoney(data.current_value, currency)}
        >
          {data.cash
            ? `Plus ${formatMoney(data.cash, currency)} uninvested cash`
            : "Holdings and deposits"}
        </StatTile>
        <StatTile
          label="Cost of what you hold"
          icon={Coins}
          value={formatMoney(data.invested, currency)}
        >
          FIFO cost of units held, plus deposits
        </StatTile>
        <StatTile
          label="Unrealized gain"
          icon={data.unrealized_gain < 0 ? TrendingDown : TrendingUp}
          value={formatMoney(data.unrealized_gain, currency, {
            signDisplay: data.unrealized_gain === 0 ? "auto" : "always",
          })}
          tone={signTone(data.unrealized_gain)}
          accent={data.unrealized_gain < 0 ? "negative" : "positive"}
        >
          Market value minus cost, priced holdings only
        </StatTile>
        <StatTile
          label="Total return"
          icon={LineChart}
          value={formatMoney(data.total_return, currency, {
            signDisplay: data.total_return === 0 ? "auto" : "always",
          })}
          tone={signTone(data.total_return)}
          accent={data.total_return < 0 ? "negative" : "positive"}
        >
          {formatPercent(data.return_percent)} on everything invested. Realized{" "}
          {formatMoney(data.realized_gain, currency)}, income {formatMoney(data.income, currency)},
          fees {formatMoney(data.fees, currency)} ({rangeLabel}).
        </StatTile>
      </StatGrid>

      {data.missing_prices + data.stale_prices > 0 ? (
        <p
          role="note"
          className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm"
        >
          <CircleHelp aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            {data.missing_prices > 0
              ? `${data.missing_prices} holding${data.missing_prices === 1 ? " has" : "s have"} no price and ${data.missing_prices === 1 ? "is" : "are"} counted at cost. `
              : ""}
            {data.stale_prices > 0
              ? `${data.stale_prices} price${data.stale_prices === 1 ? " is" : "s are"} more than a week old. `
              : ""}
            Update prices to see current values.
          </span>
        </p>
      ) : null}

      {children}

      <div className="grid gap-6 @3xl/list:grid-cols-2">
        <Panel title="Allocation">
          <ProportionBars slices={data.allocation} currency={currency} label="Allocation" />
        </Panel>
        <Panel title="By category">
          <ProportionBars slices={data.categories} currency={currency} label="By category" />
        </Panel>
      </div>
    </div>
  );
}
