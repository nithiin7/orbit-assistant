import type {
  Currency,
  HoldingKind,
  InvestmentTransactionListQuery,
  NetWorthQuery,
  PortfolioQuery,
} from "@orbit/contracts";
import { queryOptions, skipToken } from "@tanstack/react-query";

import type { WithToken } from "../client";
import { financeKeys } from "../finance";
import {
  getMarketData,
  getNetWorth,
  getPortfolio,
  listAssets,
  listDeposits,
  listHoldings,
  listInvestmentAccounts,
  listInvestmentTransactions,
  listSipPlans,
  listSnapshots,
  listValuations,
  searchInstruments,
} from "./requests";

/**
 * Cache keys for a workspace's investments, assets, and net worth. They sit under the finance
 * keys: trades record ledger transactions and net worth reads every balance, so any finance
 * change refetches them, and investment changes refetch the rest of finance.
 */
export const investmentKeys = {
  all: (workspaceId: string | null) => [...financeKeys.all(workspaceId), "investments"] as const,
  portfolio: (workspaceId: string | null, query: PortfolioQuery) =>
    [...investmentKeys.all(workspaceId), "portfolio", query] as const,
  accounts: (workspaceId: string | null, today: string) =>
    [...investmentKeys.all(workspaceId), "accounts", today] as const,
  holdings: (workspaceId: string | null, today: string) =>
    [...investmentKeys.all(workspaceId), "holdings", today] as const,
  transactions: (workspaceId: string | null, query: InvestmentTransactionListQuery) =>
    [...investmentKeys.all(workspaceId), "transactions", query] as const,
  sipPlans: (workspaceId: string | null, today: string) =>
    [...investmentKeys.all(workspaceId), "sip-plans", today] as const,
  deposits: (workspaceId: string | null, today: string) =>
    [...investmentKeys.all(workspaceId), "deposits", today] as const,
  assets: (workspaceId: string | null, today: string) =>
    [...investmentKeys.all(workspaceId), "assets", today] as const,
  valuations: (workspaceId: string | null, assetId: string) =>
    [...investmentKeys.all(workspaceId), "valuations", assetId] as const,
  netWorth: (workspaceId: string | null, query: NetWorthQuery) =>
    [...investmentKeys.all(workspaceId), "net-worth", query] as const,
  snapshots: (workspaceId: string | null, currency: Currency) =>
    [...investmentKeys.all(workspaceId), "snapshots", currency] as const,
};

/**
 * Market data keys sit outside finance: they answer from an outside price service, so finance
 * changes shouldn't refetch them.
 */
export const marketDataKeys = {
  all: (workspaceId: string | null) => ["workspaces", workspaceId, "market-data"] as const,
  status: (workspaceId: string | null) => [...marketDataKeys.all(workspaceId), "status"] as const,
  search: (workspaceId: string | null, kind: HoldingKind, q: string) =>
    [...marketDataKeys.all(workspaceId), "search", kind, q] as const,
};

type Fetch<T> = (token: string, workspaceId: string, signal: AbortSignal) => Promise<T>;

function workspaceQuery<T>(withToken: WithToken, workspaceId: string | null, fetch: Fetch<T>) {
  return workspaceId === null
    ? skipToken
    : ({ signal }: { signal: AbortSignal }) =>
        withToken((token) => fetch(token, workspaceId, signal));
}

export function portfolioOptions(
  withToken: WithToken,
  workspaceId: string | null,
  query: PortfolioQuery,
) {
  return queryOptions({
    queryKey: investmentKeys.portfolio(workspaceId, query),
    queryFn: workspaceQuery(withToken, workspaceId, (token, id, signal) =>
      getPortfolio(token, id, query, { signal }),
    ),
  });
}

export function investmentAccountsOptions(
  withToken: WithToken,
  workspaceId: string | null,
  today: string,
) {
  return queryOptions({
    queryKey: investmentKeys.accounts(workspaceId, today),
    queryFn: workspaceQuery(withToken, workspaceId, (token, id, signal) =>
      listInvestmentAccounts(token, id, today, { signal }),
    ),
  });
}

export function holdingsOptions(withToken: WithToken, workspaceId: string | null, today: string) {
  return queryOptions({
    queryKey: investmentKeys.holdings(workspaceId, today),
    queryFn: workspaceQuery(withToken, workspaceId, (token, id, signal) =>
      listHoldings(token, id, today, { signal }),
    ),
  });
}

export function investmentTransactionsOptions(
  withToken: WithToken,
  workspaceId: string | null,
  query: InvestmentTransactionListQuery,
) {
  return queryOptions({
    queryKey: investmentKeys.transactions(workspaceId, query),
    queryFn: workspaceQuery(withToken, workspaceId, (token, id, signal) =>
      listInvestmentTransactions(token, id, query, { signal }),
    ),
  });
}

export function sipPlansOptions(withToken: WithToken, workspaceId: string | null, today: string) {
  return queryOptions({
    queryKey: investmentKeys.sipPlans(workspaceId, today),
    queryFn: workspaceQuery(withToken, workspaceId, (token, id, signal) =>
      listSipPlans(token, id, today, { signal }),
    ),
  });
}

export function depositsOptions(withToken: WithToken, workspaceId: string | null, today: string) {
  return queryOptions({
    queryKey: investmentKeys.deposits(workspaceId, today),
    queryFn: workspaceQuery(withToken, workspaceId, (token, id, signal) =>
      listDeposits(token, id, today, { signal }),
    ),
  });
}

export function assetsOptions(withToken: WithToken, workspaceId: string | null, today: string) {
  return queryOptions({
    queryKey: investmentKeys.assets(workspaceId, today),
    queryFn: workspaceQuery(withToken, workspaceId, (token, id, signal) =>
      listAssets(token, id, today, { signal }),
    ),
  });
}

export function valuationsOptions(
  withToken: WithToken,
  workspaceId: string | null,
  assetId: string,
) {
  return queryOptions({
    queryKey: investmentKeys.valuations(workspaceId, assetId),
    queryFn: workspaceQuery(withToken, workspaceId, (token, id, signal) =>
      listValuations(token, id, assetId, { signal }),
    ),
  });
}

export function netWorthOptions(
  withToken: WithToken,
  workspaceId: string | null,
  query: NetWorthQuery,
) {
  return queryOptions({
    queryKey: investmentKeys.netWorth(workspaceId, query),
    queryFn: workspaceQuery(withToken, workspaceId, (token, id, signal) =>
      getNetWorth(token, id, query, { signal }),
    ),
  });
}

export function snapshotsOptions(
  withToken: WithToken,
  workspaceId: string | null,
  currency: Currency,
) {
  return queryOptions({
    queryKey: investmentKeys.snapshots(workspaceId, currency),
    queryFn: workspaceQuery(withToken, workspaceId, (token, id, signal) =>
      listSnapshots(token, id, currency, { signal }),
    ),
  });
}

export function marketDataOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: marketDataKeys.status(workspaceId),
    queryFn: workspaceQuery(withToken, workspaceId, (token, id, signal) =>
      getMarketData(token, id, { signal }),
    ),
    staleTime: Infinity,
  });
}

export function instrumentSearchOptions(
  withToken: WithToken,
  workspaceId: string | null,
  kind: HoldingKind,
  q: string,
) {
  return queryOptions({
    queryKey: marketDataKeys.search(workspaceId, kind, q),
    queryFn:
      q.length < 2
        ? skipToken
        : workspaceQuery(withToken, workspaceId, (token, id, signal) =>
            searchInstruments(token, id, kind, q, { signal }),
          ),
    staleTime: 5 * 60_000,
  });
}
