import type {
  Asset,
  AssetList,
  AssetValuation,
  AssetValuationList,
  CloseDepositRequest,
  CreateAssetRequest,
  CreateDepositRequest,
  CreateHoldingRequest,
  CreateInvestmentAccountRequest,
  CreateSipPlanRequest,
  Deposit,
  DepositContributionRequest,
  DepositList,
  DepositValueRequest,
  Holding,
  HoldingList,
  HoldingPrice,
  HoldingPriceList,
  InvestmentAccount,
  InvestmentAccountList,
  InvestmentTransaction,
  InvestmentTransactionList,
  InvestmentTransactionListQuery,
  NetWorth,
  NetWorthQuery,
  NetWorthSnapshot,
  NetWorthSnapshotList,
  Portfolio,
  PortfolioQuery,
  RecordInvestmentTransactionRequest,
  RecordPriceRequest,
  RecordSipInstallmentRequest,
  RecordValuationRequest,
  SipPlan,
  SipPlanList,
  TakeSnapshotRequest,
  UpdateAssetRequest,
  UpdateDepositRequest,
  UpdateHoldingRequest,
  UpdateInvestmentAccountRequest,
  UpdateSipPlanRequest,
} from "@orbit/contracts";

import { request, type Signal, toQueryString, workspacePath } from "../client";

function path(workspaceId: string, suffix: string): string {
  return workspacePath(workspaceId, `/finance${suffix}`);
}

function item(workspaceId: string, collection: string, id: string, suffix = ""): string {
  return path(workspaceId, `/${collection}/${encodeURIComponent(id)}${suffix}`);
}

const today = (date: string) => toQueryString({ today: date });

// Portfolio and accounts

export function getPortfolio(
  token: string,
  workspaceId: string,
  query: PortfolioQuery,
  { signal }: Signal = {},
): Promise<Portfolio> {
  return request<Portfolio>(`${path(workspaceId, "/portfolio")}${toQueryString(query)}`, {
    token,
    signal,
  });
}

export function listInvestmentAccounts(
  token: string,
  workspaceId: string,
  date: string,
  { signal }: Signal = {},
): Promise<InvestmentAccountList> {
  return request<InvestmentAccountList>(
    `${path(workspaceId, "/investment-accounts")}${today(date)}`,
    { token, signal },
  );
}

export function createInvestmentAccount(
  token: string,
  workspaceId: string,
  body: CreateInvestmentAccountRequest,
): Promise<InvestmentAccount> {
  return request<InvestmentAccount>(path(workspaceId, "/investment-accounts"), {
    method: "POST",
    body,
    token,
  });
}

export function updateInvestmentAccount(
  token: string,
  workspaceId: string,
  accountId: string,
  body: UpdateInvestmentAccountRequest,
): Promise<InvestmentAccount> {
  return request<InvestmentAccount>(item(workspaceId, "investment-accounts", accountId), {
    method: "PATCH",
    body,
    token,
  });
}

// Holdings and prices

export function listHoldings(
  token: string,
  workspaceId: string,
  date: string,
  { signal }: Signal = {},
): Promise<HoldingList> {
  return request<HoldingList>(`${path(workspaceId, "/holdings")}${today(date)}`, {
    token,
    signal,
  });
}

export function createHolding(
  token: string,
  workspaceId: string,
  body: CreateHoldingRequest,
): Promise<Holding> {
  return request<Holding>(path(workspaceId, "/holdings"), { method: "POST", body, token });
}

export function updateHolding(
  token: string,
  workspaceId: string,
  holdingId: string,
  body: UpdateHoldingRequest,
): Promise<Holding> {
  return request<Holding>(item(workspaceId, "holdings", holdingId), {
    method: "PATCH",
    body,
    token,
  });
}

export function deleteHolding(token: string, workspaceId: string, holdingId: string) {
  return request<void>(item(workspaceId, "holdings", holdingId), { method: "DELETE", token });
}

export function listPrices(
  token: string,
  workspaceId: string,
  holdingId: string,
  { signal }: Signal = {},
): Promise<HoldingPriceList> {
  return request<HoldingPriceList>(item(workspaceId, "holdings", holdingId, "/prices"), {
    token,
    signal,
  });
}

export function recordPrice(
  token: string,
  workspaceId: string,
  holdingId: string,
  body: RecordPriceRequest,
): Promise<HoldingPrice> {
  return request<HoldingPrice>(item(workspaceId, "holdings", holdingId, "/prices"), {
    method: "POST",
    body,
    token,
  });
}

// Transactions and SIPs

export function listInvestmentTransactions(
  token: string,
  workspaceId: string,
  query: InvestmentTransactionListQuery,
  { signal }: Signal = {},
): Promise<InvestmentTransactionList> {
  return request<InvestmentTransactionList>(
    `${path(workspaceId, "/investment-transactions")}${toQueryString(query)}`,
    { token, signal },
  );
}

export function recordInvestmentTransaction(
  token: string,
  workspaceId: string,
  body: RecordInvestmentTransactionRequest,
): Promise<InvestmentTransaction> {
  return request<InvestmentTransaction>(path(workspaceId, "/investment-transactions"), {
    method: "POST",
    body,
    token,
  });
}

export function deleteInvestmentTransaction(
  token: string,
  workspaceId: string,
  transactionId: string,
  deleteLedger: boolean,
): Promise<void> {
  return request<void>(
    `${item(workspaceId, "investment-transactions", transactionId)}${toQueryString({
      delete_ledger: deleteLedger,
    })}`,
    { method: "DELETE", token },
  );
}

export function listSipPlans(
  token: string,
  workspaceId: string,
  date: string,
  { signal }: Signal = {},
): Promise<SipPlanList> {
  return request<SipPlanList>(`${path(workspaceId, "/sip-plans")}${today(date)}`, {
    token,
    signal,
  });
}

export function createSipPlan(
  token: string,
  workspaceId: string,
  body: CreateSipPlanRequest,
): Promise<SipPlan> {
  return request<SipPlan>(path(workspaceId, "/sip-plans"), { method: "POST", body, token });
}

export function updateSipPlan(
  token: string,
  workspaceId: string,
  planId: string,
  body: UpdateSipPlanRequest,
): Promise<SipPlan> {
  return request<SipPlan>(item(workspaceId, "sip-plans", planId), {
    method: "PATCH",
    body,
    token,
  });
}

export function recordSipInstallment(
  token: string,
  workspaceId: string,
  planId: string,
  body: RecordSipInstallmentRequest,
): Promise<InvestmentTransaction> {
  return request<InvestmentTransaction>(item(workspaceId, "sip-plans", planId, "/installments"), {
    method: "POST",
    body,
    token,
  });
}

// Deposits

export function listDeposits(
  token: string,
  workspaceId: string,
  date: string,
  { signal }: Signal = {},
): Promise<DepositList> {
  return request<DepositList>(`${path(workspaceId, "/deposits")}${today(date)}`, {
    token,
    signal,
  });
}

export function createDeposit(
  token: string,
  workspaceId: string,
  body: CreateDepositRequest,
): Promise<Deposit> {
  return request<Deposit>(path(workspaceId, "/deposits"), { method: "POST", body, token });
}

export function updateDeposit(
  token: string,
  workspaceId: string,
  depositId: string,
  body: UpdateDepositRequest,
): Promise<Deposit> {
  return request<Deposit>(item(workspaceId, "deposits", depositId), {
    method: "PATCH",
    body,
    token,
  });
}

export function contributeToDeposit(
  token: string,
  workspaceId: string,
  depositId: string,
  body: DepositContributionRequest,
): Promise<InvestmentTransaction> {
  return request<InvestmentTransaction>(
    item(workspaceId, "deposits", depositId, "/contributions"),
    {
      method: "POST",
      body,
      token,
    },
  );
}

export function valueDeposit(
  token: string,
  workspaceId: string,
  depositId: string,
  body: DepositValueRequest,
): Promise<Deposit> {
  return request<Deposit>(item(workspaceId, "deposits", depositId, "/value"), {
    method: "PUT",
    body,
    token,
  });
}

export function closeDeposit(
  token: string,
  workspaceId: string,
  depositId: string,
  body: CloseDepositRequest,
): Promise<Deposit> {
  return request<Deposit>(item(workspaceId, "deposits", depositId, "/close"), {
    method: "POST",
    body,
    token,
  });
}

export function reopenDeposit(
  token: string,
  workspaceId: string,
  depositId: string,
  deleteLedger: boolean,
): Promise<Deposit> {
  return request<Deposit>(
    `${item(workspaceId, "deposits", depositId, "/reopen")}${toQueryString({
      delete_ledger: deleteLedger,
    })}`,
    { method: "POST", token },
  );
}

// Assets

export function listAssets(
  token: string,
  workspaceId: string,
  date: string,
  { signal }: Signal = {},
): Promise<AssetList> {
  return request<AssetList>(`${path(workspaceId, "/assets")}${today(date)}`, { token, signal });
}

export function createAsset(
  token: string,
  workspaceId: string,
  body: CreateAssetRequest,
): Promise<Asset> {
  return request<Asset>(path(workspaceId, "/assets"), { method: "POST", body, token });
}

export function updateAsset(
  token: string,
  workspaceId: string,
  assetId: string,
  body: UpdateAssetRequest,
): Promise<Asset> {
  return request<Asset>(item(workspaceId, "assets", assetId), { method: "PATCH", body, token });
}

export function listValuations(
  token: string,
  workspaceId: string,
  assetId: string,
  { signal }: Signal = {},
): Promise<AssetValuationList> {
  return request<AssetValuationList>(item(workspaceId, "assets", assetId, "/valuations"), {
    token,
    signal,
  });
}

export function recordValuation(
  token: string,
  workspaceId: string,
  assetId: string,
  body: RecordValuationRequest,
): Promise<AssetValuation> {
  return request<AssetValuation>(item(workspaceId, "assets", assetId, "/valuations"), {
    method: "POST",
    body,
    token,
  });
}

// Net worth

export function getNetWorth(
  token: string,
  workspaceId: string,
  query: NetWorthQuery,
  { signal }: Signal = {},
): Promise<NetWorth> {
  return request<NetWorth>(`${path(workspaceId, "/net-worth")}${toQueryString(query)}`, {
    token,
    signal,
  });
}

export function listSnapshots(
  token: string,
  workspaceId: string,
  currency: string,
  { signal }: Signal = {},
): Promise<NetWorthSnapshotList> {
  return request<NetWorthSnapshotList>(
    `${path(workspaceId, "/net-worth/snapshots")}${toQueryString({ currency })}`,
    { token, signal },
  );
}

export function takeSnapshot(
  token: string,
  workspaceId: string,
  body: TakeSnapshotRequest,
): Promise<NetWorthSnapshot> {
  return request<NetWorthSnapshot>(path(workspaceId, "/net-worth/snapshots"), {
    method: "POST",
    body,
    token,
  });
}
