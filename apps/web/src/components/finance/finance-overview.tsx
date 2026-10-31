"use client";

import type { Currency, FinanceAccount } from "@orbit/contracts";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Receipt, Scale } from "lucide-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useFinanceReport } from "@/hooks/use-finance";
import { accountTypeLabel, formatMoney } from "@/lib/finance";
import { byId, cn } from "@/utils/common";
import { monthLabel } from "@/utils/dates";

import { BudgetSummary } from "./budget-summary";
import { CommitmentsSummary } from "./commitments-summary";
import { CategoryBreakdown, TrendChart } from "./finance-charts";
import type { FinanceData } from "./finance-view";
import { LoadError, Panel } from "./panel";
import { StatGrid, StatTile } from "./stat-tile";
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
        description={`${monthLabel(month)} at a glance: cash flow, what’s due, and your plans.`}
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
          <CashFlowTiles {...resource.data.summary} currency={currency} />

          {/* A dashboard of cards: one column on phones, two from a medium column, three on very
              wide ones. Budget, goal, and commitment cards appear once the workspace has them. */}
          <div className="grid gap-4 @3xl/list:grid-cols-2 @3xl/list:gap-6 @7xl/list:grid-cols-3">
            <Panel
              title="Income and spending"
              description="The last six months."
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
              flush
              action={
                <Button variant="ghost" size="sm" onClick={() => onShowTab("transactions")}>
                  All transactions
                  <ArrowRight aria-hidden="true" />
                </Button>
              }
            >
              {resource.data.recent.length === 0 ? (
                <div className="flex items-center gap-3 px-5 pb-5 text-sm text-muted-foreground">
                  <Receipt className="size-4" aria-hidden="true" />
                  Nothing recorded in {monthLabel(month)}.
                </div>
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
    <StatGrid>
      <StatTile
        label="Income"
        icon={ArrowDownLeft}
        accent="income"
        value={formatMoney(income, currency)}
      >
        {transactions === 0 ? "Nothing recorded yet" : "Money earned this month"}
      </StatTile>
      <StatTile
        label="Spending"
        icon={ArrowUpRight}
        accent="spending"
        value={formatMoney(net_expenses, currency)}
      >
        {refunds > 0
          ? `${formatMoney(expenses, currency)} spent, ${formatMoney(refunds, currency)} refunded`
          : "Expenses this month"}
      </StatTile>
      <StatTile
        label="Net cash flow"
        icon={Scale}
        value={formatMoney(net, currency, { signDisplay: net === 0 ? "auto" : "always" })}
        tone={net < 0 ? "negative" : net > 0 ? "positive" : "default"}
        accent={net < 0 ? "negative" : "positive"}
        emphasis
      >
        {net < 0
          ? "Spent more than earned"
          : savedShare !== null
            ? `Saved ${savedShare}% of income`
            : "Income minus spending"}
      </StatTile>
    </StatGrid>
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
      description="Opening balances plus everything recorded. Not net worth, which adds investments and other assets."
      flush
      action={
        <Button variant="ghost" size="sm" onClick={onOpenAccounts}>
          Accounts
          <ArrowRight aria-hidden="true" />
        </Button>
      }
    >
      <dl className="grid grid-cols-2 gap-4 px-5 pb-4">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">In your accounts</dt>
          <dd className="text-lg font-semibold whitespace-nowrap tabular-nums">
            {formatMoney(held, currency)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Owed on cards and loans</dt>
          <dd className="text-lg font-semibold whitespace-nowrap tabular-nums">
            {formatMoney(owed, currency)}
          </dd>
        </div>
      </dl>
      <ul className="divide-y border-t">
        {listed.map((account) => (
          <li key={account.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm">{account.name}</p>
              <p className="text-xs text-muted-foreground">{accountTypeLabel(account.type)}</p>
            </div>
            <AccountBalance account={account} />
          </li>
        ))}
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

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <span className="sr-only">Loading this month…</span>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-4">
        {[0, 1, 2].map((tile) => (
          <Skeleton key={tile} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-6 @3xl/list:grid-cols-2">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}
