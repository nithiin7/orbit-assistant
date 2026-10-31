"use client";

import type {
  BalanceTotals,
  BudgetMonth,
  Currency,
  MonthlySummary,
  NetWorth,
  PaymentItem,
} from "@orbit/contracts";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { budgetMonthOptions } from "@/api/budgets";
import { describeApiError } from "@/api/client";
import { paymentsOptions } from "@/api/commitments";
import { financeAccountsOptions, monthlySummaryOptions } from "@/api/finance";
import { netWorthOptions } from "@/api/investments";
import type { Resource } from "@/hooks/query-resource";
import { useWorkspaceNotFound } from "@/hooks/use-workspace-not-found";
import { accountCurrencies, DEFAULT_CURRENCY } from "@/lib/finance";
import { useAuth } from "@/providers/auth";
import { useWorkspaces } from "@/providers/workspace";
import { addDays, localDateString, localMonthString } from "@/utils/dates";

/** A dashboard widget's data, as the state it renders, and a way to retry after an error. */
export type FinanceWidget<T> = { resource: Resource<T>; reload: () => void };

/** How far ahead the payments widget looks, in days. */
export const UPCOMING_DAYS = 30;

/**
 * The active workspace and the currency its finance widgets report in: the one most of its open
 * accounts use (the Finance page's default). `currency` is `null` until the accounts load.
 */
function useFinanceBasis() {
  const { withToken } = useAuth();
  const { state } = useWorkspaces();
  const workspaceId = state.status === "ready" ? state.active.id : null;
  const accounts = useQuery(financeAccountsOptions(withToken, workspaceId));
  const open = accounts.data?.accounts.filter((account) => !account.archived);
  const currency = open ? (accountCurrencies(open)[0] ?? DEFAULT_CURRENCY) : null;
  return { withToken, workspaceId, accounts, open, currency };
}

/** Combine a widget's queries: the first failure shows as its error; `data` once all loaded. */
function widget<T>(
  queries: readonly UseQueryResult<unknown>[],
  fallback: string,
  data: T | undefined,
): FinanceWidget<T> {
  const failed = queries.find((query) => query.isError && !query.isFetching);
  const resource: Resource<T> = failed
    ? { status: "error", message: describeApiError(failed.error, fallback) }
    : data !== undefined
      ? { status: "success", data }
      : { status: "loading" };
  const reload = () => {
    for (const query of queries) void query.refetch();
  };
  return { resource, reload };
}

export type CashFlowData = {
  currency: Currency;
  /** `null` when the workspace has no open accounts yet. */
  summary: MonthlySummary | null;
  totals: BalanceTotals | null;
};

/** This month's income and spending, and account balances, in the main currency. */
export function useCashFlowWidget(): FinanceWidget<CashFlowData> {
  const { withToken, workspaceId, accounts, open, currency } = useFinanceBasis();
  const hasAccounts = open !== undefined && open.length > 0;
  const summary = useQuery(
    monthlySummaryOptions(withToken, hasAccounts ? workspaceId : null, {
      month: localMonthString(),
      currency: currency ?? DEFAULT_CURRENCY,
    }),
  );
  useWorkspaceNotFound(accounts.error ?? summary.error);

  let data: CashFlowData | undefined;
  if (accounts.data && currency) {
    const totals = accounts.data.totals.find((total) => total.currency === currency) ?? null;
    if (!hasAccounts) data = { currency, summary: null, totals };
    else if (summary.data) data = { currency, summary: summary.data, totals };
  }
  return widget([accounts, summary], "Couldn’t load this month’s figures.", data);
}

/** Overdue payments and those due in the next {@link UPCOMING_DAYS} days, soonest first. */
export function useUpcomingPaymentsWidget(): FinanceWidget<PaymentItem[]> {
  const { withToken } = useAuth();
  const { state } = useWorkspaces();
  const workspaceId = state.status === "ready" ? state.active.id : null;
  const today = localDateString();
  const payments = useQuery(
    paymentsOptions(withToken, workspaceId, {
      today,
      date_from: today,
      date_to: addDays(today, UPCOMING_DAYS),
      include_overdue: true,
      status: ["overdue", "due", "upcoming"],
    }),
  );
  useWorkspaceNotFound(payments.error);
  const data =
    payments.data &&
    [...payments.data.payments].sort((a, b) => a.due_date.localeCompare(b.due_date));
  return widget([payments], "Couldn’t load your payments.", data);
}

export type BudgetWidgetData = { currency: Currency; month: BudgetMonth };

/** This month's budgets in the main currency. */
export function useBudgetWidget(): FinanceWidget<BudgetWidgetData> {
  const { withToken, workspaceId, accounts, currency } = useFinanceBasis();
  const month = useQuery(
    budgetMonthOptions(withToken, currency ? workspaceId : null, {
      month: localMonthString(),
      currency: currency ?? DEFAULT_CURRENCY,
      today: localDateString(),
    }),
  );
  useWorkspaceNotFound(accounts.error ?? month.error);
  const data = currency && month.data ? { currency, month: month.data } : undefined;
  return widget([accounts, month], "Couldn’t load this month’s budget.", data);
}

/** Net worth today in the main currency. */
export function useNetWorthWidget(): FinanceWidget<NetWorth> {
  const { withToken, workspaceId, accounts, currency } = useFinanceBasis();
  const netWorth = useQuery(
    netWorthOptions(withToken, currency ? workspaceId : null, {
      currency: currency ?? DEFAULT_CURRENCY,
      today: localDateString(),
    }),
  );
  useWorkspaceNotFound(accounts.error ?? netWorth.error);
  return widget([accounts, netWorth], "Couldn’t load your net worth.", netWorth.data);
}
