"use client";

import type {
  CommitmentSummary,
  CreateLoanRequest,
  CreateRecurringPaymentRequest,
  Currency,
  LoanDetail,
  LoanList,
  PayInstallmentRequest,
  PaymentList,
  PaymentListQuery,
  RecordRecurringPaymentRequest,
  RecurringKind,
  RecurringPaymentList,
  RescheduleLoanRequest,
  SettledOccurrenceList,
  UpdateInstallmentRequest,
  UpdateLoanRequest,
  UpdateRecurringPaymentRequest,
} from "@orbit/contracts";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import {
  adjustInstallment,
  commitmentSummaryOptions,
  createLoan,
  createRecurringPayment,
  loanOptions,
  loansOptions,
  occurrencesOptions,
  payInstallment,
  paymentsOptions,
  recordRecurringPayment,
  recurringOptions,
  rescheduleLoan,
  skipInstallment,
  skipRecurringOccurrence,
  undoInstallment,
  undoRecurringOccurrence,
  updateLoan,
  updateRecurringPayment,
} from "@/api/commitments";
import { financeKeys } from "@/api/finance";
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

export function useLoans(workspaceId: string): Loaded<LoanList> {
  const { withToken } = useAuth();
  return useLoaded(useQuery(loansOptions(withToken, workspaceId)), "Couldn’t load your loans.");
}

/** A loan's EMI schedule, loaded only while `enabled` (the schedule is open). */
export function useLoanDetail(
  workspaceId: string,
  loanId: string,
  today: string,
  enabled: boolean,
): Loaded<LoanDetail> {
  const { withToken } = useAuth();
  return useLoaded(
    useQuery({ ...loanOptions(withToken, workspaceId, loanId, today), enabled }),
    "Couldn’t load the schedule.",
  );
}

export function useRecurringPayments(
  workspaceId: string,
  kind: RecurringKind,
  today: string,
): Loaded<RecurringPaymentList> {
  const { withToken } = useAuth();
  return useLoaded(
    useQuery(recurringOptions(withToken, workspaceId, kind, today)),
    kind === "subscription" ? "Couldn’t load your subscriptions." : "Couldn’t load your bills.",
  );
}

export function useOccurrences(
  workspaceId: string,
  paymentId: string,
  enabled: boolean,
): Loaded<SettledOccurrenceList> {
  const { withToken } = useAuth();
  return useLoaded(
    useQuery({ ...occurrencesOptions(withToken, workspaceId, paymentId), enabled }),
    "Couldn’t load the history.",
  );
}

/** Upcoming and recent payments; the previous result stays visible while filters change. */
export function usePayments(workspaceId: string, query: PaymentListQuery): Loaded<PaymentList> {
  const { withToken } = useAuth();
  return useLoaded(
    useQuery({
      ...paymentsOptions(withToken, workspaceId, query),
      placeholderData: keepPreviousData,
    }),
    "Couldn’t load your payments.",
  );
}

export function useCommitmentSummary(
  workspaceId: string,
  currency: Currency,
  today: string,
): Loaded<CommitmentSummary> {
  const { withToken } = useAuth();
  return useLoaded(
    useQuery({
      ...commitmentSummaryOptions(withToken, workspaceId, { currency, today }),
      placeholderData: keepPreviousData,
    }),
    "Couldn’t load your commitments.",
  );
}

type InstallmentRef = { loanId: string; installmentId: string };
type OccurrenceRef = { paymentId: string };

/**
 * Changes to loans, subscriptions, and bills. Payments record transactions and move reminders,
 * so every change refetches the workspace's finance (including commitments) and reminders.
 * Await `mutateAsync` to handle failures.
 */
export function useCommitmentMutations(workspaceId: string) {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  const onSuccess = () => {
    void queryClient.invalidateQueries({ queryKey: financeKeys.all(workspaceId) });
    void queryClient.invalidateQueries({ queryKey: reminderKeys.all(workspaceId) });
  };
  const run = <T>(call: (token: string) => Promise<T>) => withToken(call);

  return {
    createLoan: useMutation({
      mutationFn: (body: CreateLoanRequest) => run((t) => createLoan(t, workspaceId, body)),
      onSuccess,
    }),
    updateLoan: useMutation({
      mutationFn: ({ id, changes }: { id: string; changes: UpdateLoanRequest }) =>
        run((t) => updateLoan(t, workspaceId, id, changes)),
      onSuccess,
    }),
    rescheduleLoan: useMutation({
      mutationFn: ({ id, body }: { id: string; body: RescheduleLoanRequest }) =>
        run((t) => rescheduleLoan(t, workspaceId, id, body)),
      onSuccess,
    }),
    adjustInstallment: useMutation({
      mutationFn: ({
        loanId,
        installmentId,
        changes,
      }: InstallmentRef & { changes: UpdateInstallmentRequest }) =>
        run((t) => adjustInstallment(t, workspaceId, loanId, installmentId, changes)),
      onSuccess,
    }),
    payInstallment: useMutation({
      mutationFn: ({
        loanId,
        installmentId,
        body,
      }: InstallmentRef & { body: PayInstallmentRequest }) =>
        run((t) => payInstallment(t, workspaceId, loanId, installmentId, body)),
      onSuccess,
    }),
    skipInstallment: useMutation({
      mutationFn: ({ loanId, installmentId }: InstallmentRef) =>
        run((t) => skipInstallment(t, workspaceId, loanId, installmentId)),
      onSuccess,
    }),
    undoInstallment: useMutation({
      mutationFn: ({
        loanId,
        installmentId,
        deleteTransactions,
      }: InstallmentRef & { deleteTransactions: boolean }) =>
        run((t) => undoInstallment(t, workspaceId, loanId, installmentId, deleteTransactions)),
      onSuccess,
    }),
    createRecurring: useMutation({
      mutationFn: (body: CreateRecurringPaymentRequest) =>
        run((t) => createRecurringPayment(t, workspaceId, body)),
      onSuccess,
    }),
    updateRecurring: useMutation({
      mutationFn: ({ id, changes }: { id: string; changes: UpdateRecurringPaymentRequest }) =>
        run((t) => updateRecurringPayment(t, workspaceId, id, changes)),
      onSuccess,
    }),
    recordRecurring: useMutation({
      mutationFn: ({ paymentId, body }: OccurrenceRef & { body: RecordRecurringPaymentRequest }) =>
        run((t) => recordRecurringPayment(t, workspaceId, paymentId, body)),
      onSuccess,
    }),
    skipRecurring: useMutation({
      mutationFn: ({ paymentId, dueDate }: OccurrenceRef & { dueDate: string }) =>
        run((t) => skipRecurringOccurrence(t, workspaceId, paymentId, dueDate)),
      onSuccess,
    }),
    undoRecurring: useMutation({
      mutationFn: ({
        paymentId,
        occurrenceId,
        deleteTransaction,
      }: OccurrenceRef & { occurrenceId: string; deleteTransaction: boolean }) =>
        run((t) =>
          undoRecurringOccurrence(t, workspaceId, paymentId, occurrenceId, deleteTransaction),
        ),
      onSuccess,
    }),
  };
}
