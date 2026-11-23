"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type {
  CreateFinanceTransactionRequest,
  FinanceAccount,
  FinanceCategory,
  FinanceTransaction,
  FinanceTransactionType,
} from "@orbit/contracts";
import { useId, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import type { InferType } from "yup";

import { describeApiError } from "@/api/client";
import { LinkedDocuments } from "@/components/documents/linked-documents";
import { AmountField, DateField, FormAlert, FormField, SelectField } from "@/components/form-field";
import { newSplitRow, SplitWith } from "@/components/people/split-with";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFormActions, DialogHeader } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useFinanceMutations } from "@/hooks/use-finance";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { useLedgerMutations, useTransactionSplits } from "@/hooks/use-people";
import {
  categoryTypeFor,
  DEFAULT_CURRENCY,
  parseAmount,
  toDecimalString,
  TRANSACTION_TYPES,
  transactionSchema,
} from "@/lib/finance";
import { type ParsedSplit, parseSplits, type SplitRow } from "@/lib/people";
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
  const money = useLedgerMutations(workspaceId);
  const existingSplits = useTransactionSplits(
    workspaceId,
    transaction?.type === "expense" ? transaction.id : null,
  );
  const [splits, setSplits] = useState<SplitRow[]>([]);
  const [splitting, setSplitting] = useState(false);
  // Archived accounts take no new transactions, but one already used here stays selectable.
  const current = new Set([transaction?.account_id, transaction?.to_account_id]);
  const usable = accounts.filter((account) => !account.archived || current.has(account.id));
  // New transactions start on the default account, or else the first open one.
  const firstAccount =
    usable.find((account) => account.is_default && !account.archived) ??
    usable.find((account) => !account.archived);

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
  const amountText = useWatch({ control, name: "amount" });
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
    let shares: ParsedSplit[] = [];
    if (values.type === "expense" && splits.length > 0) {
      const alreadyShared = existingSplits.reduce((sum, entry) => sum + entry.amount, 0);
      const parsed = parseSplits(
        splits,
        (text) => parseAmount(text, currency),
        amount,
        alreadyShared,
      );
      if ("error" in parsed) {
        setError("root.server", { message: parsed.error });
        return;
      }
      shares = parsed.splits;
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
      let message = transaction
        ? `Saved “${saved.description}”.`
        : `Recorded “${saved.description}”.`;
      // Each share is money they owe you, linked to this expense. The transaction is saved
      // already, so a failed share is reported rather than retried with the whole form.
      let failed = 0;
      for (const share of shares) {
        try {
          await money.add.mutateAsync({
            personId: share.personId,
            body: {
              kind: "they_owe",
              amount: share.amount,
              currency: saved.currency,
              occurred_on: saved.occurred_on,
              description: saved.description,
              transaction_id: saved.id,
              record_in_finance: null,
            },
          });
        } catch {
          failed += 1;
        }
      }
      if (shares.length > 0) {
        message +=
          failed === 0
            ? ` Split with ${shares.length} ${shares.length === 1 ? "person" : "people"}.`
            : " Some shares couldn’t be saved; add them from People.";
      }
      onSaved(message);
      close();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t save the transaction. Try again."),
      });
    }
  }

  return (
    <Dialog
      {...dialogProps}
      aria-labelledby={`${id}-heading`}
      className="mt-[6vh] max-h-[88vh] max-w-lg overflow-y-auto"
    >
      <form
        noValidate
        onSubmit={(event) => void handleSubmit(save)(event)}
        className="space-y-4 p-5"
      >
        <DialogHeader
          titleId={`${id}-heading`}
          title={transaction ? "Edit transaction" : "Record a transaction"}
          onClose={close}
        />

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
          <AmountField
            control={control}
            name="amount"
            label={`Amount (${currency})`}
            currency={currency}
            autoFocus
            placeholder="0.00"
          />
          <DateField control={control} name="occurredOn" label="Date" />
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
            control={control}
            name="accountId"
            label={ACCOUNT_LABELS[selectedType]}
            placeholder={usable.length === 0 ? "No accounts yet" : "Choose an account"}
            options={usable.map((account) => ({
              value: account.id,
              label: `${account.name} (${account.currency})${account.archived ? " – archived" : ""}`,
            }))}
          />

          {transfer ? (
            <SelectField
              control={control}
              name="toAccountId"
              label="To account"
              placeholder="Choose an account"
              options={usable
                .filter((account) => account.id !== accountId && account.currency === currency)
                .map((account) => ({
                  value: account.id,
                  label: `${account.name}${account.archived ? " – archived" : ""}`,
                }))}
            />
          ) : (
            <SelectField
              control={control}
              name="categoryId"
              label="Category"
              options={[
                { value: "", label: "No category" },
                ...categories
                  .filter((category) => category.type === categoryType)
                  .map((category) => ({ value: category.id, label: category.name })),
              ]}
            />
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

        {selectedType === "expense" ? (
          splitting || existingSplits.length > 0 ? (
            <SplitWith
              workspaceId={workspaceId}
              currency={currency}
              total={parseAmount(amountText, currency)}
              rows={splits}
              existing={existingSplits}
              onChange={setSplits}
            />
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSplitting(true);
                setSplits([newSplitRow()]);
              }}
            >
              Split with someone
            </Button>
          )
        ) : null}

        {transaction ? (
          <LinkedDocuments
            workspaceId={workspaceId}
            kind="transaction"
            recordId={transaction.id}
            heading="Receipts and documents"
          />
        ) : null}

        <FormAlert message={errors.root?.server?.message ?? null} />

        <DialogFormActions
          busy={saving}
          onCancel={close}
          submitLabel={transaction ? "Save changes" : "Record"}
        />
      </form>
    </Dialog>
  );
}
