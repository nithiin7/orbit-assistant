"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { CreatePersonLedgerEntryRequest, Person } from "@orbit/contracts";
import { Landmark } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { DialogShell } from "@/components/dialog-shell";
import { AmountField, DateField, FormAlert, FormField, SelectField } from "@/components/form-field";
import { Checkbox } from "@/components/ui/checkbox";
import { useFinanceSetup } from "@/hooks/use-finance";
import { CURRENCY_OPTIONS, parseAmount } from "@/lib/finance";
import {
  isRepayment,
  LEDGER_KIND_OPTIONS,
  ledgerRequestOf,
  moneySchema,
  type MoneyValues,
} from "@/lib/people";

/**
 * Records money between you and a person: what they owe you, what you owe them, or a repayment
 * either way. A repayment can be recorded in Finance at the same time.
 */
export function MoneyDialog({
  workspaceId,
  people,
  title,
  initial,
  onSave,
  onClose,
}: {
  workspaceId: string;
  /** Everyone to choose from; the choice is shown only when `initial` names no one. */
  people: readonly Person[];
  title: string;
  initial: MoneyValues;
  onSave: (personId: string, body: CreatePersonLedgerEntryRequest) => Promise<void>;
  /** Called once the dialog has closed, whether saved or cancelled. */
  onClose: () => void;
}) {
  const { accounts, categories } = useFinanceSetup(workspaceId);
  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting: saving },
  } = useForm({ resolver: yupResolver(moneySchema), defaultValues: initial });
  const [personId, kind, currency, record] = useWatch({
    control,
    name: ["personId", "kind", "currency", "record"],
  });
  const person = people.find((entry) => entry.id === personId) ?? null;
  const repayment = isRepayment(kind);

  const accountOptions =
    accounts.status === "success"
      ? accounts.data.accounts
          .filter((account) => !account.archived && account.currency === currency)
          .map((account) => ({ value: account.id, label: account.name }))
      : [];
  const categoryOptions =
    categories.status === "success"
      ? categories.data
          .filter((category) => category.type === "expense")
          .map((category) => ({ value: category.id, label: category.name }))
      : [];

  async function save(values: MoneyValues, close: () => void) {
    const amount = parseAmount(values.amount, values.currency);
    if (amount === null || amount <= 0) {
      setError("amount", { message: "Enter an amount, such as 500 or 1,250.50." });
      return;
    }
    try {
      await onSave(values.personId, ledgerRequestOf(values, amount));
      close();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t save this. Try again."),
      });
    }
  }

  return (
    <DialogShell
      title={title}
      description={
        person ? `Between you and ${person.name}. Only you see this.` : "Only you see this."
      }
      busy={saving}
      onClose={onClose}
      onSubmit={(event, close) => void handleSubmit((values) => save(values, close))(event)}
      submitLabel="Save"
    >
      {initial.personId === "" ? (
        <SelectField
          control={control}
          name="personId"
          label="Who"
          placeholder="Choose someone"
          options={people.map((entry) => ({ value: entry.id, label: entry.name }))}
        />
      ) : null}
      <SelectField
        control={control}
        name="kind"
        label="What happened"
        options={LEDGER_KIND_OPTIONS}
        onValueChange={(value) => {
          if (value !== "they_paid" && value !== "i_paid") setValue("record", false);
        }}
      />
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem]">
        <AmountField control={control} name="amount" label="Amount" currency={currency} autoFocus />
        <SelectField
          control={control}
          name="currency"
          label="Currency"
          options={CURRENCY_OPTIONS}
          onValueChange={() => setValue("accountId", "")}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_11rem]">
        <FormField
          label="For"
          autoComplete="off"
          placeholder="Dinner, cab, concert tickets…"
          {...register("description")}
          error={errors.description?.message}
        />
        <DateField control={control} name="occurredOn" label="When" />
      </div>

      {repayment ? (
        <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
          <label className="flex items-start gap-2.5 text-sm">
            <Checkbox {...register("record")} className="mt-0.5" />
            <span>
              <span className="flex items-center gap-1.5 font-medium">
                <Landmark className="size-3.5 text-muted-foreground" aria-hidden="true" />
                Also record it in Finance
              </span>
              <span className="block text-xs text-muted-foreground">
                {kind === "they_paid"
                  ? "Adds a refund in the expense’s category, so your spending comes down to your share."
                  : "Adds an expense for your share of what they covered."}
              </span>
            </span>
          </label>
          {record ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                control={control}
                name="accountId"
                label={kind === "they_paid" ? "Received in" : "Paid from"}
                placeholder={
                  accounts.status === "loading" ? "Loading accounts…" : "Choose an account"
                }
                options={accountOptions}
              />
              <SelectField
                control={control}
                name="categoryId"
                label="Category"
                placeholder="Choose a category"
                options={categoryOptions}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <FormAlert message={errors.root?.server?.message ?? null} />
    </DialogShell>
  );
}
