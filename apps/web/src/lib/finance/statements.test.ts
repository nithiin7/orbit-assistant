import type { FinanceCategory, StatementRow } from "@orbit/contracts";
import { describe, expect, it } from "vitest";

import {
  columnChoice,
  encodePassword,
  mappingProblem,
  reviewProblem,
  type ReviewRow,
  toImportRows,
  toReviewRows,
} from "./statements";

const STAMP = "2026-10-01T09:00:00Z";
const dining: FinanceCategory = {
  id: "cat-dining",
  workspace_id: "ws",
  name: "Food and dining",
  type: "expense",
  is_default: true,
  created_at: STAMP,
  updated_at: STAMP,
};

function row(overrides: Partial<StatementRow> = {}): StatementRow {
  return {
    fingerprint: "f".repeat(64),
    line: 1,
    occurred_on: "2026-10-01",
    description: "SWIGGY",
    amount: 100,
    direction: "out",
    balance: null,
    action: "create",
    reason: "new",
    type: "expense",
    category_id: null,
    payment: null,
    duplicate_of: null,
    ...overrides,
  };
}

function review(statementRow: StatementRow, changes: Partial<ReviewRow> = {}): ReviewRow {
  return {
    row: statementRow,
    choice: statementRow.action,
    categoryId: statementRow.category_id ?? "",
    toAccountId: "",
    ...changes,
  };
}

describe("toImportRows", () => {
  it("leaves out skipped rows and rows the balance contradicts", () => {
    const rows = toReviewRows([
      row({ action: "skip", reason: "possible_duplicate" }),
      row({ reason: "balance_mismatch" }),
    ]);
    expect(toImportRows(rows, [dining])).toEqual([]);
  });

  it("files money back from a spending category as a refund", () => {
    const rows = [review(row({ direction: "in" }), { categoryId: dining.id })];
    expect(toImportRows(rows, [dining])).toMatchObject([
      { action: "create", type: "refund", category_id: dining.id },
    ]);
  });

  it("sends a transfer's other account and a payment's target", () => {
    const payment = {
      kind: "bill" as const,
      commitment_id: "bill-1",
      occurrence_id: null,
      due_date: "2026-10-05",
      name: "Electricity",
    };
    const rows = [
      review(row({ fingerprint: "a".repeat(64) }), { choice: "transfer", toAccountId: "acc-2" }),
      review(
        row({ fingerprint: "b".repeat(64), action: "settle", reason: "payment_due", payment }),
      ),
    ];
    expect(toImportRows(rows, [])).toMatchObject([
      { action: "transfer", to_account_id: "acc-2" },
      {
        action: "settle",
        settle: {
          kind: "bill",
          commitment_id: "bill-1",
          occurrence_id: null,
          due_date: "2026-10-05",
        },
      },
    ]);
  });

  it("asks for the other account of a transfer", () => {
    expect(reviewProblem([review(row(), { choice: "transfer" })])).toMatch(/other account/);
  });
});

describe("mappingProblem", () => {
  it("needs a date, a description, and amounts in distinct columns", () => {
    const empty = columnChoice(null);
    expect(mappingProblem(empty)).toMatch(/date and description/);
    expect(mappingProblem({ ...empty, date: "0", description: "1" })).toMatch(/amount column/);
    expect(mappingProblem({ ...empty, date: "0", description: "1", amount: "1" })).toMatch(
      /different column/,
    );
    expect(mappingProblem({ ...empty, date: "0", description: "1", amount: "2" })).toBeNull();
  });
});

describe("encodePassword", () => {
  it("encodes UTF-8 as base64", () => {
    expect(encodePassword("AB12")).toBe("QUIxMg==");
    expect(encodePassword("₹")).toBe("4oK5");
  });
});
