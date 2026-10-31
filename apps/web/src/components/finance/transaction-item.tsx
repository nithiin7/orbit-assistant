"use client";

import type { FinanceAccount, FinanceCategory, FinanceTransaction } from "@orbit/contracts";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";

import { formatMoney, signedAmount, transactionTypeLabel } from "@/lib/finance";
import { cn } from "@/utils/common";
import { formatCalendarDate } from "@/utils/dates";

import { RowActions } from "./row-actions";

type TransactionItemProps = {
  transaction: FinanceTransaction;
  accounts: ReadonlyMap<string, FinanceAccount>;
  categories: ReadonlyMap<string, FinanceCategory>;
  /** Show transfers from this account's side: money in or out of it. */
  accountId?: string;
  /** Leave the date out where the list is already grouped by day. */
  showDate?: boolean;
  pending?: boolean;
  onEdit: (transaction: FinanceTransaction) => void;
  /** Omit to hide the delete action. */
  onDelete?: (transaction: FinanceTransaction) => Promise<void>;
};

const ICONS = {
  income: ArrowDownLeft,
  refund: RotateCcw,
  expense: ArrowUpRight,
  transfer: ArrowLeftRight,
} as const;

const ICON_TONES = {
  income: "bg-success/10 text-success",
  refund: "bg-success/10 text-success",
  expense: "bg-muted text-muted-foreground",
  transfer: "bg-brand-subtle text-brand",
} as const;

export function TransactionItem({
  transaction,
  accounts,
  categories,
  accountId,
  showDate = true,
  pending = false,
  onEdit,
  onDelete,
}: TransactionItemProps) {
  const Icon = ICONS[transaction.type];
  const amount = signedAmount(transaction, accountId);
  const neutral = transaction.type === "transfer" && accountId === undefined;
  const from = accounts.get(transaction.account_id)?.name ?? "Unknown account";
  const to = transaction.to_account_id
    ? (accounts.get(transaction.to_account_id)?.name ?? "Unknown account")
    : null;
  const category = transaction.category_id ? categories.get(transaction.category_id) : undefined;

  return (
    <li
      className={cn(
        "group flex items-center gap-3 px-3 py-2.5 transition-[background-color,opacity] duration-150 hover:bg-accent/40 @md/rows:px-4",
        pending && "opacity-70",
      )}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          ICON_TONES[transaction.type],
        )}
        aria-hidden="true"
      >
        <Icon className="size-4" />
      </span>

      <div className="min-w-0 flex-1 space-y-0.5">
        <button
          type="button"
          onClick={() => onEdit(transaction)}
          aria-label={`Edit “${transaction.description}”`}
          className="block max-w-full truncate rounded-sm text-left text-sm font-medium outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-ring"
        >
          {transaction.description}
        </button>
        <p className="flex min-w-0 gap-x-1.5 text-xs text-muted-foreground">
          {showDate ? (
            <>
              <span className="shrink-0">{formatCalendarDate(transaction.occurred_on)}</span>
              <span aria-hidden="true">·</span>
            </>
          ) : null}
          <span className="shrink-0">
            {category?.name ?? transactionTypeLabel(transaction.type)}
          </span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{to ? `${from} → ${to}` : from}</span>
        </p>
      </div>

      <span
        className={cn(
          "shrink-0 text-right text-sm font-medium whitespace-nowrap tabular-nums",
          amount > 0 && !neutral && "text-success",
        )}
      >
        <span className="sr-only">{transactionTypeLabel(transaction.type)}: </span>
        {formatMoney(amount, transaction.currency, {
          signDisplay: neutral ? "never" : "always",
        })}
      </span>

      {onDelete ? (
        <RowActions
          name={transaction.description}
          disabled={pending}
          // Revealed on hover or focus where there is a mouse; always there on touch screens.
          className="pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100"
          actions={[
            { id: "edit", label: "Edit", icon: Pencil, onSelect: () => onEdit(transaction) },
            {
              id: "delete",
              label: "Delete",
              icon: Trash2,
              destructive: true,
              confirm: {
                prompt: `Delete “${transaction.description}”?`,
                choices: [
                  { label: "Delete", destructive: true, onConfirm: () => onDelete(transaction) },
                ],
              },
            },
          ]}
        />
      ) : null}
    </li>
  );
}
