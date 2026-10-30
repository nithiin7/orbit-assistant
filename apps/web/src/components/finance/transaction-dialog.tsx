"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type {
  CreateFinanceTransactionRequest,
  FinanceAccount,
  FinanceCategory,
  FinanceTransaction,
  FinanceTransactionType,
} from "@orbit/contracts";
import { X } from "lucide-react";
import { type ComponentProps, useId } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import type { InferType } from "yup";

import { describeApiError } from "@/api/client";
import { FormAlert, FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useFinanceMutations } from "@/hooks/use-finance";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import {
  categoryTypeFor,
  DEFAULT_CURRENCY,
  parseAmount,
  toDecimalString,
  TRANSACTION_TYPES,
  transactionSchema,
} from "@/lib/finance";
import { cn } from "@/utils/common";
import { localDateString } from "@/utils/dates";

type TransactionDialogProps = {
  workspaceId: string;
  /** The type a new transaction starts as. */
  type: FinanceTransactionType;
  /** Edit this transaction; omit to record a new one. */
  transaction?: FinanceTransaction;
  accounts: readonly FinanceAccount[];
  categories: readonly FinanceCategory[];
  /** Called with a message to announce once saved. */
  onSaved: (message: string) => void;
  /** Called once the dialog has closed, whether saved or cancelled. */
  onClose: () => void;
};

type Values = InferType<typeof transactionSchema>;

const ACCOUNT_LABELS: Record<FinanceTransactionType, string> = {
  expense: "Paid from",
  income: "Received in",
  refund: "Refunded to",
  transfer: "From account",
};

/** Records or corrects income, an expense, a refund, or a transfer, in a modal `<dialog>`. */
export function TransactionDialog({
  workspaceId,
  type,
  transaction,
  accounts,
  categories,
  onSaved,
  onClose,
}: TransactionDialogProps) {
  const id = useId();
  const { createTransaction, updateTransaction } = useFinanceMutations(workspaceId);
  // Archived accounts take no new transactions, but one already used here stays selectable.
  const current = new Set([transaction?.account_id, transaction?.to_account_id]);
  const usable = accounts.filter((account) => !account.archived || current.has(account.id));
  const firstAccount = usable.find((account) => !account.archived);

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: saving },
  } = useForm<Values>({
    resolver: yupResolver(transactionSchema),
    defaultValues: transaction
      ? {
          type: transaction.type,
          amount: toDecimalString(transaction.amount, transaction.currency),
          occurredOn: transaction.occurred_on,
          description: transaction.description,
          accountId: transaction.account_id,
          toAccountId: transaction.to_account_id ?? "",
          categoryId: transaction.category_id ?? "",
          notes: transaction.notes,
        }
      : {
          type,
          amount: "",
          occurredOn: localDateString(),
          description: "",
          accountId: firstAccount?.id ?? "",
          toAccountId: "",
          categoryId: "",
          notes: "",
        },
  });
  const { close, dialogProps } = useModalDialog({ onClose, dismissible: !saving });
  const selectedType = useWatch({ control, name: "type" });
  const accountId = useWatch({ control, name: "accountId" });
  const source = accounts.find((account) => account.id === accountId);
  const currency = source?.currency ?? DEFAULT_CURRENCY;
  const categoryType = categoryTypeFor(selectedType);
  const transfer = selectedType === "transfer";

  async function save(values: Values) {
    // The amount's precision depends on the chosen account's currency.
    const amount = parseAmount(values.amount, currency);
    if (amount === null) {
      setError("amount", {
        message:
          currency === "JPY"
            ? "Enter a whole amount, such as 1250."
            : "Enter an amount, such as 1250 or 1,250.50.",
      });
      return;
    }
    const category = categories.find((entry) => entry.id === values.categoryId);
    const body: CreateFinanceTransactionRequest = {
      type: values.type,
      amount,
      occurred_on: values.occurredOn,
      description: values.description,
      account_id: values.accountId,
      to_account_id: transfer ? values.toAccountId : null,
      category_id: category && category.type === categoryType ? category.id : null,
      notes: values.notes,
    };
    try {
      const saved = transaction
        ? await updateTransaction.mutateAsync({ id: transaction.id, changes: body })
        : await createTransaction.mutateAsync(body);
      onSaved(transaction ? `Saved “${saved.description}”.` : `Recorded “${saved.description}”.`);
      close();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t save the transaction. Try again."),
      });
    }
  }

  return (
    <dialog
      {...dialogProps}
      aria-labelledby={`${id}-heading`}
      className="dialog-motion dialog-pop mx-auto mt-[6vh] max-h-[88vh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-xl border bg-popover p-0 text-popover-foreground shadow-elevation-3"
    >
      <form
        noValidate
        onSubmit={(event) => void handleSubmit(save)(event)}
        className="space-y-4 p-5"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={`${id}-heading`} className="text-base font-semibold">
            {transaction ? "Edit transaction" : "Record a transaction"}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            className="-mt-1.5 -mr-1.5 size-8"
            aria-label="Close"
            onClick={close}
          >
            <X aria-hidden="true" />
          </Button>
        </div>

        <Controller
          control={control}
          name="type"
          render={({ field }) => (
            <div
              role="group"
              aria-label="Transaction type"
              className="grid h-9 grid-cols-4 items-center rounded-md border bg-muted/60 p-0.5"
            >
              {TRANSACTION_TYPES.map((option) => {
                const selected = field.value === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => field.onChange(option.value)}
                    className={cn(
                      "h-full rounded-[calc(var(--radius-md)-2px)] text-sm font-medium transition-[color,background-color,box-shadow] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
          )}
        />
        {transfer ? (
          <p className="text-xs text-muted-foreground">
            Moving money between your own accounts, such as paying a card bill or investing, isn’t
            income or spending.
          </p>
        ) : selectedType === "refund" ? (
          <p className="text-xs text-muted-foreground">
            Money back for an earlier purchase. It reduces spending in its category.
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={`Amount (${currency})`}
            inputMode="decimal"
            autoComplete="off"
            autoFocus
            placeholder="0.00"
            {...register("amount")}
            error={errors.amount?.message}
          />
          <FormField
            label="Date"
            type="date"
            {...register("occurredOn")}
            error={errors.occurredOn?.message}
          />
        </div>

        <FormField
          label="Description"
          autoComplete="off"
          placeholder={transfer ? "Card bill, SIP, ATM withdrawal…" : "What was it for?"}
          {...register("description")}
          error={errors.description?.message}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label={ACCOUNT_LABELS[selectedType]}
            error={errors.accountId?.message}
            {...register("accountId")}
          >
            {usable.length === 0 ? <option value="">No accounts yet</option> : null}
            {usable.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.currency}){account.archived ? " – archived" : ""}
              </option>
            ))}
          </SelectField>

          {transfer ? (
            <SelectField
              label="To account"
              error={errors.toAccountId?.message}
              {...register("toAccountId")}
            >
              <option value="">Choose an account</option>
              {usable
                .filter((account) => account.id !== accountId && account.currency === currency)
                .map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                    {account.archived ? " – archived" : ""}
                  </option>
                ))}
            </SelectField>
          ) : (
            <SelectField label="Category" {...register("categoryId")}>
              <option value="">No category</option>
              {categories
                .filter((category) => category.type === categoryType)
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
            </SelectField>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`${id}-notes`} className="block text-sm font-medium">
            Notes <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Textarea
            id={`${id}-notes`}
            rows={2}
            {...register("notes")}
            aria-invalid={errors.notes ? true : undefined}
            aria-describedby={errors.notes ? `${id}-notes-error` : undefined}
          />
          {errors.notes ? (
            <p id={`${id}-notes-error`} className="text-xs font-medium text-destructive">
              {errors.notes.message}
            </p>
          ) : null}
        </div>

        <FormAlert message={errors.root?.server?.message ?? null} />

        <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
          <Button variant="ghost" disabled={saving} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : transaction ? "Save changes" : "Record"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

type SelectFieldProps = ComponentProps<"select"> & { label: string; error?: string };

/** A labelled native select whose error is announced with it. */
export function SelectField({ label, error, children, ...props }: SelectFieldProps) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <NativeSelect
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...props}
      >
        {children}
      </NativeSelect>
      {error ? (
        <p id={`${id}-error`} className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
