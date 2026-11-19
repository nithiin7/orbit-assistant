"use client";

import type { Currency, FinanceAccount, FinanceCategory } from "@orbit/contracts";

import { Badge } from "@/components/ui/badge";
import { Select, type SelectItems } from "@/components/ui/select";
import {
  formatMoney,
  isLocked,
  REASON_LABELS,
  type ReviewRow,
  type RowChoice,
} from "@/lib/finance";
import { cn } from "@/utils/common";

type StatementReviewProps = {
  rows: readonly ReviewRow[];
  currency: Currency;
  categories: readonly FinanceCategory[];
  /** Accounts a row can be a transfer to or from. */
  otherAccounts: readonly FinanceAccount[];
  onChange: (index: number, change: Partial<ReviewRow>) => void;
};

function choicesFor({ row }: ReviewRow): SelectItems<RowChoice> {
  const add = row.direction === "out" ? "Add as spending" : "Add as income";
  return [
    { value: "create", label: add },
    ...(row.payment && row.reason === "payment_due"
      ? [{ value: "settle" as const, label: `Mark “${row.payment.name}” paid` }]
      : []),
    { value: "transfer", label: "Transfer between my accounts" },
    { value: "skip", label: "Skip" },
  ];
}

function categoriesFor(
  { row }: ReviewRow,
  categories: readonly FinanceCategory[],
): SelectItems<string> {
  const option = (category: FinanceCategory) => ({ value: category.id, label: category.name });
  const expense = categories.filter((category) => category.type === "expense").map(option);
  if (row.direction === "out") return [{ value: "", label: "No category" }, ...expense];
  return [
    { value: "", label: "No category" },
    {
      label: "Income",
      options: categories.filter((category) => category.type === "income").map(option),
    },
    { label: "Refund of spending", options: expense },
  ];
}

/** Every statement row with what will happen to it, which the person can change. */
export function StatementReview({
  rows,
  currency,
  categories,
  otherAccounts,
  onChange,
}: StatementReviewProps) {
  const accountOptions: SelectItems<string> = otherAccounts.map((account) => ({
    value: account.id,
    label: account.name,
  }));

  return (
    <ul aria-label="Statement rows" className="divide-y rounded-lg border">
      {rows.map((entry, index) => {
        const { row, choice } = entry;
        const locked = isLocked(row);
        const label = `${row.occurred_on} ${row.description}`;
        return (
          <li
            key={row.fingerprint}
            className={cn(
              "grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto]",
              choice === "skip" && "bg-muted/40",
            )}
          >
            <div className="min-w-0 space-y-1">
              <p className="truncate text-sm font-medium" title={row.description}>
                {row.description}
              </p>
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{row.occurred_on}</span>
                <Badge variant={row.reason === "new" ? "outline" : "default"}>
                  {REASON_LABELS[row.reason]}
                </Badge>
              </p>
            </div>
            <p
              className={cn(
                "text-sm font-semibold tabular-nums sm:text-right",
                row.direction === "in" && "text-success",
              )}
            >
              {row.direction === "in" ? "+" : "−"}
              {formatMoney(row.amount, currency, { signDisplay: "never" })}
            </p>
            {locked ? (
              <p className="text-xs text-destructive sm:col-span-2">
                Orbit couldn’t check this row against the statement’s balance, so it won’t be
                imported. Add it by hand if it’s right.
              </p>
            ) : (
              <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row">
                <Select
                  aria-label={`What to do with ${label}`}
                  className="sm:w-60"
                  value={choice}
                  onValueChange={(value) => onChange(index, { choice: value })}
                  options={choicesFor(entry)}
                />
                {choice === "create" ? (
                  <Select
                    aria-label={`Category for ${label}`}
                    className="sm:w-56"
                    value={entry.categoryId}
                    onValueChange={(value) => onChange(index, { categoryId: value })}
                    options={categoriesFor(entry, categories)}
                  />
                ) : choice === "transfer" ? (
                  <Select
                    aria-label={`${row.direction === "out" ? "To" : "From"} account for ${label}`}
                    className="sm:w-56"
                    placeholder={row.direction === "out" ? "To account…" : "From account…"}
                    value={entry.toAccountId}
                    onValueChange={(value) => onChange(index, { toAccountId: value })}
                    options={accountOptions}
                  />
                ) : null}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
