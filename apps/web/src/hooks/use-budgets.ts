"use client";

import type {
  BudgetDetail,
  BudgetHistory,
  BudgetList,
  BudgetMonth,
  CopyBudgetsRequest,
  CreateBudgetRequest,
  CreateContributionRequest,
  CreateGoalRequest,
  Currency,
  GoalContributionList,
  MonthPlan,
  SavingsGoalList,
  SetIncomeRequest,
  UpdateBudgetRequest,
  UpdateGoalRequest,
} from "@orbit/contracts";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import {
  archiveBudget,
  budgetHistoryOptions,
  budgetMonthOptions,
  budgetOptions,
  budgetsOptions,
  copyBudgets,
  createBudget,
  deleteBudget,
  restoreBudget,
  updateBudget,
} from "@/api/budgets";
import { financeKeys } from "@/api/finance";
import {
  contributionsOptions,
  createContribution,
  createGoal,
  deleteContribution,
  deleteGoal,
  goalsOptions,
  updateGoal,
} from "@/api/goals";
import { clearExpectedIncome, planOptions, setExpectedIncome } from "@/api/planning";
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

export function useBudgets(workspaceId: string, today: string): Loaded<BudgetList> {
  const { withToken } = useAuth();
  return useLoaded(
    useQuery(budgetsOptions(withToken, workspaceId, today)),
    "Couldn’t load your budgets.",
  );
}

/** A budget's period history, loaded only while `enabled` (its details are open). */
export function useBudgetDetail(
  workspaceId: string,
  budgetId: string,
  today: string,
  enabled: boolean,
): Loaded<BudgetDetail> {
  const { withToken } = useAuth();
  return useLoaded(
    useQuery({ ...budgetOptions(withToken, workspaceId, budgetId, today), enabled }),
    "Couldn’t load this budget’s history.",
  );
}

/** One month's budgets and spending; the previous month stays visible while the next loads. */
export function useBudgetMonth(
  workspaceId: string,
  month: string,
  currency: Currency,
  today: string,
): Loaded<BudgetMonth> {
  const { withToken } = useAuth();
  return useLoaded(
    useQuery({
      ...budgetMonthOptions(withToken, workspaceId, { month, currency, today }),
      placeholderData: keepPreviousData,
    }),
    "Couldn’t load this month’s budgets.",
  );
}

export function useBudgetHistory(
  workspaceId: string,
  month: string,
  currency: Currency,
  today: string,
  months = 6,
): Loaded<BudgetHistory> {
  const { withToken } = useAuth();
  return useLoaded(
    useQuery({
      ...budgetHistoryOptions(withToken, workspaceId, { month, currency, today, months }),
      placeholderData: keepPreviousData,
    }),
    "Couldn’t load your budget history.",
  );
}

export function useGoals(workspaceId: string, today: string): Loaded<SavingsGoalList> {
  const { withToken } = useAuth();
  return useLoaded(
    useQuery(goalsOptions(withToken, workspaceId, today)),
    "Couldn’t load your savings goals.",
  );
}

export function useContributions(
  workspaceId: string,
  goalId: string,
  enabled: boolean,
): Loaded<GoalContributionList> {
  const { withToken } = useAuth();
  return useLoaded(
    useQuery({ ...contributionsOptions(withToken, workspaceId, goalId), enabled }),
    "Couldn’t load the contribution history.",
  );
}

export function usePlan(
  workspaceId: string,
  month: string,
  currency: Currency,
  today: string,
): Loaded<MonthPlan> {
  const { withToken } = useAuth();
  return useLoaded(
    useQuery({
      ...planOptions(withToken, workspaceId, { month, currency, today }),
      placeholderData: keepPreviousData,
    }),
    "Couldn’t load this month’s plan.",
  );
}

/**
 * Changes to budgets, savings goals, and monthly plans. A goal transfer records a transaction, and
 * every figure here is read against the ledger, so each change refetches the workspace's finance
 * queries. Await `mutateAsync` to handle failures.
 */
export function useBudgetMutations(workspaceId: string) {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  const onSuccess = () => {
    void queryClient.invalidateQueries({ queryKey: financeKeys.all(workspaceId) });
  };
  const run = <T>(call: (token: string) => Promise<T>) => withToken(call);

  return {
    createBudget: useMutation({
      mutationFn: (body: CreateBudgetRequest) => run((t) => createBudget(t, workspaceId, body)),
      onSuccess,
    }),
    updateBudget: useMutation({
      mutationFn: ({ id, changes }: { id: string; changes: UpdateBudgetRequest }) =>
        run((t) => updateBudget(t, workspaceId, id, changes)),
      onSuccess,
    }),
    archiveBudget: useMutation({
      mutationFn: (id: string) => run((t) => archiveBudget(t, workspaceId, id)),
      onSuccess,
    }),
    restoreBudget: useMutation({
      mutationFn: (id: string) => run((t) => restoreBudget(t, workspaceId, id)),
      onSuccess,
    }),
    deleteBudget: useMutation({
      mutationFn: (id: string) => run((t) => deleteBudget(t, workspaceId, id)),
      onSuccess,
    }),
    copyBudgets: useMutation({
      mutationFn: (body: CopyBudgetsRequest) => run((t) => copyBudgets(t, workspaceId, body)),
      onSuccess,
    }),
    createGoal: useMutation({
      mutationFn: (body: CreateGoalRequest) => run((t) => createGoal(t, workspaceId, body)),
      onSuccess,
    }),
    updateGoal: useMutation({
      mutationFn: ({ id, changes }: { id: string; changes: UpdateGoalRequest }) =>
        run((t) => updateGoal(t, workspaceId, id, changes)),
      onSuccess,
    }),
    deleteGoal: useMutation({
      mutationFn: (id: string) => run((t) => deleteGoal(t, workspaceId, id)),
      onSuccess,
    }),
    contribute: useMutation({
      mutationFn: ({ goalId, body }: { goalId: string; body: CreateContributionRequest }) =>
        run((t) => createContribution(t, workspaceId, goalId, body)),
      onSuccess,
    }),
    undoContribution: useMutation({
      mutationFn: ({
        goalId,
        contributionId,
        deleteTransaction,
      }: {
        goalId: string;
        contributionId: string;
        deleteTransaction: boolean;
      }) =>
        run((t) => deleteContribution(t, workspaceId, goalId, contributionId, deleteTransaction)),
      onSuccess,
    }),
    setIncome: useMutation({
      mutationFn: ({ month, body }: { month: string; body: SetIncomeRequest }) =>
        run((t) => setExpectedIncome(t, workspaceId, month, body)),
      onSuccess,
    }),
    clearIncome: useMutation({
      mutationFn: ({ month, currency }: { month: string; currency: Currency }) =>
        run((t) => clearExpectedIncome(t, workspaceId, month, currency)),
      onSuccess,
    }),
  };
}
