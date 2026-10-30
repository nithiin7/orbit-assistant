"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { FinanceAccount, UpdateFinanceAccountRequest } from "@orbit/contracts";
import { X } from "lucide-react";
import { useId } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { InferType } from "yup";

import { describeApiError } from "@/api/client";
import { AmountField, FormAlert, FormField, SelectField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useFinanceMutations } from "@/hooks/use-finance";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import {
  ACCOUNT_TYPES,
  accountSchema,
  accountTypeLabel,
  CURRENCY_OPTIONS,
  DEFAULT_CURRENCY,
  isLiability,
  parseSignedAmount,
  toDecimalString,
} from "@/lib/finance";

type AccountDialogProps = {
  workspaceId: string;
  /** Edit this account; omit to add a new one. */
  account?: FinanceAccount;
  onSaved: (message: string) => void;
  onClose: () => void;
};

type Values = InferType<typeof accountSchema>;

/**
 * Adds or edits an account. A credit card's starting balance is entered as the amount owed and
 * stored as a negative balance. Type and currency are fixed once the account exists.
 */
export function AccountDialog({ workspaceId, account, onSaved, onClose }: AccountDialogProps) {
  const id = useId();
  const { createAccount, updateAccount } = useFinanceMutations(workspaceId);
  const owedOnCard = (value: number, type: FinanceAccount["type"]) =>
    isLiability({ type }) ? -value : value;
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: saving },
  } = useForm<Values>({
    resolver: yupResolver(accountSchema),
    defaultValues: account
      ? {
          name: account.name,
          // Fixed once created; the field is only shown for new accounts.
          type: account.type === "loan" ? "other" : account.type,
          currency: account.currency,
          openingBalance:
            account.opening_balance === 0
              ? ""
              : toDecimalString(
                  owedOnCard(account.opening_balance, account.type),
                  account.currency,
                ),
          notes: account.notes,
        }
      : { name: "", type: "bank", currency: DEFAULT_CURRENCY, openingBalance: "", notes: "" },
  });
  const { close, dialogProps } = useModalDialog({ onClose, dismissible: !saving });
  const type = useWatch({ control, name: "type" });
  const currency = useWatch({ control, name: "currency" });
  const liability = isLiability({ type: account?.type ?? type });

  async function save(values: Values) {
    const entered = parseSignedAmount(values.openingBalance, values.currency) ?? 0;
    const openingBalance = owedOnCard(entered, account?.type ?? values.type);
    try {
      if (account) {
        const changes: UpdateFinanceAccountRequest = {};
        if (values.name !== account.name) changes.name = values.name;
        if (openingBalance !== account.opening_balance) changes.opening_balance = openingBalance;
        if (values.notes !== account.notes) changes.notes = values.notes;
        if (Object.keys(changes).length > 0) {
          await updateAccount.mutateAsync({ id: account.id, changes });
          onSaved(`Saved “${values.name}”.`);
        }
      } else {
        const created = await createAccount.mutateAsync({
          name: values.name,
          type: values.type,
          currency: values.currency,
          opening_balance: openingBalance,
          notes: values.notes,
        });
        onSaved(`Added “${created.name}”.`);
      }
      close();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t save the account. Try again."),
      });
    }
  }

  return (
    <dialog
      {...dialogProps}
      aria-labelledby={`${id}-heading`}
      className="dialog-motion dialog-pop mx-auto mt-[8vh] max-h-[86vh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-xl border bg-popover p-0 text-popover-foreground shadow-elevation-3"
    >
      <form
        noValidate
        onSubmit={(event) => void handleSubmit(save)(event)}
        className="space-y-4 p-5"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 id={`${id}-heading`} className="text-base font-semibold">
              {account ? "Edit account" : "Add an account"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {account
                ? `${accountTypeLabel(account.type)} in ${account.currency}.`
                : "Tracked by hand. Orbit never asks for bank logins."}
            </p>
          </div>
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

        <FormField
          label="Name"
          autoComplete="off"
          autoFocus
          placeholder="HDFC Savings, Wallet, Amex…"
          {...register("name")}
          error={errors.name?.message}
        />

        {account ? null : (
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField control={control} name="type" label="Type" options={ACCOUNT_TYPES} />
            <SelectField
              control={control}
              name="currency"
              label="Currency"
              options={CURRENCY_OPTIONS}
            />
          </div>
        )}

        <AmountField
          control={control}
          name="openingBalance"
          currency={currency}
          label={liability ? `Amount owed (${currency})` : `Opening balance (${currency})`}
          placeholder="0.00"
          hint={
            account?.type === "loan"
              ? "The principal owed before the first payment you record. Normally set by the loan."
              : liability
                ? "The outstanding card balance before the first transaction you record."
                : "The balance before the first transaction you record. Negative if overdrawn."
          }
        />

        <div className="space-y-1.5">
          <label htmlFor={`${id}-notes`} className="block text-sm font-medium">
            Notes <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Textarea id={`${id}-notes`} rows={2} {...register("notes")} />
          {errors.notes ? (
            <p className="text-xs font-medium text-destructive">{errors.notes.message}</p>
          ) : null}
        </div>

        <FormAlert message={errors.root?.server?.message ?? null} />

        <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
          <Button variant="ghost" disabled={saving} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : account ? "Save changes" : "Add account"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
