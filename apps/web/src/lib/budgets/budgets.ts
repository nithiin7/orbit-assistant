/**
 * Budgets and monthly plans: labels, threshold parsing, month helpers, and form schemas that
 * mirror the API's rules.
 *
 * Spending, utilization, statuses, and alerts are computed by the API from the ledger; the web app
 * only displays them. Percentages arrive as decimal text (`"87.50"`) and are turned into a bar
 * width for display only.
 */

import type {
  Budget,
  BudgetPeriodType,
  BudgetScope,
  CreateBudgetRequest,
  Currency,
  RolloverMode,
  UpdateBudgetRequest,
  UtilizationStatus,
} from "@orbit/contracts";
import { boolean, mixed, object, string } from "yup";

import { amountField, NAME } from "@/lib/commitments";
import { DEFAULT_CURRENCY, NOTES_MAX_LENGTH, parseAmount, toDecimalString } from "@/lib/finance";
import { labelOf, type Option } from "@/utils/common";
import { monthRange, shiftMonth } from "@/utils/dates";
import { multiLineText } from "@/utils/validation";

export const DEFAULT_THRESHOLDS: readonly number[] = [50, 75, 90, 100];
export const MAX_THRESHOLDS = 6;
export const MAX_THRESHOLD_PERCENT = 200;
/** A custom period can be at most this many days, like the API's limit. */
export const MAX_CUSTOM_DAYS = 366;

export const UTILIZATION_LABELS: Readonly<Record<UtilizationStatus, string>> = {
  on_track: "On track",
  approaching: "Approaching limit",
  near: "Near limit",
  exceeded: "Exceeded",
};

export const SCOPES: readonly Option<BudgetScope>[] = [
  { value: "overall", label: "All spending" },
  { value: "category", label: "One category" },
];

export const PERIOD_TYPES: readonly Option<BudgetPeriodType>[] = [
  { value: "monthly", label: "Monthly" },
  { value: "custom", label: "Custom dates" },
];

export const ROLLOVER_MODES: readonly Option<RolloverMode>[] = [
  { value: "none", label: "Start fresh each month" },
  { value: "surplus", label: "Carry unspent money forward" },
  { value: "full", label: "Carry unspent money and overspending" },
];

export const rolloverLabel = (mode: RolloverMode) => labelOf(ROLLOVER_MODES, mode);

/** Bar width for a utilization percentage (`"87.50"`), clamped to 0–100. Display only. */
export function barWidth(percent: string | null): number {
  if (percent === null) return 0;
  const value = Number.parseFloat(percent);
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 100) : 0;
}

/** A whole-number percentage for an accessible progress value. */
export function wholePercent(percent: string | null): number {
  return Math.floor(barWidth(percent));
}

/** "50, 75, 90, 100" as sorted, distinct whole percentages; `null` if any part is invalid. */
export function parseThresholds(text: string): number[] | null {
  const parts = text
    .split(/[,\s]+/)
    .map((part) => part.replace(/%$/, ""))
    .filter((part) => part !== "");
  if (parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const values = [...new Set(parts.map(Number))].sort((a, b) => a - b);
  if (values.some((value) => value < 1 || value > MAX_THRESHOLD_PERCENT)) return null;
  if (values.length > MAX_THRESHOLDS) return null;
  return values;
}

export function formatThresholds(values: readonly number[]): string {
  return values.join(", ");
}

/** Months to offer for a monthly budget's start or end: a year back to two years ahead. */
export function monthOptions(around: string, back = 12, ahead = 24): string[] {
  return Array.from({ length: back + ahead + 1 }, (_, index) => shiftMonth(around, index - back));
}

// Forms

type BudgetParent = {
  period?: BudgetPeriodType;
  scope?: BudgetScope;
  startMonth?: string;
  startDate?: string;
};

export const budgetSchema = object({
  name: NAME,
  scope: mixed<BudgetScope>()
    .oneOf(SCOPES.map((option) => option.value))
    .defined(),
  categoryId: string()
    .defined()
    .test("category", "Choose a category.", (value, context) => {
      const parent = context.parent as BudgetParent;
      return parent.scope !== "category" || value !== "";
    }),
  currency: mixed<Currency>().defined(),
  amount: amountField(true),
  period: mixed<BudgetPeriodType>()
    .oneOf(PERIOD_TYPES.map((option) => option.value))
    .defined(),
  // `YYYY-MM` for monthly budgets; blank `endMonth` repeats without end.
  startMonth: string().defined(),
  endMonth: string()
    .defined()
    .test("after-start", "The last month can’t be before the first.", (value, context) => {
      const parent = context.parent as BudgetParent;
      return parent.period !== "monthly" || value === "" || value >= (parent.startMonth ?? "");
    }),
  // `YYYY-MM-DD` for custom periods.
  startDate: string()
    .defined()
    .test("required", "Choose the first day.", (value, context) => {
      const parent = context.parent as BudgetParent;
      return parent.period !== "custom" || value !== "";
    }),
  endDate: string()
    .defined()
    .test("custom-end", "Choose a last day on or after the first.", (value, context) => {
      const parent = context.parent as BudgetParent;
      if (parent.period !== "custom") return true;
      return value !== "" && value >= (parent.startDate ?? "");
    }),
  rollover: mixed<RolloverMode>()
    .oneOf(ROLLOVER_MODES.map((option) => option.value))
    .defined(),
  alertsEnabled: boolean().defined(),
  thresholds: string()
    .trim()
    .defined()
    .test(
      "thresholds",
      `Enter up to ${MAX_THRESHOLDS} percentages from 1 to ${MAX_THRESHOLD_PERCENT}, such as 50, 75, 90, 100.`,
      (value) => parseThresholds(value) !== null,
    ),
  notes: multiLineText(NOTES_MAX_LENGTH),
});

export type BudgetValues = {
  name: string;
  scope: BudgetScope;
  categoryId: string;
  currency: Currency;
  amount: string;
  period: BudgetPeriodType;
  startMonth: string;
  endMonth: string;
  startDate: string;
  endDate: string;
  rollover: RolloverMode;
  alertsEnabled: boolean;
  thresholds: string;
  notes: string;
};

/** The form's values for a new budget, or for editing `budget`. */
export function budgetDefaults(month: string, budget?: Budget): BudgetValues {
  if (!budget) {
    return {
      name: "",
      scope: "category",
      categoryId: "",
      currency: DEFAULT_CURRENCY,
      amount: "",
      period: "monthly",
      startMonth: month,
      endMonth: "",
      startDate: monthRange(month).from,
      endDate: monthRange(month).to,
      rollover: "none",
      alertsEnabled: true,
      thresholds: formatThresholds(DEFAULT_THRESHOLDS),
      notes: "",
    };
  }
  return {
    name: budget.name,
    scope: budget.scope,
    categoryId: budget.category_id ?? "",
    currency: budget.currency,
    amount: toDecimalString(budget.amount, budget.currency),
    period: budget.period,
    startMonth: budget.start_date.slice(0, 7),
    endMonth: budget.period === "monthly" && budget.end_date ? budget.end_date.slice(0, 7) : "",
    startDate: budget.start_date,
    endDate: budget.end_date ?? "",
    rollover: budget.rollover,
    alertsEnabled: budget.alerts_enabled,
    thresholds: formatThresholds(budget.alert_thresholds),
    notes: budget.notes,
  };
}

function dates(values: BudgetValues): { start_date: string; end_date: string | null } {
  if (values.period === "custom") return { start_date: values.startDate, end_date: values.endDate };
  return {
    start_date: monthRange(values.startMonth).from,
    end_date: values.endMonth ? monthRange(values.endMonth).to : null,
  };
}

/** The create request for validated form values; `null` if the amount doesn't parse. */
export function toCreateBudget(values: BudgetValues): CreateBudgetRequest | null {
  const amount = parseAmount(values.amount, values.currency);
  const thresholds = parseThresholds(values.thresholds);
  if (amount === null || thresholds === null) return null;
  return {
    name: values.name,
    scope: values.scope,
    category_id: values.scope === "category" ? values.categoryId : null,
    currency: values.currency,
    amount,
    period: values.period,
    ...dates(values),
    rollover: values.period === "monthly" ? values.rollover : "none",
    alerts_enabled: values.alertsEnabled,
    alert_thresholds: thresholds,
    notes: values.notes,
  };
}

/** Only the fields that changed; `null` if the amount doesn't parse. */
export function toUpdateBudget(values: BudgetValues, budget: Budget): UpdateBudgetRequest | null {
  const amount = parseAmount(values.amount, budget.currency);
  const thresholds = parseThresholds(values.thresholds);
  if (amount === null || thresholds === null) return null;
  const changes: UpdateBudgetRequest = {};
  const { start_date, end_date } = dates({ ...values, period: budget.period });
  if (values.name !== budget.name) changes.name = values.name;
  if (amount !== budget.amount) changes.amount = amount;
  if (start_date !== budget.start_date) changes.start_date = start_date;
  if (end_date !== budget.end_date) changes.end_date = end_date;
  if (budget.period === "monthly" && values.rollover !== budget.rollover) {
    changes.rollover = values.rollover;
  }
  if (values.alertsEnabled !== budget.alerts_enabled) changes.alerts_enabled = values.alertsEnabled;
  if (thresholds.join() !== budget.alert_thresholds.join()) changes.alert_thresholds = thresholds;
  if (values.notes !== budget.notes) changes.notes = values.notes;
  return changes;
}

export const incomeSchema = object({
  currency: mixed<Currency>().defined(),
  amount: amountField(true),
  notes: multiLineText(NOTES_MAX_LENGTH),
});
