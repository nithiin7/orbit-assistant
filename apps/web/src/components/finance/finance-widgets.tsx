"use client";

import type { PaymentItem } from "@orbit/contracts";
import { ArrowRight, CalendarClock, type LucideIcon, PiggyBank, Scale, Wallet } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useId } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Resource } from "@/hooks/query-resource";
import {
  type FinanceWidget,
  UPCOMING_DAYS,
  useBudgetWidget,
  useCashFlowWidget,
  useNetWorthWidget,
  useUpcomingPaymentsWidget,
} from "@/hooks/use-finance-widgets";
import { formatMoney } from "@/lib/finance";
import { cn } from "@/utils/common";
import { formatCalendarDate, localDateString, monthLabel } from "@/utils/dates";

import { UtilizationBar } from "./budget-parts";
import { PaymentStatusBadge } from "./commitment-parts";

/** How many payments the payments widget lists before summing up the rest. */
const PAYMENTS_SHOWN = 5;

/** This month's income, spending, and net, with account balances, for the dashboard. */
export function CashFlowWidget() {
  return (
    <WidgetCard title="This month" icon={Wallet} {...useCashFlowWidget()}>
      {({ currency, summary, totals }) =>
        summary === null ? (
          <EmptyMessage action="Add an account">
            Track income and spending by adding your first account.
          </EmptyMessage>
        ) : (
          <div className="space-y-4">
            <dl className="grid grid-cols-3 gap-3">
              <Figure label="Income" value={formatMoney(summary.income, currency)} />
              <Figure label="Spending" value={formatMoney(summary.net_expenses, currency)} />
              <Figure
                label="Net"
                value={formatMoney(summary.net, currency, { signDisplay: "always" })}
                tone={summary.net < 0 ? "negative" : "default"}
              />
            </dl>
            {totals ? (
              <p className="text-xs text-muted-foreground tabular-nums">
                {formatMoney(totals.assets, currency)} in accounts
                {totals.liabilities !== 0
                  ? ` · ${formatMoney(totals.liabilities, currency)} owed`
                  : ""}
              </p>
            ) : null}
          </div>
        )
      }
    </WidgetCard>
  );
}

/** Overdue payments and what's due soon, for the dashboard. */
export function UpcomingPaymentsWidget() {
  return (
    <WidgetCard title="Upcoming payments" icon={CalendarClock} {...useUpcomingPaymentsWidget()}>
      {(payments) =>
        payments.length === 0 ? (
          <EmptyMessage>Nothing due in the next {UPCOMING_DAYS} days.</EmptyMessage>
        ) : (
          <PaymentList payments={payments} />
        )
      }
    </WidgetCard>
  );
}

function PaymentList({ payments }: { payments: PaymentItem[] }) {
  const year = Number(localDateString().slice(0, 4));
  const rest = payments.length - PAYMENTS_SHOWN;
  return (
    <div className="space-y-2">
      <ul className="divide-y rounded-lg border">
        {payments.slice(0, PAYMENTS_SHOWN).map((payment) => (
          <li
            key={`${payment.commitment_id}-${payment.occurrence_id ?? payment.due_date}`}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
          >
            <span className="min-w-0 flex-1 truncate text-sm">{payment.name}</span>
            <span className="text-xs text-muted-foreground">
              {formatCalendarDate(payment.due_date, { omitYearIn: year })}
            </span>
            <span className="text-sm tabular-nums">
              {payment.estimated ? <span className="sr-only">About </span> : null}
              {payment.estimated ? "≈ " : ""}
              {formatMoney(payment.amount, payment.currency)}
            </span>
            {payment.status === "upcoming" ? null : <PaymentStatusBadge status={payment.status} />}
          </li>
        ))}
      </ul>
      {rest > 0 ? (
        <p className="text-xs text-muted-foreground">
          And {rest} more {rest === 1 ? "payment" : "payments"}.
        </p>
      ) : null}
    </div>
  );
}

/** How much of this month's budget is spent, for the dashboard. */
export function BudgetWidget() {
  return (
    <WidgetCard title="Budget" icon={PiggyBank} {...useBudgetWidget()}>
      {({ currency, month }) =>
        month.budgets.length === 0 ? (
          <EmptyMessage action="Set a budget">
            No budget covers {monthLabel(month.month)}.
          </EmptyMessage>
        ) : month.total !== null && month.status ? (
          <div className="space-y-1.5">
            <p className="text-sm tabular-nums">
              <span className="text-lg font-semibold">{formatMoney(month.spent, currency)}</span>{" "}
              <span className="text-muted-foreground">of {formatMoney(month.total, currency)}</span>
            </p>
            <UtilizationBar
              label="Monthly budget used"
              percent={month.utilization_percent}
              status={month.status}
            />
            <p
              className={cn(
                "text-xs text-muted-foreground",
                month.remaining !== null && month.remaining < 0 && "text-destructive",
              )}
            >
              {month.remaining !== null && month.remaining < 0
                ? `${formatMoney(-month.remaining, currency)} over budget`
                : `${formatMoney(month.remaining ?? 0, currency)} left`}
              {month.budgets_counted > 0
                ? ` · ${month.budgets_within} of ${month.budgets_counted} on track`
                : ""}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {formatMoney(month.spent, currency)} spent this month.
          </p>
        )
      }
    </WidgetCard>
  );
}

/** Assets, liabilities, and net worth today, for the dashboard. */
export function NetWorthWidget() {
  return (
    <WidgetCard title="Net worth" icon={Scale} {...useNetWorthWidget()}>
      {(netWorth) =>
        netWorth.items.length === 0 ? (
          <EmptyMessage action="Add an account">
            Add accounts, investments, or assets to see your net worth.
          </EmptyMessage>
        ) : (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3">
              <Figure
                label="Net worth"
                value={formatMoney(netWorth.net_worth, netWorth.currency)}
                tone={netWorth.net_worth < 0 ? "negative" : "default"}
                className="col-span-2"
              />
              <Figure label="Assets" value={formatMoney(netWorth.assets, netWorth.currency)} />
              <Figure
                label="Liabilities"
                value={formatMoney(netWorth.liabilities, netWorth.currency)}
              />
            </dl>
            <p className="text-xs text-muted-foreground">
              As of {formatCalendarDate(netWorth.as_of)}, in {netWorth.currency}.
            </p>
          </div>
        )
      }
    </WidgetCard>
  );
}

/** The card every finance widget shares: a heading linking to Finance, then its states. */
function WidgetCard<T>({
  title,
  icon: Icon,
  resource,
  reload,
  children,
}: FinanceWidget<T> & {
  title: string;
  icon: LucideIcon;
  children: (data: T) => ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="h-full">
      <Card className="h-full shadow-elevation-1" aria-busy={resource.status === "loading"}>
        <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
          <h2 id={headingId} className="flex items-center gap-2 text-base font-semibold">
            <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
            {title}
          </h2>
          <Link href="/finance" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Open finance
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>
        <WidgetBody resource={resource} reload={reload} title={title}>
          {children}
        </WidgetBody>
      </Card>
    </section>
  );
}

function WidgetBody<T>({
  resource,
  reload,
  title,
  children,
}: {
  resource: Resource<T>;
  reload: () => void;
  title: string;
  children: (data: T) => ReactNode;
}) {
  if (resource.status === "loading") {
    return (
      <div className="space-y-2 p-5">
        <span className="sr-only">Loading {title.toLowerCase()}…</span>
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }
  if (resource.status === "error") {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="text-sm text-muted-foreground">{resource.message}</p>
        <Button variant="outline" size="sm" onClick={reload}>
          Try again
        </Button>
      </div>
    );
  }
  return <div className="p-5">{children(resource.data)}</div>;
}

function EmptyMessage({ action, children }: { action?: string; children: ReactNode }) {
  return (
    <p className="text-sm text-muted-foreground">
      {children}
      {action ? (
        <>
          {" "}
          <Link
            href="/finance"
            className="rounded-sm font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {action}
          </Link>
        </>
      ) : null}
    </p>
  );
}

function Figure({
  label,
  value,
  tone = "default",
  className,
}: {
  label: string;
  value: string;
  tone?: "default" | "negative";
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "truncate text-lg font-semibold tracking-tight tabular-nums",
          tone === "negative" && "text-destructive",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
