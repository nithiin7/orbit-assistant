"use client";

import type { Currency } from "@orbit/contracts";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useBudgetMonth, useGoals } from "@/hooks/use-budgets";
import { formatMoney } from "@/lib/finance";
import { cn } from "@/utils/common";
import { localDateString, monthLabel } from "@/utils/dates";

import { UtilizationBadge, UtilizationBar } from "./budget-parts";

/**
 * The month's budget and the savings goals in progress, for the Overview. Each card is hidden
 * until the workspace has a budget or goal, so finances without them stay uncluttered.
 */
export function BudgetSummary({
  workspaceId,
  month,
  currency,
  onOpenBudgets,
  onOpenGoals,
}: {
  workspaceId: string;
  month: string;
  currency: Currency;
  onOpenBudgets: () => void;
  onOpenGoals: () => void;
}) {
  const today = localDateString();
  const budgets = useBudgetMonth(workspaceId, month, currency, today);
  const goals = useGoals(workspaceId, today);

  if (budgets.state.status === "loading" || goals.state.status === "loading") {
    return <Skeleton className="h-36 rounded-xl" />;
  }
  if (budgets.state.status === "error" || goals.state.status === "error") {
    const message =
      budgets.state.status === "error"
        ? budgets.state.message
        : goals.state.status === "error"
          ? goals.state.message
          : "";
    return (
      <div
        role="alert"
        className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4 text-sm"
      >
        <p>{message}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            budgets.reload();
            goals.reload();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  const summary = budgets.state.data;
  const inProgress = goals.state.data.goals.filter(
    (goal) => goal.state === "active" && goal.currency === currency,
  );
  const attention = summary.budgets.filter(
    (budget) => budget.current_period && budget.current_period.status !== "on_track",
  );
  if (summary.budgets.length === 0 && inProgress.length === 0) return null;

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {summary.budgets.length > 0 ? (
        <section aria-labelledby="budget-summary-heading">
          <Card className="h-full space-y-4 p-5 shadow-elevation-1">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h3 id="budget-summary-heading" className="text-sm font-semibold">
                  Budget
                </h3>
                <p className="text-xs text-muted-foreground">{monthLabel(month)}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={onOpenBudgets}>
                Budgets
                <ArrowRight aria-hidden="true" />
              </Button>
            </div>
            {summary.total !== null && summary.status ? (
              <div className="space-y-1.5">
                <p className="text-sm tabular-nums">
                  <span className="text-lg font-semibold">
                    {formatMoney(summary.spent, currency)}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    of {formatMoney(summary.total, currency)}
                  </span>
                </p>
                <UtilizationBar
                  label="Monthly budget used"
                  percent={summary.utilization_percent}
                  status={summary.status}
                />
                <p
                  className={cn(
                    "text-xs text-muted-foreground",
                    summary.remaining !== null && summary.remaining < 0 && "text-destructive",
                  )}
                >
                  {summary.remaining !== null && summary.remaining < 0
                    ? `${formatMoney(-summary.remaining, currency)} over budget`
                    : `${formatMoney(summary.remaining ?? 0, currency)} left`}
                </p>
              </div>
            ) : null}
            {attention.length > 0 ? (
              <ul className="space-y-2" aria-label="Budgets needing attention">
                {attention.slice(0, 3).map((budget) => (
                  <li key={budget.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate">{budget.name}</span>
                    {budget.current_period ? (
                      <UtilizationBadge status={budget.current_period.status} />
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">Every budget is on track.</p>
            )}
          </Card>
        </section>
      ) : null}

      {inProgress.length > 0 ? (
        <section aria-labelledby="goal-summary-heading">
          <Card className="h-full space-y-4 p-5 shadow-elevation-1">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h3 id="goal-summary-heading" className="text-sm font-semibold">
                  Savings goals
                </h3>
                <p className="text-xs text-muted-foreground">Saving isn’t spending.</p>
              </div>
              <Button variant="ghost" size="sm" onClick={onOpenGoals}>
                Goals
                <ArrowRight aria-hidden="true" />
              </Button>
            </div>
            <ul className="space-y-3" aria-label="Savings goals in progress">
              {inProgress.slice(0, 3).map((goal) => (
                <li key={goal.id} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate">{goal.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {formatMoney(goal.saved, currency)} of{" "}
                      {formatMoney(goal.target_amount, currency)}
                    </span>
                  </div>
                  <UtilizationBar label={`${goal.name} progress`} percent={goal.progress_percent} />
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
