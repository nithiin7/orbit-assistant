"use client";

import type { FinanceAccount, FinanceCategory, FinanceTransaction } from "@orbit/contracts";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatMoney, signedAmount, transactionTypeLabel } from "@/lib/finance";
import { cn } from "@/utils/common";
import { formatCalendarDate } from "@/utils/dates";

type TransactionItemProps = {
  transaction: FinanceTransaction;
  accounts: ReadonlyMap<string, FinanceAccount>;
  categories: ReadonlyMap<string, FinanceCategory>;
  /** Show transfers from this account's side: money in or out of it. */
  accountId?: string;
  pending?: boolean;
  onEdit: (transaction: FinanceTransaction) => void;
  /** Omit to hide the delete control. */
  onDelete?: (transaction: FinanceTransaction) => Promise<void>;
};

const ICONS = {
  income: ArrowDownLeft,
  refund: RotateCcw,
  expense: ArrowUpRight,
  transfer: ArrowLeftRight,
} as const;

export function TransactionItem({
  transaction,
  accounts,
  categories,
  accountId,
  pending = false,
  onEdit,
  onDelete,
}: TransactionItemProps) {
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const Icon = ICONS[transaction.type];
  const amount = signedAmount(transaction, accountId);
  const neutral = transaction.type === "transfer" && accountId === undefined;
  const from = accounts.get(transaction.account_id)?.name ?? "Unknown account";
  const to = transaction.to_account_id
    ? (accounts.get(transaction.to_account_id)?.name ?? "Unknown account")
    : null;
  const category = transaction.category_id ? categories.get(transaction.category_id) : undefined;

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  const cancelDelete = () => {
    setConfirming(false);
    requestAnimationFrame(() => deleteRef.current?.focus());
  };

  return (
    <li
      className={cn(
        "flex items-center gap-3 px-3 py-3 transition-colors duration-150 hover:bg-accent/40 sm:px-4",
        pending && "opacity-70",
      )}
    >
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-full border bg-muted/60 text-muted-foreground"
        aria-hidden="true"
      >
        <Icon className="size-4" />
      </span>

      <div className="min-w-0 flex-1 space-y-0.5">
        <button
          type="button"
          onClick={() => onEdit(transaction)}
          aria-label={`Edit “${transaction.description}”`}
          className="block max-w-full truncate rounded-sm text-left text-sm font-medium outline-none hover:underline hover:decoration-muted-foreground/50 hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring"
        >
          {transaction.description}
        </button>
        <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
          <span>{formatCalendarDate(transaction.occurred_on)}</span>
          <span aria-hidden="true">·</span>
          <span>{category?.name ?? transactionTypeLabel(transaction.type)}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{to ? `${from} → ${to}` : from}</span>
        </p>
      </div>

      <span
        className={cn(
          "shrink-0 text-right text-sm font-medium tabular-nums",
          amount > 0 && !neutral && "text-success",
        )}
      >
        <span className="sr-only">{transactionTypeLabel(transaction.type)}: </span>
        {formatMoney(amount, transaction.currency, {
          signDisplay: neutral ? "never" : "always",
        })}
      </span>

      {onDelete ? (
        <div className="flex shrink-0 items-center gap-1">
          {confirming ? (
            <div
              role="group"
              aria-label={`Delete “${transaction.description}”?`}
              className="flex items-center gap-1"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  cancelDelete();
                }
              }}
            >
              <Button
                ref={confirmRef}
                variant="destructive"
                size="sm"
                disabled={pending}
                onClick={() => void onDelete(transaction).finally(() => setConfirming(false))}
              >
                Delete
              </Button>
              <Button variant="ghost" size="sm" disabled={pending} onClick={cancelDelete}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              ref={deleteRef}
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-destructive"
              aria-label={`Delete “${transaction.description}”`}
              disabled={pending}
              onClick={() => setConfirming(true)}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          )}
        </div>
      ) : null}
    </li>
  );
}
