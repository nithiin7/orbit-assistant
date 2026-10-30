import type { FinanceTransaction } from "@orbit/contracts";
import { describe, expect, it } from "vitest";

import {
  accountCurrencies,
  DEFAULT_TRANSACTION_FILTERS,
  formatMoney,
  parseAmount,
  parseSignedAmount,
  signedAmount,
  toDecimalString,
  toTransactionListQuery,
} from "./finance";

describe("parseAmount", () => {
  it.each([
    ["1250", 125_000],
    ["1,250.5", 125_050],
    ["1,00,000", 10_000_000],
    ["₹ 99.99", 9_999],
    ["0.10", 10],
    [".5", 50],
    ["  42. ", 4_200],
    ["100000000000", 10 ** 13],
  ])("reads %j as %i paise", (text, paise) => {
    expect(parseAmount(text, "INR")).toBe(paise);
  });

  it.each(["", "abc", "0", "0.00", "-5", "1.234", "1.2.3", "100000000000.01", "1e5"])(
    "rejects %j",
    (text) => {
      expect(parseAmount(text, "INR")).toBeNull();
    },
  );

  it("follows the currency's minor unit", () => {
    expect(parseAmount("1250", "JPY")).toBe(1250);
    expect(parseAmount("12.5", "JPY")).toBeNull();
  });

  it("adds without floating-point error", () => {
    // 0.1 + 0.2 !== 0.3 in floating point; in paise it is exact.
    const total = (parseAmount("0.10", "INR") ?? 0) + (parseAmount("0.20", "INR") ?? 0);
    expect(total).toBe(parseAmount("0.30", "INR"));
    expect(toDecimalString(total, "INR")).toBe("0.30");
  });
});

describe("parseSignedAmount", () => {
  it("allows blank, zero, and negative balances", () => {
    expect(parseSignedAmount("", "INR")).toBe(0);
    expect(parseSignedAmount("0.00", "INR")).toBe(0);
    expect(parseSignedAmount("-2,500.25", "INR")).toBe(-250_025);
    expect(parseSignedAmount("−5", "INR")).toBe(-500);
    expect(parseSignedAmount("--5", "INR")).toBeNull();
  });
});

describe("toDecimalString and formatMoney", () => {
  it.each([
    [0, "0.00"],
    [5, "0.05"],
    [-5, "-0.05"],
    [123_450, "1234.50"],
    [10 ** 13, "100000000000.00"],
  ])("writes %i paise as %j", (paise, text) => {
    expect(toDecimalString(paise, "INR")).toBe(text);
  });

  it("formats exact amounts with the currency", () => {
    expect(formatMoney(123_450, "INR")).toBe("₹1,234.50");
    expect(formatMoney(-5, "INR")).toBe("-₹0.05");
    expect(formatMoney(1_250, "JPY")).toBe("¥1,250");
    expect(formatMoney(100, "USD", { signDisplay: "always" })).toBe("+$1.00");
  });
});

describe("signedAmount", () => {
  const base: FinanceTransaction = {
    id: "t",
    workspace_id: "w",
    type: "transfer",
    amount: 500,
    currency: "INR",
    occurred_on: "2026-02-01",
    description: "ATM",
    category_id: null,
    account_id: "bank",
    to_account_id: "cash",
    notes: "",
    created_at: "2026-02-01T00:00:00Z",
    updated_at: "2026-02-01T00:00:00Z",
  };

  it("signs money in and out", () => {
    expect(signedAmount({ ...base, type: "income", to_account_id: null })).toBe(500);
    expect(signedAmount({ ...base, type: "refund", to_account_id: null })).toBe(500);
    expect(signedAmount({ ...base, type: "expense", to_account_id: null })).toBe(-500);
  });

  it("signs a transfer from the viewing account's side", () => {
    expect(signedAmount(base, "bank")).toBe(-500);
    expect(signedAmount(base, "cash")).toBe(500);
  });
});

describe("accountCurrencies", () => {
  it("puts the most used currency first", () => {
    const account = (currency: "INR" | "USD") =>
      ({ currency }) as Parameters<typeof accountCurrencies>[0][number];
    expect(accountCurrencies([account("USD"), account("INR"), account("USD")])).toEqual([
      "USD",
      "INR",
    ]);
    expect(accountCurrencies([account("USD"), account("INR")])).toEqual(["INR", "USD"]);
  });
});

describe("toTransactionListQuery", () => {
  it("sends only the filters in use, and pages by offset", () => {
    expect(toTransactionListQuery({ ...DEFAULT_TRANSACTION_FILTERS, page: 2 })).toEqual({
      sort: "date",
      limit: 50,
      offset: 100,
    });
    expect(
      toTransactionListQuery({
        ...DEFAULT_TRANSACTION_FILTERS,
        type: "expense",
        accountId: "a",
        from: "2026-02-01",
        to: "2026-02-28",
        search: "rent",
      }),
    ).toMatchObject({
      type: ["expense"],
      account_id: "a",
      date_from: "2026-02-01",
      date_to: "2026-02-28",
      q: "rent",
    });
  });

  it("ignores an end date before the start date", () => {
    const query = toTransactionListQuery({
      ...DEFAULT_TRANSACTION_FILTERS,
      from: "2026-03-01",
      to: "2026-02-01",
    });
    expect(query.date_to).toBeUndefined();
  });
});
