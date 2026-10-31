"use client";

import type { Currency } from "@orbit/contracts";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCommitmentSummary } from "@/hooks/use-commitments";
import { formatMoney } from "@/lib/finance";
import { cn } from "@/utils/common";
import { localDateString } from "@/utils/dates";

import { LoadError, Panel } from "./panel";

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
  if (state.status === "error") return <LoadError message={state.message} onRetry={reload} />;
  const summary = state.data;
  const hasAny =
    summary.active_loans > 0 ||
    summary.active_subscriptions > 0 ||
    summary.due_this_month.count > 0 ||
    summary.overdue.count > 0 ||
    summary.upcoming_bills.count > 0;
  if (!hasAny) return null;

  return (
    <Panel
      title="Commitments"
      description="Expected payments, not spending until you record them."
      action={
        <Button variant="ghost" size="sm" onClick={onOpenUpcoming}>
          Upcoming payments
          <ArrowRight aria-hidden="true" />
        </Button>
      }
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
        <Figure label="Loans outstanding" value={formatMoney(summary.loans_outstanding, currency)}>
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
    </Panel>
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
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "text-lg font-semibold tracking-tight whitespace-nowrap tabular-nums",
          tone === "negative" && "text-destructive",
        )}
      >
        {value}
      </dd>
      <dd className="text-xs text-muted-foreground">{children}</dd>
    </div>
  );
}
