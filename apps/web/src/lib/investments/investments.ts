/**
 * Investments, deposits, other assets, and net worth: labels, exact unit and price text, and
 * form schemas that mirror the API's.
 *
 * Units and per-unit prices travel as decimal strings with up to six decimals (`"218.92"`,
 * `"45.6789"`), never as JSON numbers, so they are validated and displayed with string
 * operations. Money is integer minor units, as everywhere in finance.
 */

import type {
  AssetCategory,
  Compounding,
  Currency,
  DepositKind,
  Freshness,
  HoldingKind,
  InvestmentAccountKind,
  InvestmentTransactionType,
  NetWorthSnapshot,
  Settlement,
  SipState,
  ValueSource,
} from "@orbit/contracts";
import { boolean, mixed, object, string } from "yup";

import { amountField, NAME, reminderFields } from "@/lib/commitments";
import { DEFAULT_CURRENCY, NOTES_MAX_LENGTH, parseAmount } from "@/lib/finance";
import { labelOf, type Option } from "@/utils/common";
import { multiLineText, singleLineText } from "@/utils/validation";

export const UNIT_DECIMALS = 6;

export const INVESTMENT_ACCOUNT_KINDS: readonly Option<InvestmentAccountKind>[] = [
  { value: "mutual_fund", label: "Mutual fund platform" },
  { value: "brokerage", label: "Stock brokerage" },
  { value: "deposit", label: "Fixed deposits" },
  { value: "other", label: "Other investments" },
];

export const HOLDING_KINDS: readonly Option<HoldingKind>[] = [
  { value: "mutual_fund", label: "Mutual fund" },
  { value: "stock", label: "Stock" },
  { value: "etf", label: "ETF" },
];

export const TRANSACTION_TYPES: readonly Option<InvestmentTransactionType>[] = [
  { value: "buy", label: "Buy" },
  { value: "sell", label: "Sell" },
  { value: "dividend", label: "Dividend" },
  { value: "interest", label: "Interest" },
  { value: "fee", label: "Fee" },
  { value: "deposit", label: "Deposit" },
  { value: "withdrawal", label: "Withdrawal" },
];

export const COMPOUNDING: readonly Option<Compounding>[] = [
  { value: "quarterly", label: "Quarterly" },
  { value: "monthly", label: "Monthly" },
  { value: "half_yearly", label: "Every 6 months" },
  { value: "yearly", label: "Yearly" },
  { value: "simple", label: "Simple interest" },
];

export const DEPOSIT_KINDS: readonly Option<DepositKind>[] = [
  { value: "fixed", label: "Fixed deposit" },
  { value: "recurring", label: "Recurring deposit" },
];

export const ASSET_CATEGORIES: readonly Option<AssetCategory>[] = [
  { value: "gold", label: "Gold" },
  { value: "property", label: "Property" },
  { value: "vehicle", label: "Vehicle" },
  { value: "cash", label: "Cash" },
  { value: "other", label: "Other" },
];

export const SIP_STATES: Readonly<Record<SipState, string>> = {
  active: "Active",
  paused: "Paused",
  cancelled: "Cancelled",
};

export const FRESHNESS_LABELS: Readonly<Record<Freshness, string>> = {
  current: "Current",
  stale: "Stale",
  missing: "No valuation",
  estimated: "Estimate",
};

export const SOURCE_LABELS: Readonly<Record<ValueSource, string>> = {
  ledger: "Account balance",
  market: "Market price",
  manual: "Entered by you",
  estimate: "Estimated",
  cost: "At cost",
};

export const SNAPSHOT_SOURCE_LABELS: Readonly<Record<NetWorthSnapshot["source"], string>> = {
  scheduled: "Recorded at month end",
  manual: "Saved by you",
  backfill: "Reconstructed from history",
};

export const accountKindLabel = (kind: InvestmentAccountKind) =>
  labelOf(INVESTMENT_ACCOUNT_KINDS, kind);
export const holdingKindLabel = (kind: HoldingKind) => labelOf(HOLDING_KINDS, kind);
export const transactionTypeLabel = (type: InvestmentTransactionType) =>
  labelOf(TRANSACTION_TYPES, type);
export const compoundingLabel = (value: Compounding) => labelOf(COMPOUNDING, value);
export const assetCategoryLabel = (category: AssetCategory) => labelOf(ASSET_CATEGORIES, category);

const UNITS = /^(\d{1,12})(?:\.(\d{1,6}))?$/;

/**
 * Typed units or a price, such as `1,234.5`, as the API's decimal text (`"1234.5"`); `null` when
 * it isn't a positive number with at most six decimals.
 */
export function parseUnits(text: string): string | null {
  const cleaned = text.trim().replace(/[,\s_]/g, "");
  const match = UNITS.exec(cleaned);
  if (!match) return null;
  const whole = (match[1] ?? "").replace(/^0+(?=\d)/, "");
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  if (/^0*$/.test(whole + fraction)) return null;
  return fraction ? `${whole}.${fraction}` : whole;
}

/** Decimal text for display with locale grouping, keeping every decimal: `1,234.5678`. */
export function formatUnits(text: string): string {
  const [whole = "0", fraction = ""] = text.split(".");
  const grouped = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
    whole as `${number}`,
  );
  return fraction ? `${grouped}.${fraction}` : grouped;
}

/** A per-unit price in the major unit, such as `₹45.6789`, with at least the currency's decimals. */
export function formatUnitPrice(text: string, currency: Currency): string {
  const decimals = (text.split(".")[1] ?? "").length;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: Math.min(Math.max(decimals, 2), UNIT_DECIMALS),
    maximumFractionDigits: UNIT_DECIMALS,
  }).format(text as `${number}`);
}

/** `"12.34"` as `+12.34%`; `null` as an em dash. Display only. */
export function formatPercent(text: string | null): string {
  if (text === null) return "—";
  return `${text.startsWith("-") ? "" : "+"}${text}%`;
}

/** A gain's tone: positive is success, negative destructive, zero and unknown neutral. */
export function gainTone(amount: number | null): string {
  if (amount === null || amount === 0) return "text-muted-foreground";
  return amount > 0 ? "text-success" : "text-destructive";
}

/** The first day of a range ending `today`: `months` back, the year so far, or everything. */
export function rangeStart(today: string, months: number | "ytd" | "all"): string | undefined {
  if (months === "all") return undefined;
  const [year = "2000"] = today.split("-");
  if (months === "ytd") return `${year}-01-01`;
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - months);
  return date.toISOString().slice(0, 10);
}

// Forms

const SHORT = singleLineText(100);
const NOTES = multiLineText(NOTES_MAX_LENGTH);

function unitsField(message: string) {
  return string()
    .trim()
    .required(message)
    .test("units", "Enter a positive number with up to 6 decimals.", (value) =>
      Boolean(parseUnits(value)),
    );
}

function settlementFields() {
  return {
    settlement: mixed<Settlement>().oneOf(["investment_account", "account", "none"]).defined(),
    cashAccountId: string()
      .defined()
      .test("account", "Choose the account.", (value, context) => {
        const parent = context.parent as { settlement?: Settlement };
        return parent.settlement !== "account" || value !== "";
      }),
  };
}

export const investmentAccountSchema = object({
  mode: mixed<"new" | "existing">().oneOf(["new", "existing"]).defined(),
  name: string()
    .trim()
    .defined()
    .test("name", "Enter a name.", (value, context) => {
      const parent = context.parent as { mode?: string };
      return parent.mode !== "new" || value !== "";
    }),
  accountId: string()
    .defined()
    .test("account", "Choose the account.", (value, context) => {
      const parent = context.parent as { mode?: string };
      return parent.mode !== "existing" || value !== "";
    }),
  kind: mixed<InvestmentAccountKind>()
    .oneOf(INVESTMENT_ACCOUNT_KINDS.map((option) => option.value))
    .defined(),
  provider: SHORT,
  currency: mixed<Currency>().defined(),
  linkedAccountId: string().defined(),
  notes: NOTES,
});

export const holdingSchema = object({
  accountId: string().required("Choose the investment account."),
  kind: mixed<HoldingKind>()
    .oneOf(HOLDING_KINDS.map((option) => option.value))
    .defined(),
  name: singleLineText(200).required("Enter a name."),
  symbol: singleLineText(40),
  exchange: singleLineText(20),
  isin: string()
    .trim()
    .defined()
    .test(
      "isin",
      "Enter a 12-character ISIN, such as INE009A01021.",
      (value) => value === "" || /^[A-Za-z]{2}[A-Za-z0-9]{9}\d$/.test(value),
    ),
  issuer: SHORT,
  category: SHORT,
  folio: singleLineText(40),
  notes: NOTES,
});

/** A buy, sale, dividend, or fee on a holding. Only trades have units and charges. */
export const tradeSchema = object({
  type: mixed<InvestmentTransactionType>().oneOf(["buy", "sell", "dividend", "fee"]).defined(),
  currency: mixed<Currency>().defined(),
  tradeDate: string().required("Choose the date."),
  amount: amountField(true),
  quantity: string()
    .trim()
    .defined()
    .test("units", "Enter the units, with up to 6 decimals.", (value, context) => {
      const parent = context.parent as { type?: string };
      if (parent.type !== "buy" && parent.type !== "sell") return true;
      return Boolean(parseUnits(value));
    }),
  fees: amountField(false),
  plan: mixed<"lump_sum" | "sip">().oneOf(["lump_sum", "sip"]).defined(),
  ...settlementFields(),
  notes: NOTES,
});

export const priceSchema = object({
  priceDate: string().required("Choose the date."),
  price: unitsField("Enter the price."),
});

export const sipSchema = object({
  currency: mixed<Currency>().defined(),
  amount: amountField(true),
  frequency: mixed<"weekly" | "monthly" | "quarterly" | "half_yearly" | "yearly">().defined(),
  nextDueDate: string().required("Choose the next SIP date."),
  endDate: string()
    .defined()
    .test("after", "The end can’t be before the next SIP date.", (value, context) => {
      const parent = context.parent as { nextDueDate?: string };
      return value === "" || !parent.nextDueDate || value >= parent.nextDueDate;
    }),
  fundingAccountId: string().defined(),
});

export const depositSchema = object({
  accountId: string().required("Choose the investment account."),
  kind: mixed<DepositKind>().oneOf(["fixed", "recurring"]).defined(),
  name: NAME,
  institution: SHORT,
  currency: mixed<Currency>().defined(),
  rate: string()
    .trim()
    .required("Enter the interest rate.")
    .test(
      "rate",
      "Enter a rate such as 7.1 (up to 100).",
      (value) => /^\d{1,3}(\.\d{1,2})?$/.test(value) && Number(value) <= 100,
    ),
  compounding: mixed<Compounding>()
    .oneOf(COMPOUNDING.map((option) => option.value))
    .defined(),
  startDate: string().required("Choose the start date."),
  maturityDate: string()
    .required("Choose the maturity date.")
    .test("after", "Maturity must be after the start date.", (value, context) => {
      const parent = context.parent as { startDate?: string };
      return !parent.startDate || value > parent.startDate;
    }),
  amount: amountField(true),
  statedMaturity: amountField(false),
  ...settlementFields(),
  notes: NOTES,
  ...reminderFields,
});

export const closeDepositSchema = object({
  currency: mixed<Currency>().defined(),
  closedOn: string().required("Choose the date."),
  amount: amountField(true),
  ...settlementFields(),
});

export const assetSchema = object({
  name: NAME,
  category: mixed<AssetCategory>()
    .oneOf(ASSET_CATEGORIES.map((option) => option.value))
    .defined(),
  currency: mixed<Currency>().defined(),
  purchaseDate: string().defined(),
  purchaseCost: amountField(false),
  currentValue: amountField(false),
  valuedOn: string().defined(),
  linkedAccountId: string().defined(),
  includeInNetWorth: boolean().defined(),
  notes: NOTES,
});

export const valuationSchema = object({
  currency: mixed<Currency>().defined(),
  valuedOn: string().required("Choose the date."),
  value: string()
    .trim()
    .required("Enter the value.")
    .test("value", "Enter an amount, such as 1250 or 1,250.50.", (value, context) => {
      const parent = context.parent as { currency?: Currency };
      return (
        /^0+(\.0*)?$/.test(value) ||
        parseAmount(value, parent.currency ?? DEFAULT_CURRENCY) !== null
      );
    }),
});

/** Typed text as a value that may be zero: `"0"` is 0, otherwise like `parseAmount`. */
export function parseValue(text: string, currency: Currency): number | null {
  const trimmed = text.trim();
  if (/^0+(\.0*)?$/.test(trimmed)) return 0;
  return parseAmount(trimmed, currency);
}

/** `"7.1"` as basis points (710), with string operations only. */
export function rateToBps(text: string): number {
  const [whole = "0", fraction = ""] = text.trim().split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
}
