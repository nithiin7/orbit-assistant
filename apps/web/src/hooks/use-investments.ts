"use client";

import type {
  AssetList,
  AssetValuationList,
  CloseDepositRequest,
  CreateAssetRequest,
  CreateDepositRequest,
  CreateHoldingRequest,
  CreateInvestmentAccountRequest,
  CreateSipPlanRequest,
  Currency,
  DepositContributionRequest,
  DepositList,
  DepositValueRequest,
  HoldingList,
  InvestmentAccountList,
  InvestmentTransactionList,
  InvestmentTransactionListQuery,
  NetWorth,
  NetWorthQuery,
  NetWorthSnapshotList,
  Portfolio,
  PortfolioQuery,
  RecordInvestmentTransactionRequest,
  RecordPriceRequest,
  RecordSipInstallmentRequest,
  RecordValuationRequest,
  TakeSnapshotRequest,
  UpdateAssetRequest,
  UpdateDepositRequest,
  UpdateHoldingRequest,
  UpdateInvestmentAccountRequest,
  UpdateSipPlanRequest,
} from "@orbit/contracts";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { financeKeys } from "@/api/finance";
import {
  assetsOptions,
  closeDeposit,
  contributeToDeposit,
  createAsset,
  createDeposit,
  createHolding,
  createInvestmentAccount,
  createSipPlan,
  deleteHolding,
  deleteInvestmentTransaction,
  depositsOptions,
  holdingsOptions,
  investmentAccountsOptions,
  investmentTransactionsOptions,
  netWorthOptions,
  portfolioOptions,
  recordInvestmentTransaction,
  recordPrice,
  recordSipInstallment,
  recordValuation,
  reopenDeposit,
  sipPlansOptions,
  snapshotsOptions,
  takeSnapshot,
  updateAsset,
  updateDeposit,
  updateHolding,
  updateInvestmentAccount,
  updateSipPlan,
  valuationsOptions,
  valueDeposit,
} from "@/api/investments";
import { reminderKeys } from "@/api/reminders";
import { queryResource, type Resource } from "@/hooks/query-resource";
import { useWorkspaceNotFound } from "@/hooks/use-workspace-not-found";
import { useAuth } from "@/providers/auth";

type Loaded<T> = { state: Resource<T>; refreshing: boolean; reload: () => void };

function useLoaded<T>(result: ReturnType<typeof useQuery<T>>, fallback: string): Loaded<T> {
  useWorkspaceNotFound(result.error);
  const state = queryResource(result, fallback);
  const { refetch } = result;
  const reload = useCallback(() => void refetch(), [refetch]);
  return { state, refreshing: state.status === "success" && result.isFetching, reload };
}

/** The portfolio summary; the previous result stays visible while the range or currency changes. */
export function usePortfolio(workspaceId: string, query: PortfolioQuery): Loaded<Portfolio> {
  const { withToken } = useAuth();
  return useLoaded(
    useQuery({
      ...portfolioOptions(withToken, workspaceId, query),
      placeholderData: keepPreviousData,
    }),
    "Couldn’t load your portfolio.",
  );
}

export function useInvestmentAccounts(
  workspaceId: string,
  today: string,
): Loaded<InvestmentAccountList> {
  const { withToken } = useAuth();
  return useLoaded(
    useQuery(investmentAccountsOptions(withToken, workspaceId, today)),
    "Couldn’t load your investment accounts.",
  );
}

export function useHoldings(workspaceId: string, today: string): Loaded<HoldingList> {
  const { withToken } = useAuth();
  return useLoaded(
    useQuery(holdingsOptions(withToken, workspaceId, today)),
    "Couldn’t load your holdings.",
  );
}

export function useInvestmentTransactions(
  workspaceId: string,
  query: InvestmentTransactionListQuery,
): Loaded<InvestmentTransactionList> {
  const { withToken } = useAuth();
  return useLoaded(
    useQuery({
      ...investmentTransactionsOptions(withToken, workspaceId, query),
      placeholderData: keepPreviousData,
    }),
    "Couldn’t load your investment activity.",
  );
}

export function useSipPlans(workspaceId: string, today: string) {
  const { withToken } = useAuth();
  return useLoaded(useQuery(sipPlansOptions(withToken, workspaceId, today)), "Couldn’t load SIPs.");
}

export function useDeposits(workspaceId: string, today: string): Loaded<DepositList> {
  const { withToken } = useAuth();
  return useLoaded(
    useQuery(depositsOptions(withToken, workspaceId, today)),
    "Couldn’t load your deposits.",
  );
}

export function useAssets(workspaceId: string, today: string): Loaded<AssetList> {
  const { withToken } = useAuth();
  return useLoaded(useQuery(assetsOptions(withToken, workspaceId, today)), "Couldn’t load assets.");
}

/** An asset's valuation history, loaded only while `enabled` (the history is open). */
export function useValuations(
  workspaceId: string,
  assetId: string,
  enabled: boolean,
): Loaded<AssetValuationList> {
  const { withToken } = useAuth();
  return useLoaded(
    useQuery({ ...valuationsOptions(withToken, workspaceId, assetId), enabled }),
    "Couldn’t load the history.",
  );
}

export function useNetWorth(workspaceId: string, query: NetWorthQuery): Loaded<NetWorth> {
  const { withToken } = useAuth();
  return useLoaded(
    useQuery({
      ...netWorthOptions(withToken, workspaceId, query),
      placeholderData: keepPreviousData,
    }),
    "Couldn’t load your net worth.",
  );
}

export function useSnapshots(
  workspaceId: string,
  currency: Currency,
): Loaded<NetWorthSnapshotList> {
  const { withToken } = useAuth();
  return useLoaded(
    useQuery(snapshotsOptions(withToken, workspaceId, currency)),
    "Couldn’t load your net worth history.",
  );
}

type WithId<T> = { id: string; body: T };

/**
 * Changes to investments, assets, and snapshots. Trades record ledger transactions and deposits
 * move reminders, so every change refetches the workspace's finance (including investments and
 * net worth) and reminders. Await `mutateAsync` to handle failures.
 */
export function useInvestmentMutations(workspaceId: string) {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  const onSuccess = () => {
    void queryClient.invalidateQueries({ queryKey: financeKeys.all(workspaceId) });
    void queryClient.invalidateQueries({ queryKey: reminderKeys.all(workspaceId) });
  };
  const run = <T>(call: (token: string) => Promise<T>) => withToken(call);

  return {
    createAccount: useMutation({
      mutationFn: (body: CreateInvestmentAccountRequest) =>
        run((t) => createInvestmentAccount(t, workspaceId, body)),
      onSuccess,
    }),
    updateAccount: useMutation({
      mutationFn: ({ id, body }: WithId<UpdateInvestmentAccountRequest>) =>
        run((t) => updateInvestmentAccount(t, workspaceId, id, body)),
      onSuccess,
    }),
    createHolding: useMutation({
      mutationFn: (body: CreateHoldingRequest) => run((t) => createHolding(t, workspaceId, body)),
      onSuccess,
    }),
    updateHolding: useMutation({
      mutationFn: ({ id, body }: WithId<UpdateHoldingRequest>) =>
        run((t) => updateHolding(t, workspaceId, id, body)),
      onSuccess,
    }),
    deleteHolding: useMutation({
      mutationFn: (id: string) => run((t) => deleteHolding(t, workspaceId, id)),
      onSuccess,
    }),
    recordPrice: useMutation({
      mutationFn: ({ id, body }: WithId<RecordPriceRequest>) =>
        run((t) => recordPrice(t, workspaceId, id, body)),
      onSuccess,
    }),
    recordTransaction: useMutation({
      mutationFn: (body: RecordInvestmentTransactionRequest) =>
        run((t) => recordInvestmentTransaction(t, workspaceId, body)),
      onSuccess,
    }),
    deleteTransaction: useMutation({
      mutationFn: ({ id, deleteLedger }: { id: string; deleteLedger: boolean }) =>
        run((t) => deleteInvestmentTransaction(t, workspaceId, id, deleteLedger)),
      onSuccess,
    }),
    createSip: useMutation({
      mutationFn: (body: CreateSipPlanRequest) => run((t) => createSipPlan(t, workspaceId, body)),
      onSuccess,
    }),
    updateSip: useMutation({
      mutationFn: ({ id, body }: WithId<UpdateSipPlanRequest>) =>
        run((t) => updateSipPlan(t, workspaceId, id, body)),
      onSuccess,
    }),
    recordSip: useMutation({
      mutationFn: ({ id, body }: WithId<RecordSipInstallmentRequest>) =>
        run((t) => recordSipInstallment(t, workspaceId, id, body)),
      onSuccess,
    }),
    createDeposit: useMutation({
      mutationFn: (body: CreateDepositRequest) => run((t) => createDeposit(t, workspaceId, body)),
      onSuccess,
    }),
    updateDeposit: useMutation({
      mutationFn: ({ id, body }: WithId<UpdateDepositRequest>) =>
        run((t) => updateDeposit(t, workspaceId, id, body)),
      onSuccess,
    }),
    contribute: useMutation({
      mutationFn: ({ id, body }: WithId<DepositContributionRequest>) =>
        run((t) => contributeToDeposit(t, workspaceId, id, body)),
      onSuccess,
    }),
    valueDeposit: useMutation({
      mutationFn: ({ id, body }: WithId<DepositValueRequest>) =>
        run((t) => valueDeposit(t, workspaceId, id, body)),
      onSuccess,
    }),
    closeDeposit: useMutation({
      mutationFn: ({ id, body }: WithId<CloseDepositRequest>) =>
        run((t) => closeDeposit(t, workspaceId, id, body)),
      onSuccess,
    }),
    reopenDeposit: useMutation({
      mutationFn: ({ id, deleteLedger }: { id: string; deleteLedger: boolean }) =>
        run((t) => reopenDeposit(t, workspaceId, id, deleteLedger)),
      onSuccess,
    }),
    createAsset: useMutation({
      mutationFn: (body: CreateAssetRequest) => run((t) => createAsset(t, workspaceId, body)),
      onSuccess,
    }),
    updateAsset: useMutation({
      mutationFn: ({ id, body }: WithId<UpdateAssetRequest>) =>
        run((t) => updateAsset(t, workspaceId, id, body)),
      onSuccess,
    }),
    recordValuation: useMutation({
      mutationFn: ({ id, body }: WithId<RecordValuationRequest>) =>
        run((t) => recordValuation(t, workspaceId, id, body)),
      onSuccess,
    }),
    takeSnapshot: useMutation({
      mutationFn: (body: TakeSnapshotRequest) => run((t) => takeSnapshot(t, workspaceId, body)),
      onSuccess,
    }),
  };
}
