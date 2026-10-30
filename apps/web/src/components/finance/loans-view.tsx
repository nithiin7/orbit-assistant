"use client";

import type { Installment, Loan } from "@orbit/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarClock, ChevronDown, Landmark, Pencil, Plus } from "lucide-react";
import { useState } from "react";

import { describeApiError } from "@/api/client";
import { loanOptions } from "@/api/commitments";
import { EmptyState } from "@/components/empty-state";
import { FormAlert } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCommitmentMutations, useLoanDetail, useLoans } from "@/hooks/use-commitments";
import {
  formatRate,
  frequencyLabel,
  interestMethodLabel,
  loanTypeLabel,
  perPeriod,
} from "@/lib/commitments";
import { formatMoney } from "@/lib/finance";
import { useAuth } from "@/providers/auth";
import { cn } from "@/utils/common";
import { formatCalendarDate, localDateString } from "@/utils/dates";

import { ConfirmAction, PaymentStatusBadge } from "./commitment-parts";
import type { FinanceData } from "./finance-view";
import type { PaymentTarget } from "./payment-dialog";

type LoansViewProps = FinanceData & {
  onAddLoan: () => void;
  onEditLoan: (loan: Loan) => void;
  onReschedule: (loan: Loan) => void;
  onAdjust: (loan: Loan, installment: Installment) => void;
  onPay: (target: PaymentTarget) => void;
};

export function installmentTarget(loan: Loan, installment: Installment): PaymentTarget {
  return {
    kind: "loan",
    loanId: loan.id,
    installmentId: installment.id,
    name: loan.name,
    currency: loan.currency,
    dueDate: installment.due_date,
    principal: installment.principal,
    interest: installment.interest,
    loanAccountId: loan.account_id,
    defaultAccountId: loan.payment_account_id,
  };
}

/** Every loan with what is still owed, and its EMI schedule on demand. */
export function LoansView(props: LoansViewProps) {
  const { workspaceId, onAddLoan } = props;
  const { state, reload } = useLoans(workspaceId);

  if (state.status === "error") {
    return (
      <div role="alert" className="space-y-3 rounded-xl border bg-card p-4 text-sm">
        <p>{state.message}</p>
        <Button variant="outline" size="sm" onClick={reload}>
          Try again
        </Button>
      </div>
    );
  }
  if (state.status === "loading") {
    return (
      <div className="space-y-4">
        <span className="sr-only">Loading loans…</span>
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  const loans = state.data.loans;
  const active = loans.filter((loan) => loan.status === "active");
  const inactive = loans.filter((loan) => loan.status !== "active");
  if (loans.length === 0) {
    return (
      <EmptyState
        icon={Landmark}
        title="No loans yet"
        description="Add a home, car, personal, or education loan to see its EMI schedule, what you still owe, and how much goes to interest."
      >
        <Button onClick={onAddLoan}>
          <Plus aria-hidden="true" />
          Add loan
        </Button>
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Loans</h2>
        <Button size="sm" onClick={onAddLoan}>
          <Plus aria-hidden="true" />
          Add loan
        </Button>
      </div>
      {active.length === 0 ? (
        <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
          No active loans.
        </p>
      ) : (
        <ul className="space-y-4" aria-label="Active loans">
          {active.map((loan) => (
            <LoanCard key={loan.id} loan={loan} {...props} />
          ))}
        </ul>
      )}
      {inactive.length > 0 ? (
        <details className="rounded-xl border bg-card/60">
          <summary className="cursor-pointer rounded-xl px-4 py-3 text-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {inactive.length} closed or archived {inactive.length === 1 ? "loan" : "loans"}
          </summary>
          <ul className="space-y-4 border-t p-4" aria-label="Closed and archived loans">
            {inactive.map((loan) => (
              <LoanCard key={loan.id} loan={loan} {...props} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function LoanCard({
  loan,
  workspaceId,
  onAnnounce,
  onEditLoan,
  onReschedule,
  onAdjust,
  onPay,
}: LoansViewProps & { loan: Loan }) {
  const { updateLoan } = useCommitmentMutations(workspaceId);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const repaidShare =
    loan.principal > 0
      ? Math.min(100, Math.max(0, Math.round((loan.repaid_principal / loan.principal) * 100)))
      : 0;
  const scheduleId = `schedule-${loan.id}`;

  const setStatus = async (status: Loan["status"], message: string) => {
    setError(null);
    try {
      await updateLoan.mutateAsync({ id: loan.id, changes: { status } });
      onAnnounce(message);
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t change the loan. Try again."));
    }
  };

  return (
    <li>
      <Card className="space-y-4 p-5 shadow-elevation-1">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              {loan.name}
              {loan.status !== "active" ? (
                <Badge variant="outline">{loan.status === "closed" ? "Closed" : "Archived"}</Badge>
              ) : null}
            </h3>
            <p className="text-xs text-muted-foreground">
              {[
                loanTypeLabel(loan.loan_type),
                loan.lender,
                `${formatRate(loan.interest_rate_bps)}% ${interestMethodLabel(loan.interest_method).toLowerCase()}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={`Edit “${loan.name}”`}
              onClick={() => onEditLoan(loan)}
            >
              <Pencil aria-hidden="true" />
            </Button>
            {loan.status === "active" ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => onReschedule(loan)}>
                  Reschedule
                </Button>
                <ConfirmAction
                  label="Close"
                  prompt={`Close “${loan.name}”?`}
                  options={[
                    {
                      label:
                        loan.outstanding_principal > 0
                          ? `Close with ${formatMoney(loan.outstanding_principal, loan.currency)} owed`
                          : "Close loan",
                      destructive: true,
                      onConfirm: () => setStatus("closed", `Closed “${loan.name}”.`),
                    },
                  ]}
                />
              </>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void setStatus("active", `Reopened “${loan.name}”.`)}
              >
                Reopen
              </Button>
            )}
            {loan.status === "closed" ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void setStatus("archived", `Archived “${loan.name}”.`)}
              >
                Archive
              </Button>
            ) : null}
          </div>
        </div>

        <dl className="grid gap-4 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">Still owed</dt>
            <dd className="text-xl font-semibold tracking-tight tabular-nums">
              {formatMoney(Math.max(loan.outstanding_principal, 0), loan.currency)}
            </dd>
            <dd className="mt-2">
              <div
                role="progressbar"
                aria-label="Principal repaid"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={repaidShare}
                className="h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-brand transition-[width] duration-300 motion-reduce:transition-none"
                  style={{ width: `${repaidShare}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {repaidShare}% of {formatMoney(loan.principal, loan.currency)} repaid
              </p>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">EMI</dt>
            <dd className="text-sm font-medium tabular-nums">
              {formatMoney(loan.emi_amount, loan.currency)}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                {perPeriod(loan.emi_frequency)}
              </span>
            </dd>
            <dd className="text-xs text-muted-foreground">
              {formatMoney(loan.remaining_interest, loan.currency)} interest to go
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Next EMI</dt>
            <dd className="text-sm font-medium">
              {loan.next_payment_date
                ? formatCalendarDate(loan.next_payment_date)
                : "None scheduled"}
            </dd>
            <dd className="text-xs text-muted-foreground">
              {loan.paid_installments} of {loan.total_installments} paid ·{" "}
              {frequencyLabel(loan.emi_frequency)}
            </dd>
          </div>
        </dl>

        <FormAlert message={error} />

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={open}
            aria-controls={scheduleId}
            onClick={() => setOpen((value) => !value)}
          >
            <ChevronDown
              aria-hidden="true"
              className={cn("transition-transform duration-150", open && "rotate-180")}
            />
            {open ? "Hide EMI schedule" : "Show EMI schedule"}
          </Button>
          {open ? null : <NextEmiButton loan={loan} onPay={onPay} workspaceId={workspaceId} />}
        </div>

        {open ? (
          <div id={scheduleId} className="animate-page-in">
            <LoanSchedule
              loan={loan}
              workspaceId={workspaceId}
              onAnnounce={onAnnounce}
              onAdjust={onAdjust}
              onPay={onPay}
            />
          </div>
        ) : null}
      </Card>
    </li>
  );
}

/** "Record EMI" for the next installment, whose split comes from the (cached) schedule. */
function NextEmiButton({
  loan,
  workspaceId,
  onPay,
}: {
  loan: Loan;
  workspaceId: string;
  onPay: (target: PaymentTarget) => void;
}) {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (loan.status !== "active" || !loan.next_payment_date) return null;

  const open = async () => {
    setLoading(true);
    setError(null);
    try {
      const detail = await queryClient.fetchQuery(
        loanOptions(withToken, workspaceId, loan.id, localDateString()),
      );
      const next = detail.installments.find((entry) => entry.state === "scheduled");
      if (next) onPay(installmentTarget(loan, next));
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t load the schedule. Try again."));
    }
    setLoading(false);
  };

  return (
    <div className="flex items-center gap-2">
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <Button size="sm" variant="outline" disabled={loading} onClick={() => void open()}>
        <CalendarClock aria-hidden="true" />
        Record EMI
      </Button>
    </div>
  );
}

function LoanSchedule({
  loan,
  workspaceId,
  onAnnounce,
  onAdjust,
  onPay,
}: {
  loan: Loan;
  workspaceId: string;
  onAnnounce: (message: string) => void;
  onAdjust: (loan: Loan, installment: Installment) => void;
  onPay: (target: PaymentTarget) => void;
}) {
  const today = localDateString();
  const { state, reload } = useLoanDetail(workspaceId, loan.id, today, true);
  const { skipInstallment, undoInstallment } = useCommitmentMutations(workspaceId);
  const [error, setError] = useState<string | null>(null);
  const editable = loan.status === "active";

  const act = async (work: () => Promise<unknown>, message: string) => {
    setError(null);
    try {
      await work();
      onAnnounce(message);
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t update the installment. Try again."));
    }
  };

  if (state.status === "error") {
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p>{state.message}</p>
        <Button variant="outline" size="sm" onClick={reload}>
          Try again
        </Button>
      </div>
    );
  }
  if (state.status === "loading") {
    return (
      <div className="space-y-2">
        <span className="sr-only">Loading the schedule…</span>
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-12" />
        ))}
      </div>
    );
  }

  const ref = (installment: Installment) => ({ loanId: loan.id, installmentId: installment.id });
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Principal repays the loan (a transfer, not spending); interest is an expense. Balances ahead
        are projected from what you owe today.
      </p>
      <FormAlert message={error} />
      <ol aria-label={`${loan.name} EMI schedule`} className="divide-y rounded-lg border">
        {state.data.installments.map((installment) => (
          <li
            key={installment.id}
            className={cn(
              "flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 text-sm",
              installment.state !== "scheduled" && "bg-muted/30",
            )}
          >
            <span className="w-8 shrink-0 text-xs text-muted-foreground tabular-nums">
              #{installment.sequence}
            </span>
            <div className="min-w-32 flex-1">
              <p className="font-medium">
                {formatCalendarDate(installment.paid_on ?? installment.due_date)}
                {installment.adjusted ? (
                  <span className="ml-1 text-xs font-normal text-muted-foreground">(adjusted)</span>
                ) : null}
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {formatMoney(installment.principal, loan.currency)} principal +{" "}
                {formatMoney(installment.interest, loan.currency)} interest
              </p>
            </div>
            <div className="text-right">
              <p className="font-medium tabular-nums">
                {formatMoney(installment.amount, loan.currency)}
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {formatMoney(installment.balance_after, loan.currency)} left
              </p>
            </div>
            <PaymentStatusBadge status={installment.status} />
            <div className="flex w-full flex-wrap justify-end gap-1 sm:w-auto">
              {installment.state === "scheduled" && editable ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onPay(installmentTarget(loan, installment))}
                  >
                    Pay
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onAdjust(loan, installment)}>
                    Adjust
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void act(
                        () => skipInstallment.mutateAsync(ref(installment)),
                        `Skipped installment ${installment.sequence}.`,
                      )
                    }
                  >
                    Skip
                  </Button>
                </>
              ) : installment.state !== "scheduled" ? (
                <ConfirmAction
                  label="Undo"
                  prompt={`Undo installment ${installment.sequence}?`}
                  options={
                    installment.state === "paid"
                      ? [
                          {
                            label: "Undo and delete its transactions",
                            destructive: true,
                            onConfirm: () =>
                              act(
                                () =>
                                  undoInstallment.mutateAsync({
                                    ...ref(installment),
                                    deleteTransactions: true,
                                  }),
                                `Undid installment ${installment.sequence} and deleted its transactions.`,
                              ),
                          },
                          {
                            label: "Undo, keep transactions",
                            onConfirm: () =>
                              act(
                                () =>
                                  undoInstallment.mutateAsync({
                                    ...ref(installment),
                                    deleteTransactions: false,
                                  }),
                                `Undid installment ${installment.sequence}.`,
                              ),
                          },
                        ]
                      : [
                          {
                            label: "Undo skip",
                            onConfirm: () =>
                              act(
                                () =>
                                  undoInstallment.mutateAsync({
                                    ...ref(installment),
                                    deleteTransactions: false,
                                  }),
                                `Installment ${installment.sequence} is scheduled again.`,
                              ),
                          },
                        ]
                  }
                />
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
