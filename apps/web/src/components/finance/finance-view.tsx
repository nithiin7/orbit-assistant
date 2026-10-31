"use client";

import type {
  Currency,
  FinanceAccount,
  FinanceCategory,
  FinanceTransaction,
  FinanceTransactionType,
  Installment,
  Loan,
  RecurringKind,
  RecurringPayment,
} from "@orbit/contracts";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Landmark, Plus, Undo2 } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useBudgetMonth } from "@/hooks/use-budgets";
import { useCommitmentSummary } from "@/hooks/use-commitments";
import { useFinanceSetup } from "@/hooks/use-finance";
import { accountCurrencies, DEFAULT_CURRENCY } from "@/lib/finance";
import {
  DEFAULT_FINANCE_VIEW,
  FINANCE_VIEW_PARAM,
  type FinanceView as FinanceViewId,
  parseFinanceView,
} from "@/lib/finance-views";
import { useWorkspaces } from "@/providers/workspace";
import { localDateString, localMonthString } from "@/utils/dates";

import { AccountDialog } from "./account-dialog";
import { AccountsView } from "./accounts-view";
import { AssetsView } from "./assets-view";
import { BudgetsView } from "./budgets-view";
import { FinanceNav, type ViewBadges } from "./finance-nav";
import { FinanceOverview } from "./finance-overview";
import { GoalsView } from "./goals-view";
import { InvestmentsView } from "./investments-view";
import { LoanDialog } from "./loan-dialog";
import { InstallmentDialog, RescheduleDialog } from "./loan-schedule-dialogs";
import { LoansView } from "./loans-view";
import { NetWorthView } from "./net-worth-view";
import { LoadError } from "./panel";
import { PaymentDialog, type PaymentTarget } from "./payment-dialog";
import { PlanView } from "./plan-view";
import { RecurringDialog } from "./recurring-dialog";
import { RecurringView } from "./recurring-view";
import { TransactionDialog } from "./transaction-dialog";
import { TransactionHistory } from "./transaction-history";
import { UpcomingPayments } from "./upcoming-payments";

export type FinanceTab = FinanceViewId;

const DESCRIPTION =
  "Accounts, spending, plans, commitments, and wealth, entered by hand. Private to you; Orbit never connects to your bank.";

/** Views that need an account to show anything useful. */
const NEEDS_ACCOUNT: ReadonlySet<FinanceTab> = new Set(["overview", "transactions"]);

/** Views where recording a transaction is the main thing to do. */
const RECORDING_VIEWS: ReadonlySet<FinanceTab> = new Set(["overview", "transactions"]);

type Dialog =
  | { kind: "transaction"; type: FinanceTransactionType; transaction?: FinanceTransaction }
  | { kind: "account"; account?: FinanceAccount }
  | { kind: "loan"; loan?: Loan }
  | { kind: "reschedule"; loan: Loan }
  | { kind: "installment"; loan: Loan; installment: Installment }
  | { kind: "recurring"; recurringKind: RecurringKind; payment?: RecurringPayment }
  | { kind: "pay"; target: PaymentTarget };

/** What every finance view gets from the page: the workspace's data and the shared controls. */
export type FinanceData = {
  workspaceId: string;
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  onEditTransaction: (transaction: FinanceTransaction) => void;
  onAnnounce: (message: string) => void;
  onShowTab: (tab: FinanceTab) => void;
  /** The month the monthly views show, shared so moving between them keeps it. */
  month: string;
  thisMonth: string;
  onMonthChange: (month: string) => void;
  /** The currency the views report in, from those the accounts use. */
  currency: Currency;
  currencies: Currency[];
  onCurrencyChange: (currency: Currency) => void;
};

/** The Finance page for the active workspace. Remounts (and resets) when the workspace changes. */
export function FinancePanel() {
  const { state, refresh } = useWorkspaces();

  if (state.status === "error") {
    return (
      <FinanceFrame>
        <LoadError message={state.message} onRetry={refresh} />
      </FinanceFrame>
    );
  }
  if (state.status === "loading") {
    return (
      <FinanceFrame>
        <FinanceSkeleton />
      </FinanceFrame>
    );
  }
  return <FinanceView key={state.active.id} workspaceId={state.active.id} />;
}

function FinanceFrame({ actions, children }: { actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-8">
      <PageHeader title="Finance" description={DESCRIPTION} actions={actions} />
      {children}
    </div>
  );
}

function viewFromLocation(): FinanceTab {
  if (typeof window === "undefined") return DEFAULT_FINANCE_VIEW;
  return parseFinanceView(new URLSearchParams(window.location.search).get(FINANCE_VIEW_PARAM));
}

/**
 * The view lives in the URL (`?view=budgets`), so reloads, links, and Back land on it. Changing
 * it pushes a history entry; Back and Forward change it back.
 */
function useFinanceViewParam(): [FinanceTab, (view: FinanceTab) => void] {
  const [view, setView] = useState<FinanceTab>(viewFromLocation);

  useEffect(() => {
    const onPopState = () => setView(viewFromLocation());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const show = useCallback((next: FinanceTab) => {
    setView(next);
    const url = new URL(window.location.href);
    if (next === DEFAULT_FINANCE_VIEW) url.searchParams.delete(FINANCE_VIEW_PARAM);
    else url.searchParams.set(FINANCE_VIEW_PARAM, next);
    if (url.href !== window.location.href) window.history.pushState(null, "", url);
  }, []);

  return [view, show];
}

function FinanceView({ workspaceId }: { workspaceId: string }) {
  const { accounts, categories, reload } = useFinanceSetup(workspaceId);
  const [tab, setTab] = useFinanceViewParam();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // Recomputed each render, so "this month" moves on if the page is left open past its end.
  const thisMonth = localMonthString();
  const [month, setMonth] = useState(thisMonth);
  const [chosenCurrency, setCurrency] = useState<Currency | null>(null);

  const allAccounts = useMemo(
    () => (accounts.status === "success" ? accounts.data.accounts : []),
    [accounts],
  );
  const currencies = useMemo(() => accountCurrencies(allAccounts), [allAccounts]);
  const currency =
    chosenCurrency && currencies.includes(chosenCurrency)
      ? chosenCurrency
      : (currencies[0] ?? DEFAULT_CURRENCY);
  const badges = useViewBadges(workspaceId, thisMonth, currency);

  const editTransaction = useCallback(
    (transaction: FinanceTransaction) =>
      setDialog({ kind: "transaction", type: transaction.type, transaction }),
    [],
  );

  if (accounts.status === "error" || categories.status === "error") {
    const message =
      (accounts.status === "error" ? accounts.message : "") ||
      (categories.status === "error" ? categories.message : "");
    return (
      <FinanceFrame>
        <LoadError message={message} onRetry={reload} />
      </FinanceFrame>
    );
  }
  if (accounts.status === "loading" || categories.status === "loading") {
    return (
      <FinanceFrame>
        <FinanceSkeleton />
      </FinanceFrame>
    );
  }

  const hasActiveAccount = allAccounts.some((account) => !account.archived);
  const data: FinanceData = {
    workspaceId,
    accounts: allAccounts,
    categories: categories.data,
    onEditTransaction: editTransaction,
    onAnnounce: setAnnouncement,
    onShowTab: setTab,
    month,
    thisMonth,
    onMonthChange: setMonth,
    currency,
    currencies,
    onCurrencyChange: setCurrency,
  };
  const pay = (target: PaymentTarget) => setDialog({ kind: "pay", target });
  const record = (type: FinanceTransactionType) => setDialog({ kind: "transaction", type });

  const recordMenu = hasActiveAccount ? (
    <Menu
      align="end"
      // The main action where recording is what the view is for; quieter elsewhere, where the
      // view has its own primary action.
      variant={RECORDING_VIEWS.has(tab) ? "default" : "soft"}
      items={[
        {
          id: "expense",
          label: "Expense",
          description: "Money spent from an account or card",
          icon: ArrowUpRight,
          onSelect: () => record("expense"),
        },
        {
          id: "income",
          label: "Income",
          description: "Salary, interest, or anything received",
          icon: ArrowDownLeft,
          onSelect: () => record("income"),
        },
        {
          id: "transfer",
          label: "Transfer",
          description: "Between your accounts, such as a card bill",
          icon: ArrowLeftRight,
          onSelect: () => record("transfer"),
        },
        {
          id: "refund",
          label: "Refund",
          description: "Money back on an earlier purchase",
          icon: Undo2,
          onSelect: () => record("refund"),
        },
      ]}
    >
      <Plus aria-hidden="true" />
      Record
    </Menu>
  ) : null;

  return (
    <FinanceFrame actions={recordMenu}>
      {/* Layout follows the space the page gets (which depends on the app sidebar), not the
          screen: container queries size the rail and each view's columns. */}
      <div className="@container/finance">
        <div className="grid gap-6 @5xl/finance:grid-cols-[13rem_minmax(0,1fr)] @5xl/finance:gap-8 @7xl/finance:grid-cols-[15rem_minmax(0,1fr)] @7xl/finance:gap-12">
          <aside className="min-w-0 @5xl/finance:sticky @5xl/finance:top-6 @5xl/finance:self-start">
            <FinanceNav view={tab} onChange={setTab} badges={badges} />
          </aside>

          <div key={tab} className="@container/list min-w-0 animate-page-in space-y-6">
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
            ) : tab === "overview" ? (
              <FinanceOverview {...data} />
            ) : tab === "budgets" ? (
              <BudgetsView {...data} />
            ) : tab === "plan" ? (
              <PlanView {...data} />
            ) : tab === "goals" ? (
              <GoalsView {...data} />
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
        </div>
      </div>

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
    </FinanceFrame>
  );
}

/**
 * Counts beside the views that need attention: overdue payments and exceeded budgets, this month.
 * They reuse the Overview's queries and never hold up the page.
 */
function useViewBadges(workspaceId: string, thisMonth: string, currency: Currency): ViewBadges {
  const today = localDateString();
  const commitments = useCommitmentSummary(workspaceId, currency, today);
  const budgets = useBudgetMonth(workspaceId, thisMonth, currency, today);
  const badges: ViewBadges = {};
  if (commitments.state.status === "success") {
    const overdue = commitments.state.data.overdue.count;
    badges.upcoming = { count: overdue, label: `${overdue} overdue` };
  }
  if (budgets.state.status === "success") {
    const exceeded = budgets.state.data.budgets.filter(
      (budget) => budget.current_period?.status === "exceeded",
    ).length;
    badges.budgets = { count: exceeded, label: `${exceeded} over budget` };
  }
  return badges;
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
