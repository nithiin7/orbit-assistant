import type { CommitmentSummaryQuery, PaymentListQuery, RecurringKind } from "@orbit/contracts";
import { queryOptions, skipToken } from "@tanstack/react-query";

import type { WithToken } from "../client";
import { financeKeys } from "../finance";
import {
  getCommitmentSummary,
  getLoan,
  listLoans,
  listOccurrences,
  listPayments,
  listRecurringPayments,
} from "./requests";

/**
 * Cache keys for a workspace's loans, subscriptions, and bills. They sit under the finance keys,
 * because paying a commitment records transactions (and editing a transaction can change a
 * loan's outstanding balance), so any finance change refetches them and the reverse.
 */
export const commitmentKeys = {
  all: (workspaceId: string | null) => [...financeKeys.all(workspaceId), "commitments"] as const,
  loans: (workspaceId: string | null) => [...commitmentKeys.all(workspaceId), "loans"] as const,
  loan: (workspaceId: string | null, loanId: string, today: string) =>
    [...commitmentKeys.loans(workspaceId), loanId, today] as const,
  recurring: (workspaceId: string | null, kind: RecurringKind | undefined, today: string) =>
    [...commitmentKeys.all(workspaceId), "recurring", kind ?? "all", today] as const,
  occurrences: (workspaceId: string | null, paymentId: string) =>
    [...commitmentKeys.all(workspaceId), "occurrences", paymentId] as const,
  payments: (workspaceId: string | null, query: PaymentListQuery) =>
    [...commitmentKeys.all(workspaceId), "payments", query] as const,
  summary: (workspaceId: string | null, query: CommitmentSummaryQuery) =>
    [...commitmentKeys.all(workspaceId), "summary", query] as const,
};

export function loansOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: commitmentKeys.loans(workspaceId),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) => withToken((token) => listLoans(token, workspaceId, { signal })),
  });
}

export function loanOptions(
  withToken: WithToken,
  workspaceId: string | null,
  loanId: string,
  today: string,
) {
  return queryOptions({
    queryKey: commitmentKeys.loan(workspaceId, loanId, today),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => getLoan(token, workspaceId, loanId, today, { signal })),
  });
}

export function recurringOptions(
  withToken: WithToken,
  workspaceId: string | null,
  kind: RecurringKind | undefined,
  today: string,
) {
  return queryOptions({
    queryKey: commitmentKeys.recurring(workspaceId, kind, today),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) =>
              listRecurringPayments(token, workspaceId, { kind, today }, { signal }),
            ),
  });
}

export function occurrencesOptions(
  withToken: WithToken,
  workspaceId: string | null,
  paymentId: string,
) {
  return queryOptions({
    queryKey: commitmentKeys.occurrences(workspaceId, paymentId),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => listOccurrences(token, workspaceId, paymentId, { signal })),
  });
}

export function paymentsOptions(
  withToken: WithToken,
  workspaceId: string | null,
  query: PaymentListQuery,
) {
  return queryOptions({
    queryKey: commitmentKeys.payments(workspaceId, query),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) => withToken((token) => listPayments(token, workspaceId, query, { signal })),
  });
}

export function commitmentSummaryOptions(
  withToken: WithToken,
  workspaceId: string | null,
  query: CommitmentSummaryQuery,
) {
  return queryOptions({
    queryKey: commitmentKeys.summary(workspaceId, query),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => getCommitmentSummary(token, workspaceId, query, { signal })),
  });
}
