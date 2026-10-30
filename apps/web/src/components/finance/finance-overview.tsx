"use client";

import type { Currency, FinanceAccount } from "@orbit/contracts";
import { ChevronLeft, ChevronRight, Receipt } from "lucide-react";
import { type ReactNode, useId, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { useFinanceReport } from "@/hooks/use-finance";
import {
  accountCurrencies,
  accountTypeLabel,
  DEFAULT_CURRENCY,
  formatMoney,
  isCurrency,
} from "@/lib/finance";
import { byId, cn } from "@/utils/common";
import { localMonthString, monthLabel, shiftMonth } from "@/utils/dates";

import { CommitmentsSummary } from "./commitments-summary";
import { CategoryBreakdown, TrendChart } from "./finance-charts";
import type { FinanceData } from "./finance-view";
import { TransactionItem } from "./transaction-item";

/** One month's cash flow, account balances, trend, spending, and latest transactions. */
export function FinanceOverview({
  workspaceId,
  accounts,
  categories,
  onEditTransaction,
  onShowTab,
}: FinanceData) {
  const id = useId();
  const thisMonth = localMonthString();
  const [month, setMonth] = useState(thisMonth);
  const currencies = useMemo(() => accountCurrencies(accounts), [accounts]);
  const [chosenCurrency, setCurrency] = useState<Currency | null>(null);
  const currency =
    chosenCurrency && currencies.includes(chosenCurrency)
      ? chosenCurrency
      : (currencies[0] ?? DEFAULT_CURRENCY);
  const { resource, refreshing, reload } = useFinanceReport(workspaceId, month, currency);
  const accountsById = useMemo(() => byId(accounts), [accounts]);
  const categoriesById = useMemo(() => byId(categories), [categories]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous month"
            onClick={() => setMonth((current) => shiftMonth(current, -1))}
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
            disabled={month >= thisMonth}
            onClick={() => setMonth((current) => shiftMonth(current, 1))}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
          {month !== thisMonth ? (
            <Button variant="ghost" size="sm" onClick={() => setMonth(thisMonth)}>
              This month
            </Button>
          ) : null}
        </div>
        {currencies.length > 1 ? (
          <div className="flex items-center gap-2">
            <label htmlFor={`${id}-currency`} className="text-sm text-muted-foreground">
              Currency
            </label>
            <NativeSelect
              id={`${id}-currency`}
              className="w-28"
              value={currency}
              onChange={(event) => {
                if (isCurrency(event.target.value)) setCurrency(event.target.value);
              }}
            >
              {currencies.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
      </div>

      {resource.status === "error" ? (
        <div role="alert" className="space-y-3 rounded-xl border bg-card p-4 text-sm">
          <p>{resource.message}</p>
          <Button variant="outline" size="sm" onClick={reload}>
            Try again
          </Button>
        </div>
      ) : resource.status === "loading" ? (
        <OverviewSkeleton />
      ) : (
        <div
          aria-busy={refreshing}
          className={cn("space-y-6 transition-opacity duration-150", refreshing && "opacity-70")}
        >
          <CashFlowTiles {...resource.data.summary} currency={currency} />

          <CommitmentsSummary
            workspaceId={workspaceId}
            currency={currency}
            onOpenUpcoming={() => onShowTab("upcoming")}
          />

          <div className="grid gap-6 xl:grid-cols-2">
            <Panel title="Income and spending" description="The last six months.">
              <TrendChart
                months={resource.data.trend.months}
                currency={currency}
                selected={month}
              />
            </Panel>
            <Panel
              title="Spending by category"
              description="After refunds. Transfers, such as card bills and investments, aren’t spending."
            >
              {resource.data.spending.categories.length === 0 ? (
                <p className="text-sm text-muted-foreground">No spending this month.</p>
              ) : (
                <CategoryBreakdown
                  spending={resource.data.spending.categories}
                  total={resource.data.spending.total}
                  currency={currency}
                  categories={categoriesById}
                />
              )}
            </Panel>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Balances accounts={accounts} currency={currency} />
            <Panel title="Latest this month" flush>
              {resource.data.recent.length === 0 ? (
                <div className="flex items-center gap-3 px-5 pb-5 text-sm text-muted-foreground">
                  <Receipt className="size-4" aria-hidden="true" />
                  Nothing recorded in {monthLabel(month)}.
                </div>
              ) : (
                <ul className="divide-y border-t">
                  {resource.data.recent.map((transaction) => (
                    <TransactionItem
                      key={transaction.id}
                      transaction={transaction}
                      accounts={accountsById}
                      categories={categoriesById}
                      onEdit={onEditTransaction}
                    />
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}

export function Panel({
  title,
  description,
  flush = false,
  children,
}: {
  title: string;
  description?: string;
  /** Let the content run to the card's edges, as lists do. */
  flush?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <Card className="h-full shadow-elevation-1">
        <div className="space-y-1 p-5 pb-4">
          <h3 id={id} className="text-sm font-semibold">
            {title}
          </h3>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        <div className={flush ? undefined : "px-5 pb-5"}>{children}</div>
      </Card>
    </section>
  );
}

function CashFlowTiles({
  income,
  expenses,
  refunds,
  net_expenses,
  net,
  transactions,
  currency,
}: {
  income: number;
  expenses: number;
  refunds: number;
  net_expenses: number;
  net: number;
  transactions: number;
  currency: Currency;
}) {
  const savedShare = income > 0 && net > 0 ? Math.round((net / income) * 100) : null;
  return (
    <dl className="grid gap-4 sm:grid-cols-3">
      <Tile label="Income" value={formatMoney(income, currency)}>
        {transactions === 0 ? "Nothing recorded yet" : "Money earned this month"}
      </Tile>
      <Tile label="Spending" value={formatMoney(net_expenses, currency)}>
        {refunds > 0
          ? `${formatMoney(expenses, currency)} spent, ${formatMoney(refunds, currency)} refunded`
          : "Expenses this month"}
      </Tile>
      <Tile
        label="Net cash flow"
        value={formatMoney(net, currency, { signDisplay: net === 0 ? "auto" : "always" })}
        tone={net < 0 ? "negative" : "default"}
      >
        {net < 0
          ? "Spent more than earned"
          : savedShare !== null
            ? `Saved ${savedShare}% of income`
            : "Income minus spending"}
      </Tile>
    </dl>
  );
}

export function Tile({
  label,
  value,
  tone = "default",
  children,
}: {
  label: string;
  value: string;
  tone?: "default" | "negative";
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card p-5 shadow-elevation-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-1 text-2xl font-semibold tracking-tight tabular-nums",
          tone === "negative" && "text-destructive",
        )}
      >
        {value}
      </dd>
      <dd className="mt-1 text-xs text-muted-foreground">{children}</dd>
    </div>
  );
}

/** Balances in one currency: what the accounts hold, and what credit cards owe. Not net worth. */
function Balances({ accounts, currency }: { accounts: FinanceAccount[]; currency: Currency }) {
  // Archived accounts count while they still hold (or owe) money, matching the API's totals.
  const shown = accounts.filter(
    (account) => account.currency === currency && (!account.archived || account.balance !== 0),
  );
  const assets = shown.filter((account) => account.account_class === "asset");
  const liabilities = shown.filter((account) => account.account_class === "liability");
  const held = assets.reduce((sum, account) => sum + account.balance, 0);
  const owed = -liabilities.reduce((sum, account) => sum + account.balance, 0);

  return (
    <Panel
      title="Account balances"
      description="Opening balances plus everything recorded. Not net worth: the Net worth view adds investments at market value and other assets."
      flush
    >
      <dl className="grid grid-cols-2 gap-4 px-5 pb-4">
        <div>
          <dt className="text-xs text-muted-foreground">In your accounts</dt>
          <dd className="text-lg font-semibold tabular-nums">{formatMoney(held, currency)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Owed on cards and loans</dt>
          <dd className="text-lg font-semibold tabular-nums">{formatMoney(owed, currency)}</dd>
        </div>
      </dl>
      <ul className="divide-y border-t">
        {[...assets, ...liabilities].map((account) => (
          <li key={account.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm">{account.name}</p>
              <p className="text-xs text-muted-foreground">{accountTypeLabel(account.type)}</p>
            </div>
            <AccountBalance account={account} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** A balance as people read it: a card shows what's owed, not a negative number. */
export function AccountBalance({ account }: { account: FinanceAccount }) {
  if (account.account_class === "liability") {
    const owed = -account.balance;
    return (
      <span className="shrink-0 text-right text-sm tabular-nums">
        {owed > 0 ? (
          <>
            {formatMoney(owed, account.currency)}{" "}
            <span className="text-xs text-muted-foreground">owed</span>
          </>
        ) : owed < 0 ? (
          <>
            {formatMoney(-owed, account.currency)}{" "}
            <span className="text-xs text-muted-foreground">in credit</span>
          </>
        ) : (
          <span className="text-muted-foreground">Nothing owed</span>
        )}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "shrink-0 text-right text-sm tabular-nums",
        account.balance < 0 && "text-destructive",
      )}
    >
      {formatMoney(account.balance, account.currency)}
    </span>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <span className="sr-only">Loading this month…</span>
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((tile) => (
          <Skeleton key={tile} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}
