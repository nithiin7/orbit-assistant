"use client";

import type { Currency, FinanceAccount } from "@orbit/contracts";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  ChartColumn,
  ChartPie,
  Receipt,
  Wallet,
} from "lucide-react";
import { type ReactNode, useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useFinanceReport } from "@/hooks/use-finance";
import { accountTypeLabel, formatMoney } from "@/lib/finance";
import { byId, cn } from "@/utils/common";
import { monthLabel } from "@/utils/dates";

import { BudgetSummary } from "./budget-summary";
import { CommitmentsSummary } from "./commitments-summary";
import { CategoryBreakdown, TrendChart } from "./finance-charts";
import { ACCOUNT_TYPE_ICONS as TYPE_ICONS } from "./finance-meta";
import type { FinanceData } from "./finance-view";
import { LoadError, Panel } from "./panel";
import { TransactionItem } from "./transaction-item";
import { CurrencySwitcher, MonthSwitcher, ViewHeader } from "./view-header";

/** How many accounts the overview lists before pointing to the Accounts view. */
const ACCOUNTS_SHOWN = 6;

/** One month's cash flow, commitments, plans, trend, spending, balances, and latest entries. */
export function FinanceOverview({
  workspaceId,
  accounts,
  categories,
  onEditTransaction,
  onShowTab,
  month: sharedMonth,
  thisMonth,
  onMonthChange,
  currency,
  currencies,
  onCurrencyChange,
}: FinanceData) {
  // Budgets and plans can look ahead; a report of what happened can't, so stop at this month.
  const month = sharedMonth > thisMonth ? thisMonth : sharedMonth;
  const { resource, refreshing, reload } = useFinanceReport(workspaceId, month, currency);
  const accountsById = useMemo(() => byId(accounts), [accounts]);
  const categoriesById = useMemo(() => byId(categories), [categories]);

  return (
    <div className="space-y-6">
      <ViewHeader
        title="Overview"
        controls={
          <>
            <MonthSwitcher month={month} thisMonth={thisMonth} onChange={onMonthChange} />
            <CurrencySwitcher
              currencies={currencies}
              currency={currency}
              onChange={onCurrencyChange}
            />
          </>
        }
      />

      {resource.status === "error" ? (
        <LoadError message={resource.message} onRetry={reload} />
      ) : resource.status === "loading" ? (
        <OverviewSkeleton />
      ) : (
        <div
          aria-busy={refreshing}
          className={cn("space-y-6 transition-opacity duration-150", refreshing && "opacity-70")}
        >
          <CashFlowHero {...resource.data.summary} month={month} currency={currency} />

          {/* A dashboard of cards: one column on phones, two from a medium column, three on very
              wide ones. Budget, goal, and commitment cards appear once the workspace has them. */}
          <div className="grid gap-4 @3xl/list:grid-cols-2 @3xl/list:gap-6 @7xl/list:grid-cols-3">
            <Panel
              title="Income and spending"
              description="The last six months."
              icon={ChartColumn}
              accent="income"
              className="@3xl/list:col-span-2"
            >
              <TrendChart
                months={resource.data.trend.months}
                currency={currency}
                selected={month}
              />
            </Panel>
            <Panel
              title="Spending by category"
              description="Transfers aren’t spending."
              icon={ChartPie}
              accent="spending"
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

            <CommitmentsSummary
              workspaceId={workspaceId}
              currency={currency}
              onOpenUpcoming={() => onShowTab("upcoming")}
            />
            <BudgetSummary
              workspaceId={workspaceId}
              month={month}
              currency={currency}
              onOpenBudgets={() => onShowTab("budgets")}
              onOpenGoals={() => onShowTab("goals")}
            />

            <Balances
              accounts={accounts}
              currency={currency}
              onOpenAccounts={() => onShowTab("accounts")}
            />
            <Panel
              title="Latest this month"
              icon={Receipt}
              accent="neutral"
              flush
              action={
                <Button variant="ghost" size="sm" onClick={() => onShowTab("transactions")}>
                  All transactions
                  <ArrowRight aria-hidden="true" />
                </Button>
              }
            >
              {resource.data.recent.length === 0 ? (
                <p className="mx-5 mb-5 rounded-xl border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                  Nothing recorded in {monthLabel(month)}.
                </p>
              ) : (
                <ul className="@container/rows divide-y border-t">
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

/**
 * The month's cash flow as one card: net cash flow in large type, how income split between
 * spending and what was kept, and income and spending beside it.
 */
function CashFlowHero({
  income,
  expenses,
  refunds,
  net_expenses,
  net,
  transactions,
  month,
  currency,
}: {
  income: number;
  expenses: number;
  refunds: number;
  net_expenses: number;
  net: number;
  transactions: number;
  month: string;
  currency: Currency;
}) {
  const savedShare = income > 0 && net > 0 ? Math.round((net / income) * 100) : null;
  // How much of the income went on spending; past 100% the bar is all spending.
  const spentShare = income > 0 ? Math.min(100, Math.round((net_expenses / income) * 100)) : null;
  return (
    <section
      aria-label={`Cash flow, ${monthLabel(month)}`}
      className="relative overflow-hidden rounded-2xl border bg-linear-to-br from-brand-subtle/80 via-card to-card p-5 shadow-elevation-1 @3xl/list:p-6"
    >
      <Wallet
        aria-hidden="true"
        className="pointer-events-none absolute -top-8 -right-8 size-44 -rotate-12 text-brand opacity-[0.05]"
      />
      <dl className="relative grid gap-6 @4xl/list:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] @4xl/list:items-center">
        <div className="min-w-0 space-y-3">
          <div className="space-y-1">
            <dt className="text-xs font-medium tracking-wide text-brand uppercase">
              Net cash flow
            </dt>
            <dd
              className={cn(
                // Money never breaks across lines: a sign or currency symbol stays with its digits.
                "text-3xl font-semibold tracking-tight whitespace-nowrap tabular-nums @3xl/list:text-4xl",
                net < 0 && "text-destructive",
                net > 0 && "text-success",
              )}
            >
              {formatMoney(net, currency, { signDisplay: net === 0 ? "auto" : "always" })}
            </dd>
            <dd className="text-sm text-muted-foreground">
              {transactions === 0
                ? `Nothing recorded in ${monthLabel(month)} yet.`
                : net < 0
                  ? "Spent more than earned"
                  : savedShare !== null
                    ? `Saved ${savedShare}% of income`
                    : "Income minus spending"}
            </dd>
          </div>
          {spentShare !== null ? (
            <div aria-hidden="true" className="space-y-1.5">
              <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-chart-2 transition-[width] duration-500"
                  style={{ width: `${spentShare}%` }}
                />
                <div className="h-full flex-1 bg-success/70" />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                <span>{spentShare}% spent</span>
                <span>{100 - spentShare}% kept</span>
              </div>
            </div>
          ) : null}
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-3">
          <FlowFigure
            label="Income"
            icon={ArrowDownLeft}
            iconClass="bg-chart-1/12 text-chart-1"
            value={formatMoney(income, currency)}
          >
            {transactions === 0 ? "Nothing recorded yet" : "Money earned this month"}
          </FlowFigure>
          <FlowFigure
            label="Spending"
            icon={ArrowUpRight}
            iconClass="bg-chart-2/12 text-chart-2"
            value={formatMoney(net_expenses, currency)}
          >
            {refunds > 0
              ? `${formatMoney(expenses, currency)} spent, ${formatMoney(refunds, currency)} refunded`
              : "Expenses this month"}
          </FlowFigure>
        </div>
      </dl>
    </section>
  );
}

function FlowFigure({
  label,
  icon: Icon,
  iconClass,
  value,
  children,
}: {
  label: string;
  icon: typeof ArrowDownLeft;
  iconClass: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <div className="relative min-w-0 space-y-1 rounded-xl border bg-card/80 p-4 backdrop-blur-sm">
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-3.5 right-3.5 flex size-8 items-center justify-center rounded-lg",
          iconClass,
        )}
      >
        <Icon className="size-4" />
      </span>
      <dt className="pr-10 text-sm text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold tracking-tight whitespace-nowrap tabular-nums">
        {value}
      </dd>
      <dd className="text-xs text-muted-foreground">{children}</dd>
    </div>
  );
}

/** Balances in one currency: what the accounts hold, and what cards and loans owe. Not net worth. */
function Balances({
  accounts,
  currency,
  onOpenAccounts,
}: {
  accounts: FinanceAccount[];
  currency: Currency;
  onOpenAccounts: () => void;
}) {
  // Archived accounts count while they still hold (or owe) money, matching the API's totals.
  const shown = accounts.filter(
    (account) => account.currency === currency && (!account.archived || account.balance !== 0),
  );
  const assets = shown.filter((account) => account.account_class === "asset");
  const liabilities = shown.filter((account) => account.account_class === "liability");
  const held = assets.reduce((sum, account) => sum + account.balance, 0);
  const owed = -liabilities.reduce((sum, account) => sum + account.balance, 0);
  // The largest balances first, so the short list shows what matters most.
  const listed = [...shown]
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
    .slice(0, ACCOUNTS_SHOWN);
  const rest = shown.length - listed.length;

  return (
    <Panel
      title="Account balances"
      description="Excludes investments and assets."
      icon={Wallet}
      accent="brand"
      flush
      action={
        <Button variant="ghost" size="sm" onClick={onOpenAccounts}>
          Accounts
          <ArrowRight aria-hidden="true" />
        </Button>
      }
    >
      <dl className="grid grid-cols-2 gap-3 px-5 pb-4">
        <div className="min-w-0 rounded-xl bg-muted/60 px-3 py-2.5">
          <dt className="text-xs text-muted-foreground">In your accounts</dt>
          <dd className="text-lg font-semibold whitespace-nowrap tabular-nums">
            {formatMoney(held, currency)}
          </dd>
        </div>
        <div className="min-w-0 rounded-xl bg-muted/60 px-3 py-2.5">
          <dt className="text-xs text-muted-foreground">Owed on cards and loans</dt>
          <dd className="text-lg font-semibold whitespace-nowrap tabular-nums">
            {formatMoney(owed, currency)}
          </dd>
        </div>
      </dl>
      <ul className="divide-y border-t">
        {listed.map((account) => {
          const TypeIcon = TYPE_ICONS[account.type];
          return (
            <li key={account.id} className="flex items-center gap-3 px-5 py-2.5">
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
              >
                <TypeIcon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{account.name}</p>
                <p className="text-xs text-muted-foreground">{accountTypeLabel(account.type)}</p>
              </div>
              <AccountBalance account={account} />
            </li>
          );
        })}
      </ul>
      {rest > 0 ? (
        <p className="border-t px-5 py-2.5 text-xs text-muted-foreground">
          And {rest} more {rest === 1 ? "account" : "accounts"} in Accounts.
        </p>
      ) : null}
    </Panel>
  );
}

/** A balance as people read it: a card shows what's owed, not a negative number. */
export function AccountBalance({ account }: { account: FinanceAccount }) {
  if (account.account_class === "liability") {
    const owed = -account.balance;
    return (
      <span className="shrink-0 text-right text-sm whitespace-nowrap tabular-nums">
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
        "shrink-0 text-right text-sm whitespace-nowrap tabular-nums",
        account.balance < 0 && "text-destructive",
      )}
    >
      {formatMoney(account.balance, account.currency)}
    </span>
  );
}

/** The month overview while it loads. */
export function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <span className="sr-only">Loading this month…</span>
      <Skeleton className="h-44 rounded-2xl" />
      <div className="grid gap-6 @3xl/list:grid-cols-2">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}
