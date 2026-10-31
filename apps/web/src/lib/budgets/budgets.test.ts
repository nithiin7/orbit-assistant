import type { Budget } from "@orbit/contracts";
import { describe, expect, it } from "vitest";

import {
  barWidth,
  budgetDefaults,
  budgetSchema,
  type BudgetValues,
  monthOptions,
  parseThresholds,
  toCreateBudget,
  toUpdateBudget,
  wholePercent,
} from "./budgets";

const STAMP = "2026-02-01T09:00:00Z";

function values(overrides: Partial<BudgetValues> = {}): BudgetValues {
  return {
    ...budgetDefaults("2026-02"),
    name: "Groceries",
    categoryId: "cat-groceries",
    amount: "10,000",
    ...overrides,
  };
}

const budget: Budget = {
  id: "b-1",
  workspace_id: "w-1",
  name: "Groceries",
  scope: "category",
  category_id: "cat-groceries",
  currency: "INR",
  amount: 1_000_000,
  period: "monthly",
  start_date: "2026-01-01",
  end_date: null,
  recurring: true,
  rollover: "none",
  alerts_enabled: true,
  alert_thresholds: [50, 75, 90, 100],
  state: "active",
  status: "active",
  notes: "",
  archived_at: null,
  created_at: STAMP,
  updated_at: STAMP,
  current_period: null,
};

describe("thresholds", () => {
  it("parses whole percentages, sorted and without duplicates", () => {
    expect(parseThresholds("90, 50 75%,50")).toEqual([50, 75, 90]);
    expect(parseThresholds("")).toEqual([]);
    expect(parseThresholds("120")).toEqual([120]);
  });

  it("rejects decimals, out-of-range values, and too many", () => {
    expect(parseThresholds("50.5")).toBeNull();
    expect(parseThresholds("0")).toBeNull();
    expect(parseThresholds("201")).toBeNull();
    expect(parseThresholds("10 20 30 40 50 60 70")).toBeNull();
    expect(parseThresholds("half")).toBeNull();
  });
});

describe("bar widths", () => {
  it("clamps the API's percentage text for display", () => {
    expect(barWidth("87.50")).toBe(87.5);
    expect(barWidth("142.00")).toBe(100);
    expect(barWidth(null)).toBe(0);
    expect(wholePercent("33.33")).toBe(33);
  });
});

describe("month options", () => {
  it("spans a year back and two ahead, across year ends", () => {
    const months = monthOptions("2026-02");
    expect(months[0]).toBe("2025-02");
    expect(months.at(-1)).toBe("2028-02");
    expect(months).toContain("2027-01");
  });
});

describe("budget requests", () => {
  it("sends a monthly budget as whole months in minor units", () => {
    expect(toCreateBudget(values())).toEqual({
      name: "Groceries",
      scope: "category",
      category_id: "cat-groceries",
      currency: "INR",
      amount: 1_000_000,
      period: "monthly",
      start_date: "2026-02-01",
      end_date: null,
      rollover: "none",
      alerts_enabled: true,
      alert_thresholds: [50, 75, 90, 100],
      notes: "",
    });
    // Until a month ends on its last day, in a leap year too.
    expect(toCreateBudget(values({ startMonth: "2028-01", endMonth: "2028-02" }))).toMatchObject({
      start_date: "2028-01-01",
      end_date: "2028-02-29",
    });
  });

  it("sends custom dates as they are, never with rollover", () => {
    const body = toCreateBudget(
      values({
        scope: "overall",
        period: "custom",
        startDate: "2026-03-10",
        endDate: "2026-03-24",
        rollover: "surplus",
      }),
    );
    expect(body).toMatchObject({
      scope: "overall",
      category_id: null,
      start_date: "2026-03-10",
      end_date: "2026-03-24",
      rollover: "none",
    });
  });

  it("sends only what changed", () => {
    const edited = { ...budgetDefaults("2026-02", budget), amount: "12,000", thresholds: "80" };
    expect(toUpdateBudget(edited, budget)).toEqual({ amount: 1_200_000, alert_thresholds: [80] });
    expect(toUpdateBudget(budgetDefaults("2026-02", budget), budget)).toEqual({});
    expect(
      toUpdateBudget({ ...budgetDefaults("2026-02", budget), endMonth: "2026-06" }, budget),
    ).toEqual({ end_date: "2026-06-30" });
  });
});

describe("budget form", () => {
  it("needs a category for category budgets", async () => {
    await expect(budgetSchema.validate(values({ categoryId: "" }))).rejects.toThrow(
      "Choose a category.",
    );
    await expect(
      budgetSchema.validate(values({ scope: "overall", categoryId: "" })),
    ).resolves.toBeTruthy();
  });

  it("checks dates and thresholds", async () => {
    await expect(
      budgetSchema.validate(
        values({ period: "custom", startDate: "2026-03-10", endDate: "2026-03-01" }),
      ),
    ).rejects.toThrow("Choose a last day on or after the first.");
    await expect(
      budgetSchema.validate(values({ startMonth: "2026-05", endMonth: "2026-04" })),
    ).rejects.toThrow("The last month can’t be before the first.");
    await expect(budgetSchema.validate(values({ thresholds: "50, 300" }))).rejects.toThrow(
      /percentages from 1 to 200/,
    );
    await expect(budgetSchema.validate(values({ amount: "12.345" }))).rejects.toThrow(
      /Enter an amount/,
    );
  });
});
