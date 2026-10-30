"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type {
  FinanceAccount,
  FinanceCategory,
  RecurringKind,
  RecurringPayment,
  UpdateRecurringPaymentRequest,
} from "@orbit/contracts";
import { useId } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { InferType } from "yup";

import { describeApiError } from "@/api/client";
import { AmountField, DateField, FormAlert, FormField, SelectField } from "@/components/form-field";
import { Textarea } from "@/components/ui/textarea";
import { useCommitmentMutations } from "@/hooks/use-commitments";
import { FREQUENCIES, recurringSchema, toReminderRequest } from "@/lib/commitments";
import {
  CURRENCY_OPTIONS,
  DEFAULT_CURRENCY,
  parseAmount,
  payingAccounts,
  toDecimalString,
} from "@/lib/finance";
import { localDateString } from "@/utils/dates";
import { browserTimeZone } from "@/utils/time-zones";

import { ReminderFields } from "./commitment-parts";
import { DialogShell } from "./dialog-shell";

type Values = InferType<typeof recurringSchema>;

type RecurringDialogProps = {
  workspaceId: string;
  kind: RecurringKind;
  /** Edit this one; omit to add a new one. */
  payment?: RecurringPayment;
  accounts: readonly FinanceAccount[];
  categories: readonly FinanceCategory[];
  onSaved: (message: string) => void;
  onClose: () => void;
};

const NOUN: Record<RecurringKind, string> = { subscription: "subscription", bill: "bill" };

/** Adds or edits a subscription or a recurring bill. Changing the schedule keeps its history. */
export function RecurringDialog({
  workspaceId,
  kind,
  payment,
  accounts,
  categories,
  onSaved,
  onClose,
}: RecurringDialogProps) {
  const id = useId();
  const { createRecurring, updateRecurring } = useCommitmentMutations(workspaceId);
  // A paused or cancelled one has no next due date; the form starts at today.
  const initialNextDue = payment?.next_due_date ?? localDateString();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: saving },
  } = useForm<Values>({
    resolver: yupResolver(recurringSchema),
    defaultValues: {
      kind,
      name: payment?.name ?? "",
      provider: payment?.provider ?? "",
      amount: payment ? toDecimalString(payment.amount, payment.currency) : "",
      currency: payment?.currency ?? DEFAULT_CURRENCY,
      amountVaries: payment?.amount_varies ?? false,
      frequency: payment?.frequency ?? "monthly",
      nextDueDate: initialNextDue,
      startDate: payment?.start_date ?? "",
      endDate: payment?.end_date ?? "",
      trialEndsOn: payment?.trial_ends_on ?? "",
      autoRenew: payment?.auto_renew ?? true,
      categoryId: payment?.category_id ?? "",
      accountId: payment?.account_id ?? "",
      notes: payment?.notes ?? "",
      reminderDays: payment?.reminder ? String(payment.reminder.days_before) : "",
      reminderTime: payment?.reminder?.time_of_day.slice(0, 5) ?? "09:00",
    },
  });
  const currency = useWatch({ control, name: "currency" });
  const usable = payingAccounts(accounts, currency);
  const expenseCategories = categories.filter((category) => category.type === "expense");
  const noun = NOUN[kind];

  async function save(values: Values, close: () => void) {
    const amount = parseAmount(values.amount, values.currency);
    if (amount === null) return;
    const reminder = toReminderRequest(
      values.reminderDays,
      values.reminderTime,
      payment?.reminder?.timezone ?? browserTimeZone(),
    );
    try {
      if (payment) {
        const changes: UpdateRecurringPaymentRequest = {};
        if (values.name !== payment.name) changes.name = values.name;
        if (values.provider !== payment.provider) changes.provider = values.provider;
        if (amount !== payment.amount) changes.amount = amount;
        if (values.amountVaries !== payment.amount_varies)
          changes.amount_varies = values.amountVaries;
        if (values.frequency !== payment.frequency) changes.frequency = values.frequency;
        if (values.nextDueDate !== initialNextDue) {
          changes.next_due_date = values.nextDueDate;
        }
        if (values.startDate && values.startDate !== payment.start_date) {
          changes.start_date = values.startDate;
        }
        if ((values.endDate || null) !== payment.end_date)
          changes.end_date = values.endDate || null;
        if ((values.trialEndsOn || null) !== payment.trial_ends_on) {
          changes.trial_ends_on = values.trialEndsOn || null;
        }
        if (values.autoRenew !== payment.auto_renew) changes.auto_renew = values.autoRenew;
        if ((values.categoryId || null) !== payment.category_id) {
          changes.category_id = values.categoryId || null;
        }
        if ((values.accountId || null) !== payment.account_id) {
          changes.account_id = values.accountId || null;
        }
        if (values.notes !== payment.notes) changes.notes = values.notes;
        const before = payment.reminder
          ? `${payment.reminder.days_before}@${payment.reminder.time_of_day.slice(0, 5)}`
          : "";
        const after = reminder ? `${reminder.days_before}@${reminder.time_of_day}` : "";
        if (before !== after) changes.reminder = reminder;
        if (Object.keys(changes).length > 0) {
          await updateRecurring.mutateAsync({ id: payment.id, changes });
          onSaved(`Saved “${values.name}”.`);
        }
      } else {
        const created = await createRecurring.mutateAsync({
          kind,
          name: values.name,
          provider: values.provider,
          amount,
          currency: values.currency,
          amount_varies: values.amountVaries,
          frequency: values.frequency,
          next_due_date: values.nextDueDate,
          start_date: values.startDate || null,
          end_date: values.endDate || null,
          trial_ends_on: kind === "subscription" ? values.trialEndsOn || null : null,
          auto_renew: values.autoRenew,
          category_id: values.categoryId || null,
          account_id: values.accountId || null,
          notes: values.notes,
          reminder,
        });
        onSaved(`Added “${created.name}”.`);
      }
      close();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, `Couldn’t save the ${noun}. Try again.`),
      });
    }
  }

  return (
    <DialogShell
      title={payment ? `Edit ${noun}` : `Add a ${noun}`}
      description={
        kind === "subscription"
          ? "Streaming, software, AI tools, gym, broadband… Renewals are expected payments until you record them."
          : "Rent, electricity, water, insurance, maintenance… Bills are expected until you record a payment."
      }
      busy={saving}
      onClose={onClose}
      submitLabel={payment ? "Save changes" : `Add ${noun}`}
      wide
      onSubmit={(event, close) => void handleSubmit((values) => save(values, close))(event)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Name"
          autoComplete="off"
          autoFocus
          placeholder={kind === "subscription" ? "Netflix, ChatGPT Plus…" : "Rent, Electricity…"}
          {...register("name")}
          error={errors.name?.message}
        />
        <FormField
          label={kind === "subscription" ? "Provider (optional)" : "Biller (optional)"}
          autoComplete="off"
          {...register("provider")}
          error={errors.provider?.message}
        />
        {payment ? null : (
          <SelectField
            control={control}
            name="currency"
            label="Currency"
            options={CURRENCY_OPTIONS}
          />
        )}
        <AmountField
          control={control}
          name="amount"
          currency={currency}
          label={`Amount (${currency})`}
        />
        <SelectField control={control} name="frequency" label="Repeats" options={FREQUENCIES} />
        <DateField
          control={control}
          name="nextDueDate"
          label={kind === "subscription" ? "Next renewal" : "Next due"}
          hint={payment ? "Changing it restarts the schedule; past payments stay." : undefined}
        />
        <SelectField
          control={control}
          name="categoryId"
          label="Category"
          options={[
            { value: "", label: "No category" },
            ...expenseCategories.map((category) => ({ value: category.id, label: category.name })),
          ]}
        />
        <SelectField
          control={control}
          name="accountId"
          label="Paid from (optional)"
          options={[
            { value: "", label: "Choose when paying" },
            ...usable.map((account) => ({ value: account.id, label: account.name })),
          ]}
        />
      </div>

      <div className="flex flex-col gap-2 text-sm sm:flex-row sm:gap-6">
        {kind === "bill" ? (
          <label className="flex items-center gap-2">
            <input type="checkbox" className="accent-brand" {...register("amountVaries")} />
            The amount varies (an estimate)
          </label>
        ) : (
          <label className="flex items-center gap-2">
            <input type="checkbox" className="accent-brand" {...register("autoRenew")} />
            Renews automatically
          </label>
        )}
      </div>

      <details className="rounded-lg border p-3 text-sm">
        <summary className="cursor-pointer rounded-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
          More dates
        </summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <DateField
            control={control}
            name="startDate"
            label="Started"
            hint="Defaults to the next due date."
            clearable
          />
          <DateField control={control} name="endDate" label="Ends (optional)" clearable />
          {kind === "subscription" ? (
            <DateField
              control={control}
              name="trialEndsOn"
              label="Trial ends (optional)"
              clearable
            />
          ) : null}
        </div>
      </details>

      <ReminderFields
        days={register("reminderDays")}
        time={register("reminderTime")}
        daysError={errors.reminderDays?.message}
      />

      <div className="space-y-1.5">
        <label htmlFor={`${id}-notes`} className="block text-sm font-medium">
          Notes <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Textarea id={`${id}-notes`} rows={2} {...register("notes")} />
      </div>

      <FormAlert message={errors.root?.server?.message ?? null} />
    </DialogShell>
  );
}
