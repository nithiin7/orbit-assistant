"use client";

import type { BalanceTotals, FinanceAccount, FinanceAccountType } from "@orbit/contracts";
import {
  Archive,
  ArchiveRestore,
  Banknote,
  CreditCard,
  HandCoins,
  Landmark,
  LineChart,
  type LucideIcon,
  Pencil,
  PiggyBank,
  Plus,
  Smartphone,
  Wallet,
} from "lucide-react";
import { type ReactNode, useId, useState } from "react";

import { describeApiError } from "@/api/client";
import { FormAlert } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useFinanceMutations } from "@/hooks/use-finance";
import { accountTypeLabel, formatMoney } from "@/lib/finance";
import { cn } from "@/utils/common";

import { Chip, SectionHeading } from "./finance-meta";
import { AccountBalance } from "./finance-overview";
import type { FinanceData } from "./finance-view";
import { EndedSection } from "./panel";
import { RowActions } from "./row-actions";
import { StatGrid, StatTile } from "./stat-tile";
import { ViewHeader } from "./view-header";

type AccountsViewProps = FinanceData & {
  totals: BalanceTotals[];
  onAddAccount: () => void;
  onEditAccount: (account: FinanceAccount) => void;
};

/** Accounts grouped as people think of them, rather than one long list. */
const ACCOUNT_GROUPS: readonly { label: string; icon: LucideIcon; types: FinanceAccountType[] }[] =
  [
    { label: "Bank and cash", icon: Banknote, types: ["bank", "savings", "cash"] },
    { label: "Cards", icon: CreditCard, types: ["credit_card"] },
    { label: "Wallets", icon: Smartphone, types: ["wallet"] },
    { label: "Investment accounts", icon: LineChart, types: ["investment"] },
    { label: "Loans", icon: Landmark, types: ["loan"] },
    { label: "Other", icon: Wallet, types: ["other"] },
  ];

const TYPE_ICONS: Record<FinanceAccountType, LucideIcon> = {
  bank: Landmark,
  savings: PiggyBank,
  cash: Banknote,
  credit_card: CreditCard,
  wallet: Smartphone,
  investment: LineChart,
  loan: HandCoins,
  other: Wallet,
};

export function AccountsView({
  workspaceId,
  accounts,
  totals,
  onAddAccount,
  onEditAccount,
  onAnnounce,
}: AccountsViewProps) {
  const { archiveAccount } = useFinanceMutations(workspaceId);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showLoans, setShowLoans] = useState(false);
  const loansId = useId();
  const groupId = useId();
  const loanCount = accounts.filter((account) => account.type === "loan").length;
  // Loan accounts are opened by their loan, not added here, so they stay out of the way unless asked for.
  const listed = showLoans ? accounts : accounts.filter((account) => account.type !== "loan");
  const active = listed.filter((account) => !account.archived);
  const archived = listed.filter((account) => account.archived);
  const multiCurrency = totals.length > 1;

  const setArchived = async (account: FinanceAccount, value: boolean) => {
    setError(null);
    setPending(account.id);
    try {
      await archiveAccount.mutateAsync({ id: account.id, archived: value });
      onAnnounce(value ? `Archived “${account.name}”.` : `Restored “${account.name}”.`);
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t change the account. Try again."));
    }
    setPending(null);
  };

  const row = (account: FinanceAccount) => {
    const overdrawn = account.account_class === "asset" && account.balance < 0;
    return (
      <li
        key={account.id}
        className="group flex items-center gap-3 px-3 py-2.5 transition-colors duration-150 hover:bg-accent/40 @md/rows:px-4"
      >
        <div className="min-w-0 flex-1 space-y-0.5">
          <button
            type="button"
            onClick={() => onEditAccount(account)}
            aria-label={`Edit “${account.name}”`}
            className="block max-w-full truncate rounded-sm text-left text-sm font-medium outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-ring"
          >
            {account.name}
          </button>
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
            <span>{accountTypeLabel(account.type)}</span>
            {multiCurrency ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{account.currency}</span>
              </>
            ) : null}
            {overdrawn ? (
              <Chip tone="danger">
                <span title="More has been recorded going out than the opening balance plus what came in. Check the opening balance.">
                  Below zero
                </span>
              </Chip>
            ) : null}
          </p>
        </div>
        <AccountBalance account={account} />
        <RowActions
          name={account.name}
          disabled={pending === account.id}
          actions={[
            {
              id: "edit",
              label: "Edit",
              icon: Pencil,
              onSelect: () => onEditAccount(account),
            },
            account.archived
              ? {
                  id: "restore",
                  label: "Restore",
                  icon: ArchiveRestore,
                  onSelect: () => void setArchived(account, false),
                }
              : {
                  id: "archive",
                  label: "Archive",
                  description: "Hide it; its history stays",
                  icon: Archive,
                  onSelect: () => void setArchived(account, true),
                },
          ]}
        />
      </li>
    );
  };

  const accountActions = (account: FinanceAccount) => (
    <RowActions
      name={account.name}
      disabled={pending === account.id}
      actions={[
        {
          id: "edit",
          label: "Edit",
          icon: Pencil,
          onSelect: () => onEditAccount(account),
        },
        {
          id: "archive",
          label: "Archive",
          description: "Hide it; its history stays",
          icon: Archive,
          onSelect: () => void setArchived(account, true),
        },
      ]}
    />
  );

  const groups = ACCOUNT_GROUPS.map((group) => ({
    ...group,
    accounts: active.filter((account) => group.types.includes(account.type)),
  })).filter((group) => group.accounts.length > 0);

  return (
    <div className="space-y-6">
      <ViewHeader
        title="Accounts"
        description="Where your money sits. Each balance is its opening balance plus everything recorded."
        controls={
          loanCount > 0 ? (
            <label
              htmlFor={loansId}
              className="flex h-9 items-center gap-2 px-1 text-sm text-muted-foreground"
            >
              <Checkbox
                id={loansId}
                checked={showLoans}
                onChange={(event) => setShowLoans(event.target.checked)}
              />
              Show loan accounts ({loanCount})
            </label>
          ) : null
        }
        action={
          <Button onClick={onAddAccount}>
            <Plus aria-hidden="true" />
            Add account
          </Button>
        }
      />

      {totals.length > 0 ? (
        <StatGrid>
          {totals.flatMap((total) => {
            const suffix = multiCurrency ? ` (${total.currency})` : "";
            return [
              <StatTile
                key={`${total.currency}-held`}
                label={`In your accounts${suffix}`}
                icon={Banknote}
                accent="positive"
                value={formatMoney(total.assets, total.currency)}
              >
                Bank, cash, wallets, and investment accounts
              </StatTile>,
              <StatTile
                key={`${total.currency}-owed`}
                label={`Owed on cards and loans${suffix}`}
                icon={CreditCard}
                accent="negative"
                value={formatMoney(total.liabilities, total.currency)}
              >
                What you’d pay to clear them today
              </StatTile>,
            ];
          })}
        </StatGrid>
      ) : null}

      {error ? <FormAlert message={error} /> : null}

      {active.length === 0 ? (
        <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
          No active accounts. Add a bank account, cash, a card, or a wallet to start recording.
        </p>
      ) : (
        <section aria-label="Active accounts" className="space-y-6">
          {groups.map((group) => {
            const headingId = `${groupId}-${group.label}`;
            const currency = group.accounts[0]?.currency;
            const sameCurrency = group.accounts.every((account) => account.currency === currency);
            const subtotal = group.accounts.reduce((sum, account) => sum + account.balance, 0);
            const owes = group.accounts.every((account) => account.account_class === "liability");
            return (
              <section key={group.label} aria-labelledby={headingId} className="space-y-2.5">
                <SectionHeading
                  id={headingId}
                  count={group.accounts.length}
                  trailing={
                    sameCurrency && currency
                      ? `${formatMoney(owes ? -subtotal : subtotal, currency)}${owes ? " owed" : ""}`
                      : null
                  }
                >
                  {group.label}
                </SectionHeading>
                <ul
                  aria-label={group.label}
                  className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,19rem),1fr))] gap-3 @3xl/list:gap-4"
                >
                  {group.accounts.map((account) => (
                    <AccountCard
                      key={account.id}
                      account={account}
                      total={totals.find((total) => total.currency === account.currency)}
                      showCurrency={multiCurrency}
                      onEdit={() => onEditAccount(account)}
                      actions={accountActions(account)}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </section>
      )}

      {archived.length > 0 ? (
        <EndedSection
          summary={`${archived.length} archived ${archived.length === 1 ? "account" : "accounts"}`}
        >
          <ul aria-label="Archived accounts" className="@container/rows divide-y">
            {archived.map(row)}
          </ul>
        </EndedSection>
      ) : null}
    </div>
  );
}

/** The account's balance as people read it: what's held, what's owed, or what's in credit. */
function balanceLabel(account: FinanceAccount): { label: string; amount: number } {
  if (account.account_class === "asset") return { label: "Balance", amount: account.balance };
  const owed = -account.balance;
  return owed < 0 ? { label: "In credit", amount: -owed } : { label: "Owed", amount: owed };
}

/** One account as a card, its balance the largest thing on it. */
function AccountCard({
  account,
  total,
  showCurrency,
  onEdit,
  actions,
}: {
  account: FinanceAccount;
  /** The workspace's totals in the account's currency, for its share. */
  total: BalanceTotals | undefined;
  showCurrency: boolean;
  onEdit: () => void;
  actions: ReactNode;
}) {
  const Icon = TYPE_ICONS[account.type];
  const liability = account.account_class === "liability";
  const overdrawn = !liability && account.balance < 0;
  const { label, amount } = balanceLabel(account);
  const owedNothing = liability && amount === 0;
  // Its part of all the money held, or of everything owed, in the same currency.
  const pool = liability ? total?.liabilities : total?.assets;
  const share =
    pool && pool > 0 && amount > 0 && label !== "In credit"
      ? Math.min(100, (amount / pool) * 100)
      : null;

  return (
    <li className="flex min-w-0 flex-col rounded-xl border bg-card p-4 shadow-elevation-1 transition-shadow duration-150 hover:shadow-elevation-2 @3xl/list:p-5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg",
            liability ? "bg-destructive/10 text-destructive" : "bg-brand-subtle text-brand",
          )}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit “${account.name}”`}
            className="block max-w-full truncate rounded-sm text-left font-medium outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-ring"
          >
            {account.name}
          </button>
          <p className="truncate text-xs text-muted-foreground">
            {accountTypeLabel(account.type)}
            {showCurrency ? ` · ${account.currency}` : null}
          </p>
        </div>
        <div className="-mt-1 -mr-1 shrink-0">{actions}</div>
      </div>

      <dl className="mt-5">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd
          className={cn(
            "mt-0.5 text-2xl font-semibold tracking-tight whitespace-nowrap tabular-nums",
            (overdrawn || (liability && label === "Owed" && amount > 0)) && "text-destructive",
            label === "In credit" && "text-success",
            owedNothing && "text-muted-foreground",
          )}
        >
          {owedNothing ? "Nothing owed" : formatMoney(amount, account.currency)}
        </dd>
      </dl>

      <div className="mt-auto pt-4">
        {overdrawn ? (
          <Chip tone="danger">
            <span title="More has been recorded going out than the opening balance plus what came in. Check the opening balance.">
              Below zero
            </span>
          </Chip>
        ) : share !== null ? (
          <div className="space-y-1.5">
            <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full", liability ? "bg-destructive" : "bg-brand")}
                style={{ width: `${Math.max(share, 2)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {share < 1 ? "Under 1" : Math.round(share)}% of{" "}
              {liability ? "everything you owe" : "your money"}
            </p>
          </div>
        ) : null}
      </div>
    </li>
  );
}
