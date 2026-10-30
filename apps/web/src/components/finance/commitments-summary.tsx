"use client";

import type { Currency } from "@orbit/contracts";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCommitmentSummary } from "@/hooks/use-commitments";
import { formatMoney } from "@/lib/finance";
import { cn } from "@/utils/common";
import { localDateString } from "@/utils/dates";

/**
 * Loans, EMIs, subscriptions, and what's due, in one currency, for the Overview. Hidden until the
 * workspace has a commitment, so finances without any stay uncluttered. Details live in the
 * Upcoming, Loans, Subscriptions, and Bills views.
 */
export function CommitmentsSummary({
  workspaceId,
  currency,
  onOpenUpcoming,
}: {
  workspaceId: string;
  currency: Currency;
  onOpenUpcoming: () => void;
}) {
  const { state, reload } = useCommitmentSummary(workspaceId, currency, localDateString());

  if (state.status === "loading") return <Skeleton className="h-36 rounded-xl" />;
  if (state.status === "error") {
    return (
      <div
        role="alert"
        className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4 text-sm"
      >
        <p>{state.message}</p>
        <Button variant="outline" size="sm" onClick={reload}>
          Try again
        </Button>
      </div>
    );
  }
  const summary = state.data;
  const hasAny =
    summary.active_loans > 0 ||
    summary.active_subscriptions > 0 ||
    summary.due_this_month.count > 0 ||
    summary.overdue.count > 0 ||
    summary.upcoming_bills.count > 0;
  if (!hasAny) return null;

  return (
    <section aria-labelledby="commitments-heading">
      <Card className="space-y-4 p-5 shadow-elevation-1">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h3 id="commitments-heading" className="text-sm font-semibold">
              Commitments
            </h3>
            <p className="text-xs text-muted-foreground">
              Expected payments, not spending until you record them.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onOpenUpcoming}>
            Upcoming payments
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Figure
            label="Loans outstanding"
            value={formatMoney(summary.loans_outstanding, currency)}
          >
            {summary.active_loans > 0
              ? `${formatMoney(summary.monthly_emi, currency)} a month in EMIs`
              : "No active loans"}
          </Figure>
          <Figure
            label="Subscriptions"
            value={`${formatMoney(summary.monthly_subscriptions, currency)} / mo`}
          >
            {summary.active_subscriptions > 0
              ? `${formatMoney(summary.annual_subscriptions, currency)} a year`
              : "None active"}
          </Figure>
          <Figure
            label="Left to pay this month"
            value={formatMoney(summary.due_this_month.amount, currency)}
          >
            {countLabel(summary.due_this_month.count)}
            {summary.upcoming_bills.count > 0
              ? ` · ${summary.upcoming_bills.count} ${summary.upcoming_bills.count === 1 ? "bill" : "bills"} in 30 days`
              : ""}
          </Figure>
          <Figure
            label="Overdue"
            value={formatMoney(summary.overdue.amount, currency)}
            tone={summary.overdue.count > 0 ? "negative" : "default"}
          >
            {summary.overdue.count > 0 ? countLabel(summary.overdue.count) : "Nothing overdue"}
          </Figure>
        </dl>
      </Card>
    </section>
  );
}

function countLabel(count: number): string {
  return `${count} ${count === 1 ? "payment" : "payments"}`;
}

function Figure({
  label,
  value,
  tone = "default",
  children,
}: {
  label: string;
  value: string;
  tone?: "default" | "negative";
  children: ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "text-lg font-semibold tracking-tight tabular-nums",
          tone === "negative" && "text-destructive",
        )}
      >
        {value}
      </dd>
      <dd className="text-xs text-muted-foreground">{children}</dd>
    </div>
  );
}
