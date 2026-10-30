"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { FinanceAccount, Loan, UpdateLoanRequest } from "@orbit/contracts";
import { useId } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { InferType } from "yup";

import { describeApiError } from "@/api/client";
import { FormAlert, FormField } from "@/components/form-field";
import { Textarea } from "@/components/ui/textarea";
import { useCommitmentMutations } from "@/hooks/use-commitments";
import {
  EMI_FREQUENCIES,
  formatRate,
  INTEREST_METHODS,
  LOAN_TYPES,
  loanSchema,
  parseRate,
  toReminderRequest,
} from "@/lib/commitments";
import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  parseAmount,
  payingAccounts,
  toDecimalString,
} from "@/lib/finance";
import { localDateString } from "@/utils/dates";
import { browserTimeZone } from "@/utils/time-zones";

import { ReminderFields } from "./commitment-parts";
import { DialogShell } from "./dialog-shell";
import { SelectField } from "./transaction-dialog";

type Values = InferType<typeof loanSchema>;

type LoanDialogProps = {
  workspaceId: string;
  /** Edit this loan; omit to add a new one. */
  loan?: Loan;
  accounts: readonly FinanceAccount[];
  onSaved: (message: string) => void;
  onClose: () => void;
};

/**
 * Adds a loan with its terms, or edits its details. Terms (amount, rate, tenure) are fixed once
 * the schedule exists; a rate change or prepayment goes through "Reschedule" instead.
 */
export function LoanDialog({ workspaceId, loan, accounts, onSaved, onClose }: LoanDialogProps) {
  const id = useId();
  const { createLoan, updateLoan } = useCommitmentMutations(workspaceId);
  const today = localDateString();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: saving },
  } = useForm<Values>({
    resolver: yupResolver(loanSchema),
    defaultValues: {
      name: loan?.name ?? "",
      lender: loan?.lender ?? "",
      loanType: loan?.loan_type ?? "home",
      currency: loan?.currency ?? DEFAULT_CURRENCY,
      principal: loan ? toDecimalString(loan.principal, loan.currency) : "",
      outstanding: "",
      rate: loan ? formatRate(loan.interest_rate_bps) : "",
      interestMethod: loan?.interest_method ?? "reducing",
      startDate: loan?.start_date ?? today,
      tenureMonths: loan ? String(loan.tenure_months) : "",
      emiFrequency: loan?.emi_frequency ?? "monthly",
      firstPaymentDate: loan?.first_payment_date ?? "",
      nextPaymentDate: "",
      emi: "",
      paymentAccountId: loan?.payment_account_id ?? "",
      notes: loan?.notes ?? "",
      reminderDays: loan?.reminder ? String(loan.reminder.days_before) : "",
      reminderTime: loan?.reminder?.time_of_day.slice(0, 5) ?? "09:00",
    },
  });
  const currency = useWatch({ control, name: "currency" });
  const usable = payingAccounts(accounts, currency);

  async function save(values: Values, close: () => void) {
    const reminder = toReminderRequest(
      values.reminderDays,
      values.reminderTime,
      loan?.reminder?.timezone ?? browserTimeZone(),
    );
    try {
      if (loan) {
        const changes: UpdateLoanRequest = {};
        if (values.name !== loan.name) changes.name = values.name;
        if (values.lender !== loan.lender) changes.lender = values.lender;
        if (values.loanType !== loan.loan_type) changes.loan_type = values.loanType;
        if (values.notes !== loan.notes) changes.notes = values.notes;
        if ((values.paymentAccountId || null) !== loan.payment_account_id) {
          changes.payment_account_id = values.paymentAccountId || null;
        }
        const before = loan.reminder
          ? `${loan.reminder.days_before}@${loan.reminder.time_of_day.slice(0, 5)}`
          : "";
        const after = reminder ? `${reminder.days_before}@${reminder.time_of_day}` : "";
        if (before !== after) changes.reminder = reminder;
        if (Object.keys(changes).length > 0) {
          await updateLoan.mutateAsync({ id: loan.id, changes });
          onSaved(`Saved “${values.name}”.`);
        }
      } else {
        const principal = parseAmount(values.principal, values.currency);
        const rate = parseRate(values.rate);
        if (principal === null || rate === null) return;
        const outstanding = values.outstanding
          ? parseAmount(values.outstanding, values.currency)
          : null;
        const emi = values.emi ? parseAmount(values.emi, values.currency) : null;
        const created = await createLoan.mutateAsync({
          name: values.name,
          lender: values.lender,
          loan_type: values.loanType,
          currency: values.currency,
          principal,
          outstanding_principal: outstanding,
          interest_rate_bps: rate,
          interest_method: values.interestMethod,
          start_date: values.startDate,
          tenure_months: Number(values.tenureMonths),
          emi_frequency: values.emiFrequency,
          first_payment_date: values.firstPaymentDate,
          next_payment_date: values.nextPaymentDate || null,
          emi_amount: emi,
          payment_account_id: values.paymentAccountId || null,
          notes: values.notes,
          reminder,
        });
        onSaved(`Added “${created.name}” and its EMI schedule.`);
      }
      close();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t save the loan. Try again."),
      });
    }
  }

  return (
    <DialogShell
      title={loan ? "Edit loan" : "Add a loan"}
      description={
        loan
          ? "Amount, rate, and tenure are set; use Reschedule after a prepayment or rate change."
          : "Orbit tracks what you owe in a loan account and builds the EMI schedule."
      }
      busy={saving}
      onClose={onClose}
      submitLabel={loan ? "Save changes" : "Add loan"}
      wide
      onSubmit={(event, close) => void handleSubmit((values) => save(values, close))(event)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Name"
          autoComplete="off"
          autoFocus
          placeholder="Home loan, Car loan…"
          {...register("name")}
          error={errors.name?.message}
        />
        <FormField
          label="Lender (optional)"
          autoComplete="off"
          placeholder="SBI, HDFC…"
          {...register("lender")}
          error={errors.lender?.message}
        />
        <SelectField label="Type" {...register("loanType")}>
          {LOAN_TYPES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
        <SelectField label="EMIs paid from (optional)" {...register("paymentAccountId")}>
          <option value="">Choose when paying</option>
          {usable.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </SelectField>
      </div>

      {loan ? null : (
        <fieldset className="space-y-4">
          <legend className="text-sm font-medium">Terms</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField label="Currency" {...register("currency")}>
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </SelectField>
            <FormField
              label="Amount borrowed"
              inputMode="decimal"
              autoComplete="off"
              {...register("principal")}
              error={errors.principal?.message}
            />
            <FormField
              label="Interest rate (% a year)"
              inputMode="decimal"
              autoComplete="off"
              placeholder="8.5"
              {...register("rate")}
              error={errors.rate?.message}
            />
            <SelectField label="Interest" {...register("interestMethod")}>
              {INTEREST_METHODS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>
            <SelectField label="EMI every" {...register("emiFrequency")}>
              {EMI_FREQUENCIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>
            <FormField
              label="Tenure (months)"
              inputMode="numeric"
              autoComplete="off"
              placeholder="240"
              {...register("tenureMonths")}
              error={errors.tenureMonths?.message}
            />
            <FormField
              label="Loan start"
              type="date"
              {...register("startDate")}
              error={errors.startDate?.message}
            />
            <FormField
              label="First EMI"
              type="date"
              {...register("firstPaymentDate")}
              error={errors.firstPaymentDate?.message}
            />
            <FormField
              label="EMI (optional)"
              inputMode="decimal"
              autoComplete="off"
              hint="Blank: worked out from the terms."
              {...register("emi")}
              error={errors.emi?.message}
            />
          </div>
          <details className="rounded-lg border p-3 text-sm">
            <summary className="cursor-pointer rounded-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Already repaying this loan?
            </summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <FormField
                label="Still owed (principal)"
                inputMode="decimal"
                autoComplete="off"
                hint="From your latest statement."
                {...register("outstanding")}
                error={errors.outstanding?.message}
              />
              <FormField
                label="Next EMI"
                type="date"
                hint="Earlier EMIs aren’t tracked."
                {...register("nextPaymentDate")}
                error={errors.nextPaymentDate?.message}
              />
            </div>
          </details>
        </fieldset>
      )}

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
        {errors.notes ? (
          <p className="text-xs font-medium text-destructive">{errors.notes.message}</p>
        ) : null}
      </div>

      <FormAlert message={errors.root?.server?.message ?? null} />
    </DialogShell>
  );
}
