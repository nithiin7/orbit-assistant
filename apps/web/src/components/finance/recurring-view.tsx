"use client";

import type { Currency, RecurringKind, RecurringPayment } from "@orbit/contracts";
import { Ban, CalendarX, History, Pause, Pencil, Play, Plus, Receipt, Repeat } from "lucide-react";
import { useState } from "react";

import { describeApiError } from "@/api/client";
import { EmptyState } from "@/components/empty-state";
import { FormAlert } from "@/components/form-field";
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

import { ConfirmAction, KindIcon, PaymentStatusBadge } from "./commitment-parts";
import { Chip, rowListClassName, twoColumnRows } from "./finance-meta";
import type { FinanceData } from "./finance-view";
import { EndedSection, LoadError } from "./panel";
import type { PaymentTarget } from "./payment-dialog";
import { RowActions } from "./row-actions";
import { StatGrid, StatTile } from "./stat-tile";
import { ViewHeader } from "./view-header";

type RecurringViewProps = FinanceData & {
  kind: RecurringKind;
  onAdd: () => void;
  onEdit: (payment: RecurringPayment) => void;
  onPay: (target: PaymentTarget) => void;
};

const COPY: Record<
  RecurringKind,
  { title: string; empty: string; description: string; add: string; summary: string }
> = {
  subscription: {
    title: "Subscriptions",
    empty: "No subscriptions yet",
    description:
      "Track streaming, software, AI tools, memberships, and broadband to see what they cost each month and when they renew.",
    add: "Add subscription",
    summary: "What your subscriptions cost and when each renews. Recording one adds the expense.",
  },
  bill: {
    title: "Bills",
    empty: "No recurring bills yet",
    description:
      "Track rent, utilities, phone, insurance premiums, and maintenance, and record each payment against its due date.",
    add: "Add bill",
    summary:
      "Rent, utilities, phone, and other bills, with what’s due next. Recording one adds the expense.",
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
  const addButton = (
    <Button onClick={onAdd}>
      <Plus aria-hidden="true" />
      {copy.add}
    </Button>
  );
  const header = <ViewHeader title={copy.title} description={copy.summary} action={addButton} />;

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
        <span className="sr-only">Loading {copy.title.toLowerCase()}…</span>
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
        {addButton}
      </EmptyState>
    );
  }
  // Soonest due first, so the list reads as what's coming; paused ones without a date go last.
  const current = all
    .filter((payment) => payment.status === "active" || payment.status === "paused")
    .sort(
      (a, b) =>
        (a.next_due_date ?? "9999").localeCompare(b.next_due_date ?? "9999") ||
        a.name.localeCompare(b.name),
    );
  const ended = all.filter(
    (payment) => payment.status === "cancelled" || payment.status === "expired",
  );
  const active = all.filter((payment) => payment.status === "active");
  const multiCurrency = costTotals(active).length > 1;

  return (
    <div className="space-y-6">
      {header}
      <StatGrid>
        {costTotals(active).map((total) => (
          <StatTile
            key={total.currency}
            label={`${copy.title} in ${total.currency}`}
            icon={kind === "subscription" ? Repeat : Receipt}
            accent="brand"
            value={
              <>
                {formatMoney(total.monthly, total.currency)}{" "}
                <span className="text-sm font-normal text-muted-foreground">/ month</span>
              </>
            }
          >
            {formatMoney(total.yearly, total.currency)} a year · {active.length} active
          </StatTile>
        ))}
        {!multiCurrency && current[0]?.next_due_date ? (
          <StatTile
            label={kind === "subscription" ? "Next renewal" : "Next due"}
            value={formatCalendarDate(current[0].next_due_date)}
          >
            {current[0].name} · {formatMoney(current[0].amount, current[0].currency)}
          </StatTile>
        ) : null}
      </StatGrid>

      {current.length === 0 ? (
        <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
          Nothing active. Cancelled and ended ones are below.
        </p>
      ) : (
        <ul
          aria-label={`Active ${copy.title.toLowerCase()}`}
          className={cn(rowListClassName, "grid", twoColumnRows(current.length, "5xl"))}
        >
          {current.map((payment) => (
            <RecurringRow key={payment.id} payment={payment} {...props} />
          ))}
        </ul>
      )}
      {ended.length > 0 ? (
        <EndedSection summary={`${ended.length} cancelled or ended`}>
          <ul className="@container/rows divide-y" aria-label={`Ended ${copy.title.toLowerCase()}`}>
            {ended.map((payment) => (
              <RecurringRow key={payment.id} payment={payment} {...props} />
            ))}
          </ul>
        </EndedSection>
      ) : null}
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
  const renews = kind === "subscription" && payment.auto_renew;

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
  const live = payment.status === "active" || payment.status === "paused";

  return (
    <li className="space-y-3 px-3 py-3 @md/rows:px-4">
      <div className="flex items-start gap-3">
        <KindIcon kind={payment.kind} className="mt-0.5" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <button
                type="button"
                onClick={() => onEdit(payment)}
                aria-label={`Edit “${payment.name}”`}
                className="block max-w-full truncate rounded-sm text-left text-sm font-medium outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-ring"
              >
                {payment.name}
              </button>
              <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                {payment.provider ? (
                  <>
                    <span>{payment.provider}</span>
                    <span aria-hidden="true">·</span>
                  </>
                ) : null}
                <span>{frequencyLabel(payment.frequency)}</span>
                {payment.last_paid_on ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>Last paid {formatCalendarDate(payment.last_paid_on)}</span>
                  </>
                ) : null}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm font-medium whitespace-nowrap tabular-nums">
                {payment.amount_varies ? "≈ " : ""}
                {formatMoney(payment.amount, payment.currency)}{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  {perPeriod(payment.frequency)}
                </span>
              </p>
              {payment.frequency !== "monthly" ? (
                <p className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                  {formatMoney(payment.monthly_cost, payment.currency)} / month
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {payment.status !== "active" ? (
                <Chip>{RECURRING_STATUS_LABELS[payment.status]}</Chip>
              ) : null}
              {due && dueStatus ? (
                <Chip tone={dueStatus === "upcoming" ? "quiet" : "muted"}>
                  {renews ? "Renews" : "Due"} {formatCalendarDate(due)}
                </Chip>
              ) : null}
              {dueStatus && dueStatus !== "upcoming" ? (
                <PaymentStatusBadge status={dueStatus} />
              ) : null}
              {payment.overdue > 1 ? (
                <Chip tone="danger">{payment.overdue} payments not recorded</Chip>
              ) : null}
              {payment.trial_ends_on && payment.trial_ends_on >= today ? (
                <Chip tone="brand">Trial until {formatCalendarDate(payment.trial_ends_on)}</Chip>
              ) : null}
              {kind === "subscription" && !payment.auto_renew ? (
                <Chip>Doesn’t auto-renew</Chip>
              ) : null}
            </div>
            <RowActions
              name={payment.name}
              primary={
                due && payment.status === "active" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onPay(recurringTarget(payment, due))}
                  >
                    Record payment
                  </Button>
                ) : null
              }
              actions={[
                {
                  id: "skip",
                  label: "Skip this payment",
                  description: due ? `Mark ${formatCalendarDate(due)} as skipped` : undefined,
                  icon: CalendarX,
                  hidden: !(due && payment.status === "active"),
                  onSelect: () => {
                    if (!due) return;
                    void act(
                      () => skipRecurring.mutateAsync({ paymentId: payment.id, dueDate: due }),
                      `Skipped ${formatCalendarDate(due)} for “${payment.name}”.`,
                    );
                  },
                },
                {
                  id: "history",
                  label: showHistory ? "Hide payment history" : "Payment history",
                  icon: History,
                  onSelect: () => setShowHistory((value) => !value),
                },
                { id: "edit", label: "Edit", icon: Pencil, onSelect: () => onEdit(payment) },
                {
                  id: "pause",
                  label: "Pause",
                  icon: Pause,
                  hidden: payment.status !== "active",
                  onSelect: () => void setState("paused", `Paused “${payment.name}”.`),
                },
                {
                  id: "resume",
                  label: "Resume",
                  icon: Play,
                  hidden: !(payment.status === "paused" || payment.status === "cancelled"),
                  onSelect: () => void setState("active", `Resumed “${payment.name}”.`),
                },
                {
                  id: "cancel",
                  label: `Cancel ${kind === "subscription" ? "subscription" : "bill"}…`,
                  icon: Ban,
                  destructive: true,
                  hidden: !live,
                  confirm: {
                    prompt: `Cancel “${payment.name}”?`,
                    choices: [
                      {
                        label: `Cancel ${kind === "subscription" ? "subscription" : "bill"}`,
                        destructive: true,
                        onConfirm: () =>
                          setState(
                            "cancelled",
                            `Cancelled “${payment.name}”. Its history is kept.`,
                          ),
                      },
                    ],
                  },
                },
              ]}
            />
          </div>
        </div>
      </div>

      <FormAlert message={error} />

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

  if (state.status === "error") return <LoadError message={state.message} onRetry={reload} />;
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
