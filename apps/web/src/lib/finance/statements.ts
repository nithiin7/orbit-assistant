import type {
  FinanceCategory,
  FinanceTransactionType,
  ImportStatementRow,
  StatementColumns,
  StatementRow,
} from "@orbit/contracts";
import { mixed, object, string } from "yup";

/** What the person chose for one statement row in review. */
export type RowChoice = "create" | "skip" | "settle" | "transfer";

export type ReviewRow = {
  row: StatementRow;
  choice: RowChoice;
  categoryId: string;
  /** The other account, for a transfer. */
  toAccountId: string;
};

/** Rows whose balance or amount didn't add up stay skipped: they can't be imported by mistake. */
export function isLocked(row: StatementRow): boolean {
  return row.reason === "balance_mismatch" || row.reason === "unreadable_amount";
}

export const REASON_LABELS: Record<StatementRow["reason"], string> = {
  new: "New",
  already_imported: "Imported before",
  possible_duplicate: "Already in Orbit",
  recorded_payment: "Payment already recorded",
  payment_due: "Pays a bill or EMI",
  balance_mismatch: "Balance doesn’t add up",
  unreadable_amount: "Amount unreadable",
};

export function toReviewRows(rows: readonly StatementRow[]): ReviewRow[] {
  return rows.map((row) => ({
    row,
    choice: row.action,
    categoryId: row.category_id ?? "",
    toAccountId: "",
  }));
}

/** Money in filed under a spending category is a refund; otherwise it's income. */
export function transactionTypeFor(
  row: StatementRow,
  category: FinanceCategory | undefined,
): FinanceTransactionType {
  if (row.direction === "out") return "expense";
  return category?.type === "expense" ? "refund" : "income";
}

/** The rows to send: everything not skipped, as the API expects it. */
export function toImportRows(
  rows: readonly ReviewRow[],
  categories: readonly FinanceCategory[],
): ImportStatementRow[] {
  return rows.flatMap(({ row, choice, categoryId, toAccountId }): ImportStatementRow[] => {
    if (choice === "skip" || isLocked(row)) return [];
    const category = categories.find((entry) => entry.id === categoryId);
    const base = {
      fingerprint: row.fingerprint,
      occurred_on: row.occurred_on,
      description: row.description,
      amount: row.amount,
      direction: row.direction,
      type: transactionTypeFor(row, undefined),
      category_id: null,
      to_account_id: null,
      settle: null,
    };
    if (choice === "transfer") {
      return [{ ...base, action: "transfer", to_account_id: toAccountId }];
    }
    if (choice === "settle" && row.payment) {
      const { kind, commitment_id, occurrence_id, due_date } = row.payment;
      return [
        { ...base, action: "settle", settle: { kind, commitment_id, occurrence_id, due_date } },
      ];
    }
    return [
      {
        ...base,
        action: "create",
        type: transactionTypeFor(row, category),
        category_id: category ? category.id : null,
      },
    ];
  });
}

/** Problems that stop the import, written for the person. */
export function reviewProblem(rows: readonly ReviewRow[]): string | null {
  if (rows.some((entry) => entry.choice === "transfer" && !entry.toAccountId)) {
    return "Choose the other account for each transfer.";
  }
  return null;
}

/** Text in a header, base64-encoded as UTF-8, as the API expects a PDF's password. */
export function encodePassword(password: string): string {
  const bytes = new TextEncoder().encode(password);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export const MAX_STATEMENT_BYTES = 5 * 1024 * 1024;

export const statementFileSchema = object({
  accountId: string().required("Choose the account this statement is for."),
  file: mixed<File>()
    .required("Choose a statement file.")
    .test(
      "size",
      "Statements must be at most 5 MB.",
      (file) => !file || file.size <= MAX_STATEMENT_BYTES,
    ),
});

export const statementPasswordSchema = object({
  password: string().required("Enter the PDF’s password."),
});

/** The fields a statement's columns can be mapped to, in the order the form shows them. */
export const COLUMN_FIELDS = [
  { key: "date", label: "Date", required: true },
  { key: "description", label: "Description", required: true },
  { key: "withdrawal", label: "Money out (withdrawals)", required: false },
  { key: "deposit", label: "Money in (deposits)", required: false },
  { key: "amount", label: "Amount (one signed column)", required: false },
  { key: "direction", label: "Debit or credit marker", required: false },
  { key: "balance", label: "Balance", required: false },
] as const satisfies readonly { key: keyof StatementColumns; label: string; required: boolean }[];

export type ColumnChoice = Record<keyof StatementColumns, string>;

export function columnChoice(columns: StatementColumns | null | undefined): ColumnChoice {
  const value = (position: number | null | undefined) => (position == null ? "" : String(position));
  return {
    date: value(columns?.date),
    description: value(columns?.description),
    withdrawal: value(columns?.withdrawal),
    deposit: value(columns?.deposit),
    amount: value(columns?.amount),
    direction: value(columns?.direction),
    balance: value(columns?.balance),
  };
}

/** A problem with a column mapping, or `null` when the API can read the statement with it. */
export function mappingProblem(choice: ColumnChoice): string | null {
  if (!choice.date || !choice.description) return "Choose the date and description columns.";
  const separate = choice.withdrawal !== "" && choice.deposit !== "";
  if (!separate && !choice.amount) {
    return "Choose the amount column, or both the money out and money in columns.";
  }
  const chosen = Object.values(choice).filter(Boolean);
  if (new Set(chosen).size !== chosen.length) return "Choose a different column for each field.";
  return null;
}
