import type {
  Budget,
  BudgetDetail,
  BudgetHistory,
  BudgetHistoryQuery,
  BudgetList,
  BudgetMonth,
  BudgetMonthQuery,
  CopyBudgetsRequest,
  CopyBudgetsResult,
  CreateBudgetRequest,
  UpdateBudgetRequest,
} from "@orbit/contracts";

import { request, type Signal, toQueryString, workspacePath } from "../client";

function budgetsPath(workspaceId: string, suffix = ""): string {
  return workspacePath(workspaceId, `/finance/budgets${suffix}`);
}

function budgetPath(workspaceId: string, budgetId: string, suffix = ""): string {
  return budgetsPath(workspaceId, `/${encodeURIComponent(budgetId)}${suffix}`);
}

export function listBudgets(
  token: string,
  workspaceId: string,
  today: string,
  { signal }: Signal = {},
): Promise<BudgetList> {
  return request<BudgetList>(`${budgetsPath(workspaceId)}${toQueryString({ today })}`, {
    token,
    signal,
  });
}

export function getBudget(
  token: string,
  workspaceId: string,
  budgetId: string,
  today: string,
  { signal }: Signal = {},
): Promise<BudgetDetail> {
  return request<BudgetDetail>(`${budgetPath(workspaceId, budgetId)}${toQueryString({ today })}`, {
    token,
    signal,
  });
}

export function getBudgetMonth(
  token: string,
  workspaceId: string,
  query: BudgetMonthQuery,
  { signal }: Signal = {},
): Promise<BudgetMonth> {
  return request<BudgetMonth>(`${budgetsPath(workspaceId, "/overview")}${toQueryString(query)}`, {
    token,
    signal,
  });
}

export function getBudgetHistory(
  token: string,
  workspaceId: string,
  query: BudgetHistoryQuery,
  { signal }: Signal = {},
): Promise<BudgetHistory> {
  return request<BudgetHistory>(`${budgetsPath(workspaceId, "/history")}${toQueryString(query)}`, {
    token,
    signal,
  });
}

export function createBudget(
  token: string,
  workspaceId: string,
  body: CreateBudgetRequest,
): Promise<Budget> {
  return request<Budget>(budgetsPath(workspaceId), { method: "POST", body, token });
}

export function updateBudget(
  token: string,
  workspaceId: string,
  budgetId: string,
  body: UpdateBudgetRequest,
): Promise<Budget> {
  return request<Budget>(budgetPath(workspaceId, budgetId), { method: "PATCH", body, token });
}

export function archiveBudget(token: string, workspaceId: string, budgetId: string) {
  return request<Budget>(budgetPath(workspaceId, budgetId, "/archive"), {
    method: "POST",
    token,
  });
}

export function restoreBudget(token: string, workspaceId: string, budgetId: string) {
  return request<Budget>(budgetPath(workspaceId, budgetId, "/restore"), {
    method: "POST",
    token,
  });
}

export function deleteBudget(token: string, workspaceId: string, budgetId: string) {
  return request<void>(budgetPath(workspaceId, budgetId), { method: "DELETE", token });
}

export function copyBudgets(
  token: string,
  workspaceId: string,
  body: CopyBudgetsRequest,
): Promise<CopyBudgetsResult> {
  return request<CopyBudgetsResult>(budgetsPath(workspaceId, "/copy"), {
    method: "POST",
    body,
    token,
  });
}
