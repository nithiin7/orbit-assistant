"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { Currency, MonthPlan, PlanLine } from "@orbit/contracts";
import { Wallet } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { InferType } from "yup";

import { describeApiError } from "@/api/client";
import { AmountField, FormAlert } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useBudgetMutations, usePlan } from "@/hooks/use-budgets";
import { incomeSchema } from "@/lib/budgets";
import { formatMoney, parseAmount, toDecimalString } from "@/lib/finance";
import { cn } from "@/utils/common";
import { localDateString, monthLabel } from "@/utils/dates";

import type { FinanceData } from "./finance-view";
import { LoadError, Panel } from "./panel";
import { StatGrid, StatTile } from "./stat-tile";
import { CurrencySwitcher, MonthSwitcher, ViewHeader } from "./view-header";

/**
 * A month's plan: expected income, fixed commitments, variable spending, savings, and
 * investments, planned against what the ledger recorded, and what remains to spend.
 */
export function PlanView({
  workspaceId,
  onAnnounce,
  onShowTab,
  month,
  thisMonth,
  onMonthChange,
  currency,
  currencies,
  onCurrencyChange,
}: FinanceData) {
  const today = localDateString();
  const { state, refreshing, reload } = usePlan(workspaceId, month, currency, today);

  return (
    <div className="space-y-6">
      <ViewHeader
        title="Plan"
        description="Expected income against commitments, budgets, savings, and investments, and what’s left to spend."
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
          </>
        }
      />

      {state.status === "error" ? (
        <LoadError message={state.message} onRetry={reload} />
      ) : state.status === "loading" ? (
        <div className="space-y-4">
          <span className="sr-only">Loading the plan…</span>
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      ) : (
        <div
          aria-busy={refreshing}
          className={cn("space-y-6 transition-opacity duration-150", refreshing && "opacity-70")}
        >
          <IncomeForm
            key={`${month}-${currency}-${state.data.expected_income ?? ""}-${state.data.income_source ?? ""}`}
            workspaceId={workspaceId}
            plan={state.data}
            onAnnounce={onAnnounce}
          />
          <RemainingTiles plan={state.data} />
          <div className="grid items-start gap-6 @5xl/list:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Breakdown plan={state.data} />
            <CashFlowNote plan={state.data} onShowBudgets={() => onShowTab("budgets")} />
          </div>
        </div>
      )}
    </div>
  );
}

function RemainingTiles({ plan }: { plan: MonthPlan }) {
  const { remaining, currency } = plan;
  const planned = remaining.planned;
  return (
    <StatGrid>
      <StatTile
        label="Available to spend (planned)"
        icon={Wallet}
        accent={planned !== null && planned < 0 ? "negative" : "brand"}
        value={planned === null ? "—" : formatMoney(planned, currency)}
        tone={planned !== null && planned < 0 ? "negative" : "default"}
        emphasis={planned !== null && planned >= 0}
      >
        {planned === null
          ? "Enter your expected income to plan the month."
          : "Expected income after commitments, budgets, savings, and investments."}
      </StatTile>
      <StatTile
        label="Left over so far (actual)"
        value={formatMoney(remaining.actual, currency, {
          signDisplay: remaining.actual < 0 ? "always" : "auto",
        })}
        tone={remaining.actual < 0 ? "negative" : "default"}
      >
        {remaining.actual < 0 && plan.allocations > 0
          ? `Income recorded, less everything paid and spent, and ${formatMoney(plan.allocations, currency)} moved to savings and investments.`
          : "Income recorded this month, less everything paid, spent, saved, and invested."}
      </StatTile>
    </StatGrid>
  );
}

function amount(value: number | null, currency: Currency): string {
  return value === null ? "—" : formatMoney(value, currency);
}

function Breakdown({ plan }: { plan: MonthPlan }) {
  const { currency, fixed } = plan;
  const rows: { label: string; line: PlanLine; sign: "+" | "−"; sub?: boolean; hint?: string }[] = [
    { label: "Income", line: plan.income, sign: "+" },
    { label: "Fixed commitments", line: fixed.total, sign: "−" },
    { label: "EMIs", line: fixed.emi, sign: "−", sub: true, hint: "Principal and interest" },
    { label: "Rent", line: fixed.rent, sign: "−", sub: true },
    { label: "Subscriptions", line: fixed.subscriptions, sign: "−", sub: true },
    { label: "Bills", line: fixed.bills, sign: "−", sub: true },
    {
      label: "Variable spending",
      line: plan.variable,
      sign: "−",
      hint:
        plan.variable_basis === "overall_budget"
          ? "Your overall budget, less the month’s commitment spending"
          : plan.variable_basis === "category_budgets"
            ? "Your category budgets"
            : "Add a budget to plan it",
    },
    {
      label: "Savings goals",
      line: plan.savings,
      sign: "−",
      hint: "Planned: each goal’s suggested monthly amount",
    },
    { label: "Investments", line: plan.investments, sign: "−", hint: "Planned: SIPs due" },
  ];
  return (
    <Panel
      title={`${monthLabel(plan.month)} plan`}
      description="Planned figures come from your expected income, commitment schedules, budgets, goals, and SIPs; actual ones from what you recorded."
      flush
    >
      <table className="w-full text-sm">
        <caption className="sr-only">
          Planned and actual cash flow for {monthLabel(plan.month)}
        </caption>
        <thead>
          <tr className="border-y text-xs text-muted-foreground">
            <th scope="col" className="py-2 pr-2 pl-4 text-left font-medium @lg/list:pl-5">
              Line
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium @lg/list:px-3">
              Planned
            </th>
            <th scope="col" className="py-2 pr-4 pl-2 text-right font-medium @lg/list:pr-5">
              Actual
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row.label} className={cn(row.sub && "text-muted-foreground")}>
              <th
                scope="row"
                className={cn(
                  "py-2 pr-2 pl-4 text-left font-normal @lg/list:pl-5",
                  row.sub ? "pl-8 text-xs @lg/list:pl-9" : "font-medium",
                )}
              >
                <span aria-hidden="true" className="mr-1.5 inline-block w-2 text-muted-foreground">
                  {row.sub ? "" : row.sign}
                </span>
                {row.label}
                {row.hint ? (
                  // Hints need room; on narrow columns the panel's description covers them.
                  <span className="hidden pl-3.5 text-xs font-normal text-muted-foreground @lg/list:block">
                    {row.hint}
                  </span>
                ) : null}
              </th>
              <td className="px-2 py-2 text-right whitespace-nowrap tabular-nums @lg/list:px-3">
                {amount(row.line.planned, currency)}
              </td>
              <td className="py-2 pr-4 pl-2 text-right whitespace-nowrap tabular-nums @lg/list:pr-5">
                {formatMoney(row.line.actual, currency)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 font-semibold">
            <th scope="row" className="py-3 pr-2 pl-4 text-left @lg/list:pl-5">
              <span aria-hidden="true" className="mr-1.5 inline-block w-2">
                =
              </span>
              Remaining
            </th>
            <td
              className={cn(
                "px-2 py-3 text-right whitespace-nowrap tabular-nums @lg/list:px-3",
                plan.remaining.planned !== null && plan.remaining.planned < 0 && "text-destructive",
              )}
            >
              {amount(plan.remaining.planned, currency)}
            </td>
            <td
              className={cn(
                "py-3 pr-4 pl-2 text-right whitespace-nowrap tabular-nums @lg/list:pr-5",
                plan.remaining.actual < 0 && "text-destructive",
              )}
            >
              {formatMoney(plan.remaining.actual, currency)}
            </td>
          </tr>
        </tfoot>
      </table>
    </Panel>
  );
}

type IncomeValues = InferType<typeof incomeSchema>;

function IncomeForm({
  workspaceId,
  plan,
  onAnnounce,
}: {
  workspaceId: string;
  plan: MonthPlan;
  onAnnounce: (message: string) => void;
}) {
  const { setIncome, clearIncome } = useBudgetMutations(workspaceId);
  const { currency } = plan;
  const ownIncome = plan.income_source === "this_month";
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: saving },
  } = useForm<IncomeValues>({
    resolver: yupResolver(incomeSchema),
    defaultValues: {
      currency,
      amount: plan.expected_income !== null ? toDecimalString(plan.expected_income, currency) : "",
      notes: ownIncome ? plan.notes : "",
    },
  });
  const [clearError, setClearError] = useState<string | null>(null);

  async function save(values: IncomeValues) {
    const expected = parseAmount(values.amount, currency);
    if (expected === null) return;
    try {
      await setIncome.mutateAsync({
        month: plan.month,
        body: { currency, expected_income: expected, notes: values.notes },
      });
      onAnnounce(
        `Expected income for ${monthLabel(plan.month)} is ${formatMoney(expected, currency)}.`,
      );
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t save your expected income. Try again."),
      });
    }
  }

  const clear = async () => {
    setClearError(null);
    try {
      await clearIncome.mutateAsync({ month: plan.month, currency });
      onAnnounce(`Cleared ${monthLabel(plan.month)}’s expected income.`);
    } catch (reason) {
      setClearError(describeApiError(reason, "Couldn’t clear it. Try again."));
    }
  };

  return (
    <Card className="p-4 shadow-elevation-1 @3xl/list:p-5">
      <form
        noValidate
        className="flex flex-col gap-3 @3xl/list:flex-row @3xl/list:items-end"
        onSubmit={(event) => void handleSubmit(save)(event)}
      >
        <div className="min-w-0 space-y-1 @3xl/list:flex-1">
          <h3 className="text-sm font-semibold">Expected income</h3>
          <p className="text-xs text-muted-foreground">
            {plan.income_source === "earlier" && plan.income_month
              ? `Carried from ${monthLabel(plan.income_month)}. Save to set ${monthLabel(plan.month)}’s own.`
              : "What you expect to earn this month. Later months use it until you change it."}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-full @md/list:w-56">
            <AmountField
              control={control}
              name="amount"
              currency={currency}
              label={`Expected in ${monthLabel(plan.month)} (${currency})`}
            />
          </div>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save income"}
          </Button>
          {ownIncome ? (
            <Button
              type="button"
              variant="ghost"
              disabled={clearIncome.isPending}
              onClick={() => void clear()}
            >
              Clear
            </Button>
          ) : null}
        </div>
      </form>
      <FormAlert message={errors.root?.server?.message ?? clearError} />
    </Card>
  );
}

/** Cash flow isn't spending: principal, savings, and investments are money kept. */
function CashFlowNote({ plan, onShowBudgets }: { plan: MonthPlan; onShowBudgets: () => void }) {
  const { currency } = plan;
  return (
    <Card className="space-y-3 p-5 shadow-elevation-1">
      <h3 className="text-sm font-semibold">Spending and allocations</h3>
      <dl className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <dt className="text-muted-foreground">Spending</dt>
          <dd className="text-base font-semibold tabular-nums">
            {formatMoney(plan.spending, currency)}
          </dd>
          <dd className="text-muted-foreground">Expenses, interest, and paid bills</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Allocations</dt>
          <dd className="text-base font-semibold tabular-nums">
            {formatMoney(plan.allocations, currency)}
          </dd>
          <dd className="text-muted-foreground">Money moved to your own accounts</dd>
        </div>
      </dl>
      <ul className="space-y-1 text-xs text-muted-foreground">
        <li>Loan principal repaid: {formatMoney(plan.flows.loan_principal, currency)}</li>
        <li>
          Moved into investments: {formatMoney(plan.flows.invested, currency)}
          {plan.flows.divested > 0
            ? ` (${formatMoney(plan.flows.divested, currency)} taken out)`
            : ""}
        </li>
        <li>Put toward savings goals: {formatMoney(plan.savings.actual, currency)}</li>
      </ul>
      {plan.variable_basis === null ? (
        <Button size="sm" variant="outline" onClick={onShowBudgets}>
          Plan variable spending with a budget
        </Button>
      ) : null}
    </Card>
  );
}
