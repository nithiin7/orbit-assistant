"use client";

import type {
  FinanceAccount,
  FinanceCategory,
  FinanceTransaction,
  FinanceTransactionType,
} from "@orbit/contracts";
import { ArrowLeftRight, Landmark, Minus, Plus } from "lucide-react";
import { useCallback, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useFinanceSetup } from "@/hooks/use-finance";
import { useWorkspaces } from "@/providers/workspace";
import { cn, type Option } from "@/utils/common";

import { AccountDialog } from "./account-dialog";
import { AccountsView } from "./accounts-view";
import { FinanceOverview } from "./finance-overview";
import { TransactionDialog } from "./transaction-dialog";
import { TransactionHistory } from "./transaction-history";

type Tab = "overview" | "transactions" | "accounts";

const TABS: readonly Option<Tab>[] = [
  { value: "overview", label: "Overview" },
  { value: "transactions", label: "Transactions" },
  { value: "accounts", label: "Accounts" },
];

type Dialog =
  | { kind: "transaction"; type: FinanceTransactionType; transaction?: FinanceTransaction }
  | { kind: "account"; account?: FinanceAccount };

/** What every finance view gets from the page: the workspace's accounts and categories. */
export type FinanceData = {
  workspaceId: string;
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  onEditTransaction: (transaction: FinanceTransaction) => void;
  onAnnounce: (message: string) => void;
};

/** The Finance page for the active workspace. Remounts (and resets) when the workspace changes. */
export function FinancePanel() {
  const { state, refresh } = useWorkspaces();

  if (state.status === "error") {
    return (
      <div role="alert" className="space-y-3 rounded-xl border bg-card p-4 text-sm">
        <p>{state.message}</p>
        <Button variant="outline" size="sm" onClick={refresh}>
          Try again
        </Button>
      </div>
    );
  }
  if (state.status === "loading") return <FinanceSkeleton />;
  return <FinanceView key={state.active.id} workspaceId={state.active.id} />;
}

function FinanceView({ workspaceId }: { workspaceId: string }) {
  const { accounts, categories, reload } = useFinanceSetup(workspaceId);
  const [tab, setTab] = useState<Tab>("overview");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const editTransaction = useCallback(
    (transaction: FinanceTransaction) =>
      setDialog({ kind: "transaction", type: transaction.type, transaction }),
    [],
  );

  if (accounts.status === "error" || categories.status === "error") {
    const message = accounts.status === "error" ? accounts.message : "";
    return (
      <div role="alert" className="space-y-3 rounded-xl border bg-card p-4 text-sm">
        <p>{message || (categories.status === "error" ? categories.message : "")}</p>
        <Button variant="outline" size="sm" onClick={reload}>
          Try again
        </Button>
      </div>
    );
  }
  if (accounts.status === "loading" || categories.status === "loading") {
    return <FinanceSkeleton />;
  }

  const allAccounts = accounts.data.accounts;
  const hasActiveAccount = allAccounts.some((account) => !account.archived);
  const data: FinanceData = {
    workspaceId,
    accounts: allAccounts,
    categories: categories.data,
    onEditTransaction: editTransaction,
    onAnnounce: setAnnouncement,
  };
  const record = (type: FinanceTransactionType) => setDialog({ kind: "transaction", type });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="group"
          aria-label="Finance view"
          className="inline-flex h-9 w-full items-center rounded-md border bg-muted/60 p-0.5 sm:w-auto"
        >
          {TABS.map((option) => {
            const selected = tab === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                onClick={() => setTab(option.value)}
                className={cn(
                  "h-full flex-1 rounded-[calc(var(--radius-md)-2px)] px-3 text-sm font-medium transition-[color,background-color,box-shadow] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-none",
                  selected
                    ? "bg-card text-foreground shadow-elevation-1"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        {hasActiveAccount ? (
          <div className="grid grid-cols-3 gap-2 sm:flex">
            <Button variant="outline" onClick={() => record("income")}>
              <Plus aria-hidden="true" />
              Income
            </Button>
            <Button variant="outline" onClick={() => record("expense")}>
              <Minus aria-hidden="true" />
              Expense
            </Button>
            <Button variant="outline" onClick={() => record("transfer")}>
              <ArrowLeftRight aria-hidden="true" />
              Transfer
            </Button>
          </div>
        ) : null}
      </div>

      {!hasActiveAccount && tab !== "accounts" ? (
        <EmptyState
          icon={Landmark}
          title="Add an account to get started"
          description="Track a bank account, cash, a card, or a wallet by hand. Orbit never asks for bank logins or connects to your bank."
        >
          <Button onClick={() => setDialog({ kind: "account" })}>
            <Plus aria-hidden="true" />
            Add account
          </Button>
        </EmptyState>
      ) : (
        <div key={tab} className="animate-page-in">
          {tab === "overview" ? (
            <FinanceOverview {...data} />
          ) : tab === "transactions" ? (
            <TransactionHistory {...data} />
          ) : (
            <AccountsView
              {...data}
              totals={accounts.data.totals}
              onAddAccount={() => setDialog({ kind: "account" })}
              onEditAccount={(account) => setDialog({ kind: "account", account })}
            />
          )}
        </div>
      )}

      <p role="status" className="sr-only">
        {announcement}
      </p>

      {dialog?.kind === "transaction" ? (
        <TransactionDialog
          workspaceId={workspaceId}
          type={dialog.type}
          transaction={dialog.transaction}
          accounts={allAccounts}
          categories={categories.data}
          onSaved={setAnnouncement}
          onClose={() => setDialog(null)}
        />
      ) : dialog?.kind === "account" ? (
        <AccountDialog
          workspaceId={workspaceId}
          account={dialog.account}
          onSaved={setAnnouncement}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

function FinanceSkeleton() {
  return (
    <div className="space-y-4">
      <span className="sr-only">Loading finances…</span>
      <Skeleton className="h-9 w-72" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((tile) => (
          <Skeleton key={tile} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-56 rounded-xl" />
    </div>
  );
}
