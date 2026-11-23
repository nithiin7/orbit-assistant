import type { Person, PersonLedger, PersonLedgerEntry } from "@orbit/contracts";
import { describe, expect, it } from "vitest";

import { parseAmount } from "@/lib/finance";

import {
  balanceText,
  entryHeadline,
  equalShare,
  lastSplitExpense,
  ledgerRequestOf,
  moneySummary,
  parseSplits,
  settleValues,
  signedAmount,
  splitsByTransaction,
} from "./money";

function person(id: string, name: string): Person {
  return {
    id,
    name,
    relationship: "friend",
    phone: "",
    email: "",
    note: "",
    favorite: false,
    dates: [],
    reminder_time: "09:00:00",
    timezone: "UTC",
    created_at: "2030-01-01T00:00:00Z",
    updated_at: "2030-01-01T00:00:00Z",
  };
}

const DINNER = {
  id: "t1",
  type: "expense",
  description: "Dinner",
  amount: 100_000,
  occurred_on: "2030-02-10",
  account_id: "bank",
  category_id: "food",
};

function entry(overrides: Partial<PersonLedgerEntry>): PersonLedgerEntry {
  return {
    id: "e",
    person_id: "a",
    kind: "they_owe",
    amount: 50_000,
    currency: "INR",
    occurred_on: "2030-02-10",
    description: "Dinner",
    transaction: null,
    created_at: "2030-02-10T00:00:00Z",
    updated_at: "2030-02-10T00:00:00Z",
    ...overrides,
  };
}

const LEDGER: PersonLedger = {
  entries: [
    entry({ id: "e1", transaction: DINNER }),
    entry({ id: "e2", person_id: "b", kind: "i_owe", amount: 30_000 }),
    entry({ id: "e3", person_id: "b", kind: "i_owe", amount: 700, currency: "USD" }),
  ],
  balances: [
    { person_id: "a", currency: "INR", amount: 50_000 },
    { person_id: "b", currency: "INR", amount: -30_000 },
    { person_id: "b", currency: "USD", amount: -700 },
  ],
};

describe("money owed", () => {
  it("signs entries and describes them from your side", () => {
    expect(signedAmount({ kind: "they_owe", amount: 5 })).toBe(5);
    expect(signedAmount({ kind: "they_paid", amount: 5 })).toBe(-5);
    expect(entryHeadline({ kind: "i_paid" }, "Sam")).toBe("You paid Sam back");
    expect(balanceText({ amount: 120_000, currency: "INR" })).toBe("Owes you ₹1,200.00");
    expect(balanceText({ amount: -50_000, currency: "INR" })).toBe("You owe ₹500.00");
  });

  it("totals per currency and lists who owes whom", () => {
    const summary = moneySummary([person("a", "Priya"), person("b", "Sam")], LEDGER);
    expect(summary.owedToYou).toEqual([{ currency: "INR", amount: 50_000 }]);
    expect(summary.youOwe).toEqual([
      { currency: "INR", amount: 30_000 },
      { currency: "USD", amount: 700 },
    ]);
    expect(summary.owers.map((row) => row.person.name)).toEqual(["Priya"]);
    expect(summary.owed[0]?.balances).toHaveLength(2);
  });

  it("settles up with a refund where the shared expense was", () => {
    const suggested = lastSplitExpense(LEDGER, "a", "INR");
    expect(suggested?.id).toBe("t1");
    const values = settleValues(
      { amount: 50_000, currency: "INR" },
      person("a", "Priya"),
      suggested,
    );
    expect(values).toMatchObject({
      personId: "a",
      kind: "they_paid",
      amount: "500.00",
      description: "Priya paid you back",
      record: true,
      accountId: "bank",
      categoryId: "food",
    });
    expect(ledgerRequestOf(values, 50_000).record_in_finance).toEqual({
      account_id: "bank",
      category_id: "food",
    });
    // Without a shared expense, it stays in People unless chosen.
    const plain = settleValues({ amount: -30_000, currency: "INR" }, person("b", "Sam"), null);
    expect(plain).toMatchObject({ kind: "i_paid", record: false, description: "Paid Sam back" });
    expect(ledgerRequestOf(plain, 30_000).record_in_finance).toBeNull();
  });

  it("knows each expense's shares", () => {
    expect(
      splitsByTransaction(LEDGER)
        .get("t1")
        ?.map((e) => e.id),
    ).toEqual(["e1"]);
  });
});

describe("splitting an expense", () => {
  const parse = (text: string) => parseAmount(text, "INR");

  it("shares equally with you included", () => {
    expect(equalShare(100_000, 1)).toBe(50_000);
    expect(equalShare(100_000, 2)).toBe(33_333);
  });

  it("checks people, amounts, and the total", () => {
    const row = (personId: string, amount: string) => ({ key: personId, personId, amount });
    expect(parseSplits([row("a", "400")], parse, 100_000, 50_000)).toEqual({
      splits: [{ personId: "a", amount: 40_000 }],
    });
    expect(parseSplits([row("a", "600")], parse, 100_000, 50_000)).toEqual({
      error: "The shares add up to more than the expense.",
    });
    expect(parseSplits([row("", "1")], parse, 100_000, 0)).toEqual({
      error: "Choose who to split with, or remove the empty row.",
    });
    expect(parseSplits([row("a", "")], parse, 100_000, 0)).toEqual({
      error: "Enter each person’s share.",
    });
    expect(parseSplits([row("a", "1"), row("a", "2")], parse, 100_000, 0)).toMatchObject({
      error: expect.stringContaining("once"),
    });
  });
});
