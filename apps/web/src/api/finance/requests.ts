import type {
  CreateFinanceAccountRequest,
  CreateFinanceCategoryRequest,
  CreateFinanceTransactionRequest,
  FinanceAccount,
  FinanceAccountList,
  FinanceCategory,
  FinanceCategoryList,
  FinanceExportQuery,
  FinanceReportQuery,
  FinanceTransaction,
  FinanceTransactionList,
  FinanceTransactionListQuery,
  FinanceTrend,
  FinanceTrendQuery,
  MonthlySummary,
  RenameFinanceCategoryRequest,
  SpendingByCategory,
  UpdateFinanceAccountRequest,
  UpdateFinanceTransactionRequest,
} from "@orbit/contracts";

import { request, send, type Signal, toQueryString, workspacePath } from "../client";

function financePath(workspaceId: string, suffix: string): string {
  return workspacePath(workspaceId, `/finance${suffix}`);
}

function itemPath(workspaceId: string, collection: string, id: string, suffix = ""): string {
  return financePath(workspaceId, `/${collection}/${encodeURIComponent(id)}${suffix}`);
}

// Accounts

export function listFinanceAccounts(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<FinanceAccountList> {
  return request<FinanceAccountList>(financePath(workspaceId, "/accounts"), { token, signal });
}

export function createFinanceAccount(
  token: string,
  workspaceId: string,
  body: CreateFinanceAccountRequest,
): Promise<FinanceAccount> {
  return request<FinanceAccount>(financePath(workspaceId, "/accounts"), {
    method: "POST",
    body,
    token,
  });
}

export function updateFinanceAccount(
  token: string,
  workspaceId: string,
  accountId: string,
  body: UpdateFinanceAccountRequest,
): Promise<FinanceAccount> {
  return request<FinanceAccount>(itemPath(workspaceId, "accounts", accountId), {
    method: "PATCH",
    body,
    token,
  });
}

export function archiveFinanceAccount(
  token: string,
  workspaceId: string,
  accountId: string,
  archived: boolean,
): Promise<FinanceAccount> {
  const action = archived ? "/archive" : "/restore";
  return request<FinanceAccount>(itemPath(workspaceId, "accounts", accountId, action), {
    method: "POST",
    token,
  });
}

// Categories

export function listFinanceCategories(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<FinanceCategoryList> {
  return request<FinanceCategoryList>(financePath(workspaceId, "/categories"), { token, signal });
}

export function createFinanceCategory(
  token: string,
  workspaceId: string,
  body: CreateFinanceCategoryRequest,
): Promise<FinanceCategory> {
  return request<FinanceCategory>(financePath(workspaceId, "/categories"), {
    method: "POST",
    body,
    token,
  });
}

export function renameFinanceCategory(
  token: string,
  workspaceId: string,
  categoryId: string,
  body: RenameFinanceCategoryRequest,
): Promise<FinanceCategory> {
  return request<FinanceCategory>(itemPath(workspaceId, "categories", categoryId), {
    method: "PATCH",
    body,
    token,
  });
}

export function deleteFinanceCategory(
  token: string,
  workspaceId: string,
  categoryId: string,
): Promise<void> {
  return request<void>(itemPath(workspaceId, "categories", categoryId), {
    method: "DELETE",
    token,
  });
}

// Transactions

export function listFinanceTransactions(
  token: string,
  workspaceId: string,
  query: FinanceTransactionListQuery = {},
  { signal }: Signal = {},
): Promise<FinanceTransactionList> {
  return request<FinanceTransactionList>(
    `${financePath(workspaceId, "/transactions")}${toQueryString(query)}`,
    { token, signal },
  );
}

export function createFinanceTransaction(
  token: string,
  workspaceId: string,
  body: CreateFinanceTransactionRequest,
): Promise<FinanceTransaction> {
  return request<FinanceTransaction>(financePath(workspaceId, "/transactions"), {
    method: "POST",
    body,
    token,
  });
}

export function updateFinanceTransaction(
  token: string,
  workspaceId: string,
  transactionId: string,
  body: UpdateFinanceTransactionRequest,
): Promise<FinanceTransaction> {
  return request<FinanceTransaction>(itemPath(workspaceId, "transactions", transactionId), {
    method: "PATCH",
    body,
    token,
  });
}

export function deleteFinanceTransaction(
  token: string,
  workspaceId: string,
  transactionId: string,
): Promise<void> {
  return request<void>(itemPath(workspaceId, "transactions", transactionId), {
    method: "DELETE",
    token,
  });
}

/** The transactions in the range as a CSV file. */
export async function exportFinanceTransactions(
  token: string,
  workspaceId: string,
  query: FinanceExportQuery = {},
): Promise<Blob> {
  const response = await send(
    `${financePath(workspaceId, "/transactions/export")}${toQueryString(query)}`,
    { token },
  );
  return response.blob();
}

// Reports

export function getMonthlySummary(
  token: string,
  workspaceId: string,
  query: FinanceReportQuery,
  { signal }: Signal = {},
): Promise<MonthlySummary> {
  return request<MonthlySummary>(`${financePath(workspaceId, "/summary")}${toQueryString(query)}`, {
    token,
    signal,
  });
}

export function getFinanceTrend(
  token: string,
  workspaceId: string,
  query: FinanceTrendQuery,
  { signal }: Signal = {},
): Promise<FinanceTrend> {
  return request<FinanceTrend>(`${financePath(workspaceId, "/trend")}${toQueryString(query)}`, {
    token,
    signal,
  });
}

export function getSpendingByCategory(
  token: string,
  workspaceId: string,
  query: FinanceReportQuery,
  { signal }: Signal = {},
): Promise<SpendingByCategory> {
  return request<SpendingByCategory>(
    `${financePath(workspaceId, "/spending")}${toQueryString(query)}`,
    { token, signal },
  );
}
