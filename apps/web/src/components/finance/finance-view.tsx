"use client";

import type {
  FinanceAccount,
  FinanceCategory,
  FinanceTransaction,
  FinanceTransactionType,
  Installment,
  Loan,
  RecurringKind,
  RecurringPayment,
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
import { AssetsView } from "./assets-view";
import { FinanceOverview } from "./finance-overview";
import { InvestmentsView } from "./investments-view";
import { LoanDialog } from "./loan-dialog";
import { InstallmentDialog, RescheduleDialog } from "./loan-schedule-dialogs";
import { LoansView } from "./loans-view";
import { NetWorthView } from "./net-worth-view";
import { PaymentDialog, type PaymentTarget } from "./payment-dialog";
import { RecurringDialog } from "./recurring-dialog";
import { RecurringView } from "./recurring-view";
import { TransactionDialog } from "./transaction-dialog";
import { TransactionHistory } from "./transaction-history";
import { UpcomingPayments } from "./upcoming-payments";

export type FinanceTab =
  | "overview"
  | "upcoming"
  | "transactions"
  | "accounts"
  | "loans"
  | "subscriptions"
  | "bills"
  | "investments"
  | "assets"
  | "net-worth";

const TABS: readonly Option<FinanceTab>[] = [
  { value: "overview", label: "Overview" },
  { value: "upcoming", label: "Upcoming" },
  { value: "transactions", label: "Transactions" },
  { value: "accounts", label: "Accounts" },
  { value: "loans", label: "Loans" },
  { value: "subscriptions", label: "Subscriptions" },
  { value: "bills", label: "Bills" },
  { value: "investments", label: "Investments" },
  { value: "assets", label: "Assets" },
  { value: "net-worth", label: "Net worth" },
];

/** Views that need an account to show anything useful. */
const NEEDS_ACCOUNT: ReadonlySet<FinanceTab> = new Set(["overview", "transactions"]);

type Dialog =
  | { kind: "transaction"; type: FinanceTransactionType; transaction?: FinanceTransaction }
  | { kind: "account"; account?: FinanceAccount }
  | { kind: "loan"; loan?: Loan }
  | { kind: "reschedule"; loan: Loan }
  | { kind: "installment"; loan: Loan; installment: Installment }
  | { kind: "recurring"; recurringKind: RecurringKind; payment?: RecurringPayment }
  | { kind: "pay"; target: PaymentTarget };

/** What every finance view gets from the page: the workspace's accounts and categories. */
export type FinanceData = {
  workspaceId: string;
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  onEditTransaction: (transaction: FinanceTransaction) => void;
  onAnnounce: (message: string) => void;
  onShowTab: (tab: FinanceTab) => void;
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
  const [tab, setTab] = useState<FinanceTab>("overview");
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
    onShowTab: setTab,
  };
  const pay = (target: PaymentTarget) => setDialog({ kind: "pay", target });
  const record = (type: FinanceTransactionType) => setDialog({ kind: "transaction", type });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="group"
          aria-label="Finance view"
          className="inline-flex h-9 w-full max-w-full items-center overflow-x-auto rounded-md border bg-muted/60 p-0.5 sm:w-auto"
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
                  "h-full flex-none rounded-[calc(var(--radius-md)-2px)] px-3 text-sm font-medium whitespace-nowrap transition-[color,background-color,box-shadow] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring",
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

      {!hasActiveAccount && NEEDS_ACCOUNT.has(tab) ? (
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
          ) : tab === "upcoming" ? (
            <UpcomingPayments {...data} onPay={pay} />
          ) : tab === "transactions" ? (
            <TransactionHistory {...data} />
          ) : tab === "investments" ? (
            <InvestmentsView {...data} />
          ) : tab === "assets" ? (
            <AssetsView {...data} />
          ) : tab === "net-worth" ? (
            <NetWorthView {...data} />
          ) : tab === "loans" ? (
            <LoansView
              {...data}
              onAddLoan={() => setDialog({ kind: "loan" })}
              onEditLoan={(loan) => setDialog({ kind: "loan", loan })}
              onReschedule={(loan) => setDialog({ kind: "reschedule", loan })}
              onAdjust={(loan, installment) =>
                setDialog({ kind: "installment", loan, installment })
              }
              onPay={pay}
            />
          ) : tab === "subscriptions" || tab === "bills" ? (
            <RecurringView
              key={tab}
              {...data}
              kind={tab === "subscriptions" ? "subscription" : "bill"}
              onAdd={() =>
                setDialog({
                  kind: "recurring",
                  recurringKind: tab === "subscriptions" ? "subscription" : "bill",
                })
              }
              onEdit={(payment) =>
                setDialog({ kind: "recurring", recurringKind: payment.kind, payment })
              }
              onPay={pay}
            />
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
      ) : dialog?.kind === "loan" ? (
        <LoanDialog
          workspaceId={workspaceId}
          loan={dialog.loan}
          accounts={allAccounts}
          onSaved={setAnnouncement}
          onClose={() => setDialog(null)}
        />
      ) : dialog?.kind === "reschedule" ? (
        <RescheduleDialog
          workspaceId={workspaceId}
          loan={dialog.loan}
          onSaved={setAnnouncement}
          onClose={() => setDialog(null)}
        />
      ) : dialog?.kind === "installment" ? (
        <InstallmentDialog
          workspaceId={workspaceId}
          loan={dialog.loan}
          installment={dialog.installment}
          onSaved={setAnnouncement}
          onClose={() => setDialog(null)}
        />
      ) : dialog?.kind === "recurring" ? (
        <RecurringDialog
          workspaceId={workspaceId}
          kind={dialog.recurringKind}
          payment={dialog.payment}
          accounts={allAccounts}
          categories={categories.data}
          onSaved={setAnnouncement}
          onClose={() => setDialog(null)}
        />
      ) : dialog?.kind === "pay" ? (
        <PaymentDialog
          workspaceId={workspaceId}
          target={dialog.target}
          accounts={allAccounts}
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
