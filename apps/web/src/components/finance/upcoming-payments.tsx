"use client";

import type { CommitmentKind, Loan, PaymentItem, PaymentStatus } from "@orbit/contracts";
import { CalendarCheck, ChevronDown } from "lucide-react";
import { type ReactNode, useId, useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useLoans, usePayments } from "@/hooks/use-commitments";
import {
  groupPayments,
  KIND_LABELS,
  PAYMENT_STATUSES,
  PAYMENT_WINDOW_DAYS,
  paymentKey,
  SOON_DAYS,
  splitUpcoming,
  totalsByCurrency,
} from "@/lib/commitments";
import { formatMoney } from "@/lib/finance";
import { byId, cn, type Option } from "@/utils/common";
import { addDays, formatCalendarDate, localDateString, monthRange } from "@/utils/dates";

import { KindIcon, PaymentStatusBadge } from "./commitment-parts";
import { rowListClassName, SectionHeading } from "./finance-meta";
import type { FinanceData } from "./finance-view";
import { LoadError } from "./panel";
import type { PaymentTarget } from "./payment-dialog";
import { ViewHeader } from "./view-header";

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

const STATUS_FILTERS: readonly Option<PaymentStatus | "all">[] = [
  { value: "all", label: "Any status" },
  ...PAYMENT_STATUSES,
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
    <>
      <label htmlFor={`${id}-range`} className="sr-only">
        Dates
      </label>
      <Select
        id={`${id}-range`}
        className="w-48"
        value={range}
        onValueChange={setRange}
        options={RANGES}
      />
      <label htmlFor={`${id}-kind`} className="sr-only">
        Payment type
      </label>
      <Select
        id={`${id}-kind`}
        className="w-40"
        value={kind}
        onValueChange={setKind}
        options={KINDS}
      />
      <label htmlFor={`${id}-status`} className="sr-only">
        Status
      </label>
      <Select
        id={`${id}-status`}
        className="w-36"
        value={status}
        onValueChange={setStatus}
        options={STATUS_FILTERS}
      />
    </>
  );
  const header = (
    <ViewHeader
      title="Upcoming payments"
      description={`Loan EMIs, subscriptions, and bills from ${formatCalendarDate(bounds.from)} to ${formatCalendarDate(bounds.to)}. They aren’t spending until you record them.`}
      controls={filters}
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
        <span className="sr-only">Loading payments…</span>
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  const groups = groupPayments(state.data.payments);
  const { soon, later } = splitUpcoming(groups.upcoming, today);
  const row = (item: PaymentItem) => {
    const target =
      item.status === "paid" || item.status === "skipped" ? null : targetOf(item, loansById);
    const account = item.account_id ? accountsById.get(item.account_id)?.name : undefined;
    return (
      <li
        key={paymentKey(item)}
        className="flex items-center gap-3 px-3 py-2.5 transition-colors duration-150 hover:bg-accent/40 @md/rows:px-4"
      >
        <KindIcon kind={item.kind} />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="truncate text-sm font-medium">{item.name}</p>
          <p className="flex min-w-0 gap-x-1.5 text-xs text-muted-foreground">
            <span className="shrink-0">
              {item.paid_on
                ? `Paid ${formatCalendarDate(item.paid_on)}`
                : `Due ${formatCalendarDate(item.due_date)}`}
            </span>
            <span aria-hidden="true">·</span>
            <span className="shrink-0">{KIND_LABELS[item.kind]}</span>
            {account ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate">{account}</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 @lg/rows:flex-row @lg/rows:items-center @lg/rows:gap-3">
          <span className="text-sm font-medium whitespace-nowrap tabular-nums">
            {item.estimated ? <span className="sr-only">About </span> : null}
            {item.estimated ? "≈ " : ""}
            {formatMoney(item.amount, item.currency)}
          </span>
          {/* Inside its section, "upcoming" goes without saying. */}
          {item.status === "upcoming" ? null : <PaymentStatusBadge status={item.status} />}
        </div>
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
      {header}
      {state.data.payments.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title="Nothing due"
          description="No loan EMIs, subscriptions, or bills fall in these dates. Add them from their views to see what’s coming up."
        />
      ) : (
        <div
          aria-busy={refreshing}
          // Sections flow into two columns on very wide lists, read down then across.
          className={cn(
            "gap-6 transition-opacity duration-150 @6xl/list:columns-2",
            refreshing && "opacity-70",
          )}
        >
          <Group title="Overdue" items={groups.overdue} tone="danger" render={row} cap={5} />
          <Group title="Due today" items={groups.dueToday} tone="brand" render={row} />
          <Group title={`Next ${SOON_DAYS} days`} items={soon} render={row} />
          <Group title="Later" items={later} render={row} />
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
  cap,
}: {
  title: string;
  items: PaymentItem[];
  render: (item: PaymentItem) => ReactNode;
  tone?: "default" | "danger" | "brand";
  /** Settled payments: shown without a total. */
  quiet?: boolean;
  /** Show this many until asked for the rest, so a long backlog doesn't bury the page. */
  cap?: number;
}) {
  const id = useId();
  const [showAll, setShowAll] = useState(false);
  if (items.length === 0) return null;
  const shown = cap && !showAll ? items.slice(0, cap) : items;
  const hidden = items.length - shown.length;
  return (
    <section aria-labelledby={id} className="mb-6 break-inside-avoid space-y-2 last:mb-0">
      <SectionHeading
        id={id}
        tone={tone}
        count={items.length}
        trailing={
          quiet
            ? null
            : totalsByCurrency(items)
                .map(([currency, amount]) => formatMoney(amount, currency))
                .join(" + ")
        }
      >
        {title}
      </SectionHeading>
      <ul className={rowListClassName}>{shown.map(render)}</ul>
      {hidden > 0 ? (
        <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
          <ChevronDown aria-hidden="true" />
          Show {hidden} more
        </Button>
      ) : null}
    </section>
  );
}
