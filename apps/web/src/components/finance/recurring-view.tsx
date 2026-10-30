"use client";

import type { Currency, RecurringKind, RecurringPayment } from "@orbit/contracts";
import { ChevronDown, History, Pencil, Plus, Receipt, Repeat } from "lucide-react";
import { useState } from "react";

import { describeApiError } from "@/api/client";
import { EmptyState } from "@/components/empty-state";
import { FormAlert } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCommitmentMutations,
  useOccurrences,
  useRecurringPayments,
} from "@/hooks/use-commitments";
import { frequencyLabel, perPeriod, RECURRING_STATUS_LABELS } from "@/lib/commitments";
import { formatMoney } from "@/lib/finance";
import { cn } from "@/utils/common";
import { formatCalendarDate, localDateString } from "@/utils/dates";

import { ConfirmAction, PaymentStatusBadge } from "./commitment-parts";
import type { FinanceData } from "./finance-view";
import type { PaymentTarget } from "./payment-dialog";

type RecurringViewProps = FinanceData & {
  kind: RecurringKind;
  onAdd: () => void;
  onEdit: (payment: RecurringPayment) => void;
  onPay: (target: PaymentTarget) => void;
};

const COPY: Record<
  RecurringKind,
  { title: string; empty: string; description: string; add: string; due: string }
> = {
  subscription: {
    title: "Subscriptions",
    empty: "No subscriptions yet",
    description:
      "Track streaming, software, AI tools, memberships, and broadband to see what they cost each month and when they renew.",
    add: "Add subscription",
    due: "Renews",
  },
  bill: {
    title: "Bills",
    empty: "No recurring bills yet",
    description:
      "Track rent, utilities, phone, insurance premiums, and maintenance, and record each payment against its due date.",
    add: "Add bill",
    due: "Due",
  },
};

export function recurringTarget(payment: RecurringPayment, dueDate: string): PaymentTarget {
  return {
    kind: payment.kind,
    paymentId: payment.id,
    name: payment.name,
    currency: payment.currency,
    dueDate,
    amount: payment.amount,
    estimated: payment.amount_varies,
    defaultAccountId: payment.account_id,
  };
}

/** Monthly and yearly costs per currency; currencies are never added together. */
function costTotals(
  payments: RecurringPayment[],
): { currency: Currency; monthly: number; yearly: number }[] {
  const totals = new Map<Currency, { monthly: number; yearly: number }>();
  for (const payment of payments) {
    const total = totals.get(payment.currency) ?? { monthly: 0, yearly: 0 };
    total.monthly += payment.monthly_cost;
    total.yearly += payment.annual_cost;
    totals.set(payment.currency, total);
  }
  return [...totals.entries()].map(([currency, total]) => ({ currency, ...total }));
}

/** Subscriptions or bills: what they cost, what's due next, and their payment history. */
export function RecurringView(props: RecurringViewProps) {
  const { workspaceId, kind, onAdd } = props;
  const today = localDateString();
  const { state, reload } = useRecurringPayments(workspaceId, kind, today);
  const copy = COPY[kind];

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
      <div className="space-y-3">
        <span className="sr-only">Loading {copy.title.toLowerCase()}…</span>
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  const all = state.data.recurring_payments;
  if (all.length === 0) {
    return (
      <EmptyState
        icon={kind === "subscription" ? Repeat : Receipt}
        title={copy.empty}
        description={copy.description}
      >
        <Button onClick={onAdd}>
          <Plus aria-hidden="true" />
          {copy.add}
        </Button>
      </EmptyState>
    );
  }
  const current = all.filter(
    (payment) => payment.status === "active" || payment.status === "paused",
  );
  const ended = all.filter(
    (payment) => payment.status === "cancelled" || payment.status === "expired",
  );
  const active = all.filter((payment) => payment.status === "active");

  return (
    <div className="space-y-6">
      <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {costTotals(active).map((total) => (
          <div key={total.currency} className="rounded-xl border bg-card p-5 shadow-elevation-1">
            <dt className="text-sm text-muted-foreground">
              {kind === "subscription" ? "Subscriptions" : "Bills"} in {total.currency}
            </dt>
            <dd className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
              {formatMoney(total.monthly, total.currency)}{" "}
              <span className="text-sm font-normal text-muted-foreground">/ month</span>
            </dd>
            <dd className="mt-1 text-xs text-muted-foreground">
              {formatMoney(total.yearly, total.currency)} a year · {active.length} active
            </dd>
          </div>
        ))}
      </dl>

      <section className="space-y-3" aria-labelledby={`${kind}-heading`}>
        <div className="flex items-center justify-between gap-3">
          <h2 id={`${kind}-heading`} className="text-base font-semibold">
            {copy.title}
          </h2>
          <Button size="sm" onClick={onAdd}>
            <Plus aria-hidden="true" />
            {copy.add}
          </Button>
        </div>
        {current.length === 0 ? (
          <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
            Nothing active. Cancelled and ended ones are below.
          </p>
        ) : (
          <ul
            aria-label={`Active ${copy.title.toLowerCase()}`}
            className="divide-y overflow-hidden rounded-xl border bg-card shadow-elevation-1"
          >
            {current.map((payment) => (
              <RecurringRow key={payment.id} payment={payment} {...props} />
            ))}
          </ul>
        )}
        {ended.length > 0 ? (
          <details className="rounded-xl border bg-card/60">
            <summary className="cursor-pointer rounded-xl px-4 py-3 text-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {ended.length} cancelled or ended
            </summary>
            <ul className="divide-y border-t" aria-label={`Ended ${copy.title.toLowerCase()}`}>
              {ended.map((payment) => (
                <RecurringRow key={payment.id} payment={payment} {...props} />
              ))}
            </ul>
          </details>
        ) : null}
      </section>
    </div>
  );
}

function RecurringRow({
  payment,
  workspaceId,
  kind,
  onAnnounce,
  onEdit,
  onPay,
}: RecurringViewProps & { payment: RecurringPayment }) {
  const { updateRecurring, skipRecurring } = useCommitmentMutations(workspaceId);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const due = payment.next_due_date;
  const today = localDateString();
  const dueStatus =
    due === null ? null : due < today ? "overdue" : due === today ? "due" : "upcoming";
  const historyId = `history-${payment.id}`;

  const act = async (work: () => Promise<unknown>, message: string) => {
    setError(null);
    try {
      await work();
      onAnnounce(message);
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t make that change. Try again."));
    }
  };
  const setState = (state: "active" | "paused" | "cancelled", message: string) =>
    act(() => updateRecurring.mutateAsync({ id: payment.id, changes: { state } }), message);

  return (
    <li className="space-y-3 px-4 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <button
            type="button"
            onClick={() => onEdit(payment)}
            aria-label={`Edit “${payment.name}”`}
            className="block max-w-full truncate rounded-sm text-left text-sm font-medium outline-none hover:underline hover:decoration-muted-foreground/50 hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring"
          >
            {payment.name}
          </button>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {payment.provider ? <span>{payment.provider}</span> : null}
            <span>{frequencyLabel(payment.frequency)}</span>
            {payment.trial_ends_on && payment.trial_ends_on >= today ? (
              <span>Trial until {formatCalendarDate(payment.trial_ends_on)}</span>
            ) : null}
            {kind === "subscription" && !payment.auto_renew ? (
              <span>Doesn’t auto-renew</span>
            ) : null}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium tabular-nums">
            {payment.amount_varies ? "≈ " : ""}
            {formatMoney(payment.amount, payment.currency)}{" "}
            <span className="text-xs font-normal text-muted-foreground">
              {perPeriod(payment.frequency)}
            </span>
          </p>
          {payment.frequency !== "monthly" ? (
            <p className="text-xs text-muted-foreground tabular-nums">
              {formatMoney(payment.monthly_cost, payment.currency)} / month
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {payment.status !== "active" ? (
          <Badge variant="outline">{RECURRING_STATUS_LABELS[payment.status]}</Badge>
        ) : null}
        {due && dueStatus ? (
          <span className="inline-flex items-center gap-2">
            <span className="text-muted-foreground">
              {COPY[kind].due} {formatCalendarDate(due)}
            </span>
            {dueStatus !== "upcoming" ? <PaymentStatusBadge status={dueStatus} /> : null}
          </span>
        ) : null}
        {payment.overdue > 1 ? (
          <span className="text-destructive">{payment.overdue} payments not recorded</span>
        ) : null}
        {payment.last_paid_on ? (
          <span className="text-muted-foreground">
            Last paid {formatCalendarDate(payment.last_paid_on)}
          </span>
        ) : null}
      </div>

      <FormAlert message={error} />

      <div className="flex flex-wrap items-center gap-1">
        {due && payment.status === "active" ? (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onPay(recurringTarget(payment, due))}
            >
              Record payment
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void act(
                  () => skipRecurring.mutateAsync({ paymentId: payment.id, dueDate: due }),
                  `Skipped ${formatCalendarDate(due)} for “${payment.name}”.`,
                )
              }
            >
              Skip
            </Button>
          </>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={showHistory}
          aria-controls={historyId}
          onClick={() => setShowHistory((value) => !value)}
        >
          <History aria-hidden="true" />
          History
          <ChevronDown
            aria-hidden="true"
            className={cn("transition-transform duration-150", showHistory && "rotate-180")}
          />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          aria-label={`Edit “${payment.name}”`}
          onClick={() => onEdit(payment)}
        >
          <Pencil aria-hidden="true" />
        </Button>
        {payment.status === "active" ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void setState("paused", `Paused “${payment.name}”.`)}
          >
            Pause
          </Button>
        ) : payment.status === "paused" || payment.status === "cancelled" ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void setState("active", `Resumed “${payment.name}”.`)}
          >
            Resume
          </Button>
        ) : null}
        {payment.status === "active" || payment.status === "paused" ? (
          <ConfirmAction
            label="Cancel"
            prompt={`Cancel “${payment.name}”?`}
            options={[
              {
                label: `Cancel ${kind === "subscription" ? "subscription" : "bill"}`,
                destructive: true,
                onConfirm: () =>
                  setState("cancelled", `Cancelled “${payment.name}”. Its history is kept.`),
              },
            ]}
          />
        ) : null}
      </div>

      {showHistory ? (
        <div id={historyId} className="animate-page-in">
          <OccurrenceHistory payment={payment} workspaceId={workspaceId} onAnnounce={onAnnounce} />
        </div>
      ) : null}
    </li>
  );
}

function OccurrenceHistory({
  payment,
  workspaceId,
  onAnnounce,
}: {
  payment: RecurringPayment;
  workspaceId: string;
  onAnnounce: (message: string) => void;
}) {
  const { state, reload } = useOccurrences(workspaceId, payment.id, true);
  const { undoRecurring } = useCommitmentMutations(workspaceId);
  const [error, setError] = useState<string | null>(null);

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
  if (state.status === "loading") return <Skeleton className="h-16" />;
  const occurrences = state.data.occurrences;
  if (occurrences.length === 0) {
    return <p className="text-sm text-muted-foreground">No payments recorded yet.</p>;
  }

  const undo = async (occurrenceId: string, deleteTransaction: boolean, message: string) => {
    setError(null);
    try {
      await undoRecurring.mutateAsync({ paymentId: payment.id, occurrenceId, deleteTransaction });
      onAnnounce(message);
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t undo that payment. Try again."));
    }
  };

  return (
    <div className="space-y-2">
      <FormAlert message={error} />
      <ol aria-label={`${payment.name} payment history`} className="divide-y rounded-lg border">
        {occurrences.map((occurrence) => (
          <li
            key={occurrence.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm"
          >
            <span className="min-w-28 flex-1">
              {formatCalendarDate(occurrence.due_date)}
              {occurrence.paid_on && occurrence.paid_on !== occurrence.due_date ? (
                <span className="ml-1 text-xs text-muted-foreground">
                  paid {formatCalendarDate(occurrence.paid_on)}
                </span>
              ) : null}
            </span>
            <span className="tabular-nums">
              {occurrence.amount !== null ? formatMoney(occurrence.amount, payment.currency) : "—"}
            </span>
            <PaymentStatusBadge status={occurrence.state} />
            <span className="text-xs text-muted-foreground">
              {occurrence.state === "paid" && occurrence.transaction_id === null
                ? "No transaction"
                : null}
            </span>
            <ConfirmAction
              label="Undo"
              prompt={`Undo the ${formatCalendarDate(occurrence.due_date)} payment?`}
              options={
                occurrence.transaction_id
                  ? [
                      {
                        label: "Undo and delete the expense",
                        destructive: true,
                        onConfirm: () =>
                          undo(occurrence.id, true, "Undid the payment and deleted its expense."),
                      },
                      {
                        label: "Undo, keep the expense",
                        onConfirm: () => undo(occurrence.id, false, "Undid the payment."),
                      },
                    ]
                  : [{ label: "Undo", onConfirm: () => undo(occurrence.id, false, "Undid it.") }]
              }
            />
          </li>
        ))}
      </ol>
    </div>
  );
}
