"use client";

import type { ContributionType, Currency, SavingsGoal } from "@orbit/contracts";
import {
  ArrowUpFromLine,
  Ban,
  CircleCheck,
  CircleHelp,
  History,
  Pause,
  Pencil,
  Play,
  Plus,
  Target,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import { describeApiError } from "@/api/client";
import { EmptyState } from "@/components/empty-state";
import { FormAlert } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useBudgetMutations, useContributions, useGoals } from "@/hooks/use-budgets";
import { formatMoney } from "@/lib/finance";
import { GOAL_STATE_LABELS, goalCategoryLabel, goalPriorityLabel } from "@/lib/goals";
import { cn } from "@/utils/common";
import { formatCalendarDate, localDateString } from "@/utils/dates";

import { UtilizationBar } from "./budget-parts";
import { ConfirmAction } from "./commitment-parts";
import { Chip } from "./finance-meta";
import type { FinanceData } from "./finance-view";
import { ContributionDialog, GoalDialog } from "./goal-dialogs";
import { EndedSection, LoadError } from "./panel";
import { RowActions } from "./row-actions";
import { StatGrid, StatTile } from "./stat-tile";
import { ViewHeader } from "./view-header";

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

  const addButton = (
    <Button onClick={() => setDialog({ kind: "goal" })}>
      <Plus aria-hidden="true" />
      Add goal
    </Button>
  );
  const header = (
    <ViewHeader
      title="Savings goals"
      description="What you’re saving for, how far along you are, and what to put aside each month. Saving isn’t spending."
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
        <span className="sr-only">Loading savings goals…</span>
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
          {addButton}
        </EmptyState>
        {dialogs}
      </>
    );
  }
  const open = goals.filter((goal) => goal.state === "active" || goal.state === "paused");
  const closed = goals.filter((goal) => goal.state === "completed" || goal.state === "cancelled");
  const shared = sharedOverAllocations(open);
  const handlers = {
    workspaceId,
    onAnnounce,
    sharedWarnings: new Set(shared.map((entry) => entry.accountName)),
    onEdit: (goal: SavingsGoal) => setDialog({ kind: "goal", goal }),
    onMove: (goal: SavingsGoal, type: ContributionType) =>
      setDialog({ kind: "contribution", goal, type }),
  };
  const gridClassName = "grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-4";

  return (
    <div className="space-y-6">
      {header}
      <GoalTotals goals={open} />
      {shared.map((entry) => (
        <p
          key={entry.accountName}
          role="note"
          className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm"
        >
          <CircleHelp aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            {entry.goals.join(", ")} are kept in {entry.accountName} and count on{" "}
            {formatMoney(entry.allocated, entry.currency)}, but it holds{" "}
            {formatMoney(entry.balance, entry.currency)}. Move money in, or lower a goal.
          </span>
        </p>
      ))}
      {open.length === 0 ? (
        <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
          Nothing in progress. Completed and cancelled goals are below.
        </p>
      ) : (
        <ul aria-label="Savings goals in progress" className={gridClassName}>
          {open.map((goal) => (
            <GoalCard key={goal.id} goal={goal} {...handlers} />
          ))}
        </ul>
      )}
      {closed.length > 0 ? (
        <EndedSection summary={`${closed.length} completed or cancelled`}>
          <ul aria-label="Completed and cancelled goals" className={cn(gridClassName, "p-4")}>
            {closed.map((goal) => (
              <GoalCard key={goal.id} goal={goal} {...handlers} />
            ))}
          </ul>
        </EndedSection>
      ) : null}
      {dialogs}
    </div>
  );
}

/**
 * Accounts that hold several goals and count on more than they hold. Said once, above the goals,
 * rather than on every card that shares the account.
 */
function sharedOverAllocations(goals: SavingsGoal[]) {
  const byAccount = new Map<string, SavingsGoal[]>();
  for (const goal of goals) {
    if (!goal.account) continue;
    byAccount.set(goal.account.account_id, [
      ...(byAccount.get(goal.account.account_id) ?? []),
      goal,
    ]);
  }
  return [...byAccount.values()].flatMap((entries) => {
    const account = entries[0]?.account;
    if (!account || entries.length < 2 || account.allocated <= Math.max(account.balance, 0)) {
      return [];
    }
    return [
      {
        accountName: account.name,
        goals: entries.map((goal) => goal.name),
        allocated: account.allocated,
        balance: account.balance,
        currency: entries[0]?.currency ?? "INR",
      },
    ];
  });
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
    <StatGrid>
      {[...totals.entries()].flatMap(([currency, total]) => [
        <StatTile
          key={`${currency}-saved`}
          label={`Saved toward goals (${currency})`}
          icon={Target}
          accent="positive"
          value={formatMoney(total.saved, currency)}
        >
          of {formatMoney(total.target, currency)}
        </StatTile>,
        total.monthly > 0 ? (
          <StatTile
            key={`${currency}-monthly`}
            label="To put aside each month"
            value={formatMoney(total.monthly, currency)}
          >
            To reach every goal by its date
          </StatTile>
        ) : null,
      ])}
    </StatGrid>
  );
}

type GoalCardProps = {
  goal: SavingsGoal;
  /** Accounts whose over-allocation is already explained above the goals. */
  sharedWarnings: ReadonlySet<string>;
  workspaceId: string;
  onAnnounce: (message: string) => void;
  onEdit: (goal: SavingsGoal) => void;
  onMove: (goal: SavingsGoal, type: ContributionType) => void;
};

function GoalCard({
  goal,
  sharedWarnings,
  workspaceId,
  onAnnounce,
  onEdit,
  onMove,
}: GoalCardProps) {
  const { updateGoal, deleteGoal } = useBudgetMutations(workspaceId);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const historyId = `goal-history-${goal.id}`;
  const headingId = `goal-${goal.id}`;
  const currency = goal.currency;
  const account = goal.account;
  const overAllocated =
    account !== null &&
    account.allocated > Math.max(account.balance, 0) &&
    !sharedWarnings.has(account.name);

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
      className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-5 shadow-elevation-1"
    >
      <div className="flex items-start justify-between gap-3">
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
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {goal.reached && goal.state !== "completed" ? (
            <Chip tone="success">Target reached</Chip>
          ) : null}
          {goal.state !== "active" ? <Chip>{GOAL_STATE_LABELS[goal.state]}</Chip> : null}
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
        <div className="col-span-2 rounded-lg bg-muted/40 p-3">
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

      <div className="mt-auto flex items-center justify-between gap-2 border-t pt-3">
        <RowActions
          name={goal.name}
          className="w-full justify-between"
          primary={
            goal.state === "active" ? (
              <Button size="sm" variant="outline" onClick={() => onMove(goal, "contribution")}>
                <Plus aria-hidden="true" />
                Add money
              </Button>
            ) : (
              <span />
            )
          }
          actions={[
            {
              id: "withdraw",
              label: "Withdraw",
              description: "Take money out of the goal",
              icon: ArrowUpFromLine,
              hidden: !(goal.saved > 0 && goal.state !== "cancelled"),
              onSelect: () => onMove(goal, "withdrawal"),
            },
            {
              id: "history",
              label: showHistory ? "Hide history" : "History",
              description: "Money added and taken out",
              icon: History,
              onSelect: () => setShowHistory((value) => !value),
            },
            { id: "edit", label: "Edit", icon: Pencil, onSelect: () => onEdit(goal) },
            {
              id: "pause",
              label: "Pause",
              icon: Pause,
              hidden: goal.state !== "active",
              onSelect: () => void setState("paused", `Paused “${goal.name}”.`),
            },
            {
              id: "complete",
              label: "Mark complete",
              icon: CircleCheck,
              hidden: goal.state !== "active",
              onSelect: () => void setState("completed", `Completed “${goal.name}”. Well done.`),
            },
            {
              id: "resume",
              label: goal.state === "paused" ? "Resume" : "Reopen",
              icon: Play,
              hidden: goal.state === "active",
              onSelect: () =>
                void setState(
                  "active",
                  goal.state === "paused" ? `Resumed “${goal.name}”.` : `Reopened “${goal.name}”.`,
                ),
            },
            {
              id: "cancel",
              label: "Cancel goal…",
              icon: Ban,
              destructive: true,
              hidden: !(goal.state === "active" || goal.state === "paused"),
              confirm: {
                prompt: `Cancel “${goal.name}”?`,
                choices: [
                  {
                    label: "Cancel goal",
                    destructive: true,
                    onConfirm: () =>
                      setState("cancelled", `Cancelled “${goal.name}”. Its history is kept.`),
                  },
                ],
              },
            },
            {
              id: "delete",
              label: "Delete…",
              icon: Trash2,
              destructive: true,
              hidden: goal.saved !== 0,
              confirm: {
                prompt: `Delete “${goal.name}”?`,
                choices: [
                  {
                    label: "Delete goal",
                    destructive: true,
                    onConfirm: () =>
                      act(() => deleteGoal.mutateAsync(goal.id), `Deleted “${goal.name}”.`),
                  },
                ],
              },
            },
          ]}
        />
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

  if (state.status === "error") return <LoadError message={state.message} onRetry={reload} />;
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
