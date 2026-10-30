import type { BudgetHistoryQuery, BudgetMonthQuery } from "@orbit/contracts";
import { queryOptions, skipToken } from "@tanstack/react-query";

import type { WithToken } from "../client";
import { financeKeys } from "../finance";
import { getBudget, getBudgetHistory, getBudgetMonth, listBudgets } from "./requests";

/**
 * Cache keys for a workspace's budgets. They sit under the finance keys: spending comes from
 * transactions, so recording or editing one refetches every budget figure.
 */
export const budgetKeys = {
  all: (workspaceId: string | null) => [...financeKeys.all(workspaceId), "budgets"] as const,
  list: (workspaceId: string | null, today: string) =>
    [...budgetKeys.all(workspaceId), "list", today] as const,
  detail: (workspaceId: string | null, budgetId: string, today: string) =>
    [...budgetKeys.all(workspaceId), "detail", budgetId, today] as const,
  month: (workspaceId: string | null, query: BudgetMonthQuery) =>
    [...budgetKeys.all(workspaceId), "month", query] as const,
  history: (workspaceId: string | null, query: BudgetHistoryQuery) =>
    [...budgetKeys.all(workspaceId), "history", query] as const,
};

export function budgetsOptions(withToken: WithToken, workspaceId: string | null, today: string) {
  return queryOptions({
    queryKey: budgetKeys.list(workspaceId, today),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) => withToken((token) => listBudgets(token, workspaceId, today, { signal })),
  });
}

export function budgetOptions(
  withToken: WithToken,
  workspaceId: string | null,
  budgetId: string,
  today: string,
) {
  return queryOptions({
    queryKey: budgetKeys.detail(workspaceId, budgetId, today),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => getBudget(token, workspaceId, budgetId, today, { signal })),
  });
}

export function budgetMonthOptions(
  withToken: WithToken,
  workspaceId: string | null,
  query: BudgetMonthQuery,
) {
  return queryOptions({
    queryKey: budgetKeys.month(workspaceId, query),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => getBudgetMonth(token, workspaceId, query, { signal })),
  });
}

export function budgetHistoryOptions(
  withToken: WithToken,
  workspaceId: string | null,
  query: BudgetHistoryQuery,
) {
  return queryOptions({
    queryKey: budgetKeys.history(workspaceId, query),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => getBudgetHistory(token, workspaceId, query, { signal })),
  });
}
