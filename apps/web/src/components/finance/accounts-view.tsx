"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { BalanceTotals, FinanceAccount, FinanceCategory } from "@orbit/contracts";
import { Archive, ArchiveRestore, Pencil, Plus, X } from "lucide-react";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import type { InferType } from "yup";

import { describeApiError } from "@/api/client";
import { FormAlert } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useFinanceMutations } from "@/hooks/use-finance";
import { accountTypeLabel, categorySchema, formatMoney } from "@/lib/finance";

import { AccountBalance } from "./finance-overview";
import type { FinanceData } from "./finance-view";

type AccountsViewProps = FinanceData & {
  totals: BalanceTotals[];
  onAddAccount: () => void;
  onEditAccount: (account: FinanceAccount) => void;
};

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
  const active = accounts.filter((account) => !account.archived);
  const archived = accounts.filter((account) => account.archived);

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

  const row = (account: FinanceAccount) => (
    <li key={account.id} className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{account.name}</p>
        <p className="text-xs text-muted-foreground">
          {accountTypeLabel(account.type)} · {account.currency}
        </p>
      </div>
      <AccountBalance account={account} />
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={`Edit “${account.name}”`}
          onClick={() => onEditAccount(account)}
        >
          <Pencil aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          disabled={pending === account.id}
          aria-label={account.archived ? `Restore “${account.name}”` : `Archive “${account.name}”`}
          onClick={() => void setArchived(account, !account.archived)}
        >
          {account.archived ? (
            <ArchiveRestore aria-hidden="true" />
          ) : (
            <Archive aria-hidden="true" />
          )}
        </Button>
      </div>
    </li>
  );

  return (
    <div className="space-y-6">
      {totals.length > 0 ? (
        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {totals.map((total) => (
            <div key={total.currency} className="rounded-xl border bg-card p-5 shadow-elevation-1">
              <dt className="text-sm text-muted-foreground">Balances in {total.currency}</dt>
              <dd className="mt-2 grid grid-cols-2 gap-3">
                <span>
                  <span className="block text-xs text-muted-foreground">Held</span>
                  <span className="text-lg font-semibold tabular-nums">
                    {formatMoney(total.assets, total.currency)}
                  </span>
                </span>
                <span>
                  <span className="block text-xs text-muted-foreground">Owed on cards</span>
                  <span className="text-lg font-semibold tabular-nums">
                    {formatMoney(total.liabilities, total.currency)}
                  </span>
                </span>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      <section aria-labelledby="finance-accounts-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="finance-accounts-heading" className="text-base font-semibold">
            Accounts
          </h2>
          <Button size="sm" onClick={onAddAccount}>
            <Plus aria-hidden="true" />
            Add account
          </Button>
        </div>
        <FormAlert message={error} />
        {active.length === 0 ? (
          <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
            No active accounts. Add a bank account, cash, a card, or a wallet to start recording.
          </p>
        ) : (
          <ul
            aria-label="Active accounts"
            className="divide-y overflow-hidden rounded-xl border bg-card shadow-elevation-1"
          >
            {active.map(row)}
          </ul>
        )}
        {archived.length > 0 ? (
          <details className="group rounded-xl border bg-card/60">
            <summary className="cursor-pointer rounded-xl px-4 py-3 text-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {archived.length} archived {archived.length === 1 ? "account" : "accounts"}
            </summary>
            <ul aria-label="Archived accounts" className="divide-y border-t">
              {archived.map(row)}
            </ul>
          </details>
        ) : null}
      </section>

      <CategoriesSection
        workspaceId={workspaceId}
        categories={categories}
        onAnnounce={onAnnounce}
      />
    </div>
  );
}

type CategoryValues = InferType<typeof categorySchema>;

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
    <section aria-labelledby={`${id}-heading`}>
      <Card className="space-y-4 p-5 shadow-elevation-1">
        <div className="space-y-1">
          <h2 id={`${id}-heading`} className="text-base font-semibold">
            Categories
          </h2>
          <p className="text-xs text-muted-foreground">
            Built-in categories can’t be deleted. Your own can, once no transaction uses them.
          </p>
        </div>

        <form
          noValidate
          onSubmit={(event) => void handleSubmit(add)(event)}
          className="flex flex-col gap-2 sm:flex-row sm:items-start"
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
          <NativeSelect id={`${id}-type`} className="sm:w-36" {...register("type")}>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </NativeSelect>
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
      </Card>
    </section>
  );
}
