"use client";

import type {
  CreateFinanceAccountRequest,
  CreateFinanceCategoryRequest,
  CreateFinanceTransactionRequest,
  Currency,
  FinanceAccountList,
  FinanceCategory,
  FinanceExportQuery,
  FinanceTransaction,
  FinanceTransactionList,
  FinanceTransactionListQuery,
  FinanceTrend,
  MonthlySummary,
  SpendingByCategory,
  UpdateFinanceAccountRequest,
  UpdateFinanceTransactionRequest,
} from "@orbit/contracts";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { describeApiError } from "@/api/client";
import {
  archiveFinanceAccount,
  createFinanceAccount,
  createFinanceCategory,
  createFinanceTransaction,
  deleteFinanceCategory,
  deleteFinanceTransaction,
  exportFinanceTransactions,
  financeAccountsOptions,
  financeCategoriesOptions,
  financeKeys,
  financeTransactionsOptions,
  financeTrendOptions,
  monthlySummaryOptions,
  spendingOptions,
  updateFinanceAccount,
  updateFinanceTransaction,
} from "@/api/finance";
import { queryResource, type Resource } from "@/hooks/query-resource";
import { useWorkspaceNotFound } from "@/hooks/use-workspace-not-found";
import { useAuth } from "@/providers/auth";
import { monthRange } from "@/utils/dates";

const selectCategories = (data: { categories: FinanceCategory[] }) => data.categories;

/** The workspace's accounts (with balances) and categories, which every finance view needs. */
export function useFinanceSetup(workspaceId: string): {
  accounts: Resource<FinanceAccountList>;
  categories: Resource<FinanceCategory[]>;
  reload: () => void;
} {
  const { withToken } = useAuth();
  const accountsQuery = useQuery(financeAccountsOptions(withToken, workspaceId));
  const categoriesQuery = useQuery({
    ...financeCategoriesOptions(withToken, workspaceId),
    select: selectCategories,
  });
  useWorkspaceNotFound(accountsQuery.error ?? categoriesQuery.error);

  const { refetch: refetchAccounts } = accountsQuery;
  const { refetch: refetchCategories } = categoriesQuery;
  const reload = useCallback(() => {
    void refetchAccounts();
    void refetchCategories();
  }, [refetchAccounts, refetchCategories]);
  return {
    accounts: queryResource(accountsQuery, "Couldn’t load your accounts."),
    categories: queryResource(categoriesQuery, "Couldn’t load your categories."),
    reload,
  };
}

/**
 * Transaction history for `query`. Within a workspace the previous page stays visible
 * (`refreshing`) while a new filter or page loads, so typing a search doesn't flash a skeleton.
 */
export function useTransactionHistory(
  workspaceId: string,
  query: FinanceTransactionListQuery,
): { state: Resource<FinanceTransactionList>; refreshing: boolean; reload: () => void } {
  const { withToken } = useAuth();
  const result = useQuery({
    ...financeTransactionsOptions(withToken, workspaceId, query),
    placeholderData: keepPreviousData,
  });
  useWorkspaceNotFound(result.error);
  const state = queryResource(result, "Couldn’t load your transactions.");
  const { refetch } = result;
  const reload = useCallback(() => void refetch(), [refetch]);
  return { state, refreshing: state.status === "success" && result.isFetching, reload };
}

export type FinanceReport = {
  summary: MonthlySummary;
  trend: FinanceTrend;
  spending: SpendingByCategory;
  recent: FinanceTransaction[];
};

/** Months shown in the income and spending trend. */
export const TREND_MONTHS = 6;
const RECENT_COUNT = 5;

/**
 * One month's figures in one currency, all aggregated by the API: the summary, the trend up to
 * that month, spending by category, and the month's latest transactions.
 */
export function useFinanceReport(
  workspaceId: string,
  month: string,
  currency: Currency,
): { resource: Resource<FinanceReport>; refreshing: boolean; reload: () => void } {
  const { withToken } = useAuth();
  const report = { month, currency };
  const range = monthRange(month);
  const keep = { placeholderData: keepPreviousData };
  const summary = useQuery({ ...monthlySummaryOptions(withToken, workspaceId, report), ...keep });
  const trend = useQuery({
    ...financeTrendOptions(withToken, workspaceId, { ...report, months: TREND_MONTHS }),
    ...keep,
  });
  const spending = useQuery({ ...spendingOptions(withToken, workspaceId, report), ...keep });
  const recent = useQuery({
    ...financeTransactionsOptions(withToken, workspaceId, {
      date_from: range.from,
      date_to: range.to,
      limit: RECENT_COUNT,
    }),
    ...keep,
  });
  const queries = [summary, trend, spending, recent];
  const error = queries.find((query) => query.error)?.error ?? null;
  useWorkspaceNotFound(error);
  const fetching = queries.some((query) => query.isFetching);

  let resource: Resource<FinanceReport>;
  if (error && !fetching) {
    resource = { status: "error", message: describeApiError(error, "Couldn’t load this month.") };
  } else if (summary.data && trend.data && spending.data && recent.data) {
    resource = {
      status: "success",
      data: {
        summary: summary.data,
        trend: trend.data,
        spending: spending.data,
        recent: recent.data.transactions,
      },
    };
  } else {
    resource = { status: "loading" };
  }

  const { refetch: a } = summary;
  const { refetch: b } = trend;
  const { refetch: c } = spending;
  const { refetch: d } = recent;
  const reload = useCallback(() => {
    for (const refetch of [a, b, c, d]) void refetch();
  }, [a, b, c, d]);
  return { resource, refreshing: resource.status === "success" && fetching, reload };
}

/**
 * Finance changes for the workspace. Balances and reports are derived from transactions on the
 * server, so every change refetches the workspace's finance queries rather than patching them.
 * Await `mutateAsync` to handle failures.
 */
export function useFinanceMutations(workspaceId: string) {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  const refetchFinance = () =>
    void queryClient.invalidateQueries({ queryKey: financeKeys.all(workspaceId) });

  const createTransaction = useMutation({
    mutationFn: (body: CreateFinanceTransactionRequest) =>
      withToken((token) => createFinanceTransaction(token, workspaceId, body)),
    onSuccess: refetchFinance,
  });
  const updateTransaction = useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: UpdateFinanceTransactionRequest }) =>
      withToken((token) => updateFinanceTransaction(token, workspaceId, id, changes)),
    onSuccess: refetchFinance,
  });
  const deleteTransaction = useMutation({
    mutationFn: (transaction: FinanceTransaction) =>
      withToken((token) => deleteFinanceTransaction(token, workspaceId, transaction.id)),
    onSuccess: refetchFinance,
  });
  const createAccount = useMutation({
    mutationFn: (body: CreateFinanceAccountRequest) =>
      withToken((token) => createFinanceAccount(token, workspaceId, body)),
    onSuccess: refetchFinance,
  });
  const updateAccount = useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: UpdateFinanceAccountRequest }) =>
      withToken((token) => updateFinanceAccount(token, workspaceId, id, changes)),
    onSuccess: refetchFinance,
  });
  const archiveAccount = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      withToken((token) => archiveFinanceAccount(token, workspaceId, id, archived)),
    onSuccess: refetchFinance,
  });
  const createCategory = useMutation({
    mutationFn: (body: CreateFinanceCategoryRequest) =>
      withToken((token) => createFinanceCategory(token, workspaceId, body)),
    onSuccess: refetchFinance,
  });
  const deleteCategory = useMutation({
    mutationFn: (category: FinanceCategory) =>
      withToken((token) => deleteFinanceCategory(token, workspaceId, category.id)),
    onSuccess: refetchFinance,
  });

  return {
    createTransaction,
    updateTransaction,
    deleteTransaction,
    createAccount,
    updateAccount,
    archiveAccount,
    createCategory,
    deleteCategory,
  };
}

/** Downloads the workspace's transactions in the range as a CSV file. */
export function useExportTransactions(workspaceId: string) {
  const { withToken } = useAuth();
  return useCallback(
    async (query: FinanceExportQuery) => {
      const blob = await withToken((token) => exportFinanceTransactions(token, workspaceId, query));
      const span = [query.date_from, query.date_to].filter(Boolean).join("-");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `orbit-transactions${span ? `-${span}` : ""}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    },
    [withToken, workspaceId],
  );
}
