"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { Budget, FinanceCategory } from "@orbit/contracts";
import { useId } from "react";
import { useForm, useWatch } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { AmountField, DateField, FormAlert, FormField, SelectField } from "@/components/form-field";
import { Textarea } from "@/components/ui/textarea";
import { useBudgetMutations } from "@/hooks/use-budgets";
import {
  budgetDefaults,
  budgetSchema,
  type BudgetValues,
  monthOptions,
  PERIOD_TYPES,
  ROLLOVER_MODES,
  SCOPES,
  toCreateBudget,
  toUpdateBudget,
} from "@/lib/budgets";
import { CURRENCY_OPTIONS } from "@/lib/finance";
import { monthLabel } from "@/utils/dates";

import { DialogShell } from "./dialog-shell";

type BudgetDialogProps = {
  workspaceId: string;
  /** Edit this one; omit to add a new budget. */
  budget?: Budget;
  /** The month the view shows, where a new budget starts. */
  month: string;
  categories: readonly FinanceCategory[];
  onSaved: (message: string) => void;
  onClose: () => void;
};

/**
 * Adds or edits a budget. Edits apply from the current period on; finished periods keep the
 * amounts they had. Scope, category, currency, and period type are fixed once it exists.
 */
export function BudgetDialog({
  workspaceId,
  budget,
  month,
  categories,
  onSaved,
  onClose,
}: BudgetDialogProps) {
  const id = useId();
  const { createBudget, updateBudget } = useBudgetMutations(workspaceId);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: saving },
  } = useForm<BudgetValues>({
    resolver: yupResolver(budgetSchema),
    defaultValues: budgetDefaults(month, budget),
  });
  const [scope, period, currency, startMonth, alertsEnabled] = useWatch({
    control,
    name: ["scope", "period", "currency", "startMonth", "alertsEnabled"],
  });
  const expenseCategories = categories.filter((category) => category.type === "expense");
  const months = monthOptions(month);
  const monthChoices = months.map((value) => ({ value, label: monthLabel(value) }));

  async function save(values: BudgetValues, close: () => void) {
    try {
      if (budget) {
        const changes = toUpdateBudget(values, budget);
        if (changes === null) return;
        if (Object.keys(changes).length > 0) {
          await updateBudget.mutateAsync({ id: budget.id, changes });
          onSaved(`Saved “${values.name}”. Finished periods keep their amounts.`);
        }
      } else {
        const body = toCreateBudget(values);
        if (body === null) return;
        const created = await createBudget.mutateAsync(body);
        onSaved(`Added the “${created.name}” budget.`);
      }
      close();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t save the budget. Try again."),
      });
    }
  }

  return (
    <DialogShell
      title={budget ? `Edit “${budget.name}”` : "Add a budget"}
      description="A limit on net spending: expenses minus refunds. Transfers, investments, savings, and loan principal never count."
      busy={saving}
      onClose={onClose}
      submitLabel={budget ? "Save changes" : "Add budget"}
      wide
      onSubmit={(event, close) => void handleSubmit((values) => save(values, close))(event)}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Name"
          autoComplete="off"
          autoFocus
          placeholder="Groceries, Everything…"
          {...register("name")}
          error={errors.name?.message}
        />
        {budget ? null : (
          <SelectField control={control} name="scope" label="Limits" options={SCOPES} />
        )}
        {!budget && scope === "category" ? (
          <SelectField
            control={control}
            name="categoryId"
            label="Category"
            placeholder="Choose a category"
            options={expenseCategories.map((category) => ({
              value: category.id,
              label: category.name,
            }))}
            error={errors.categoryId?.message}
          />
        ) : null}
        {budget ? null : (
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
          label={`${period === "monthly" ? "Each month" : "For the period"} (${currency})`}
        />
        {budget ? null : (
          <SelectField control={control} name="period" label="Period" options={PERIOD_TYPES} />
        )}
      </div>

      {period === "monthly" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            control={control}
            name="startMonth"
            label="First month"
            options={monthChoices}
          />
          <SelectField
            control={control}
            name="endMonth"
            label="Repeats"
            options={[
              { value: "", label: "Every month, no end" },
              ...monthChoices
                .filter((option) => option.value >= startMonth)
                .map((option) => ({ value: option.value, label: `Until ${option.label}` })),
            ]}
            error={errors.endMonth?.message}
          />
          <SelectField
            control={control}
            name="rollover"
            label="At month end"
            options={ROLLOVER_MODES}
            hint="Overspending carried forward never takes a month below zero."
          />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <DateField control={control} name="startDate" label="First day" />
          <DateField
            control={control}
            name="endDate"
            label="Last day"
            hint="Up to a year. A trip, a festival, a move…"
          />
        </div>
      )}

      <fieldset className="space-y-3 rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">Alerts</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-brand" {...register("alertsEnabled")} />
          Notify me in Orbit when spending reaches
        </label>
        <FormField
          label="Thresholds (%)"
          inputMode="numeric"
          autoComplete="off"
          disabled={!alertsEnabled}
          hint="Each sends one notification per period, the first time it’s reached."
          {...register("thresholds")}
          error={errors.thresholds?.message}
        />
      </fieldset>

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
