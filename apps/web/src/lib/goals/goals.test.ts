import type { FinanceAccount } from "@orbit/contracts";
import { describe, expect, it } from "vitest";

import { contributionSchema, goalSchema, savingsAccounts } from "./goals";

const STAMP = "2026-02-01T09:00:00Z";

function account(overrides: Partial<FinanceAccount>): FinanceAccount {
  return {
    id: "acc",
    workspace_id: "w-1",
    name: "Account",
    type: "bank",
    account_class: "asset",
    currency: "INR",
    opening_balance: 0,
    balance: 0,
    notes: "",
    archived: false,
    archived_at: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

describe("savings accounts", () => {
  it("offers active asset accounts in the goal's currency, not investments, cards, or loans", () => {
    const accounts = [
      account({ id: "bank" }),
      account({ id: "savings", type: "savings" }),
      account({ id: "broker", type: "investment" }),
      account({ id: "card", type: "credit_card", account_class: "liability" }),
      account({ id: "loan", type: "loan", account_class: "liability" }),
      account({ id: "usd", currency: "USD" }),
      account({ id: "old", archived: true }),
    ];
    expect(savingsAccounts(accounts, "INR").map((entry) => entry.id)).toEqual(["bank", "savings"]);
  });
});

const contribution = {
  type: "contribution" as const,
  mode: "allocate" as const,
  currency: "INR" as const,
  amount: "5,000",
  occurredOn: "2026-02-10",
  accountId: "",
  transactionId: "",
  notes: "",
};

describe("contribution form", () => {
  it("asks for what each way of saving needs", async () => {
    await expect(contributionSchema.validate(contribution)).resolves.toBeTruthy();
    await expect(contributionSchema.validate({ ...contribution, amount: "" })).rejects.toThrow(
      "Enter an amount.",
    );
    await expect(
      contributionSchema.validate({ ...contribution, mode: "transfer" }),
    ).rejects.toThrow("Choose an account.");
    await expect(
      contributionSchema.validate({ ...contribution, mode: "link", amount: "" }),
    ).rejects.toThrow("Choose a transfer.");
    await expect(
      contributionSchema.validate({
        ...contribution,
        mode: "link",
        amount: "",
        transactionId: "t",
      }),
    ).resolves.toBeTruthy();
  });
});

describe("goal form", () => {
  it("keeps the target date on or after the start", async () => {
    const goal = {
      name: "Car",
      description: "",
      category: "vehicle" as const,
      priority: "medium" as const,
      currency: "INR" as const,
      targetAmount: "5,00,000",
      startDate: "2026-02-01",
      targetDate: "2026-01-31",
      accountId: "",
      notes: "",
    };
    await expect(goalSchema.validate(goal)).rejects.toThrow(
      "The target date can’t be before the start.",
    );
    await expect(goalSchema.validate({ ...goal, targetDate: "" })).resolves.toBeTruthy();
  });
});
