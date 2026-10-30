"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { Currency, FinanceAccount, FinanceTransaction } from "@orbit/contracts";
import { type Control, useForm, useWatch } from "react-hook-form";
import type { InferType } from "yup";

import { describeApiError } from "@/api/client";
import { AmountField, DateField, FormAlert, SelectField } from "@/components/form-field";
import { useCommitmentMutations } from "@/hooks/use-commitments";
import { useTransactionHistory } from "@/hooks/use-finance";
import { parseComponent, paymentSchema } from "@/lib/commitments";
import { formatMoney, parseAmount, payingAccounts, toDecimalString } from "@/lib/finance";
import { cn } from "@/utils/common";
import { addDays, formatCalendarDate, localDateString } from "@/utils/dates";

import { DialogShell } from "./dialog-shell";

/** What is being paid: one loan installment, or one subscription or bill occurrence. */
export type PaymentTarget =
  | {
      kind: "loan";
      loanId: string;
      installmentId: string;
      name: string;
      currency: Currency;
      dueDate: string;
      principal: number;
      interest: number;
      /** The loan's own account: principal transfers go into it. */
      loanAccountId: string;
      defaultAccountId: string | null;
    }
  | {
      kind: "subscription" | "bill";
      paymentId: string;
      name: string;
      currency: Currency;
      dueDate: string;
      amount: number;
      estimated: boolean;
      defaultAccountId: string | null;
    };

type Values = InferType<typeof paymentSchema>;
type Mode = Values["mode"];

type PaymentDialogProps = {
  workspaceId: string;
  target: PaymentTarget;
  accounts: readonly FinanceAccount[];
  onSaved: (message: string) => void;
  onClose: () => void;
};

/**
 * Records a payment. Orbit can record the transactions for you (for a loan: the principal as a
 * transfer into the loan account, the interest as an expense), link ones you already recorded,
 * or, for subscriptions and bills, mark it paid without a transaction.
 */
export function PaymentDialog({
  workspaceId,
  target,
  accounts,
  onSaved,
  onClose,
}: PaymentDialogProps) {
  const { payInstallment, recordRecurring } = useCommitmentMutations(workspaceId);
  const isLoan = target.kind === "loan";
  const usable = payingAccounts(accounts, target.currency);
  const firstAccount =
    usable.find((account) => account.id === target.defaultAccountId) ?? usable[0];
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: saving },
  } = useForm<Values>({
    resolver: yupResolver(paymentSchema),
    defaultValues: {
      mode: "create",
      isLoan,
      currency: target.currency,
      paidOn: localDateString(),
      accountId: firstAccount?.id ?? "",
      amount:
        target.kind === "loan" || target.estimated
          ? ""
          : toDecimalString(target.amount, target.currency),
      principal: isLoan ? toDecimalString(target.principal, target.currency) : "",
      interest: isLoan ? toDecimalString(target.interest, target.currency) : "",
      transactionId: "",
      interestTransactionId: "",
    },
  });
  const mode = useWatch({ control, name: "mode" });

  async function save(values: Values, close: () => void) {
    try {
      if (target.kind === "loan") {
        if (values.mode === "link") {
          await payInstallment.mutateAsync({
            loanId: target.loanId,
            installmentId: target.installmentId,
            body: {
              paid_on: values.paidOn,
              principal_transaction_id: values.transactionId || null,
              interest_transaction_id: values.interestTransactionId || null,
            },
          });
        } else {
          const principal = parseComponent(values.principal, target.currency) ?? 0;
          const interest = parseComponent(values.interest, target.currency) ?? 0;
          if (principal + interest === 0) {
            setError("principal", { message: "Enter what was paid." });
            return;
          }
          await payInstallment.mutateAsync({
            loanId: target.loanId,
            installmentId: target.installmentId,
            body: {
              paid_on: values.paidOn,
              from_account_id: values.accountId,
              principal,
              interest,
            },
          });
        }
      } else {
        const amount = values.amount ? parseAmount(values.amount, target.currency) : null;
        await recordRecurring.mutateAsync({
          paymentId: target.paymentId,
          body: {
            due_date: target.dueDate,
            paid_on: values.paidOn,
            mode: values.mode,
            amount: values.mode === "link" ? null : amount,
            account_id: values.mode === "create" ? values.accountId : null,
            transaction_id: values.mode === "link" ? values.transactionId : null,
          },
        });
      }
      onSaved(`Recorded the payment for “${target.name}”.`);
      close();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t record the payment. Try again."),
      });
    }
  }

  const modes: { value: Mode; label: string; hint: string }[] = [
    {
      value: "create",
      label: "Record it now",
      hint: isLoan
        ? "Adds a transfer for the principal and an expense for the interest."
        : "Adds an expense in its category.",
    },
    { value: "link", label: "Link existing", hint: "You already recorded the transaction." },
    ...(isLoan
      ? []
      : [
          {
            value: "manual" as const,
            label: "Mark paid only",
            hint: "No transaction, so it isn’t counted as spending.",
          },
        ]),
  ];

  return (
    <DialogShell
      title={`Record payment: ${target.name}`}
      description={`Due ${formatCalendarDate(target.dueDate)}.`}
      busy={saving}
      onClose={onClose}
      submitLabel="Record payment"
      onSubmit={(event, close) => void handleSubmit((values) => save(values, close))(event)}
    >
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">How was it paid?</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {modes.map((option) => (
            <label
              key={option.value}
              className={cn(
                "flex cursor-pointer flex-col gap-0.5 rounded-lg border p-3 text-sm transition-colors duration-150 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                mode === option.value ? "border-brand bg-brand-subtle/40" : "hover:bg-accent/40",
              )}
            >
              <span className="flex items-center gap-2 font-medium">
                <input
                  type="radio"
                  value={option.value}
                  className="accent-brand"
                  {...register("mode")}
                />
                {option.label}
              </span>
              <span className="text-xs text-muted-foreground">{option.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <DateField control={control} name="paidOn" label="Paid on" />

      {mode === "create" ? (
        usable.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            Add an account in {target.currency} to record payments from it.
          </p>
        ) : (
          <SelectField
            control={control}
            name="accountId"
            label="Paid from"
            placeholder="Choose an account"
            options={usable.map((account) => ({ value: account.id, label: account.name }))}
          />
        )
      ) : null}

      {mode !== "link" && target.kind === "loan" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <AmountField
            control={control}
            name="principal"
            currency={target.currency}
            label={`Principal (${target.currency})`}
            hint="Reduces what you owe. Not spending."
          />
          <AmountField
            control={control}
            name="interest"
            currency={target.currency}
            label={`Interest (${target.currency})`}
            hint="Counted as a Loan interest expense."
          />
        </div>
      ) : null}

      {mode !== "link" && target.kind !== "loan" ? (
        <AmountField
          control={control}
          name="amount"
          currency={target.currency}
          label={`Amount paid (${target.currency})`}
          placeholder={toDecimalString(target.amount, target.currency)}
          hint={
            target.estimated
              ? `Estimated ${formatMoney(target.amount, target.currency)}. Enter the actual bill.`
              : "Leave as is unless it changed."
          }
        />
      ) : null}

      {mode === "link" ? (
        <LinkFields
          workspaceId={workspaceId}
          target={target}
          control={control}
          error={errors.interestTransactionId?.message}
        />
      ) : null}

      <FormAlert message={errors.root?.server?.message ?? null} />
    </DialogShell>
  );
}

/**
 * Pick the transactions to link from those recorded within a month of the due date. Shown only in
 * link mode, so their history is fetched only when needed.
 */
function LinkFields({
  workspaceId,
  target,
  control,
  error,
}: {
  workspaceId: string;
  target: PaymentTarget;
  control: Control<Values>;
  /** "Choose at least one", reported on the interest field. */
  error?: string;
}) {
  const { state } = useTransactionHistory(workspaceId, {
    date_from: addDays(target.dueDate, -31),
    date_to: addDays(target.dueDate, 31),
    type: target.kind === "loan" ? ["transfer", "expense"] : ["expense"],
    limit: 200,
  });
  if (state.status === "loading") {
    return <p className="text-sm text-muted-foreground">Loading transactions…</p>;
  }
  if (state.status === "error") return <FormAlert message={state.message} />;

  const inCurrency = state.data.transactions.filter(
    (transaction) => transaction.currency === target.currency,
  );
  const describe = (transaction: FinanceTransaction) => ({
    value: transaction.id,
    label: `${formatCalendarDate(transaction.occurred_on)} · ${transaction.description} · ${formatMoney(transaction.amount, transaction.currency)}`,
  });

  if (target.kind === "loan") {
    const transfers = inCurrency.filter(
      (transaction) =>
        transaction.type === "transfer" && transaction.to_account_id === target.loanAccountId,
    );
    const expenses = inCurrency.filter((transaction) => transaction.type === "expense");
    return (
      <div className="space-y-4">
        <SelectField
          control={control}
          name="transactionId"
          label="Principal: a transfer into the loan account"
          options={[{ value: "", label: "None" }, ...transfers.map(describe)]}
        />
        <SelectField
          control={control}
          name="interestTransactionId"
          label="Interest: an expense"
          options={[{ value: "", label: "None" }, ...expenses.map(describe)]}
        />
      </div>
    );
  }
  const expenses = inCurrency.filter((transaction) => transaction.type === "expense");
  return (
    <>
      <SelectField
        control={control}
        name="transactionId"
        label="Expense"
        placeholder="Choose a transaction"
        options={expenses.map(describe)}
        error={error}
      />
      {expenses.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No expenses in {target.currency} within a month of the due date.
        </p>
      ) : null}
    </>
  );
}
