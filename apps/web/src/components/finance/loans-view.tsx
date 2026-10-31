"use client";

import type { Installment, Loan } from "@orbit/contracts";
import { useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  CalendarClock,
  ChevronDown,
  CircleCheck,
  Landmark,
  Pencil,
  Plus,
  RotateCcw,
} from "lucide-react";
import { useState } from "react";

import { describeApiError } from "@/api/client";
import { loanOptions } from "@/api/commitments";
import { EmptyState } from "@/components/empty-state";
import { FormAlert } from "@/components/form-field";
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
import { Chip } from "./finance-meta";
import type { FinanceData } from "./finance-view";
import { EndedSection, LoadError } from "./panel";
import type { PaymentTarget } from "./payment-dialog";
import { RowActions } from "./row-actions";
import { StatGrid, StatTile } from "./stat-tile";
import { ViewHeader } from "./view-header";

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
  const { workspaceId, onAddLoan, currency } = props;
  const { state, reload } = useLoans(workspaceId);
  const addButton = (
    <Button onClick={onAddLoan}>
      <Plus aria-hidden="true" />
      Add loan
    </Button>
  );
  const header = (
    <ViewHeader
      title="Loans"
      description="What you still owe, each EMI’s split between principal and interest, and the schedule ahead."
      action={addButton}
    />
  );

  if (state.status === "error") {
    return (
      <div className="space-y-6">
        {header}
        <LoadError message={state.message} onRetry={reload} />
      </div>
    );
  }
  if (state.status === "loading") {
    return (
      <div className="space-y-6">
        {header}
        <span className="sr-only">Loading loans…</span>
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
        {addButton}
      </EmptyState>
    );
  }

  // Totals never add currencies together: they cover the loans in the page's currency.
  const counted = active.filter((loan) => loan.currency === currency);
  const owed = counted.reduce((sum, loan) => sum + Math.max(loan.outstanding_principal, 0), 0);
  const interest = counted.reduce((sum, loan) => sum + loan.remaining_interest, 0);
  const next = counted
    .filter((loan) => loan.next_payment_date)
    .sort((a, b) => (a.next_payment_date ?? "").localeCompare(b.next_payment_date ?? ""))[0];

  return (
    <div className="space-y-6">
      {header}
      {counted.length > 0 ? (
        <StatGrid>
          <StatTile
            label="Still owed"
            icon={Landmark}
            accent="negative"
            value={formatMoney(owed, currency)}
          >
            Principal across {counted.length} active {counted.length === 1 ? "loan" : "loans"}
          </StatTile>
          <StatTile label="Interest to go" value={formatMoney(interest, currency)}>
            If every EMI is paid on schedule
          </StatTile>
          {next?.next_payment_date ? (
            <StatTile
              label="Next EMI"
              icon={CalendarClock}
              accent="brand"
              value={formatCalendarDate(next.next_payment_date)}
            >
              {next.name} · {formatMoney(next.emi_amount, next.currency)}
            </StatTile>
          ) : null}
        </StatGrid>
      ) : null}
      {active.length === 0 ? (
        <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
          No active loans.
        </p>
      ) : (
        <ul
          className="grid items-start gap-4 @4xl/list:grid-cols-2 @4xl/list:gap-6"
          aria-label="Active loans"
        >
          {active.map((loan) => (
            <LoanCard key={loan.id} loan={loan} {...props} />
          ))}
        </ul>
      )}
      {inactive.length > 0 ? (
        <EndedSection
          summary={`${inactive.length} closed or archived ${inactive.length === 1 ? "loan" : "loans"}`}
        >
          <ul
            className="grid items-start gap-4 p-4 @4xl/list:grid-cols-2"
            aria-label="Closed and archived loans"
          >
            {inactive.map((loan) => (
              <LoanCard key={loan.id} loan={loan} {...props} />
            ))}
          </ul>
        </EndedSection>
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
    <li className="@container/card min-w-0">
      <Card className="space-y-4 p-5 shadow-elevation-1">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              {loan.name}
              {loan.status !== "active" ? (
                <Chip>{loan.status === "closed" ? "Closed" : "Archived"}</Chip>
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
          <RowActions
            name={loan.name}
            actions={[
              { id: "edit", label: "Edit", icon: Pencil, onSelect: () => onEditLoan(loan) },
              {
                id: "reschedule",
                label: "Reschedule",
                description: "Change the rate, EMI, or tenure from here on",
                icon: CalendarClock,
                hidden: loan.status !== "active",
                onSelect: () => onReschedule(loan),
              },
              {
                id: "close",
                label: "Close loan…",
                description: "Paid off, sold, or settled",
                icon: CircleCheck,
                hidden: loan.status !== "active",
                confirm: {
                  prompt: `Close “${loan.name}”?`,
                  choices: [
                    {
                      label:
                        loan.outstanding_principal > 0
                          ? `Close with ${formatMoney(loan.outstanding_principal, loan.currency)} owed`
                          : "Close loan",
                      destructive: true,
                      onConfirm: () => setStatus("closed", `Closed “${loan.name}”.`),
                    },
                  ],
                },
              },
              {
                id: "reopen",
                label: "Reopen",
                icon: RotateCcw,
                hidden: loan.status === "active",
                onSelect: () => void setStatus("active", `Reopened “${loan.name}”.`),
              },
              {
                id: "archive",
                label: "Archive",
                icon: Archive,
                hidden: loan.status !== "closed",
                onSelect: () => void setStatus("archived", `Archived “${loan.name}”.`),
              },
            ]}
          />
        </div>

        <dl className="grid grid-cols-2 gap-4 @lg/card:grid-cols-4">
          <div className="col-span-2">
            <dt className="text-xs text-muted-foreground">Still owed</dt>
            <dd className="text-xl font-semibold tracking-tight whitespace-nowrap tabular-nums">
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

        {error ? <FormAlert message={error} /> : null}

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

  if (state.status === "error") return <LoadError message={state.message} onRetry={reload} />;
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
      {error ? <FormAlert message={error} /> : null}
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
