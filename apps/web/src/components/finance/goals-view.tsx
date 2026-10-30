"use client";

import type { ContributionType, Currency, SavingsGoal } from "@orbit/contracts";
import { ChevronDown, History, Pencil, Plus, Target } from "lucide-react";
import { useState } from "react";

import { describeApiError } from "@/api/client";
import { EmptyState } from "@/components/empty-state";
import { FormAlert } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useBudgetMutations, useContributions, useGoals } from "@/hooks/use-budgets";
import { formatMoney } from "@/lib/finance";
import { GOAL_STATE_LABELS, goalCategoryLabel, goalPriorityLabel } from "@/lib/goals";
import { cn } from "@/utils/common";
import { formatCalendarDate, localDateString } from "@/utils/dates";

import { UtilizationBar } from "./budget-parts";
import { ConfirmAction } from "./commitment-parts";
import type { FinanceData } from "./finance-view";
import { ContributionDialog, GoalDialog } from "./goal-dialogs";

type Dialog =
  | { kind: "goal"; goal?: SavingsGoal }
  | { kind: "contribution"; goal: SavingsGoal; type: ContributionType };

/** Savings goals: progress, what to save each month, and the money behind each goal. */
export function GoalsView({ workspaceId, accounts, onAnnounce }: FinanceData) {
  const today = localDateString();
  const { state, reload } = useGoals(workspaceId, today);
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const dialogs =
    dialog?.kind === "goal" ? (
      <GoalDialog
        workspaceId={workspaceId}
        goal={dialog.goal}
        accounts={accounts}
        onSaved={onAnnounce}
        onClose={() => setDialog(null)}
      />
    ) : dialog?.kind === "contribution" ? (
      <ContributionDialog
        workspaceId={workspaceId}
        goal={dialog.goal}
        type={dialog.type}
        accounts={accounts}
        onSaved={onAnnounce}
        onClose={() => setDialog(null)}
      />
    ) : null;

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
        <span className="sr-only">Loading savings goals…</span>
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }
  const goals = state.data.goals;
  if (goals.length === 0) {
    return (
      <>
        <EmptyState
          icon={Target}
          title="No savings goals yet"
          description="Save for an emergency fund, a car, a holiday, or a home. Orbit shows your progress and how much to put aside each month."
        >
          <Button onClick={() => setDialog({ kind: "goal" })}>
            <Plus aria-hidden="true" />
            Add goal
          </Button>
        </EmptyState>
        {dialogs}
      </>
    );
  }
  const open = goals.filter((goal) => goal.state === "active" || goal.state === "paused");
  const closed = goals.filter((goal) => goal.state === "completed" || goal.state === "cancelled");
  const handlers = {
    workspaceId,
    onAnnounce,
    onEdit: (goal: SavingsGoal) => setDialog({ kind: "goal", goal }),
    onMove: (goal: SavingsGoal, type: ContributionType) =>
      setDialog({ kind: "contribution", goal, type }),
  };

  return (
    <div className="space-y-6">
      <GoalTotals goals={open} />
      <section aria-labelledby="goals-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="goals-heading" className="text-base font-semibold">
            Savings goals
          </h2>
          <Button size="sm" onClick={() => setDialog({ kind: "goal" })}>
            <Plus aria-hidden="true" />
            Add goal
          </Button>
        </div>
        {open.length === 0 ? (
          <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
            Nothing in progress. Completed and cancelled goals are below.
          </p>
        ) : (
          <ul aria-label="Savings goals in progress" className="grid gap-4 lg:grid-cols-2">
            {open.map((goal) => (
              <GoalCard key={goal.id} goal={goal} {...handlers} />
            ))}
          </ul>
        )}
        {closed.length > 0 ? (
          <details className="rounded-xl border bg-card/60">
            <summary className="cursor-pointer rounded-xl px-4 py-3 text-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {closed.length} completed or cancelled
            </summary>
            <ul
              aria-label="Completed and cancelled goals"
              className="grid gap-4 p-4 lg:grid-cols-2"
            >
              {closed.map((goal) => (
                <GoalCard key={goal.id} goal={goal} {...handlers} />
              ))}
            </ul>
          </details>
        ) : null}
      </section>
      {dialogs}
    </div>
  );
}

/** Saved against targets per currency; currencies are never added together. */
function GoalTotals({ goals }: { goals: SavingsGoal[] }) {
  const totals = new Map<Currency, { saved: number; target: number; monthly: number }>();
  for (const goal of goals) {
    const total = totals.get(goal.currency) ?? { saved: 0, target: 0, monthly: 0 };
    total.saved += Math.max(goal.saved, 0);
    total.target += goal.target_amount;
    if (goal.state === "active") total.monthly += goal.suggested_monthly ?? 0;
    totals.set(goal.currency, total);
  }
  if (totals.size === 0) return null;
  return (
    <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {[...totals.entries()].map(([currency, total]) => (
        <div key={currency} className="rounded-xl border bg-card p-5 shadow-elevation-1">
          <dt className="text-sm text-muted-foreground">Saved toward goals ({currency})</dt>
          <dd className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
            {formatMoney(total.saved, currency)}
          </dd>
          <dd className="mt-1 text-xs text-muted-foreground">
            of {formatMoney(total.target, currency)}
            {total.monthly > 0
              ? ` · ${formatMoney(total.monthly, currency)} a month to stay on track`
              : ""}
          </dd>
        </div>
      ))}
    </dl>
  );
}

type GoalCardProps = {
  goal: SavingsGoal;
  workspaceId: string;
  onAnnounce: (message: string) => void;
  onEdit: (goal: SavingsGoal) => void;
  onMove: (goal: SavingsGoal, type: ContributionType) => void;
};

function GoalCard({ goal, workspaceId, onAnnounce, onEdit, onMove }: GoalCardProps) {
  const { updateGoal, deleteGoal } = useBudgetMutations(workspaceId);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const historyId = `goal-history-${goal.id}`;
  const headingId = `goal-${goal.id}`;
  const currency = goal.currency;
  const account = goal.account;
  const overAllocated = account !== null && account.allocated > Math.max(account.balance, 0);

  const act = async (work: () => Promise<unknown>, message: string) => {
    setError(null);
    try {
      await work();
      onAnnounce(message);
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t make that change. Try again."));
    }
  };
  const setState = (state: SavingsGoal["state"], message: string) =>
    act(() => updateGoal.mutateAsync({ id: goal.id, changes: { state } }), message);

  return (
    <li
      aria-labelledby={headingId}
      className="space-y-4 rounded-xl border bg-card p-5 shadow-elevation-1"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <h3 id={headingId} className="truncate text-sm font-semibold">
            {goal.name}
          </h3>
          <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
            <span>{goalCategoryLabel(goal.category)}</span>
            <span>{goalPriorityLabel(goal.priority)} priority</span>
            {goal.target_date ? <span>By {formatCalendarDate(goal.target_date)}</span> : null}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {goal.reached && goal.state !== "completed" ? (
            <Badge variant="outline" className="border-success/40 text-success">
              Target reached
            </Badge>
          ) : null}
          {goal.state !== "active" ? (
            <Badge variant="outline">{GOAL_STATE_LABELS[goal.state]}</Badge>
          ) : null}
        </div>
      </div>
      {goal.description ? (
        <p className="text-sm text-pretty text-muted-foreground">{goal.description}</p>
      ) : null}

      <div className="space-y-1.5">
        <UtilizationBar label={`${goal.name} progress`} percent={goal.progress_percent} />
        <p className="flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground tabular-nums">
          <span>
            <span className="text-sm font-semibold text-foreground">
              {formatMoney(goal.saved, currency)}
            </span>{" "}
            of {formatMoney(goal.target_amount, currency)} · {goal.progress_percent}%
          </span>
          <span>{formatMoney(goal.remaining, currency)} to go</span>
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <dt className="text-muted-foreground">Suggested each month</dt>
          <dd className="text-sm font-medium tabular-nums">
            {goal.suggested_monthly === null
              ? "Set a target date"
              : goal.months_left === 0 && goal.remaining > 0
                ? `${formatMoney(goal.suggested_monthly, currency)} now`
                : formatMoney(goal.suggested_monthly, currency)}
          </dd>
          {goal.months_left !== null && goal.remaining > 0 ? (
            <dd className={cn("text-muted-foreground", goal.months_left === 0 && "text-warning")}>
              {goal.months_left === 0
                ? "The target date has passed"
                : `${goal.months_left} ${goal.months_left === 1 ? "month" : "months"} left`}
            </dd>
          ) : null}
        </div>
        <div>
          <dt className="text-muted-foreground">This month</dt>
          <dd className="text-sm font-medium tabular-nums">
            {formatMoney(goal.this_month, currency)}
          </dd>
        </div>
        <div className="col-span-2 rounded-lg border bg-muted/30 p-3">
          <dt className="text-muted-foreground">
            {account ? `Kept in ${account.name}` : "Not linked to an account"}
          </dt>
          <dd className="mt-0.5 tabular-nums">
            {account ? (
              <>
                {formatMoney(account.balance, currency)} in the account ·{" "}
                {formatMoney(goal.available, currency)} available to withdraw
              </>
            ) : (
              <>Allocated from money you hold · {formatMoney(goal.available, currency)} set aside</>
            )}
          </dd>
          {overAllocated ? (
            <dd className="mt-1 text-warning">
              Goals in this account count on {formatMoney(account.allocated, currency)}, more than
              it holds.
            </dd>
          ) : null}
        </div>
      </dl>

      <FormAlert message={error} />

      <div className="flex flex-wrap items-center gap-1">
        {goal.state === "active" ? (
          <Button size="sm" variant="outline" onClick={() => onMove(goal, "contribution")}>
            Add money
          </Button>
        ) : null}
        {goal.saved > 0 && goal.state !== "cancelled" ? (
          <Button size="sm" variant="ghost" onClick={() => onMove(goal, "withdrawal")}>
            Withdraw
          </Button>
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
          aria-label={`Edit “${goal.name}”`}
          onClick={() => onEdit(goal)}
        >
          <Pencil aria-hidden="true" />
        </Button>
        {goal.state === "active" ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void setState("paused", `Paused “${goal.name}”.`)}
            >
              Pause
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void setState("completed", `Completed “${goal.name}”. Well done.`)}
            >
              Mark complete
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void setState(
                "active",
                goal.state === "paused" ? `Resumed “${goal.name}”.` : `Reopened “${goal.name}”.`,
              )
            }
          >
            {goal.state === "paused" ? "Resume" : "Reopen"}
          </Button>
        )}
        {goal.state === "active" || goal.state === "paused" ? (
          <ConfirmAction
            label="Cancel"
            prompt={`Cancel “${goal.name}”?`}
            options={[
              {
                label: "Cancel goal",
                destructive: true,
                onConfirm: () =>
                  setState("cancelled", `Cancelled “${goal.name}”. Its history is kept.`),
              },
            ]}
          />
        ) : null}
        {goal.saved === 0 ? (
          <ConfirmAction
            label="Delete"
            prompt={`Delete “${goal.name}”?`}
            options={[
              {
                label: "Delete goal",
                destructive: true,
                onConfirm: () =>
                  act(() => deleteGoal.mutateAsync(goal.id), `Deleted “${goal.name}”.`),
              },
            ]}
          />
        ) : null}
      </div>

      {showHistory ? (
        <div id={historyId} className="animate-page-in">
          <ContributionHistory goal={goal} workspaceId={workspaceId} onAnnounce={onAnnounce} />
        </div>
      ) : null}
    </li>
  );
}

function ContributionHistory({
  goal,
  workspaceId,
  onAnnounce,
}: {
  goal: SavingsGoal;
  workspaceId: string;
  onAnnounce: (message: string) => void;
}) {
  const { state, reload } = useContributions(workspaceId, goal.id, true);
  const { undoContribution } = useBudgetMutations(workspaceId);
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
  const entries = state.data.contributions;
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing added yet.</p>;
  }
  const undo = async (contributionId: string, deleteTransaction: boolean, message: string) => {
    setError(null);
    try {
      await undoContribution.mutateAsync({ goalId: goal.id, contributionId, deleteTransaction });
      onAnnounce(message);
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t undo that. Try again."));
    }
  };

  return (
    <div className="space-y-2">
      <FormAlert message={error} />
      <ol aria-label={`${goal.name} contributions`} className="divide-y rounded-lg border">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm"
          >
            <span className="min-w-24 flex-1">{formatCalendarDate(entry.occurred_on)}</span>
            <span
              className={cn(
                "tabular-nums",
                entry.type === "withdrawal" ? "text-muted-foreground" : "font-medium",
              )}
            >
              {entry.type === "withdrawal" ? "−" : "+"}
              {formatMoney(entry.amount, goal.currency)}
            </span>
            <span className="text-xs text-muted-foreground">
              {entry.transaction_id ? "Transfer" : "Set aside"}
            </span>
            <ConfirmAction
              label="Undo"
              prompt={`Undo the ${formatCalendarDate(entry.occurred_on)} ${entry.type}?`}
              options={
                entry.transaction_id
                  ? [
                      {
                        label: "Undo and delete the transfer",
                        destructive: true,
                        onConfirm: () => undo(entry.id, true, "Undid it and deleted its transfer."),
                      },
                      {
                        label: "Undo, keep the transfer",
                        onConfirm: () => undo(entry.id, false, "Undid it. The transfer stays."),
                      },
                    ]
                  : [{ label: "Undo", onConfirm: () => undo(entry.id, false, "Undid it.") }]
              }
            />
          </li>
        ))}
      </ol>
    </div>
  );
}
