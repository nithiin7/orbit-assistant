"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { Installment, Loan, UpdateInstallmentRequest } from "@orbit/contracts";
import { useForm } from "react-hook-form";
import { object, string } from "yup";

import { describeApiError } from "@/api/client";
import { FormAlert, FormField } from "@/components/form-field";
import { useCommitmentMutations } from "@/hooks/use-commitments";
import { formatRate, parseComponent, parseRate } from "@/lib/commitments";
import { formatMoney, parseAmount, toDecimalString } from "@/lib/finance";
import { formatCalendarDate } from "@/utils/dates";

import { DialogShell } from "./dialog-shell";

const AMOUNT_HINT = "Enter an amount, such as 1250 or 1,250.50.";

type InstallmentValues = { dueDate: string; principal: string; interest: string };

/** Adjusts one scheduled installment by hand, for a lender that doesn't follow the schedule. */
export function InstallmentDialog({
  workspaceId,
  loan,
  installment,
  onSaved,
  onClose,
}: {
  workspaceId: string;
  loan: Loan;
  installment: Installment;
  onSaved: (message: string) => void;
  onClose: () => void;
}) {
  const { adjustInstallment } = useCommitmentMutations(workspaceId);
  const component = string()
    .trim()
    .defined()
    .test("amount", AMOUNT_HINT, (value) => parseComponent(value, loan.currency) !== null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: saving },
  } = useForm<InstallmentValues>({
    resolver: yupResolver(
      object({
        dueDate: string().required("Choose a date."),
        principal: component,
        interest: component,
      }),
    ),
    defaultValues: {
      dueDate: installment.due_date,
      principal: toDecimalString(installment.principal, loan.currency),
      interest: toDecimalString(installment.interest, loan.currency),
    },
  });

  async function save(values: InstallmentValues, close: () => void) {
    const principal = parseComponent(values.principal, loan.currency) ?? 0;
    const interest = parseComponent(values.interest, loan.currency) ?? 0;
    if (principal + interest === 0) {
      setError("principal", { message: "An installment must have an amount." });
      return;
    }
    const changes: UpdateInstallmentRequest = {};
    if (values.dueDate !== installment.due_date) changes.due_date = values.dueDate;
    if (principal !== installment.principal) changes.principal = principal;
    if (interest !== installment.interest) changes.interest = interest;
    try {
      if (Object.keys(changes).length > 0) {
        await adjustInstallment.mutateAsync({
          loanId: loan.id,
          installmentId: installment.id,
          changes,
        });
        onSaved(`Adjusted installment ${installment.sequence}.`);
      }
      close();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t adjust the installment. Try again."),
      });
    }
  }

  return (
    <DialogShell
      title={`Adjust installment ${installment.sequence}`}
      description={`${loan.name}, due ${formatCalendarDate(installment.due_date)}.`}
      busy={saving}
      onClose={onClose}
      submitLabel="Save"
      onSubmit={(event, close) => void handleSubmit((values) => save(values, close))(event)}
    >
      <FormField
        label="Due date"
        type="date"
        {...register("dueDate")}
        error={errors.dueDate?.message}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label={`Principal (${loan.currency})`}
          inputMode="decimal"
          autoComplete="off"
          {...register("principal")}
          error={errors.principal?.message}
        />
        <FormField
          label={`Interest (${loan.currency})`}
          inputMode="decimal"
          autoComplete="off"
          {...register("interest")}
          error={errors.interest?.message}
        />
      </div>
      <FormAlert message={errors.root?.server?.message ?? null} />
    </DialogShell>
  );
}

type RescheduleValues = { rate: string; emi: string; nextPaymentDate: string };

/**
 * Regenerates the unpaid installments from what is still owed: after a prepayment (a transfer
 * into the loan account) or when the lender changes the rate.
 */
export function RescheduleDialog({
  workspaceId,
  loan,
  onSaved,
  onClose,
}: {
  workspaceId: string;
  loan: Loan;
  onSaved: (message: string) => void;
  onClose: () => void;
}) {
  const { rescheduleLoan } = useCommitmentMutations(workspaceId);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: saving },
  } = useForm<RescheduleValues>({
    resolver: yupResolver(
      object({
        rate: string()
          .trim()
          .required("Enter the interest rate.")
          .test(
            "rate",
            "Enter a rate such as 8.5 (up to 100).",
            (value) => parseRate(value) !== null,
          ),
        emi: string()
          .trim()
          .defined()
          .test(
            "emi",
            AMOUNT_HINT,
            (value) => value === "" || parseAmount(value, loan.currency) !== null,
          ),
        nextPaymentDate: string().defined(),
      }),
    ),
    defaultValues: {
      rate: formatRate(loan.interest_rate_bps),
      emi: "",
      nextPaymentDate: loan.next_payment_date ?? "",
    },
  });

  async function save(values: RescheduleValues, close: () => void) {
    const rate = parseRate(values.rate);
    try {
      await rescheduleLoan.mutateAsync({
        id: loan.id,
        body: {
          interest_rate_bps: rate === loan.interest_rate_bps ? null : rate,
          emi_amount: values.emi ? parseAmount(values.emi, loan.currency) : null,
          next_payment_date:
            values.nextPaymentDate && values.nextPaymentDate !== loan.next_payment_date
              ? values.nextPaymentDate
              : null,
        },
      });
      onSaved(`Rescheduled “${loan.name}”.`);
      close();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t reschedule the loan. Try again."),
      });
    }
  }

  return (
    <DialogShell
      title={`Reschedule ${loan.name}`}
      description={`Rebuilds the unpaid installments from the ${formatMoney(loan.outstanding_principal, loan.currency)} still owed. Paid installments stay as they are.`}
      busy={saving}
      onClose={onClose}
      submitLabel="Reschedule"
      onSubmit={(event, close) => void handleSubmit((values) => save(values, close))(event)}
    >
      <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
        Made a prepayment? Record it first as a transfer into the “{loan.name}” account, so it
        counts toward what you owe.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Interest rate (% a year)"
          inputMode="decimal"
          autoComplete="off"
          {...register("rate")}
          error={errors.rate?.message}
        />
        <FormField
          label={`New EMI (${loan.currency}, optional)`}
          inputMode="decimal"
          autoComplete="off"
          hint="Blank keeps the number of EMIs and works out a new amount. A new EMI changes the tenure."
          {...register("emi")}
          error={errors.emi?.message}
        />
      </div>
      <FormField label="Next EMI" type="date" {...register("nextPaymentDate")} />
      <FormAlert message={errors.root?.server?.message ?? null} />
    </DialogShell>
  );
}
