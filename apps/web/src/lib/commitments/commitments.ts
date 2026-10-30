/**
 * Loans, subscriptions, and bills: labels, interest-rate parsing, payment grouping, and form
 * schemas that mirror the API's.
 *
 * Interest rates travel as integer basis points (8.5% is 850) and are converted to and from text
 * with string operations, like money, so no floating-point arithmetic touches them.
 */

import type {
  CommitmentKind,
  Currency,
  EmiFrequency,
  InterestMethod,
  LoanType,
  PaymentItem,
  PaymentStatus,
  RecurringFrequency,
  RecurringKind,
  RecurringStatus,
} from "@orbit/contracts";
import { boolean, mixed, object, string } from "yup";

import { DEFAULT_CURRENCY, NOTES_MAX_LENGTH, parseAmount } from "@/lib/finance";
import { labelOf, type Option } from "@/utils/common";
import { multiLineText, singleLineText } from "@/utils/validation";

export const NAME_MAX_LENGTH = 100;
/** The highest rate the API accepts: 100% a year. */
export const MAX_RATE_BPS = 10_000;
export const MAX_REMINDER_DAYS = 30;
/** How far back and ahead the upcoming-payments view looks by default. */
export const PAYMENT_WINDOW_DAYS = 30;

// Labels

export const LOAN_TYPES: readonly Option<LoanType>[] = [
  { value: "home", label: "Home loan" },
  { value: "vehicle", label: "Vehicle loan" },
  { value: "personal", label: "Personal loan" },
  { value: "education", label: "Education loan" },
  { value: "other", label: "Other loan" },
];

export const INTEREST_METHODS: readonly Option<InterestMethod>[] = [
  { value: "reducing", label: "Reducing balance" },
  { value: "flat", label: "Flat rate" },
];

export const EMI_FREQUENCIES: readonly Option<EmiFrequency>[] = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "half_yearly", label: "Every 6 months" },
  { value: "yearly", label: "Yearly" },
];

export const FREQUENCIES: readonly Option<RecurringFrequency>[] = [
  { value: "weekly", label: "Weekly" },
  ...EMI_FREQUENCIES,
];

const PERIODS: Record<RecurringFrequency, string> = {
  weekly: "week",
  monthly: "month",
  quarterly: "quarter",
  half_yearly: "6 months",
  yearly: "year",
};

/** Months per installment, for showing a tenure in installments. */
export const MONTHS_PER_PERIOD: Readonly<Record<EmiFrequency, number>> = {
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  yearly: 12,
};

export const loanTypeLabel = (type: LoanType) => labelOf(LOAN_TYPES, type);
export const frequencyLabel = (frequency: RecurringFrequency) => labelOf(FREQUENCIES, frequency);
export const interestMethodLabel = (method: InterestMethod) => labelOf(INTEREST_METHODS, method);

/** `/ month`, `/ year`, … for an amount that recurs. */
export function perPeriod(frequency: RecurringFrequency): string {
  return `/ ${PERIODS[frequency]}`;
}

export const KIND_LABELS: Readonly<Record<CommitmentKind, string>> = {
  loan: "Loan EMI",
  subscription: "Subscription",
  bill: "Bill",
};

export const PAYMENT_STATUSES: readonly Option<PaymentStatus>[] = [
  { value: "overdue", label: "Overdue" },
  { value: "due", label: "Due today" },
  { value: "upcoming", label: "Upcoming" },
  { value: "paid", label: "Paid" },
  { value: "skipped", label: "Skipped" },
];

export const paymentStatusLabel = (status: PaymentStatus) => labelOf(PAYMENT_STATUSES, status);

export const RECURRING_STATUS_LABELS: Readonly<Record<RecurringStatus, string>> = {
  active: "Active",
  paused: "Paused",
  cancelled: "Cancelled",
  expired: "Ended",
};

// Interest rates

/** `850` as `"8.5"`: the rate in percent, without trailing zeros. */
export function formatRate(bps: number): string {
  const whole = Math.floor(bps / 100);
  const fraction = String(bps % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

/**
 * Text such as `8.5`, `8.50%`, or `10` as basis points; `null` when it isn't a rate between 0
 * and 100% with at most two decimals.
 */
export function parseRate(text: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec(text.trim().replace(/\s*%$/, ""));
  if (!match) return null;
  const bps = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return bps <= MAX_RATE_BPS ? bps : null;
}

// Payments

export type PaymentGroups = {
  overdue: PaymentItem[];
  dueToday: PaymentItem[];
  upcoming: PaymentItem[];
  /** Newest first. */
  settled: PaymentItem[];
};

/** Payments split the way the upcoming view shows them. */
export function groupPayments(items: readonly PaymentItem[]): PaymentGroups {
  const groups: PaymentGroups = { overdue: [], dueToday: [], upcoming: [], settled: [] };
  for (const item of items) {
    if (item.status === "overdue") groups.overdue.push(item);
    else if (item.status === "due") groups.dueToday.push(item);
    else if (item.status === "upcoming") groups.upcoming.push(item);
    else groups.settled.push(item);
  }
  groups.settled.reverse();
  return groups;
}

/** A stable key for a payment, expected or settled. */
export function paymentKey(item: PaymentItem): string {
  return `${item.kind}:${item.commitment_id}:${item.occurrence_id ?? item.due_date}`;
}

/** Money summed per currency, never across currencies. */
export function totalsByCurrency(items: readonly PaymentItem[]): [Currency, number][] {
  const totals = new Map<Currency, number>();
  for (const item of items)
    totals.set(item.currency, (totals.get(item.currency) ?? 0) + item.amount);
  return [...totals.entries()];
}

// Forms

export const NAME = singleLineText(NAME_MAX_LENGTH)
  .required("Enter a name.")
  .test("printable", "Remove unsupported characters.", (value) => !/\p{C}/u.test(value));
const COUNTERPARTY = singleLineText(NAME_MAX_LENGTH);
const AMOUNT_HINT = "Enter an amount, such as 1250 or 1,250.50.";

type CurrencyParent = { currency?: Currency };

/** An amount typed in the parent's `currency`; blank only when not `required`. */
export function amountField(required: boolean) {
  const field = string().trim().defined();
  return (required ? field.required("Enter an amount.") : field).test(
    "amount",
    AMOUNT_HINT,
    (value, context) => {
      if (value === "") return !required;
      const parent = context.parent as CurrencyParent;
      return parseAmount(value, parent.currency ?? DEFAULT_CURRENCY) !== null;
    },
  );
}

/** Reminder fields shared by every commitment form: blank days means no reminder. */
export const reminderFields = {
  reminderDays: string()
    .trim()
    .defined()
    .test(
      "days",
      `Enter a number of days from 0 to ${MAX_REMINDER_DAYS}, or leave it blank.`,
      (value) => value === "" || (/^\d{1,2}$/.test(value) && Number(value) <= MAX_REMINDER_DAYS),
    ),
  reminderTime: string().defined(),
};

export const loanSchema = object({
  name: NAME,
  lender: COUNTERPARTY,
  loanType: mixed<LoanType>()
    .oneOf(LOAN_TYPES.map((option) => option.value))
    .defined(),
  currency: mixed<Currency>().defined(),
  principal: amountField(true),
  outstanding: amountField(false),
  rate: string()
    .trim()
    .required("Enter the interest rate.")
    .test("rate", "Enter a rate such as 8.5 (up to 100).", (value) => parseRate(value) !== null),
  interestMethod: mixed<InterestMethod>()
    .oneOf(INTEREST_METHODS.map((option) => option.value))
    .defined(),
  startDate: string().required("Choose the start date."),
  tenureMonths: string()
    .trim()
    .required("Enter the tenure in months.")
    .test(
      "tenure",
      "Enter a whole number of months.",
      (value) => /^\d{1,4}$/.test(value) && Number(value) > 0,
    )
    .test("periods", "The tenure must be whole installment periods.", (value, context) => {
      const parent = context.parent as { emiFrequency?: EmiFrequency };
      return Number(value) % MONTHS_PER_PERIOD[parent.emiFrequency ?? "monthly"] === 0;
    }),
  emiFrequency: mixed<EmiFrequency>()
    .oneOf(EMI_FREQUENCIES.map((option) => option.value))
    .defined(),
  firstPaymentDate: string()
    .required("Choose the first payment date.")
    .test("after-start", "The first payment can’t be before the start date.", (value, context) => {
      const parent = context.parent as { startDate?: string };
      return !parent.startDate || value >= parent.startDate;
    }),
  nextPaymentDate: string()
    .defined()
    .test("after-first", "The next payment can’t be before the first.", (value, context) => {
      const parent = context.parent as { firstPaymentDate?: string };
      return value === "" || !parent.firstPaymentDate || value >= parent.firstPaymentDate;
    }),
  emi: amountField(false),
  paymentAccountId: string().defined(),
  notes: multiLineText(NOTES_MAX_LENGTH),
  ...reminderFields,
});

export const recurringSchema = object({
  kind: mixed<RecurringKind>().oneOf(["subscription", "bill"]).defined(),
  name: NAME,
  provider: COUNTERPARTY,
  amount: amountField(true),
  currency: mixed<Currency>().defined(),
  amountVaries: boolean().defined(),
  frequency: mixed<RecurringFrequency>()
    .oneOf(FREQUENCIES.map((option) => option.value))
    .defined(),
  nextDueDate: string().required("Choose the next due date."),
  startDate: string()
    .defined()
    .test("before-next", "The start can’t be after the next due date.", (value, context) => {
      const parent = context.parent as { nextDueDate?: string };
      return value === "" || !parent.nextDueDate || value <= parent.nextDueDate;
    }),
  endDate: string()
    .defined()
    .test("after-next", "The end can’t be before the next due date.", (value, context) => {
      const parent = context.parent as { nextDueDate?: string };
      return value === "" || !parent.nextDueDate || value >= parent.nextDueDate;
    }),
  trialEndsOn: string().defined(),
  autoRenew: boolean().defined(),
  categoryId: string().defined(),
  accountId: string().defined(),
  notes: multiLineText(NOTES_MAX_LENGTH),
  ...reminderFields,
});

/** `"3"` as reminder settings, `""` as none. The API fills in the time zone. */
export function toReminderRequest(
  days: string,
  time: string,
  timezone: string | undefined,
): { days_before: number; time_of_day: string; timezone?: string } | null {
  if (days === "") return null;
  return { days_before: Number(days), time_of_day: time || "09:00", timezone };
}

/**
 * Recording a payment. `create` records new transactions from `accountId`; `link` points at
 * transactions already recorded; `manual` (subscriptions and bills only) marks it paid without
 * one. Loans split the amount into principal and interest.
 */
export const paymentSchema = object({
  mode: mixed<"create" | "link" | "manual">().oneOf(["create", "link", "manual"]).defined(),
  isLoan: boolean().defined(),
  currency: mixed<Currency>().defined(),
  paidOn: string().required("Choose the date it was paid."),
  accountId: string()
    .defined()
    .test("account", "Choose the account it was paid from.", (value, context) => {
      const parent = context.parent as { mode?: string };
      return parent.mode !== "create" || value !== "";
    }),
  /** Subscriptions and bills: blank uses the expected amount. */
  amount: amountField(false),
  /** Loans: what was paid toward principal and interest; blank is zero. */
  principal: string().trim().defined().test("principal", AMOUNT_HINT, componentValid),
  interest: string().trim().defined().test("interest", AMOUNT_HINT, componentValid),
  /** Link mode: the transactions to link. */
  transactionId: string().defined(),
  interestTransactionId: string()
    .defined()
    .test("linked", "Choose at least one transaction to link.", (value, context) => {
      const parent = context.parent as { mode?: string; transactionId?: string };
      return parent.mode !== "link" || value !== "" || (parent.transactionId ?? "") !== "";
    }),
});

function componentValid(value: string, context: { parent: unknown }): boolean {
  if (value === "" || /^0+(\.0*)?$/.test(value)) return true;
  const parent = context.parent as CurrencyParent;
  return parseAmount(value, parent.currency ?? DEFAULT_CURRENCY) !== null;
}

/** Text typed into a principal or interest field, as minor units: blank and zero are 0. */
export function parseComponent(text: string, currency: Currency): number | null {
  const trimmed = text.trim();
  if (trimmed === "" || /^0+(\.0*)?$/.test(trimmed)) return 0;
  return parseAmount(trimmed, currency);
}
