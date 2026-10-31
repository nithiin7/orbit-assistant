"use client";

import type { Budget, BudgetMonth, Currency, FinanceCategory } from "@orbit/contracts";
import {
  Archive,
  ArchiveRestore,
  Copy,
  History,
  Pencil,
  PiggyBank,
  Plus,
  Receipt,
  Target,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useMemo, useState } from "react";

import { describeApiError } from "@/api/client";
import { EmptyState } from "@/components/empty-state";
import { FormAlert } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useBudgetDetail,
  useBudgetHistory,
  useBudgetMonth,
  useBudgetMutations,
  useBudgets,
} from "@/hooks/use-budgets";
import { rolloverLabel, UTILIZATION_LABELS } from "@/lib/budgets";
import { formatMoney } from "@/lib/finance";
import { byId, cn } from "@/utils/common";
import { formatCalendarDate, localDateString, monthLabel, shiftMonth } from "@/utils/dates";

import { BudgetDialog } from "./budget-dialog";
import { PeriodFigures, UtilizationBadge, UtilizationBar } from "./budget-parts";
import { rowListClassName } from "./finance-meta";
import type { FinanceData } from "./finance-view";
import { EndedSection, LoadError, Panel } from "./panel";
import { type RowAction, RowActions } from "./row-actions";
import { StatGrid, StatTile } from "./stat-tile";
import { CurrencySwitcher, MonthSwitcher, ViewHeader } from "./view-header";

type Dialog = { budget?: Budget } | null;

/** One month's budgets: totals, each budget's progress, spending by category, and history. */
export function BudgetsView({
  workspaceId,
  categories,
  onAnnounce,
  month,
  thisMonth,
  onMonthChange,
  currency,
  currencies,
  onCurrencyChange,
}: FinanceData) {
  const today = localDateString();
  const [dialog, setDialog] = useState<Dialog>(null);
  const { state, refreshing, reload } = useBudgetMonth(workspaceId, month, currency, today);
  const categoriesById = useMemo(() => byId(categories), [categories]);
  const addButton = (
    <Button onClick={() => setDialog({})}>
      <Plus aria-hidden="true" />
      Add budget
    </Button>
  );

  return (
    <div className="space-y-6">
      <ViewHeader
        title="Budgets"
        description="Limits for all spending or a category, tracked against what you record."
        controls={
          <>
            <MonthSwitcher
              month={month}
              thisMonth={thisMonth}
              onChange={onMonthChange}
              allowFuture
            />
            <CurrencySwitcher
              currencies={currencies}
              currency={currency}
              onChange={onCurrencyChange}
            />
            <CopyMonth workspaceId={workspaceId} month={month} onAnnounce={onAnnounce} />
          </>
        }
        action={addButton}
      />

      {state.status === "error" ? (
        <LoadError message={state.message} onRetry={reload} />
      ) : state.status === "loading" ? (
        <BudgetsSkeleton />
      ) : state.data.budgets.length === 0 ? (
        <EmptyState
          icon={PiggyBank}
          title={`No budgets for ${monthLabel(month)}`}
          description="Set a limit for all spending or for categories such as groceries and dining. Orbit tracks it against what you record and alerts you as you approach it."
        >
          {addButton}
        </EmptyState>
      ) : (
        <div
          aria-busy={refreshing}
          className={cn("space-y-6 transition-opacity duration-150", refreshing && "opacity-70")}
        >
          <MonthTiles month={state.data} currency={currency} />
          {/* The budgets lead; category spending and the months before sit beside them when
              there's room, below them when there isn't. */}
          <div className="grid items-start gap-6 @6xl/list:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <BudgetList
              month={state.data}
              categories={categoriesById}
              workspaceId={workspaceId}
              today={today}
              onEdit={(budget) => setDialog({ budget })}
              onAnnounce={onAnnounce}
            />
            <div className="grid gap-6 @3xl/list:grid-cols-2 @6xl/list:grid-cols-1">
              <CategorySpending month={state.data} categories={categoriesById} />
              <MonthHistory
                workspaceId={workspaceId}
                month={month}
                currency={currency}
                today={today}
                onSelect={onMonthChange}
              />
            </div>
          </div>
        </div>
      )}

      <EndedBudgets
        workspaceId={workspaceId}
        today={today}
        categories={categoriesById}
        onAnnounce={onAnnounce}
      />

      {dialog ? (
        <BudgetDialog
          workspaceId={workspaceId}
          budget={dialog.budget}
          month={month}
          categories={categories}
          onSaved={onAnnounce}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

function CopyMonth({
  workspaceId,
  month,
  onAnnounce,
}: {
  workspaceId: string;
  month: string;
  onAnnounce: (message: string) => void;
}) {
  const { copyBudgets } = useBudgetMutations(workspaceId);
  const [error, setError] = useState<string | null>(null);
  const previous = shiftMonth(month, -1);
  const copy = async () => {
    setError(null);
    try {
      const result = await copyBudgets.mutateAsync({ from_month: previous, to_month: month });
      const copied = result.created.length;
      onAnnounce(
        copied > 0
          ? `Copied ${copied} ${copied === 1 ? "budget" : "budgets"} from ${monthLabel(previous)}.`
          : `Nothing to copy: ${monthLabel(month)} already has ${monthLabel(previous)}’s budgets.`,
      );
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t copy the budgets. Try again."));
    }
  };
  return (
    <>
      <Button variant="ghost" disabled={copyBudgets.isPending} onClick={() => void copy()}>
        <Copy aria-hidden="true" />
        Copy {monthLabel(previous, { short: true })}
      </Button>
      {error ? (
        <p role="alert" className="w-full text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
}

function MonthTiles({ month, currency }: { month: BudgetMonth; currency: Currency }) {
  const over = month.remaining !== null && month.remaining < 0;
  return (
    <div className="space-y-4">
      <StatGrid>
        <StatTile
          label="Budget"
          icon={Target}
          accent="brand"
          value={month.total === null ? "—" : formatMoney(month.total, currency)}
        >
          {month.basis === "overall"
            ? "Your overall monthly budget"
            : month.basis === "categories"
              ? `${month.budgets_counted} category ${month.budgets_counted === 1 ? "budget" : "budgets"}`
              : "Only custom periods this month"}
        </StatTile>
        <StatTile
          label="Spent"
          icon={Receipt}
          accent="spending"
          value={formatMoney(month.spent, currency)}
        >
          {month.unbudgeted !== null && month.unbudgeted > 0
            ? `${formatMoney(month.unbudgeted, currency)} outside your category budgets`
            : "Expenses minus refunds"}
        </StatTile>
        <StatTile
          label={over ? "Over budget" : "Remaining"}
          icon={over ? TriangleAlert : PiggyBank}
          value={month.remaining === null ? "—" : formatMoney(Math.abs(month.remaining), currency)}
          tone={over ? "negative" : "default"}
          accent={over ? "negative" : "positive"}
          emphasis={!over}
        >
          {month.budgets_counted > 0
            ? `${month.budgets_within} of ${month.budgets_counted} within budget`
            : "No monthly budgets"}
        </StatTile>
      </StatGrid>
      {month.total !== null && month.status ? (
        <div className="space-y-1.5">
          <p className="flex justify-between gap-3 text-xs text-muted-foreground">
            <span>Overall budget used</span>
            {month.utilization_percent !== null ? (
              <span className="tabular-nums">{month.utilization_percent}%</span>
            ) : null}
          </p>
          <UtilizationBar
            label="Overall budget used"
            percent={month.utilization_percent}
            status={month.status}
          />
        </div>
      ) : null}
    </div>
  );
}

function periodLabel(budget: Budget): string {
  if (budget.period === "custom") {
    return `${formatCalendarDate(budget.start_date)} – ${formatCalendarDate(budget.end_date ?? budget.start_date)}`;
  }
  if (!budget.recurring) return "This month only";
  return budget.end_date ? `Monthly until ${monthLabel(budget.end_date.slice(0, 7))}` : "Monthly";
}

function scopeLabel(budget: Budget, categories: ReadonlyMap<string, FinanceCategory>): string {
  if (budget.scope === "overall") return "All spending";
  return categories.get(budget.category_id ?? "")?.name ?? "A category";
}

function BudgetList({
  month,
  categories,
  workspaceId,
  today,
  onEdit,
  onAnnounce,
}: {
  month: BudgetMonth;
  categories: ReadonlyMap<string, FinanceCategory>;
  workspaceId: string;
  today: string;
  onEdit: (budget: Budget) => void;
  onAnnounce: (message: string) => void;
}) {
  // Those needing attention first, then by name.
  const order = { exceeded: 0, near: 1, approaching: 2, on_track: 3 };
  const budgets = [...month.budgets].sort(
    (a, b) =>
      order[a.current_period?.status ?? "on_track"] -
        order[b.current_period?.status ?? "on_track"] || a.name.localeCompare(b.name),
  );
  return (
    <section aria-label="This month’s budgets" className="min-w-0">
      <ul aria-label={`Budgets for ${monthLabel(month.month)}`} className={rowListClassName}>
        {budgets.map((budget) => (
          <BudgetRow
            key={budget.id}
            budget={budget}
            categories={categories}
            workspaceId={workspaceId}
            today={today}
            onEdit={onEdit}
            onAnnounce={onAnnounce}
          />
        ))}
      </ul>
    </section>
  );
}

function BudgetRow({
  budget,
  categories,
  workspaceId,
  today,
  onEdit,
  onAnnounce,
}: {
  budget: Budget;
  categories: ReadonlyMap<string, FinanceCategory>;
  workspaceId: string;
  today: string;
  onEdit: (budget: Budget) => void;
  onAnnounce: (message: string) => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const lifecycle = useBudgetLifecycle(budget, workspaceId, onAnnounce);
  const period = budget.current_period;
  const historyId = `budget-history-${budget.id}`;
  return (
    <li className="space-y-2.5 px-3 py-3 @md/rows:px-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <button
            type="button"
            onClick={() => onEdit(budget)}
            aria-label={`Edit “${budget.name}”`}
            className="block max-w-full truncate rounded-sm text-left text-sm font-medium outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-ring"
          >
            {budget.name}
          </button>
          <p className="flex flex-wrap gap-x-1.5 text-xs text-muted-foreground">
            <span>{scopeLabel(budget, categories)}</span>
            <span aria-hidden="true">·</span>
            <span>{periodLabel(budget)}</span>
            {budget.rollover !== "none" ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{rolloverLabel(budget.rollover)}</span>
              </>
            ) : null}
            {!budget.alerts_enabled ? (
              <>
                <span aria-hidden="true">·</span>
                <span>Alerts off</span>
              </>
            ) : null}
          </p>
        </div>
        {period ? <UtilizationBadge status={period.status} /> : null}
        <RowActions
          name={budget.name}
          actions={[
            {
              id: "history",
              label: showHistory ? "Hide history" : "History",
              description: "Each period so far",
              icon: History,
              onSelect: () => setShowHistory((value) => !value),
            },
            { id: "edit", label: "Edit", icon: Pencil, onSelect: () => onEdit(budget) },
            ...lifecycle.actions,
          ]}
        />
      </div>

      {period ? (
        <div className="space-y-1.5">
          <UtilizationBar
            label={`${budget.name} budget used`}
            percent={period.utilization_percent}
            status={period.status}
          />
          <PeriodFigures period={period} currency={budget.currency} />
          <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            {period.rollover_amount !== 0 ? (
              <span>
                {formatMoney(period.base_amount, budget.currency)} budget{" "}
                {period.rollover_amount > 0 ? "+" : "−"}{" "}
                {formatMoney(Math.abs(period.rollover_amount), budget.currency)}{" "}
                {period.rollover_amount > 0 ? "carried in" : "overspending carried in"}
              </span>
            ) : null}
            {period.projected !== null && !period.closed && period.end >= today ? (
              <span className={cn(period.projected > period.available && "text-warning")}>
                On pace for {formatMoney(period.projected, budget.currency)}
              </span>
            ) : null}
          </p>
        </div>
      ) : null}

      {lifecycle.error ? <FormAlert message={lifecycle.error} /> : null}

      {showHistory ? (
        <div id={historyId} className="animate-page-in">
          <PeriodHistory budget={budget} workspaceId={workspaceId} today={today} />
        </div>
      ) : null}
    </li>
  );
}

/** Archive, restore, and delete as row actions, each confirmed, with any failure to show. */
function useBudgetLifecycle(
  budget: Budget,
  workspaceId: string,
  onAnnounce: (message: string) => void,
): { actions: RowAction[]; error: string | null } {
  const { archiveBudget, restoreBudget, deleteBudget } = useBudgetMutations(workspaceId);
  const [error, setError] = useState<string | null>(null);
  const act = async (work: () => Promise<unknown>, message: string) => {
    setError(null);
    try {
      await work();
      onAnnounce(message);
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t make that change. Try again."));
    }
  };
  const archivedNow = budget.state === "archived";
  return {
    error,
    actions: [
      archivedNow
        ? {
            id: "restore",
            label: "Restore",
            icon: ArchiveRestore,
            onSelect: () =>
              void act(() => restoreBudget.mutateAsync(budget.id), `Restored “${budget.name}”.`),
          }
        : {
            id: "archive",
            label: "Archive",
            description: "Stop tracking; its history is kept",
            icon: Archive,
            confirm: {
              prompt: `Archive “${budget.name}”?`,
              choices: [
                {
                  label: "Archive budget",
                  onConfirm: () =>
                    act(
                      () => archiveBudget.mutateAsync(budget.id),
                      `Archived “${budget.name}”. Its history is kept.`,
                    ),
                },
              ],
            },
          },
      {
        id: "delete",
        label: "Delete…",
        icon: Trash2,
        destructive: true,
        confirm: {
          prompt: `Delete “${budget.name}” and its history?`,
          choices: [
            {
              label: "Delete budget",
              destructive: true,
              onConfirm: () =>
                act(
                  () => deleteBudget.mutateAsync(budget.id),
                  `Deleted “${budget.name}”. Your transactions are untouched.`,
                ),
            },
          ],
        },
      },
    ],
  };
}

function PeriodHistory({
  budget,
  workspaceId,
  today,
}: {
  budget: Budget;
  workspaceId: string;
  today: string;
}) {
  const { state, reload } = useBudgetDetail(workspaceId, budget.id, today, true);
  if (state.status === "error") return <LoadError message={state.message} onRetry={reload} />;
  if (state.status === "loading") return <Skeleton className="h-16" />;
  const { periods, periods_closed, periods_within } = state.data;
  return (
    <div className="space-y-2">
      {periods_closed > 0 ? (
        <p className="text-xs text-muted-foreground">
          Within budget in {periods_within} of {periods_closed} finished{" "}
          {periods_closed === 1 ? "period" : "periods"}.
        </p>
      ) : null}
      <ol aria-label={`${budget.name} periods`} className="divide-y rounded-lg border">
        {periods.map((period) => (
          <li key={period.start} className="space-y-1.5 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">
                {budget.period === "monthly"
                  ? monthLabel(period.start.slice(0, 7))
                  : `${formatCalendarDate(period.start)} – ${formatCalendarDate(period.end)}`}
              </span>
              <span className="flex items-center gap-2">
                {period.closed ? null : (
                  <Badge variant="outline" className="text-muted-foreground">
                    In progress
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  {UTILIZATION_LABELS[period.status]}
                </span>
              </span>
            </div>
            <UtilizationBar
              label={`${budget.name}, ${period.start}`}
              percent={period.utilization_percent}
              status={period.status}
            />
            <PeriodFigures period={period} currency={budget.currency} />
            {period.closed &&
            period.spent_at_close !== null &&
            period.spent_at_close !== period.spent ? (
              <p className="text-xs text-muted-foreground">
                {formatMoney(period.spent_at_close, budget.currency)} when it closed; later
                corrections don’t change the rollover it passed on.
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

function CategorySpending({
  month,
  categories,
}: {
  month: BudgetMonth;
  categories: ReadonlyMap<string, FinanceCategory>;
}) {
  const rows = month.categories.filter((entry) => entry.spent > 0 || entry.budget !== null);
  // Each category budget's own period, as the API computed it.
  const periods = new Map(
    month.budgets
      .filter((budget) => budget.scope === "category" && budget.period === "monthly")
      .map((budget) => [budget.category_id, budget.current_period]),
  );
  return (
    <Panel
      title="Spending by category"
      description="Against category budgets, where you have them. Transfers aren’t spending."
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No spending this month.</p>
      ) : (
        <ul className="space-y-3" aria-label="Category spending">
          {rows.slice(0, 8).map((entry) => {
            const name =
              entry.category_id === null
                ? "Uncategorized"
                : (categories.get(entry.category_id)?.name ?? "A category");
            const spent = Math.max(entry.spent, 0);
            const period = periods.get(entry.category_id);
            return (
              <li key={entry.category_id ?? "none"} className="space-y-1">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate">{name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    <span className="font-medium text-foreground">
                      {formatMoney(spent, month.currency)}
                    </span>
                    {entry.budget !== null
                      ? ` of ${formatMoney(entry.budget, month.currency)}`
                      : " · no budget"}
                  </span>
                </div>
                {period ? (
                  <UtilizationBar
                    label={`${name} budget used`}
                    percent={period.utilization_percent}
                    status={period.status}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function MonthHistory({
  workspaceId,
  month,
  currency,
  today,
  onSelect,
}: {
  workspaceId: string;
  month: string;
  currency: Currency;
  today: string;
  onSelect: (month: string) => void;
}) {
  const { state, reload } = useBudgetHistory(workspaceId, month, currency, today);
  return (
    <Panel
      title="Budget against spending"
      description="The six months to this one, with the budgets each month had. Choose a month to inspect it."
    >
      {state.status === "error" ? (
        <LoadError message={state.message} onRetry={reload} />
      ) : state.status === "loading" ? (
        <Skeleton className="h-40" />
      ) : (
        <ol className="space-y-2" aria-label="Monthly budget history">
          {state.data.months.map((entry) => {
            const label = monthLabel(entry.month);
            const summary =
              entry.total === null
                ? `${label}: ${formatMoney(entry.spent, currency)} spent, no budget`
                : `${label}: ${formatMoney(entry.spent, currency)} spent of ${formatMoney(entry.total, currency)}`;
            return (
              <li key={entry.month}>
                <button
                  type="button"
                  aria-label={summary}
                  aria-current={entry.month === month ? "true" : undefined}
                  onClick={() => onSelect(entry.month)}
                  className={cn(
                    "w-full space-y-1 rounded-md px-2 py-1.5 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring",
                    entry.month === month && "bg-muted/60",
                  )}
                >
                  <span className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="font-medium">{monthLabel(entry.month, { short: true })}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {formatMoney(entry.spent, currency)}
                      {entry.total !== null ? ` / ${formatMoney(entry.total, currency)}` : ""}
                    </span>
                  </span>
                  <UtilizationBar
                    label={`${label} budget used`}
                    percent={entry.utilization_percent}
                    status={entry.status ?? "on_track"}
                    className={entry.total === null ? "opacity-40" : undefined}
                  />
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

/** Completed and archived budgets, out of the month's way but still restorable. */
function EndedBudgets({
  workspaceId,
  today,
  categories,
  onAnnounce,
}: {
  workspaceId: string;
  today: string;
  categories: ReadonlyMap<string, FinanceCategory>;
  onAnnounce: (message: string) => void;
}) {
  const { state } = useBudgets(workspaceId, today);
  if (state.status !== "success") return null;
  const ended = state.data.budgets.filter(
    (budget) => budget.status === "archived" || budget.status === "completed",
  );
  if (ended.length === 0) return null;
  return (
    <EndedSection summary={`${ended.length} archived or finished`}>
      <ul className="@container/rows divide-y" aria-label="Archived and finished budgets">
        {ended.map((budget) => (
          <EndedBudgetRow
            key={budget.id}
            budget={budget}
            categories={categories}
            workspaceId={workspaceId}
            onAnnounce={onAnnounce}
          />
        ))}
      </ul>
    </EndedSection>
  );
}

function EndedBudgetRow({
  budget,
  categories,
  workspaceId,
  onAnnounce,
}: {
  budget: Budget;
  categories: ReadonlyMap<string, FinanceCategory>;
  workspaceId: string;
  onAnnounce: (message: string) => void;
}) {
  const lifecycle = useBudgetLifecycle(budget, workspaceId, onAnnounce);
  return (
    <li className="space-y-2 px-3 py-3 @md/rows:px-4">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{budget.name}</p>
          <p className="text-xs text-muted-foreground">
            {scopeLabel(budget, categories)} · {periodLabel(budget)} ·{" "}
            {budget.status === "archived" ? "Archived" : "Finished"}
          </p>
        </div>
        <RowActions name={budget.name} actions={lifecycle.actions} />
      </div>
      {lifecycle.error ? <FormAlert message={lifecycle.error} /> : null}
    </li>
  );
}

function BudgetsSkeleton() {
  return (
    <div className="space-y-4">
      <span className="sr-only">Loading budgets…</span>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-4">
        {[0, 1, 2].map((tile) => (
          <Skeleton key={tile} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-48 rounded-xl" />
    </div>
  );
}
