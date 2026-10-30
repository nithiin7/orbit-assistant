"use client";

import type { CommitmentKind, Loan, PaymentItem, PaymentStatus } from "@orbit/contracts";
import { CalendarCheck } from "lucide-react";
import { type ReactNode, useId, useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { useLoans, usePayments } from "@/hooks/use-commitments";
import {
  groupPayments,
  KIND_LABELS,
  PAYMENT_STATUSES,
  PAYMENT_WINDOW_DAYS,
  paymentKey,
  totalsByCurrency,
} from "@/lib/commitments";
import { formatMoney } from "@/lib/finance";
import { byId, cn, type Option } from "@/utils/common";
import { addDays, formatCalendarDate, localDateString, monthRange } from "@/utils/dates";

import { KindIcon, PaymentStatusBadge } from "./commitment-parts";
import type { FinanceData } from "./finance-view";
import type { PaymentTarget } from "./payment-dialog";

type Range = "window" | "month" | "quarter";

const RANGES: readonly Option<Range>[] = [
  { value: "window", label: "Last and next 30 days" },
  { value: "month", label: "This month" },
  { value: "quarter", label: "Next 90 days" },
];

const KINDS: readonly Option<CommitmentKind | "all">[] = [
  { value: "all", label: "All payments" },
  { value: "loan", label: "Loan EMIs" },
  { value: "subscription", label: "Subscriptions" },
  { value: "bill", label: "Bills" },
];

function rangeOf(range: Range, today: string): { from: string; to: string } {
  switch (range) {
    case "window":
      return {
        from: addDays(today, -PAYMENT_WINDOW_DAYS),
        to: addDays(today, PAYMENT_WINDOW_DAYS),
      };
    case "month":
      return monthRange(today.slice(0, 7));
    case "quarter":
      return { from: today, to: addDays(today, 90) };
  }
}

/** The target for recording one expected payment. */
function targetOf(item: PaymentItem, loans: ReadonlyMap<string, Loan>): PaymentTarget | null {
  if (item.kind === "loan") {
    const loan = loans.get(item.commitment_id);
    if (!loan || item.occurrence_id === null) return null;
    return {
      kind: "loan",
      loanId: loan.id,
      installmentId: item.occurrence_id,
      name: item.name,
      currency: item.currency,
      dueDate: item.due_date,
      principal: item.principal ?? 0,
      interest: item.interest ?? 0,
      loanAccountId: loan.account_id,
      defaultAccountId: item.account_id,
    };
  }
  return {
    kind: item.kind,
    paymentId: item.commitment_id,
    name: item.name,
    currency: item.currency,
    dueDate: item.due_date,
    amount: item.amount,
    estimated: item.estimated,
    defaultAccountId: item.account_id,
  };
}

/**
 * Loan EMIs, subscription renewals, and bills in one place: overdue, due today, upcoming, and
 * recently paid. Expected payments aren't spending until recorded.
 */
export function UpcomingPayments({
  workspaceId,
  accounts,
  onPay,
}: FinanceData & { onPay: (target: PaymentTarget) => void }) {
  const id = useId();
  const today = localDateString();
  const [range, setRange] = useState<Range>("window");
  const [kind, setKind] = useState<CommitmentKind | "all">("all");
  const [status, setStatus] = useState<PaymentStatus | "all">("all");
  const bounds = rangeOf(range, today);
  const { state, refreshing, reload } = usePayments(workspaceId, {
    today,
    date_from: bounds.from,
    date_to: bounds.to,
    kind: kind === "all" ? undefined : [kind],
    status: status === "all" ? undefined : [status],
  });
  const loans = useLoans(workspaceId);
  const loansById = useMemo(
    () => byId(loans.state.status === "success" ? loans.state.data.loans : []),
    [loans.state],
  );
  const accountsById = useMemo(() => byId(accounts), [accounts]);

  const filters = (
    <div className="flex flex-wrap gap-2">
      <label htmlFor={`${id}-range`} className="sr-only">
        Dates
      </label>
      <NativeSelect
        id={`${id}-range`}
        className="w-48"
        value={range}
        onChange={(event) => {
          const next = RANGES.find((option) => option.value === event.target.value);
          if (next) setRange(next.value);
        }}
      >
        {RANGES.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
      <label htmlFor={`${id}-kind`} className="sr-only">
        Payment type
      </label>
      <NativeSelect
        id={`${id}-kind`}
        className="w-40"
        value={kind}
        onChange={(event) => {
          const next = KINDS.find((option) => option.value === event.target.value);
          if (next) setKind(next.value);
        }}
      >
        {KINDS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
      <label htmlFor={`${id}-status`} className="sr-only">
        Status
      </label>
      <NativeSelect
        id={`${id}-status`}
        className="w-36"
        value={status}
        onChange={(event) => {
          const value = event.target.value;
          const next = PAYMENT_STATUSES.find((option) => option.value === value);
          setStatus(next ? next.value : "all");
        }}
      >
        <option value="all">Any status</option>
        {PAYMENT_STATUSES.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );

  if (state.status === "error") {
    return (
      <div className="space-y-4">
        {filters}
        <div role="alert" className="space-y-3 rounded-xl border bg-card p-4 text-sm">
          <p>{state.message}</p>
          <Button variant="outline" size="sm" onClick={reload}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  if (state.status === "loading") {
    return (
      <div className="space-y-4">
        {filters}
        <span className="sr-only">Loading payments…</span>
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  const groups = groupPayments(state.data.payments);
  const row = (item: PaymentItem) => {
    const target =
      item.status === "paid" || item.status === "skipped" ? null : targetOf(item, loansById);
    const account = item.account_id ? accountsById.get(item.account_id)?.name : undefined;
    return (
      <li key={paymentKey(item)} className="flex flex-wrap items-center gap-3 px-3 py-3 sm:px-4">
        <KindIcon kind={item.kind} />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="truncate text-sm font-medium">{item.name}</p>
          <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
            <span>{KIND_LABELS[item.kind]}</span>
            <span aria-hidden="true">·</span>
            <span>
              {item.paid_on
                ? `Paid ${formatCalendarDate(item.paid_on)}`
                : `Due ${formatCalendarDate(item.due_date)}`}
            </span>
            {account ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate">{account}</span>
              </>
            ) : null}
          </p>
        </div>
        <span className="text-right text-sm font-medium tabular-nums">
          {item.estimated ? <span className="sr-only">About </span> : null}
          {item.estimated ? "≈ " : ""}
          {formatMoney(item.amount, item.currency)}
        </span>
        <PaymentStatusBadge status={item.status} />
        {target ? (
          <Button size="sm" variant="outline" onClick={() => onPay(target)}>
            Record
          </Button>
        ) : null}
      </li>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {filters}
        <p className="text-xs text-muted-foreground">
          {formatCalendarDate(bounds.from)} to {formatCalendarDate(bounds.to)}
        </p>
      </div>
      {state.data.payments.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title="Nothing due"
          description="No loan EMIs, subscriptions, or bills fall in these dates. Add them from their tabs to see what’s coming up."
        />
      ) : (
        <div
          aria-busy={refreshing}
          className={cn("space-y-6 transition-opacity duration-150", refreshing && "opacity-70")}
        >
          <Group title="Overdue" items={groups.overdue} tone="negative" render={row} />
          <Group title="Due today" items={groups.dueToday} render={row} />
          <Group title="Upcoming" items={groups.upcoming} render={row} />
          <Group title="Recently paid" items={groups.settled} render={row} quiet />
        </div>
      )}
    </div>
  );
}

function Group({
  title,
  items,
  render,
  tone = "default",
  quiet = false,
}: {
  title: string;
  items: PaymentItem[];
  render: (item: PaymentItem) => ReactNode;
  tone?: "default" | "negative";
  /** Settled payments: shown without a total. */
  quiet?: boolean;
}) {
  const id = useId();
  if (items.length === 0) return null;
  return (
    <section aria-labelledby={id} className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3
          id={id}
          className={cn("text-sm font-semibold", tone === "negative" && "text-destructive")}
        >
          {title} <span className="font-normal text-muted-foreground">({items.length})</span>
        </h3>
        {quiet ? null : (
          <p className="text-xs text-muted-foreground tabular-nums">
            {totalsByCurrency(items)
              .map(([currency, amount]) => formatMoney(amount, currency))
              .join(" + ")}
          </p>
        )}
      </div>
      <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-elevation-1">
        {items.map(render)}
      </ul>
    </section>
  );
}
