import type {
  FinanceReportQuery,
  FinanceTransactionListQuery,
  FinanceTrendQuery,
} from "@orbit/contracts";
import { queryOptions, skipToken } from "@tanstack/react-query";

import type { WithToken } from "../client";
import {
  getFinanceTrend,
  getMonthlySummary,
  getSpendingByCategory,
  listFinanceAccounts,
  listFinanceCategories,
  listFinanceTransactions,
} from "./requests";

/**
 * Cache keys for a workspace's finances. Every key starts with the workspace ID, so one
 * workspace's results can never be served for another. Balances and reports are derived from
 * transactions, so any change invalidates `all`.
 */
export const financeKeys = {
  all: (workspaceId: string | null) => ["workspaces", workspaceId, "finance"] as const,
  accounts: (workspaceId: string | null) => [...financeKeys.all(workspaceId), "accounts"] as const,
  categories: (workspaceId: string | null) =>
    [...financeKeys.all(workspaceId), "categories"] as const,
  transactions: (workspaceId: string | null, query: FinanceTransactionListQuery) =>
    [...financeKeys.all(workspaceId), "transactions", query] as const,
  summary: (workspaceId: string | null, query: FinanceReportQuery) =>
    [...financeKeys.all(workspaceId), "summary", query] as const,
  trend: (workspaceId: string | null, query: FinanceTrendQuery) =>
    [...financeKeys.all(workspaceId), "trend", query] as const,
  spending: (workspaceId: string | null, query: FinanceReportQuery) =>
    [...financeKeys.all(workspaceId), "spending", query] as const,
};

export function financeAccountsOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: financeKeys.accounts(workspaceId),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) => withToken((token) => listFinanceAccounts(token, workspaceId, { signal })),
  });
}

export function financeCategoriesOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: financeKeys.categories(workspaceId),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => listFinanceCategories(token, workspaceId, { signal })),
  });
}

export function financeTransactionsOptions(
  withToken: WithToken,
  workspaceId: string | null,
  query: FinanceTransactionListQuery,
) {
  return queryOptions({
    queryKey: financeKeys.transactions(workspaceId, query),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => listFinanceTransactions(token, workspaceId, query, { signal })),
  });
}

export function monthlySummaryOptions(
  withToken: WithToken,
  workspaceId: string | null,
  query: FinanceReportQuery,
) {
  return queryOptions({
    queryKey: financeKeys.summary(workspaceId, query),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => getMonthlySummary(token, workspaceId, query, { signal })),
  });
}

export function financeTrendOptions(
  withToken: WithToken,
  workspaceId: string | null,
  query: FinanceTrendQuery,
) {
  return queryOptions({
    queryKey: financeKeys.trend(workspaceId, query),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => getFinanceTrend(token, workspaceId, query, { signal })),
  });
}

export function spendingOptions(
  withToken: WithToken,
  workspaceId: string | null,
  query: FinanceReportQuery,
) {
  return queryOptions({
    queryKey: financeKeys.spending(workspaceId, query),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => getSpendingByCategory(token, workspaceId, query, { signal })),
  });
}
