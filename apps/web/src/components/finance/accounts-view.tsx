"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type {
  BalanceTotals,
  FinanceAccount,
  FinanceAccountType,
  FinanceCategory,
} from "@orbit/contracts";
import {
  Archive,
  ArchiveRestore,
  Banknote,
  CreditCard,
  Landmark,
  LineChart,
  type LucideIcon,
  Pencil,
  Plus,
  Smartphone,
  Wallet,
  X,
} from "lucide-react";
import { useId, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { InferType } from "yup";

import { describeApiError } from "@/api/client";
import { FormAlert } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useFinanceMutations } from "@/hooks/use-finance";
import { accountTypeLabel, categorySchema, formatMoney } from "@/lib/finance";
import { type Option } from "@/utils/common";

import { Chip, rowListClassName, SectionHeading } from "./finance-meta";
import { AccountBalance } from "./finance-overview";
import type { FinanceData } from "./finance-view";
import { EndedSection, Panel } from "./panel";
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

export function AccountsView({
  workspaceId,
  accounts,
  categories,
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

      <FormAlert message={error} />

      {active.length === 0 ? (
        <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
          No active accounts. Add a bank account, cash, a card, or a wallet to start recording.
        </p>
      ) : (
        <section aria-label="Active accounts" className="gap-6 @5xl/list:columns-2">
          {groups.map((group) => {
            const headingId = `${groupId}-${group.label}`;
            const currency = group.accounts[0]?.currency;
            const sameCurrency = group.accounts.every((account) => account.currency === currency);
            const subtotal = group.accounts.reduce((sum, account) => sum + account.balance, 0);
            const owes = group.accounts.every((account) => account.account_class === "liability");
            return (
              <section
                key={group.label}
                aria-labelledby={headingId}
                className="mb-6 break-inside-avoid space-y-2 last:mb-0"
              >
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
                <ul aria-label={group.label} className={rowListClassName}>
                  {group.accounts.map(row)}
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

      <CategoriesSection
        workspaceId={workspaceId}
        categories={categories}
        onAnnounce={onAnnounce}
      />
    </div>
  );
}

type CategoryValues = InferType<typeof categorySchema>;

const CATEGORY_TYPES: readonly Option<CategoryValues["type"]>[] = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
];

function CategoriesSection({
  workspaceId,
  categories,
  onAnnounce,
}: {
  workspaceId: string;
  categories: FinanceCategory[];
  onAnnounce: (message: string) => void;
}) {
  const id = useId();
  const { createCategory, deleteCategory } = useFinanceMutations(workspaceId);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError: setFormError,
    formState: { errors, isSubmitting },
  } = useForm<CategoryValues>({
    resolver: yupResolver(categorySchema),
    defaultValues: { name: "", type: "expense" },
  });

  async function add(values: CategoryValues) {
    try {
      const created = await createCategory.mutateAsync(values);
      reset({ name: "", type: values.type });
      onAnnounce(`Added the category “${created.name}”.`);
    } catch (reason) {
      setFormError("root.server", {
        message: describeApiError(reason, "Couldn’t add the category. Try again."),
      });
    }
  }

  async function remove(category: FinanceCategory) {
    setError(null);
    try {
      await deleteCategory.mutateAsync(category);
      onAnnounce(`Deleted the category “${category.name}”.`);
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t delete the category. Try again."));
    }
  }

  return (
    <Panel
      title="Categories"
      description="Built-in categories can’t be deleted. Your own can, once no transaction uses them."
    >
      <div className="space-y-4">
        <form
          noValidate
          onSubmit={(event) => void handleSubmit(add)(event)}
          className="flex flex-col gap-2 @2xl/list:max-w-2xl @2xl/list:flex-row @2xl/list:items-start"
        >
          <div className="min-w-0 flex-1 space-y-1">
            <label htmlFor={`${id}-name`} className="sr-only">
              New category name
            </label>
            <Input
              id={`${id}-name`}
              placeholder="New category, such as Pets"
              autoComplete="off"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? `${id}-name-error` : undefined}
              {...register("name")}
            />
            {errors.name ? (
              <p id={`${id}-name-error`} className="text-xs font-medium text-destructive">
                {errors.name.message}
              </p>
            ) : null}
          </div>
          <label htmlFor={`${id}-type`} className="sr-only">
            Category type
          </label>
          <Controller
            control={control}
            name="type"
            render={({ field }) => (
              <Select
                id={`${id}-type`}
                ref={field.ref}
                className="@2xl/list:w-36"
                value={field.value}
                onValueChange={field.onChange}
                onBlur={field.onBlur}
                options={CATEGORY_TYPES}
              />
            )}
          />
          <Button type="submit" variant="outline" disabled={isSubmitting}>
            Add category
          </Button>
        </form>
        <FormAlert message={errors.root?.server?.message ?? error} />

        {(["expense", "income"] as const).map((type) => (
          <div key={type} className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              {type === "income" ? "Income" : "Expenses"}
            </h3>
            <ul className="flex flex-wrap gap-1.5">
              {categories
                .filter((category) => category.type === type)
                .map((category) => (
                  <li key={category.id}>
                    <Badge variant="outline" className="gap-1 py-1 text-foreground">
                      {category.name}
                      {category.is_default ? null : (
                        <button
                          type="button"
                          aria-label={`Delete the category “${category.name}”`}
                          onClick={() => void remove(category)}
                          className="-mr-1 rounded-full p-0.5 text-muted-foreground outline-none hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <X className="size-3" aria-hidden="true" />
                        </button>
                      )}
                    </Badge>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </Panel>
  );
}
