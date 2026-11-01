"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { Habit } from "@orbit/contracts";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useId } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { DialogShell } from "@/components/finance/dialog-shell";
import { FormAlert, FormField, SelectField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MAX_STEPS, type RoutineFormValues, routineSchema } from "@/lib/habits";
import { timeZoneLabel, timeZoneNames } from "@/utils/time-zones";

import { ColorChoices, IconChoices, ReminderTimes, WeekdayChips } from "./habit-dialog";

type RoutineDialogProps = {
  editing: boolean;
  initial: RoutineFormValues;
  /** Habits a step can complete. */
  habits: readonly Pick<Habit, "id" | "name" | "kind">[];
  onSave: (values: RoutineFormValues) => Promise<void>;
  onClose: () => void;
};

export function RoutineDialog({ editing, initial, habits, onSave, onClose }: RoutineDialogProps) {
  const id = useId();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: saving },
  } = useForm<RoutineFormValues>({ resolver: yupResolver(routineSchema), defaultValues: initial });
  const { fields, append, remove, move } = useFieldArray({
    control,
    name: "steps",
    keyName: "key",
  });
  const zoneOptions = timeZoneNames(initial.timeZone).map((zone) => ({
    value: zone,
    label: timeZoneLabel(zone),
  }));
  const habitOptions = [
    { value: "", label: "No linked habit" },
    ...habits.map((habit) => ({
      value: habit.id,
      label: habit.kind === "boolean" ? habit.name : `${habit.name} (log it yourself)`,
    })),
  ];

  async function save(values: RoutineFormValues, close: () => void) {
    try {
      await onSave(values);
      close();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t save the routine. Try again."),
      });
    }
  }

  return (
    <DialogShell
      title={editing ? "Edit routine" : "New routine"}
      description={editing ? "Sessions you’ve already started keep their steps." : undefined}
      busy={saving}
      onClose={onClose}
      onSubmit={(event, close) => void handleSubmit((values) => save(values, close))(event)}
      submitLabel={editing ? "Save changes" : "Create routine"}
      wide
    >
      <FormField
        label="Name"
        autoComplete="off"
        autoFocus
        placeholder="Morning routine"
        {...register("name")}
        error={errors.name?.message}
      />
      <div className="space-y-1.5">
        <label htmlFor={`${id}-description`} className="block text-sm font-medium">
          Description <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Textarea id={`${id}-description`} rows={2} {...register("description")} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Controller
          control={control}
          name="icon"
          render={({ field }) => <IconChoices value={field.value} onChange={field.onChange} />}
        />
        <Controller
          control={control}
          name="color"
          render={({ field }) => <ColorChoices value={field.value} onChange={field.onChange} />}
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Steps</legend>
        <ol className="space-y-2">
          {fields.map((field, index) => (
            <li key={field.key} className="space-y-2 rounded-lg border p-2.5">
              <div className="flex items-center gap-2">
                <span className="w-5 text-center text-xs text-muted-foreground tabular-nums">
                  {index + 1}
                </span>
                <label htmlFor={`${id}-step-${index}`} className="sr-only">
                  Step {index + 1} name
                </label>
                <Input
                  id={`${id}-step-${index}`}
                  placeholder="Drink a glass of water"
                  className="h-8 flex-1"
                  {...register(`steps.${index}.name`)}
                  aria-invalid={errors.steps?.[index]?.name ? true : undefined}
                />
                <label htmlFor={`${id}-minutes-${index}`} className="sr-only">
                  Step {index + 1} minutes
                </label>
                <Input
                  id={`${id}-minutes-${index}`}
                  inputMode="numeric"
                  placeholder="min"
                  className="h-8 w-16"
                  {...register(`steps.${index}.duration`)}
                  aria-invalid={errors.steps?.[index]?.duration ? true : undefined}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={`Move step ${index + 1} up`}
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                >
                  <ArrowUp aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={`Move step ${index + 1} down`}
                  disabled={index === fields.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  <ArrowDown aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={`Remove step ${index + 1}`}
                  onClick={() => remove(index)}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
              {habits.length > 0 ? (
                <Controller
                  control={control}
                  name={`steps.${index}.habitId`}
                  render={({ field: habit }) => (
                    <Select
                      aria-label={`Step ${index + 1} linked habit`}
                      value={habit.value}
                      onValueChange={habit.onChange}
                      options={habitOptions}
                      className="h-8"
                    />
                  )}
                />
              ) : null}
              {errors.steps?.[index]?.name || errors.steps?.[index]?.duration ? (
                <p className="text-xs font-medium text-destructive">
                  {errors.steps[index]?.name?.message ?? errors.steps[index]?.duration?.message}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
        {fields.length < MAX_STEPS ? (
          <Button
            variant="soft"
            size="sm"
            onClick={() => append({ id: "", name: "", duration: "", habitId: "" })}
          >
            <Plus aria-hidden="true" />
            Add a step
          </Button>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Completing a step linked to a yes-or-no habit also marks that habit done for the day.
        </p>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Time of day (optional)"
          type="time"
          {...register("timeOfDay")}
          error={errors.timeOfDay?.message}
          hint="Shows the routine on your calendar."
        />
        <SelectField control={control} name="timeZone" label="Time zone" options={zoneOptions} />
      </div>
      <Controller
        control={control}
        name="weekdays"
        render={({ field }) => (
          <WeekdayChips
            legend="Days"
            value={field.value}
            onChange={field.onChange}
            hint="None chosen: every day."
          />
        )}
      />
      <Controller
        control={control}
        name="reminders"
        render={({ field }) => (
          <ReminderTimes
            value={field.value}
            onChange={field.onChange}
            error={errors.reminders?.message ?? errors.reminders?.root?.message}
          />
        )}
      />
      <FormAlert message={errors.root?.server?.message ?? null} />
    </DialogShell>
  );
}
