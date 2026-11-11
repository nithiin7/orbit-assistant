"use client";

import type {
  Deposit,
  FinanceAccount,
  Holding,
  InvestmentAccount,
  InvestmentTransaction,
} from "@orbit/contracts";
import { Trash2 } from "lucide-react";

import { describeApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useInvestmentMutations, useInvestmentTransactions } from "@/hooks/use-investments";
import { formatMoney } from "@/lib/finance";
import {
  accountKindLabel,
  formatUnitPrice,
  formatUnits,
  transactionTypeLabel,
} from "@/lib/investments";
import { formatCalendarDate } from "@/utils/dates";

import { LoadError, Panel } from "./panel";
import { RowActions } from "./row-actions";

export function ActivityPanel({
  workspaceId,
  holdings,
  deposits,
  onAnnounce,
}: {
  workspaceId: string;
  holdings: readonly Holding[];
  deposits: readonly Deposit[];
  onAnnounce: (message: string) => void;
}) {
  const activity = useInvestmentTransactions(workspaceId, { limit: 25 });
  const { deleteTransaction } = useInvestmentMutations(workspaceId);
  const names = new Map<string, string>([
    ...holdings.map((holding) => [holding.id, holding.name] as const),
    ...deposits.map((deposit) => [deposit.id, deposit.name] as const),
  ]);
  const state = activity.state;

  const remove = (entry: InvestmentTransaction, deleteLedger: boolean) => async () => {
    try {
      await deleteTransaction.mutateAsync({ id: entry.id, deleteLedger });
      onAnnounce("Deleted the investment transaction.");
    } catch (reason) {
      onAnnounce(describeApiError(reason, "Couldn’t delete it."));
    }
  };

  return (
    <Panel title="Recent activity" flush>
      {state.status === "error" ? (
        <div className="px-5 pb-5">
          <LoadError message={state.message} onRetry={activity.reload} />
        </div>
      ) : state.status === "loading" ? (
        <div className="px-5 pb-5">
          <Skeleton className="h-24" />
        </div>
      ) : state.data.transactions.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <ul className="@container/rows divide-y border-t">
          {state.data.transactions.map((entry) => {
            const subject =
              names.get(entry.holding_id ?? entry.deposit_id ?? "") ?? "Investment account";
            const outflow =
              entry.type === "buy" || entry.type === "deposit" || entry.type === "fee";
            return (
              <li key={entry.id} className="flex items-center gap-3 px-4 py-2.5 @md/rows:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {transactionTypeLabel(entry.type)}
                    {entry.plan === "sip" ? " (SIP)" : ""} · {subject}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatCalendarDate(entry.trade_date)}
                    {entry.quantity
                      ? ` · ${formatUnits(entry.quantity)} units at ${formatUnitPrice(entry.unit_price ?? "0", entry.currency)}`
                      : ""}
                    {entry.fees ? ` · charges ${formatMoney(entry.fees, entry.currency)}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-sm whitespace-nowrap tabular-nums">
                  {formatMoney(outflow ? -entry.amount : entry.amount, entry.currency, {
                    signDisplay: "always",
                  })}
                </span>
                <RowActions
                  name={`${transactionTypeLabel(entry.type)} of ${subject}`}
                  actions={[
                    {
                      id: "delete",
                      label: "Delete…",
                      icon: Trash2,
                      destructive: true,
                      confirm: {
                        prompt: "Delete this investment transaction?",
                        choices: [
                          { label: "Delete, keep ledger entries", onConfirm: remove(entry, false) },
                          {
                            label: "Delete with ledger entries",
                            destructive: true,
                            onConfirm: remove(entry, true),
                          },
                        ],
                      },
                    },
                  ]}
                />
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function AccountsPanel({
  profiles,
  accounts,
  onEdit,
}: {
  profiles: readonly InvestmentAccount[];
  accounts: readonly FinanceAccount[];
  onEdit: (account: InvestmentAccount) => void;
}) {
  const names = new Map(accounts.map((account) => [account.id, account.name]));
  return (
    <Panel title="Investment accounts" description="Cash is money not yet invested." flush>
      <ul className="divide-y border-t">
        {profiles.map((account) => (
          <li
            key={account.account_id}
            className="flex items-center justify-between gap-3 px-4 py-2.5 @md/rows:px-5"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {account.name}
                {account.archived ? (
                  <span className="text-muted-foreground"> (archived)</span>
                ) : null}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {[
                  accountKindLabel(account.kind),
                  account.provider,
                  account.linked_account_id
                    ? `Linked to ${names.get(account.linked_account_id) ?? "an account"}`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-right">
                <p className="text-sm font-medium whitespace-nowrap tabular-nums">
                  {formatMoney(account.value, account.currency)}
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  Cash {formatMoney(account.cash, account.currency)}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onEdit(account)}
                aria-label={`Edit ${account.name}`}
              >
                Edit
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
