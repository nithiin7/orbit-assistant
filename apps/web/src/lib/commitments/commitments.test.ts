import type { PaymentItem } from "@orbit/contracts";
import { describe, expect, it } from "vitest";

import {
  formatRate,
  groupPayments,
  loanSchema,
  parseComponent,
  parseRate,
  paymentKey,
  paymentSchema,
  perPeriod,
  recurringSchema,
  splitUpcoming,
  toReminderRequest,
  totalsByCurrency,
} from "./commitments";

function item(overrides: Partial<PaymentItem>): PaymentItem {
  return {
    kind: "bill",
    commitment_id: "c1",
    occurrence_id: null,
    name: "Rent",
    counterparty: "",
    amount: 100,
    estimated: false,
    currency: "INR",
    due_date: "2026-02-01",
    status: "upcoming",
    account_id: null,
    paid_on: null,
    transaction_ids: [],
    principal: null,
    interest: null,
    ...overrides,
  };
}

describe("interest rates", () => {
  it("parses percent text into basis points without floats", () => {
    expect(parseRate("8.5")).toBe(850);
    expect(parseRate("8.50 %")).toBe(850);
    expect(parseRate("10")).toBe(1000);
    expect(parseRate("0.07")).toBe(7);
    expect(parseRate("100")).toBe(10_000);
    expect(parseRate(" 12.")).toBe(1200);
  });

  it("rejects rates that aren't rates", () => {
    for (const text of ["", "abc", "-1", "8.555", "100.01", "1,000", "8..5"]) {
      expect(parseRate(text)).toBeNull();
    }
  });

  it("formats basis points as percent text", () => {
    expect(formatRate(850)).toBe("8.5");
    expect(formatRate(865)).toBe("8.65");
    expect(formatRate(1000)).toBe("10");
    expect(formatRate(7)).toBe("0.07");
    expect(parseRate(formatRate(1234))).toBe(1234);
  });
});

describe("payments", () => {
  it("groups by status, with settled payments newest first", () => {
    const groups = groupPayments([
      item({ status: "overdue", due_date: "2026-01-01" }),
      item({ status: "paid", due_date: "2026-01-05", occurrence_id: "o1" }),
      item({ status: "due", due_date: "2026-01-10" }),
      item({ status: "skipped", due_date: "2026-01-08", occurrence_id: "o2" }),
      item({ status: "upcoming", due_date: "2026-01-20" }),
    ]);
    expect(groups.overdue).toHaveLength(1);
    expect(groups.dueToday).toHaveLength(1);
    expect(groups.upcoming).toHaveLength(1);
    expect(groups.settled.map((entry) => entry.due_date)).toEqual(["2026-01-08", "2026-01-05"]);
  });

  it("keys expected payments by date and settled ones by occurrence", () => {
    expect(paymentKey(item({}))).toBe("bill:c1:2026-02-01");
    expect(paymentKey(item({ occurrence_id: "o1" }))).toBe("bill:c1:o1");
  });

  it("never adds different currencies together", () => {
    expect(
      totalsByCurrency([
        item({ amount: 100 }),
        item({ amount: 250 }),
        item({ amount: 5, currency: "USD" }),
      ]),
    ).toEqual([
      ["INR", 350],
      ["USD", 5],
    ]);
  });

  it("describes periods and reminders", () => {
    expect(perPeriod("half_yearly")).toBe("/ 6 months");
    expect(toReminderRequest("", "09:00", "Asia/Kolkata")).toBeNull();
    expect(toReminderRequest("3", "", undefined)).toEqual({
      days_before: 3,
      time_of_day: "09:00",
      timezone: undefined,
    });
  });
});

describe("forms", () => {
  const loan = {
    name: "Car loan",
    lender: "SBI",
    loanType: "vehicle",
    currency: "INR",
    principal: "6,00,000",
    outstanding: "",
    rate: "9.25",
    interestMethod: "reducing",
    startDate: "2026-01-01",
    tenureMonths: "60",
    emiFrequency: "monthly",
    firstPaymentDate: "2026-02-05",
    nextPaymentDate: "",
    emi: "",
    paymentAccountId: "",
    notes: "",
    reminderDays: "3",
    reminderTime: "09:00",
  };

  it("accepts a valid loan and rejects inconsistent terms", async () => {
    await expect(loanSchema.validate(loan)).resolves.toBeTruthy();
    await expect(loanSchema.validate({ ...loan, rate: "101" })).rejects.toThrow(/rate/);
    await expect(
      loanSchema.validate({ ...loan, tenureMonths: "61", emiFrequency: "quarterly" }),
    ).rejects.toThrow(/whole installment periods/);
    await expect(loanSchema.validate({ ...loan, firstPaymentDate: "2025-12-01" })).rejects.toThrow(
      /before the start/,
    );
    await expect(loanSchema.validate({ ...loan, reminderDays: "31" })).rejects.toThrow(/days/);
    await expect(loanSchema.validate({ ...loan, emi: "12.345" })).rejects.toThrow(/amount/);
  });

  it("checks a subscription's dates against its next due date", async () => {
    const subscription = {
      kind: "subscription",
      name: "Netflix",
      provider: "",
      amount: "649",
      currency: "INR",
      amountVaries: false,
      frequency: "monthly",
      nextDueDate: "2026-03-15",
      startDate: "",
      endDate: "",
      trialEndsOn: "",
      autoRenew: true,
      categoryId: "",
      accountId: "",
      notes: "",
      reminderDays: "",
      reminderTime: "09:00",
    };
    await expect(recurringSchema.validate(subscription)).resolves.toBeTruthy();
    await expect(
      recurringSchema.validate({ ...subscription, startDate: "2026-04-01" }),
    ).rejects.toThrow(/start/);
    await expect(
      recurringSchema.validate({ ...subscription, endDate: "2026-03-01" }),
    ).rejects.toThrow(/end/);
  });
});

describe("payment form", () => {
  const base = {
    mode: "create",
    isLoan: true,
    currency: "INR",
    paidOn: "2026-02-05",
    accountId: "acc",
    amount: "",
    principal: "47,000",
    interest: "0",
    transactionId: "",
    interestTransactionId: "",
  };

  it("requires an account to create and a transaction to link", async () => {
    await expect(paymentSchema.validate(base)).resolves.toBeTruthy();
    await expect(paymentSchema.validate({ ...base, accountId: "" })).rejects.toThrow(/account/);
    await expect(paymentSchema.validate({ ...base, mode: "link", accountId: "" })).rejects.toThrow(
      /at least one transaction/,
    );
    await expect(
      paymentSchema.validate({ ...base, mode: "link", accountId: "", transactionId: "t1" }),
    ).resolves.toBeTruthy();
  });

  it("parses principal and interest, where zero is allowed", () => {
    expect(parseComponent("", "INR")).toBe(0);
    expect(parseComponent("0.00", "INR")).toBe(0);
    expect(parseComponent("6,000.50", "INR")).toBe(600_050);
    expect(parseComponent("1.234", "INR")).toBeNull();
  });
});

describe("splitUpcoming", () => {
  it("separates the next seven days from later payments", () => {
    const { soon, later } = splitUpcoming(
      [
        item({ due_date: "2026-02-02" }),
        item({ due_date: "2026-02-08" }),
        item({ due_date: "2026-02-09" }),
      ],
      "2026-02-01",
    );
    expect(soon.map((entry) => entry.due_date)).toEqual(["2026-02-02", "2026-02-08"]);
    expect(later.map((entry) => entry.due_date)).toEqual(["2026-02-09"]);
  });
});
