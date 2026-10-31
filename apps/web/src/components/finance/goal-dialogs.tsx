"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type {
  ContributionType,
  CreateContributionRequest,
  FinanceAccount,
  SavingsGoal,
  UpdateGoalRequest,
} from "@orbit/contracts";
import { useId } from "react";
import { type Control, useForm, useWatch } from "react-hook-form";
import type { InferType } from "yup";

import { describeApiError } from "@/api/client";
import { AmountField, DateField, FormAlert, FormField, SelectField } from "@/components/form-field";
import { Textarea } from "@/components/ui/textarea";
import { useBudgetMutations } from "@/hooks/use-budgets";
import { useTransactionHistory } from "@/hooks/use-finance";
import {
  CURRENCY_OPTIONS,
  DEFAULT_CURRENCY,
  formatMoney,
  parseAmount,
  payingAccounts,
  toDecimalString,
} from "@/lib/finance";
import {
  CONTRIBUTION_MODES,
  contributionSchema,
  GOAL_CATEGORIES,
  GOAL_PRIORITIES,
  goalSchema,
  savingsAccounts,
} from "@/lib/goals";
import { formatCalendarDate, localDateString } from "@/utils/dates";

import { DialogShell } from "./dialog-shell";

type GoalValues = InferType<typeof goalSchema>;

/** Adds or edits a savings goal. Its target and date can change; contributions stay. */
export function GoalDialog({
  workspaceId,
  goal,
  accounts,
  onSaved,
  onClose,
}: {
  workspaceId: string;
  goal?: SavingsGoal;
  accounts: readonly FinanceAccount[];
  onSaved: (message: string) => void;
  onClose: () => void;
}) {
  const id = useId();
  const { createGoal, updateGoal } = useBudgetMutations(workspaceId);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: saving },
  } = useForm<GoalValues>({
    resolver: yupResolver(goalSchema),
    defaultValues: {
      name: goal?.name ?? "",
      description: goal?.description ?? "",
      category: goal?.category ?? "emergency_fund",
      priority: goal?.priority ?? "medium",
      currency: goal?.currency ?? DEFAULT_CURRENCY,
      targetAmount: goal ? toDecimalString(goal.target_amount, goal.currency) : "",
      startDate: goal?.start_date ?? localDateString(),
      targetDate: goal?.target_date ?? "",
      accountId: goal?.account_id ?? "",
      notes: goal?.notes ?? "",
    },
  });
  const currency = useWatch({ control, name: "currency" });
  const usable = savingsAccounts(accounts, currency);
  // A goal's transfers tie it to its account, so a linked account stays listed while archived.
  const linked = goal?.account_id ? accounts.find((entry) => entry.id === goal.account_id) : null;
  const accountOptions = [
    { value: "", label: "Not linked: track it on its own" },
    ...(linked && !usable.includes(linked) ? [linked] : []).concat(usable).map((account) => ({
      value: account.id,
      label: account.name,
    })),
  ];

  async function save(values: GoalValues, close: () => void) {
    const target = parseAmount(values.targetAmount, values.currency);
    if (target === null) return;
    try {
      if (goal) {
        const changes: UpdateGoalRequest = {};
        if (values.name !== goal.name) changes.name = values.name;
        if (values.description !== goal.description) changes.description = values.description;
        if (values.category !== goal.category) changes.category = values.category;
        if (values.priority !== goal.priority) changes.priority = values.priority;
        if (target !== goal.target_amount) changes.target_amount = target;
        if (values.startDate !== goal.start_date) changes.start_date = values.startDate;
        if ((values.targetDate || null) !== goal.target_date) {
          changes.target_date = values.targetDate || null;
        }
        if ((values.accountId || null) !== goal.account_id) {
          changes.account_id = values.accountId || null;
        }
        if (values.notes !== goal.notes) changes.notes = values.notes;
        if (Object.keys(changes).length > 0) {
          await updateGoal.mutateAsync({ id: goal.id, changes });
          onSaved(`Saved “${values.name}”.`);
        }
      } else {
        const created = await createGoal.mutateAsync({
          name: values.name,
          description: values.description,
          category: values.category,
          priority: values.priority,
          currency: values.currency,
          target_amount: target,
          start_date: values.startDate,
          target_date: values.targetDate || null,
          account_id: values.accountId || null,
          notes: values.notes,
        });
        onSaved(`Added the “${created.name}” goal.`);
      }
      close();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t save the goal. Try again."),
      });
    }
  }

  return (
    <DialogShell
      title={goal ? `Edit “${goal.name}”` : "Add a savings goal"}
      description="A goal earmarks money; it’s never spending, and it doesn’t change your balances or net worth."
      busy={saving}
      onClose={onClose}
      submitLabel={goal ? "Save changes" : "Add goal"}
      wide
      onSubmit={(event, close) => void handleSubmit((values) => save(values, close))(event)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Name"
          autoComplete="off"
          autoFocus
          placeholder="Emergency fund, New laptop…"
          {...register("name")}
          error={errors.name?.message}
        />
        <SelectField control={control} name="category" label="Kind" options={GOAL_CATEGORIES} />
        {goal ? null : (
          <SelectField
            control={control}
            name="currency"
            label="Currency"
            options={CURRENCY_OPTIONS}
          />
        )}
        <AmountField
          control={control}
          name="targetAmount"
          currency={currency}
          label={`Target (${currency})`}
        />
        <DateField control={control} name="startDate" label="Started" />
        <DateField
          control={control}
          name="targetDate"
          label="Target date (optional)"
          hint="Orbit suggests a monthly amount to reach it."
          clearable
        />
        <SelectField control={control} name="priority" label="Priority" options={GOAL_PRIORITIES} />
        <SelectField
          control={control}
          name="accountId"
          label="Kept in"
          options={accountOptions}
          hint="Link the account the savings sit in to record transfers into it."
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`${id}-description`} className="block text-sm font-medium">
          Description <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Textarea id={`${id}-description`} rows={2} {...register("description")} />
      </div>
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

type ContributionValues = InferType<typeof contributionSchema>;

/**
 * Puts money into a goal or takes it out: by earmarking money already held, by recording a
 * transfer into (or out of) the goal's account, or by linking a transfer already recorded.
 */
export function ContributionDialog({
  workspaceId,
  goal,
  type,
  accounts,
  onSaved,
  onClose,
}: {
  workspaceId: string;
  goal: SavingsGoal;
  type: ContributionType;
  accounts: readonly FinanceAccount[];
  onSaved: (message: string) => void;
  onClose: () => void;
}) {
  const id = useId();
  const { contribute } = useBudgetMutations(workspaceId);
  const linked = goal.account_id !== null;
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: saving },
  } = useForm<ContributionValues>({
    resolver: yupResolver(contributionSchema),
    defaultValues: {
      type,
      mode: "allocate",
      currency: goal.currency,
      amount: "",
      occurredOn: localDateString(),
      accountId: "",
      transactionId: "",
      notes: "",
    },
  });
  const mode = useWatch({ control, name: "mode" });
  const others = payingAccounts(accounts, goal.currency).filter(
    (account) => account.id !== goal.account_id,
  );
  const withdrawal = type === "withdrawal";

  async function save(values: ContributionValues, close: () => void) {
    const body: CreateContributionRequest = { type, mode: values.mode, notes: values.notes };
    if (values.mode === "link") {
      body.transaction_id = values.transactionId;
    } else {
      const amount = parseAmount(values.amount, goal.currency);
      if (amount === null) return;
      body.amount = amount;
      body.occurred_on = values.occurredOn || null;
      if (values.mode === "transfer") body.account_id = values.accountId;
    }
    try {
      const entry = await contribute.mutateAsync({ goalId: goal.id, body });
      onSaved(
        `${withdrawal ? "Withdrew" : "Added"} ${formatMoney(entry.amount, goal.currency)} ${withdrawal ? "from" : "to"} “${goal.name}”.`,
      );
      close();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t record that. Try again."),
      });
    }
  }

  return (
    <DialogShell
      title={`${withdrawal ? "Withdraw from" : "Add to"} ${goal.name}`}
      description={
        withdrawal
          ? `Up to ${formatMoney(goal.available, goal.currency)} can be withdrawn.`
          : "Saving moves money between your own accounts, so it’s never counted as spending."
      }
      busy={saving}
      onClose={onClose}
      submitLabel={withdrawal ? "Withdraw" : "Add contribution"}
      onSubmit={(event, close) => void handleSubmit((values) => save(values, close))(event)}
    >
      {linked ? (
        <SelectField
          control={control}
          name="mode"
          label="How"
          options={CONTRIBUTION_MODES.map((option) =>
            withdrawal && option.value === "allocate"
              ? { ...option, label: "Release money I set aside" }
              : option,
          )}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          This goal isn’t linked to an account, so the money is{" "}
          {withdrawal ? "released" : "set aside"} without moving. Link an account to record
          transfers.
        </p>
      )}

      {mode === "link" ? (
        <TransferPicker
          workspaceId={workspaceId}
          goal={goal}
          withdrawal={withdrawal}
          control={control}
          error={errors.transactionId?.message}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <AmountField
            control={control}
            name="amount"
            currency={goal.currency}
            label={`Amount (${goal.currency})`}
            autoFocus
          />
          <DateField control={control} name="occurredOn" label="Date" />
          {mode === "transfer" ? (
            <SelectField
              control={control}
              name="accountId"
              label={withdrawal ? "Move to" : "Move from"}
              placeholder="Choose an account"
              options={others.map((account) => ({ value: account.id, label: account.name }))}
              error={errors.accountId?.message}
              hint={`${withdrawal ? "From" : "Into"} ${goal.account?.name ?? "the goal’s account"}, as a transfer.`}
            />
          ) : null}
        </div>
      )}

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

/** Recent transfers into (or out of) the goal's account, to link one. */
function TransferPicker({
  workspaceId,
  goal,
  withdrawal,
  control,
  error,
}: {
  workspaceId: string;
  goal: SavingsGoal;
  withdrawal: boolean;
  control: Control<ContributionValues>;
  error?: string;
}) {
  const { state } = useTransactionHistory(workspaceId, {
    type: ["transfer"],
    account_id: goal.account_id ?? undefined,
    limit: 50,
  });
  const transfers =
    state.status === "success"
      ? state.data.transactions.filter((transaction) =>
          withdrawal
            ? transaction.account_id === goal.account_id
            : transaction.to_account_id === goal.account_id,
        )
      : [];
  return (
    <SelectField
      control={control}
      name="transactionId"
      label="Transfer"
      placeholder={state.status === "loading" ? "Loading transfers…" : "Choose a transfer"}
      options={transfers.map((transaction) => ({
        value: transaction.id,
        label: `${formatCalendarDate(transaction.occurred_on)} · ${transaction.description} · ${formatMoney(transaction.amount, transaction.currency)}`,
      }))}
      error={error ?? (state.status === "error" ? state.message : undefined)}
      hint={
        state.status === "success" && transfers.length === 0
          ? `No transfers ${withdrawal ? "out of" : "into"} ${goal.account?.name ?? "its account"} yet.`
          : "Its amount and date are used."
      }
    />
  );
}
