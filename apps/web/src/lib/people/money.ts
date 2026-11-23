import type {
  CreatePersonLedgerEntryRequest,
  Currency,
  Person,
  PersonBalance,
  PersonLedger,
  PersonLedgerEntry,
  PersonLedgerKind,
} from "@orbit/contracts";
import { boolean, type InferType, mixed, object, string } from "yup";

import { CURRENCIES, DEFAULT_CURRENCY, formatMoney, toDecimalString } from "@/lib/finance";
import { type Option } from "@/utils/common";
import { localDateString } from "@/utils/dates";
import { singleLineText } from "@/utils/validation";

export const LEDGER_DESCRIPTION_MAX_LENGTH = 200;

export const LEDGER_KINDS: readonly PersonLedgerKind[] = [
  "they_owe",
  "i_owe",
  "they_paid",
  "i_paid",
];

/** How each kind moves a balance, which is positive while they owe you. */
const SIGNS: Readonly<Record<PersonLedgerKind, 1 | -1>> = {
  they_owe: 1,
  i_paid: 1,
  i_owe: -1,
  they_paid: -1,
};

export const LEDGER_KIND_OPTIONS: readonly Option<PersonLedgerKind>[] = [
  { value: "they_owe", label: "They owe me" },
  { value: "i_owe", label: "I owe them" },
  { value: "they_paid", label: "They paid me back" },
  { value: "i_paid", label: "I paid them back" },
];

export function isRepayment(kind: PersonLedgerKind): boolean {
  return kind === "they_paid" || kind === "i_paid";
}

/** The entry's effect on the balance: positive when it adds to what they owe you. */
export function signedAmount(entry: Pick<PersonLedgerEntry, "kind" | "amount">): number {
  return SIGNS[entry.kind] * entry.amount;
}

/** What happened, from your side: "Priya owes you", "You paid Sam back". */
export function entryHeadline(entry: Pick<PersonLedgerEntry, "kind">, name: string): string {
  switch (entry.kind) {
    case "they_owe":
      return `${name} owes you`;
    case "i_owe":
      return `You owe ${name}`;
    case "they_paid":
      return `${name} paid you back`;
    case "i_paid":
      return `You paid ${name} back`;
  }
}

export function balancesOf(ledger: PersonLedger, personId: string): PersonBalance[] {
  return ledger.balances.filter((balance) => balance.person_id === personId);
}

export function entriesOf(ledger: PersonLedger, personId: string): PersonLedgerEntry[] {
  return ledger.entries.filter((entry) => entry.person_id === personId);
}

/** "Owes you ₹1,200.00" or "You owe ₹500.00". */
export function balanceText(balance: Pick<PersonBalance, "amount" | "currency">): string {
  const money = formatMoney(Math.abs(balance.amount), balance.currency);
  return balance.amount > 0 ? `Owes you ${money}` : `You owe ${money}`;
}

export type CurrencyTotal = { currency: Currency; amount: number };

export type MoneySummary = {
  /** What everyone owes you, per currency. */
  owedToYou: CurrencyTotal[];
  /** What you owe, per currency, as positive amounts. */
  youOwe: CurrencyTotal[];
  /** People who owe you, most first, with what they owe in each currency. */
  owers: { person: Person; balances: PersonBalance[] }[];
  /** People you owe, most first. */
  owed: { person: Person; balances: PersonBalance[] }[];
};

function addTo(totals: Map<Currency, number>, currency: Currency, amount: number) {
  totals.set(currency, (totals.get(currency) ?? 0) + amount);
}

function sortedTotals(totals: Map<Currency, number>): CurrencyTotal[] {
  return [...totals]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => CURRENCIES.indexOf(a.currency) - CURRENCIES.indexOf(b.currency));
}

function largest(balances: readonly PersonBalance[]): number {
  return Math.max(...balances.map((balance) => Math.abs(balance.amount)));
}

/** People with the largest balance (in any currency) first. */
function byLargest<T extends { balances: PersonBalance[] }>(list: T[]): T[] {
  return list.sort((a, b) => largest(b.balances) - largest(a.balances));
}

/** Who owes whom, per currency. Currencies are never added together. */
export function moneySummary(people: readonly Person[], ledger: PersonLedger): MoneySummary {
  const owedToYou = new Map<Currency, number>();
  const youOwe = new Map<Currency, number>();
  const owers: MoneySummary["owers"] = [];
  const owed: MoneySummary["owed"] = [];
  for (const person of people) {
    const balances = balancesOf(ledger, person.id);
    const positive = balances.filter((balance) => balance.amount > 0);
    const negative = balances.filter((balance) => balance.amount < 0);
    for (const balance of positive) addTo(owedToYou, balance.currency, balance.amount);
    for (const balance of negative) addTo(youOwe, balance.currency, -balance.amount);
    if (positive.length > 0) owers.push({ person, balances: positive });
    if (negative.length > 0) owed.push({ person, balances: negative });
  }
  return {
    owedToYou: sortedTotals(owedToYou),
    youOwe: sortedTotals(youOwe),
    owers: byLargest(owers),
    owed: byLargest(owed),
  };
}

/** The expense this person's most recent share was split from, to suggest for a refund. */
export function lastSplitExpense(
  ledger: PersonLedger,
  personId: string,
  currency: Currency,
): PersonLedgerEntry["transaction"] {
  return (
    entriesOf(ledger, personId).find(
      (entry) =>
        entry.kind === "they_owe" && entry.currency === currency && entry.transaction !== null,
    )?.transaction ?? null
  );
}

/** Each transaction's shares: who it was split with, by transaction ID. */
export function splitsByTransaction(
  ledger: PersonLedger,
): ReadonlyMap<string, PersonLedgerEntry[]> {
  const splits = new Map<string, PersonLedgerEntry[]>();
  for (const entry of ledger.entries) {
    if (entry.kind !== "they_owe" || !entry.transaction) continue;
    const list = splits.get(entry.transaction.id) ?? [];
    list.push(entry);
    splits.set(entry.transaction.id, list);
  }
  return splits;
}

// The money form

export const moneySchema = object({
  personId: string().defined().required("Choose who it’s with."),
  kind: mixed<PersonLedgerKind>().oneOf(LEDGER_KINDS).defined(),
  amount: string().trim().defined().required("Enter an amount."),
  currency: mixed<Currency>().oneOf(CURRENCIES).defined(),
  occurredOn: string().defined().required("Choose a date."),
  description: singleLineText(LEDGER_DESCRIPTION_MAX_LENGTH).required("Say what it was for."),
  record: boolean().defined(),
  accountId: string()
    .defined()
    .when("record", {
      is: true,
      then: (schema) => schema.required("Choose an account."),
    }),
  categoryId: string()
    .defined()
    .when("record", {
      is: true,
      then: (schema) => schema.required("Choose a category."),
    }),
});

export type MoneyValues = InferType<typeof moneySchema>;

export function newMoneyValues(
  personId: string,
  kind: PersonLedgerKind = "they_owe",
  currency: Currency = DEFAULT_CURRENCY,
): MoneyValues {
  return {
    personId,
    kind,
    amount: "",
    currency,
    occurredOn: localDateString(),
    description: "",
    record: false,
    accountId: "",
    categoryId: "",
  };
}

/**
 * Settling up a balance: the repayment that clears it, suggesting the account and category of
 * the expense it came from so the refund lands where the spending did.
 */
export function settleValues(
  balance: Pick<PersonBalance, "amount" | "currency">,
  person: Pick<Person, "id" | "name">,
  suggested: PersonLedgerEntry["transaction"],
): MoneyValues {
  const theyPay = balance.amount > 0;
  return {
    ...newMoneyValues(person.id, theyPay ? "they_paid" : "i_paid", balance.currency),
    amount: toDecimalString(Math.abs(balance.amount), balance.currency),
    description: theyPay ? `${person.name} paid you back` : `Paid ${person.name} back`,
    record: suggested !== null,
    accountId: suggested?.account_id ?? "",
    categoryId: suggested?.category_id ?? "",
  };
}

export function ledgerRequestOf(
  values: MoneyValues,
  amount: number,
): CreatePersonLedgerEntryRequest {
  const record = values.record && isRepayment(values.kind);
  return {
    kind: values.kind,
    amount,
    currency: values.currency,
    occurred_on: values.occurredOn,
    description: values.description.trim(),
    transaction_id: null,
    record_in_finance: record
      ? { account_id: values.accountId, category_id: values.categoryId }
      : null,
  };
}

// Splitting an expense

export type SplitRow = { key: string; personId: string; amount: string };

/** An equal share for each person when the expense is split between them and you. */
export function equalShare(total: number, people: number): number {
  return people > 0 ? Math.floor(total / (people + 1)) : 0;
}

export type ParsedSplit = { personId: string; amount: number };

/**
 * The shares to record, or what's wrong with them: a missing person or amount, someone listed
 * twice, or shares (with those already recorded) above the expense.
 */
export function parseSplits(
  rows: readonly SplitRow[],
  parse: (text: string) => number | null,
  total: number,
  alreadyShared: number,
): { splits: ParsedSplit[] } | { error: string } {
  const splits: ParsedSplit[] = [];
  for (const row of rows) {
    if (!row.personId) return { error: "Choose who to split with, or remove the empty row." };
    const amount = parse(row.amount);
    if (amount === null || amount <= 0) return { error: "Enter each person’s share." };
    if (splits.some((split) => split.personId === row.personId)) {
      return { error: "Each person can appear once. Combine their shares." };
    }
    splits.push({ personId: row.personId, amount });
  }
  const shared = alreadyShared + splits.reduce((sum, split) => sum + split.amount, 0);
  if (shared > total) return { error: "The shares add up to more than the expense." };
  return { splits };
}
