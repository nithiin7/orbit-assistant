/**
 * Finance display rules, money parsing and formatting, filters, and form schemas that mirror
 * the API's.
 *
 * Amounts are integers in the currency's minor unit (paise for INR), exactly as the API sends
 * them. Text is converted to and from minor units with string operations, never floating-point
 * arithmetic, so ₹0.10 + ₹0.20 is always ₹0.30. The largest amount (10^13) is far inside the
 * range where JavaScript numbers hold integers exactly.
 */

import type {
  CreateFinanceAccountRequest,
  Currency,
  FinanceAccount,
  FinanceAccountType,
  FinanceCategory,
  FinanceTransaction,
  FinanceTransactionListQuery,
  FinanceTransactionType,
} from "@orbit/contracts";
import { mixed, object, string } from "yup";

import { type Option } from "@/utils/common";
import { multiLineText, singleLineText } from "@/utils/validation";

/** Mirrors the API's `CURRENCY_EXPONENTS`: digits after the decimal point. */
export const CURRENCY_EXPONENTS: Readonly<Record<Currency, number>> = {
  INR: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  AED: 2,
  SGD: 2,
  AUD: 2,
  CAD: 2,
  CHF: 2,
  JPY: 0,
};
export const CURRENCIES = Object.keys(CURRENCY_EXPONENTS) as readonly Currency[];
export const DEFAULT_CURRENCY: Currency = "INR";
/** The largest amount the API accepts, in minor units. */
export const MAX_AMOUNT = 10 ** 13;
export const DESCRIPTION_MAX_LENGTH = 200;
export const NOTES_MAX_LENGTH = 2000;
export const ACCOUNT_NAME_MAX_LENGTH = 100;
/** Transactions per page of history. */
export const TRANSACTION_PAGE_SIZE = 50;

export function isCurrency(value: string): value is Currency {
  return value in CURRENCY_EXPONENTS;
}

/** Minor units as plain decimal text in the major unit: 123450 INR is `"1234.50"`. */
export function toDecimalString(amount: number, currency: Currency): string {
  const exponent = CURRENCY_EXPONENTS[currency];
  const sign = amount < 0 ? "-" : "";
  const digits = String(Math.abs(amount)).padStart(exponent + 1, "0");
  if (exponent === 0) return `${sign}${digits}`;
  return `${sign}${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

const GROUPING = /[,\s_]/g;

/**
 * Text a person typed, such as `1,00,000.5` or `₹ 250`, as positive minor units; `null` when it
 * isn't an amount, has more decimals than the currency allows, or is out of range.
 */
export function parseAmount(text: string, currency: Currency): number | null {
  const exponent = CURRENCY_EXPONENTS[currency];
  // Drop a leading currency symbol or code, but not a sign: negative text is not an amount.
  const cleaned = text.replace(GROUPING, "").replace(/^[^\d.+\-−]+/, "");
  const match = /^(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!match || cleaned === "" || cleaned === ".") return null;
  const whole = match[1] ?? "";
  const fraction = match[2] ?? "";
  if (fraction.length > exponent || (whole === "" && fraction === "")) return null;
  const digits = `${whole}${fraction.padEnd(exponent, "0")}`.replace(/^0+(?=\d)/, "");
  // 17 digits is beyond `MAX_AMOUNT` already; stop before Number could lose precision.
  if (digits.length > 16) return null;
  const amount = Number(digits);
  return amount > 0 && amount <= MAX_AMOUNT ? amount : null;
}

/** Like `parseAmount`, but zero and a leading minus sign are allowed; blank is zero. */
export function parseSignedAmount(text: string, currency: Currency): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  const negative = trimmed.startsWith("-") || trimmed.startsWith("−");
  const rest = negative ? trimmed.slice(1) : trimmed;
  if (/^[0.,\s]+$/.test(rest)) return 0;
  const amount = parseAmount(rest, currency);
  if (amount === null) return null;
  return negative ? -amount : amount;
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: Currency, signDisplay: "auto" | "always" | "never") {
  const key = `${currency}:${signDisplay}`;
  let format = formatters.get(key);
  if (!format) {
    format = new Intl.NumberFormat(undefined, { style: "currency", currency, signDisplay });
    formatters.set(key, format);
  }
  return format;
}

/**
 * Minor units for display, such as `₹1,234.50`. Formats the exact decimal text, never a float.
 * `signDisplay: "always"` shows `+` for money in.
 */
export function formatMoney(
  amount: number,
  currency: Currency,
  { signDisplay = "auto" }: { signDisplay?: "auto" | "always" | "never" } = {},
): string {
  const decimal = toDecimalString(amount, currency) as `${number}`;
  return formatter(currency, signDisplay).format(decimal);
}

// Labels

/** Account types a person can create; loan accounts are created with a loan. */
export type ManualAccountType = CreateFinanceAccountRequest["type"];

export const ACCOUNT_TYPES: readonly Option<ManualAccountType>[] = [
  { value: "bank", label: "Bank account" },
  { value: "savings", label: "Savings account" },
  { value: "cash", label: "Cash" },
  { value: "wallet", label: "Digital wallet" },
  { value: "credit_card", label: "Credit card" },
  { value: "investment", label: "Investment account" },
  { value: "other", label: "Other" },
];

export function accountTypeLabel(type: FinanceAccountType): string {
  if (type === "loan") return "Loan";
  return ACCOUNT_TYPES.find((item) => item.value === type)?.label ?? type;
}

export const TRANSACTION_TYPES: readonly Option<FinanceTransactionType>[] = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "refund", label: "Refund" },
  { value: "transfer", label: "Transfer" },
];

export function transactionTypeLabel(type: FinanceTransactionType): string {
  return TRANSACTION_TYPES.find((item) => item.value === type)?.label ?? type;
}

export function isTransactionType(value: string): value is FinanceTransactionType {
  return TRANSACTION_TYPES.some((item) => item.value === value);
}

/** The category type a transaction type takes, or `null` for transfers, which have none. */
export function categoryTypeFor(type: FinanceTransactionType): FinanceCategory["type"] | null {
  if (type === "transfer") return null;
  return type === "income" ? "income" : "expense";
}

/**
 * The transaction's amount as it affects the account it's listed under: positive for money in,
 * negative for money out, and `0`-signed (neutral) for a transfer viewed without an account.
 */
export function signedAmount(transaction: FinanceTransaction, accountId?: string): number {
  switch (transaction.type) {
    case "income":
    case "refund":
      return transaction.amount;
    case "expense":
      return -transaction.amount;
    case "transfer":
      if (accountId === transaction.to_account_id) return transaction.amount;
      if (accountId === transaction.account_id) return -transaction.amount;
      return transaction.amount;
  }
}

/** For a credit card or loan, the opening balance is entered as the amount owed. */
export function isLiability(account: Pick<FinanceAccount, "type">): boolean {
  return account.type === "credit_card" || account.type === "loan";
}

/** Accounts money can be paid from: active, and not a loan's own account. */
export function payingAccounts(
  accounts: readonly FinanceAccount[],
  currency?: Currency,
): FinanceAccount[] {
  return accounts.filter(
    (account) =>
      !account.archived &&
      account.type !== "loan" &&
      (currency === undefined || account.currency === currency),
  );
}

/** The distinct currencies of the given accounts, the most common first, INR breaking ties. */
export function accountCurrencies(accounts: readonly FinanceAccount[]): Currency[] {
  const counts = new Map<Currency, number>();
  for (const account of accounts) {
    counts.set(account.currency, (counts.get(account.currency) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(
      ([a, countA], [b, countB]) =>
        countB - countA || Number(b === DEFAULT_CURRENCY) - Number(a === DEFAULT_CURRENCY),
    )
    .map(([currency]) => currency);
}

// Filters

export type TransactionFilters = {
  type: FinanceTransactionType | "all";
  accountId: string;
  categoryId: string;
  /** `YYYY-MM-DD` or `""` for no bound. */
  from: string;
  to: string;
  /** Already trimmed. */
  search: string;
  sort: "date" | "amount";
  page: number;
};

export const DEFAULT_TRANSACTION_FILTERS: TransactionFilters = {
  type: "all",
  accountId: "",
  categoryId: "",
  from: "",
  to: "",
  search: "",
  sort: "date",
  page: 0,
};

export function toTransactionListQuery(filters: TransactionFilters): FinanceTransactionListQuery {
  return {
    type: filters.type === "all" ? undefined : [filters.type],
    account_id: filters.accountId || undefined,
    category_id: filters.categoryId || undefined,
    // A reversed range would be rejected; ignore the end date until it is fixed.
    date_from: filters.from || undefined,
    date_to: filters.to && !(filters.from && filters.to < filters.from) ? filters.to : undefined,
    q: filters.search || undefined,
    sort: filters.sort,
    limit: TRANSACTION_PAGE_SIZE,
    offset: filters.page * TRANSACTION_PAGE_SIZE,
  };
}

/** True when any filter narrows the history beyond "everything". */
export function isFiltered(filters: TransactionFilters): boolean {
  return (
    filters.type !== "all" ||
    filters.accountId !== "" ||
    filters.categoryId !== "" ||
    filters.from !== "" ||
    filters.to !== "" ||
    filters.search !== ""
  );
}

// Forms

const AMOUNT_HINT = "Enter an amount, such as 1250 or 1,250.50.";

export type TransactionFormContext = { currency: Currency };

export const transactionSchema = object({
  type: mixed<FinanceTransactionType>()
    .oneOf(TRANSACTION_TYPES.map((item) => item.value))
    .defined(),
  amount: string()
    .trim()
    .required("Enter an amount.")
    .test("amount", AMOUNT_HINT, (value, context) => {
      const options = context.options.context as TransactionFormContext | undefined;
      return parseAmount(value, options?.currency ?? DEFAULT_CURRENCY) !== null;
    }),
  occurredOn: string().required("Choose a date."),
  description: singleLineText(DESCRIPTION_MAX_LENGTH).required("Enter a description."),
  accountId: string().required("Choose an account."),
  /** `""` unless the transaction is a transfer. */
  toAccountId: string()
    .defined()
    .test("destination", "Choose the account the money goes to.", (value, context) => {
      const parent = context.parent as { type?: string };
      return parent.type !== "transfer" || value !== "";
    })
    .test("different", "Choose a different account.", (value, context) => {
      const parent = context.parent as { type?: string; accountId?: string };
      return parent.type !== "transfer" || value !== parent.accountId;
    }),
  /** `""` for no category. */
  categoryId: string().defined(),
  notes: multiLineText(NOTES_MAX_LENGTH),
});

export const accountSchema = object({
  name: singleLineText(ACCOUNT_NAME_MAX_LENGTH, "Remove line breaks and unsupported characters.")
    .required("Enter a name.")
    .test("printable", "Remove unsupported characters.", (value) => !/\p{C}/u.test(value)),
  type: mixed<ManualAccountType>()
    .oneOf(ACCOUNT_TYPES.map((item) => item.value))
    .defined(),
  currency: mixed<Currency>()
    .oneOf([...CURRENCIES])
    .defined(),
  /** Blank is zero. For a credit card or loan, the amount owed. */
  openingBalance: string()
    .trim()
    .defined()
    .test("balance", "Enter an amount, such as 5000 or -250.50.", (value, context) => {
      const parent = context.parent as { currency?: Currency };
      return parseSignedAmount(value, parent.currency ?? DEFAULT_CURRENCY) !== null;
    }),
  notes: multiLineText(NOTES_MAX_LENGTH),
});

export const categorySchema = object({
  name: singleLineText(ACCOUNT_NAME_MAX_LENGTH)
    .required("Enter a name.")
    .test("printable", "Remove unsupported characters.", (value) => !/\p{C}/u.test(value)),
  type: mixed<FinanceCategory["type"]>().oneOf(["income", "expense"]).defined(),
});
