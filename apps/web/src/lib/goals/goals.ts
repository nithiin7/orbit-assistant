/**
 * Savings goals: labels, which accounts can hold savings, and form schemas that mirror the API.
 *
 * A goal earmarks money and is never spending. Progress, the suggested monthly contribution, and
 * what can be withdrawn are computed by the API; the web app only displays them.
 */

import type {
  ContributionMode,
  ContributionType,
  Currency,
  FinanceAccount,
  FinanceAccountType,
  GoalCategory,
  GoalPriority,
  GoalState,
} from "@orbit/contracts";
import { mixed, object, string } from "yup";

import { amountField, NAME } from "@/lib/commitments";
import { NOTES_MAX_LENGTH } from "@/lib/finance";
import { labelOf, type Option } from "@/utils/common";
import { multiLineText } from "@/utils/validation";

export const DESCRIPTION_MAX_LENGTH = 500;

export const GOAL_CATEGORIES: readonly Option<GoalCategory>[] = [
  { value: "emergency_fund", label: "Emergency fund" },
  { value: "vehicle", label: "Vehicle" },
  { value: "travel", label: "Travel" },
  { value: "home", label: "Home" },
  { value: "electronics", label: "Electronics" },
  { value: "education", label: "Education" },
  { value: "wedding", label: "Wedding" },
  { value: "other", label: "Other" },
];

export const GOAL_PRIORITIES: readonly Option<GoalPriority>[] = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

export const GOAL_STATE_LABELS: Readonly<Record<GoalState, string>> = {
  active: "Active",
  paused: "Paused",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const goalCategoryLabel = (category: GoalCategory) => labelOf(GOAL_CATEGORIES, category);
export const goalPriorityLabel = (priority: GoalPriority) => labelOf(GOAL_PRIORITIES, priority);

/**
 * Accounts that can hold a goal's savings, like the API's rule: investments are tracked
 * separately, and cards and loans owe money.
 */
const SAVINGS_TYPES: ReadonlySet<FinanceAccountType> = new Set([
  "bank",
  "savings",
  "cash",
  "wallet",
  "other",
]);

export function savingsAccounts(
  accounts: readonly FinanceAccount[],
  currency: Currency,
): FinanceAccount[] {
  return accounts.filter(
    (account) =>
      !account.archived && account.currency === currency && SAVINGS_TYPES.has(account.type),
  );
}

export const CONTRIBUTION_MODES: readonly Option<ContributionMode>[] = [
  { value: "allocate", label: "Set aside money I already have" },
  { value: "transfer", label: "Move money between accounts" },
  { value: "link", label: "Link a transfer I recorded" },
];

// Forms

export const goalSchema = object({
  name: NAME,
  description: multiLineText(DESCRIPTION_MAX_LENGTH),
  category: mixed<GoalCategory>()
    .oneOf(GOAL_CATEGORIES.map((option) => option.value))
    .defined(),
  priority: mixed<GoalPriority>()
    .oneOf(GOAL_PRIORITIES.map((option) => option.value))
    .defined(),
  currency: mixed<Currency>().defined(),
  targetAmount: amountField(true),
  startDate: string().required("Choose a start date."),
  targetDate: string()
    .defined()
    .test("after-start", "The target date can’t be before the start.", (value, context) => {
      const parent = context.parent as { startDate?: string };
      return value === "" || !parent.startDate || value >= parent.startDate;
    }),
  accountId: string().defined(),
  notes: multiLineText(NOTES_MAX_LENGTH),
});

type ContributionParent = { mode?: ContributionMode };

export const contributionSchema = object({
  type: mixed<ContributionType>().oneOf(["contribution", "withdrawal"]).defined(),
  mode: mixed<ContributionMode>()
    .oneOf(CONTRIBUTION_MODES.map((option) => option.value))
    .defined(),
  currency: mixed<Currency>().defined(),
  amount: amountField(false).test("required", "Enter an amount.", (value, context) => {
    const parent = context.parent as ContributionParent;
    return parent.mode === "link" || value !== "";
  }),
  occurredOn: string().defined(),
  accountId: string()
    .defined()
    .test("account", "Choose an account.", (value, context) => {
      const parent = context.parent as ContributionParent;
      return parent.mode !== "transfer" || value !== "";
    }),
  transactionId: string()
    .defined()
    .test("transfer", "Choose a transfer.", (value, context) => {
      const parent = context.parent as ContributionParent;
      return parent.mode !== "link" || value !== "";
    }),
  notes: multiLineText(NOTES_MAX_LENGTH),
});
