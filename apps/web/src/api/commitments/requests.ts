import type {
  CommitmentSummary,
  CommitmentSummaryQuery,
  CreateLoanRequest,
  CreateRecurringPaymentRequest,
  Installment,
  Loan,
  LoanDetail,
  LoanList,
  PayInstallmentRequest,
  PaymentList,
  PaymentListQuery,
  RecordRecurringPaymentRequest,
  RecurringKind,
  RecurringPayment,
  RecurringPaymentList,
  RescheduleLoanRequest,
  SettledOccurrence,
  SettledOccurrenceList,
  UpdateInstallmentRequest,
  UpdateLoanRequest,
  UpdateRecurringPaymentRequest,
} from "@orbit/contracts";

import { request, type Signal, toQueryString, workspacePath } from "../client";

function financePath(workspaceId: string, suffix: string): string {
  return workspacePath(workspaceId, `/finance${suffix}`);
}

function loanPath(workspaceId: string, loanId: string, suffix = ""): string {
  return financePath(workspaceId, `/loans/${encodeURIComponent(loanId)}${suffix}`);
}

function installmentPath(
  workspaceId: string,
  loanId: string,
  installmentId: string,
  suffix = "",
): string {
  return loanPath(
    workspaceId,
    loanId,
    `/installments/${encodeURIComponent(installmentId)}${suffix}`,
  );
}

function recurringPath(workspaceId: string, paymentId: string, suffix = ""): string {
  return financePath(workspaceId, `/recurring-payments/${encodeURIComponent(paymentId)}${suffix}`);
}

// Loans

export function listLoans(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<LoanList> {
  return request<LoanList>(financePath(workspaceId, "/loans"), { token, signal });
}

export function getLoan(
  token: string,
  workspaceId: string,
  loanId: string,
  today: string,
  { signal }: Signal = {},
): Promise<LoanDetail> {
  return request<LoanDetail>(`${loanPath(workspaceId, loanId)}${toQueryString({ today })}`, {
    token,
    signal,
  });
}

export function createLoan(
  token: string,
  workspaceId: string,
  body: CreateLoanRequest,
): Promise<Loan> {
  return request<Loan>(financePath(workspaceId, "/loans"), { method: "POST", body, token });
}

export function updateLoan(
  token: string,
  workspaceId: string,
  loanId: string,
  body: UpdateLoanRequest,
): Promise<Loan> {
  return request<Loan>(loanPath(workspaceId, loanId), { method: "PATCH", body, token });
}

/** Deletes a loan entered by mistake; a 409 when it has recorded payments. */
export function deleteLoan(token: string, workspaceId: string, loanId: string): Promise<void> {
  return request<void>(loanPath(workspaceId, loanId), { method: "DELETE", token });
}

export function rescheduleLoan(
  token: string,
  workspaceId: string,
  loanId: string,
  body: RescheduleLoanRequest,
): Promise<Loan> {
  return request<Loan>(loanPath(workspaceId, loanId, "/reschedule"), {
    method: "POST",
    body,
    token,
  });
}

export function adjustInstallment(
  token: string,
  workspaceId: string,
  loanId: string,
  installmentId: string,
  body: UpdateInstallmentRequest,
): Promise<Installment> {
  return request<Installment>(installmentPath(workspaceId, loanId, installmentId), {
    method: "PATCH",
    body,
    token,
  });
}

export function payInstallment(
  token: string,
  workspaceId: string,
  loanId: string,
  installmentId: string,
  body: PayInstallmentRequest,
): Promise<Installment> {
  return request<Installment>(installmentPath(workspaceId, loanId, installmentId, "/pay"), {
    method: "POST",
    body,
    token,
  });
}

export function skipInstallment(
  token: string,
  workspaceId: string,
  loanId: string,
  installmentId: string,
): Promise<Installment> {
  return request<Installment>(installmentPath(workspaceId, loanId, installmentId, "/skip"), {
    method: "POST",
    token,
  });
}

export function undoInstallment(
  token: string,
  workspaceId: string,
  loanId: string,
  installmentId: string,
  deleteTransactions: boolean,
): Promise<Installment> {
  const query = toQueryString({ delete_transactions: deleteTransactions });
  return request<Installment>(
    `${installmentPath(workspaceId, loanId, installmentId, "/undo")}${query}`,
    { method: "POST", token },
  );
}

// Subscriptions and bills

export function listRecurringPayments(
  token: string,
  workspaceId: string,
  query: { kind?: RecurringKind; today: string },
  { signal }: Signal = {},
): Promise<RecurringPaymentList> {
  return request<RecurringPaymentList>(
    `${financePath(workspaceId, "/recurring-payments")}${toQueryString(query)}`,
    { token, signal },
  );
}

export function createRecurringPayment(
  token: string,
  workspaceId: string,
  body: CreateRecurringPaymentRequest,
): Promise<RecurringPayment> {
  return request<RecurringPayment>(financePath(workspaceId, "/recurring-payments"), {
    method: "POST",
    body,
    token,
  });
}

export function updateRecurringPayment(
  token: string,
  workspaceId: string,
  paymentId: string,
  body: UpdateRecurringPaymentRequest,
): Promise<RecurringPayment> {
  return request<RecurringPayment>(recurringPath(workspaceId, paymentId), {
    method: "PATCH",
    body,
    token,
  });
}

export function listOccurrences(
  token: string,
  workspaceId: string,
  paymentId: string,
  { signal }: Signal = {},
): Promise<SettledOccurrenceList> {
  return request<SettledOccurrenceList>(recurringPath(workspaceId, paymentId, "/occurrences"), {
    token,
    signal,
  });
}

export function recordRecurringPayment(
  token: string,
  workspaceId: string,
  paymentId: string,
  body: RecordRecurringPaymentRequest,
): Promise<SettledOccurrence> {
  return request<SettledOccurrence>(recurringPath(workspaceId, paymentId, "/occurrences"), {
    method: "POST",
    body,
    token,
  });
}

export function skipRecurringOccurrence(
  token: string,
  workspaceId: string,
  paymentId: string,
  dueDate: string,
): Promise<SettledOccurrence> {
  return request<SettledOccurrence>(recurringPath(workspaceId, paymentId, "/occurrences/skip"), {
    method: "POST",
    body: { due_date: dueDate },
    token,
  });
}

export function undoRecurringOccurrence(
  token: string,
  workspaceId: string,
  paymentId: string,
  occurrenceId: string,
  deleteTransaction: boolean,
): Promise<void> {
  const query = toQueryString({ delete_transaction: deleteTransaction });
  return request<void>(
    `${recurringPath(workspaceId, paymentId, `/occurrences/${encodeURIComponent(occurrenceId)}`)}${query}`,
    { method: "DELETE", token },
  );
}

// Upcoming payments and the dashboard

export function listPayments(
  token: string,
  workspaceId: string,
  query: PaymentListQuery,
  { signal }: Signal = {},
): Promise<PaymentList> {
  return request<PaymentList>(`${financePath(workspaceId, "/payments")}${toQueryString(query)}`, {
    token,
    signal,
  });
}

export function getCommitmentSummary(
  token: string,
  workspaceId: string,
  query: CommitmentSummaryQuery,
  { signal }: Signal = {},
): Promise<CommitmentSummary> {
  return request<CommitmentSummary>(
    `${financePath(workspaceId, "/commitments/summary")}${toQueryString(query)}`,
    { token, signal },
  );
}
