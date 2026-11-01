"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { HabitCategory, HabitColor, HabitIcon, Weekday } from "@orbit/contracts";
import { Plus, X } from "lucide-react";
import { useId } from "react";
import { type Control, Controller, useForm, useWatch } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { DialogShell } from "@/components/finance/dialog-shell";
import { DateField, FormAlert, FormField, SelectField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CATEGORY_COLORS } from "@/lib/calendar";
import {
  HABIT_ICONS,
  HABIT_KINDS,
  type HabitFormValues,
  habitSchema,
  MAX_REMINDERS,
  type ReminderFields,
  SCHEDULE_TYPES,
} from "@/lib/habits";
import { WEEKDAYS } from "@/lib/reminders";
import { cn } from "@/utils/common";
import { timeZoneLabel, timeZoneNames } from "@/utils/time-zones";

import { COLOR_STYLES, HABIT_ICON_COMPONENTS } from "./habit-icon";

type HabitDialogProps = {
  /** Editing an existing habit, rather than creating one. */
  editing: boolean;
  initial: HabitFormValues;
  categories: readonly HabitCategory[];
  onSave: (values: HabitFormValues) => Promise<void>;
  onClose: () => void;
};

export function HabitDialog({ editing, initial, categories, onSave, onClose }: HabitDialogProps) {
  const id = useId();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: saving },
  } = useForm<HabitFormValues>({ resolver: yupResolver(habitSchema), defaultValues: initial });
  const [kind, scheduleType] = useWatch({ control, name: ["kind", "scheduleType"] });
  const zoneOptions = timeZoneNames(initial.timeZone).map((zone) => ({
    value: zone,
    label: timeZoneLabel(zone),
  }));

  async function save(values: HabitFormValues, close: () => void) {
    try {
      await onSave(values);
      close();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t save the habit. Try again."),
      });
    }
  }

  return (
    <DialogShell
      title={editing ? "Edit habit" : "New habit"}
      description={
        editing
          ? "A new schedule applies from today. Earlier days keep the schedule they had."
          : undefined
      }
      busy={saving}
      onClose={onClose}
      onSubmit={(event, close) => void handleSubmit((values) => save(values, close))(event)}
      submitLabel={editing ? "Save changes" : "Create habit"}
      wide
    >
      <FormField
        label="Name"
        autoComplete="off"
        autoFocus
        placeholder="Read for 20 minutes"
        {...register("name")}
        error={errors.name?.message}
      />

      <div className="space-y-1.5">
        <label htmlFor={`${id}-description`} className="block text-sm font-medium">
          Why it matters <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Textarea id={`${id}-description`} rows={2} {...register("description")} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <IconPicker control={control} />
        <ColorPicker control={control} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          control={control}
          name="categoryId"
          label="Category"
          options={[
            { value: "", label: "No category" },
            ...categories.map((category) => ({ value: category.id, label: category.name })),
          ]}
        />
        <SelectField
          control={control}
          name="kind"
          label="Track"
          options={HABIT_KINDS}
          disabled={editing}
          hint={editing ? "The kind of habit can’t change once it has history." : undefined}
        />
      </div>

      {kind !== "boolean" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={kind === "duration" ? "Minutes each day" : "Daily target"}
            inputMode="decimal"
            {...register("target")}
            error={errors.target?.message}
          />
          {kind === "numeric" ? (
            <FormField
              label="Unit"
              placeholder="litres, pages, steps"
              {...register("unit")}
              error={errors.unit?.message}
            />
          ) : null}
        </div>
      ) : null}

      <fieldset className="space-y-3 rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">Schedule</legend>
        <SelectField
          control={control}
          name="scheduleType"
          label="Repeats"
          options={SCHEDULE_TYPES}
        />
        {scheduleType === "daily" ? (
          <FormField
            label="Every how many days"
            inputMode="numeric"
            {...register("every")}
            error={errors.every?.message}
            hint="1 is every day."
          />
        ) : null}
        {scheduleType === "weekdays" ? (
          <Controller
            control={control}
            name="weekdays"
            render={({ field }) => (
              <WeekdayChips
                legend="On"
                value={field.value}
                onChange={field.onChange}
                error={errors.weekdays?.message}
              />
            )}
          />
        ) : null}
        {scheduleType === "weekly_target" ? (
          <FormField
            label="Times each week"
            inputMode="numeric"
            {...register("timesPerWeek")}
            error={errors.timesPerWeek?.message}
            hint="Any days, Monday to Sunday. Shorter weeks ask for less."
          />
        ) : null}
        {scheduleType === "monthly" ? (
          <Controller
            control={control}
            name="monthDays"
            render={({ field }) => (
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium">Days of the month</legend>
                <div className="grid grid-cols-7 gap-1">
                  {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => {
                    const selected = field.value.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        aria-pressed={selected}
                        onClick={() =>
                          field.onChange(
                            selected ? field.value.filter((d) => d !== day) : [...field.value, day],
                          )
                        }
                        className={cn(
                          "h-8 rounded-md border text-xs font-medium tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          selected
                            ? "border-transparent bg-primary text-primary-foreground"
                            : "bg-card text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
                <p
                  className={
                    errors.monthDays
                      ? "text-xs font-medium text-destructive"
                      : "text-xs text-muted-foreground"
                  }
                >
                  {errors.monthDays?.message ??
                    "In shorter months, the 29th to 31st fall on the month’s last day."}
                </p>
              </fieldset>
            )}
          />
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <DateField control={control} name="startDate" label="Starts on" />
          <DateField control={control} name="endDate" label="Ends on (optional)" />
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Time of day (optional)"
          type="time"
          {...register("timeOfDay")}
          error={errors.timeOfDay?.message}
          hint="Shows the habit on your calendar at this time."
        />
        <SelectField control={control} name="timeZone" label="Time zone" options={zoneOptions} />
      </div>

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

function IconPicker({ control }: { control: Control<HabitFormValues> }) {
  return (
    <Controller
      control={control}
      name="icon"
      render={({ field }) => <IconChoices value={field.value} onChange={field.onChange} />}
    />
  );
}

export function IconChoices({
  value,
  onChange,
}: {
  value: HabitIcon;
  onChange: (icon: HabitIcon) => void;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">Icon</legend>
      <div className="flex flex-wrap gap-1">
        {HABIT_ICONS.map((option) => {
          const Icon = HABIT_ICON_COMPONENTS[option.value];
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              aria-label={option.label}
              title={option.label}
              onClick={() => onChange(option.value)}
              className={cn(
                "flex size-8 items-center justify-center rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected
                  ? "border-brand bg-brand-subtle text-brand"
                  : "bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function ColorPicker({ control }: { control: Control<HabitFormValues> }) {
  return (
    <Controller
      control={control}
      name="color"
      render={({ field }) => <ColorChoices value={field.value} onChange={field.onChange} />}
    />
  );
}

export function ColorChoices({
  value,
  onChange,
}: {
  value: HabitColor;
  onChange: (color: HabitColor) => void;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">Color</legend>
      <div className="flex flex-wrap gap-1.5">
        {CATEGORY_COLORS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            aria-label={option.label}
            title={option.label}
            onClick={() => onChange(option.value)}
            className={cn(
              "size-7 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              COLOR_STYLES[option.value].fill,
              value === option.value && "ring-2 ring-foreground ring-offset-2 ring-offset-popover",
            )}
          />
        ))}
      </div>
    </fieldset>
  );
}

export function WeekdayChips({
  legend,
  value,
  onChange,
  error,
  hint,
}: {
  legend: string;
  value: readonly Weekday[];
  onChange: (days: Weekday[]) => void;
  error?: string;
  hint?: string;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-1.5">
        {WEEKDAYS.map((day) => {
          const selected = value.includes(day.value);
          return (
            <button
              key={day.value}
              type="button"
              aria-pressed={selected}
              onClick={() =>
                onChange(selected ? value.filter((d) => d !== day.value) : [...value, day.value])
              }
              className={cn(
                "h-8 min-w-11 rounded-md border px-2 text-sm font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {day.label}
            </button>
          );
        })}
      </div>
      {error || hint ? (
        <p
          className={
            error ? "text-xs font-medium text-destructive" : "text-xs text-muted-foreground"
          }
        >
          {error ?? hint}
        </p>
      ) : null}
    </fieldset>
  );
}

/** Reminder times, each optionally limited to some weekdays. Shared by habits and routines. */
export function ReminderTimes({
  value,
  onChange,
  error,
}: {
  value: readonly ReminderFields[];
  onChange: (reminders: ReminderFields[]) => void;
  error?: string;
}) {
  const change = (index: number, patch: Partial<ReminderFields>) =>
    onChange(value.map((reminder, i) => (i === index ? { ...reminder, ...patch } : reminder)));
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Reminders</legend>
      <p className="text-xs text-muted-foreground">
        Notifications on due days that aren’t done yet. They stop while paused or archived.
      </p>
      <ul className="space-y-2">
        {value.map((reminder, index) => (
          // Reminder times are unique, so the time identifies the row while it's edited.
          <li key={index} className="space-y-2 rounded-lg border p-2.5">
            <div className="flex items-center gap-2">
              <input
                type="time"
                aria-label={`Reminder ${index + 1} time`}
                value={reminder.time}
                onChange={(event) => change(index, { time: event.target.value })}
                className="h-8 rounded-md border bg-card px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto size-8"
                aria-label={`Remove reminder ${index + 1}`}
                onClick={() => onChange(value.filter((_, i) => i !== index))}
              >
                <X aria-hidden="true" />
              </Button>
            </div>
            <WeekdayChips
              legend="Only on"
              value={reminder.weekdays}
              onChange={(weekdays) => change(index, { weekdays })}
              hint="None chosen: every due day."
            />
          </li>
        ))}
      </ul>
      {value.length < MAX_REMINDERS ? (
        <Button
          variant="soft"
          size="sm"
          onClick={() => onChange([...value, { time: "08:00", weekdays: [] }])}
        >
          <Plus aria-hidden="true" />
          Add a reminder
        </Button>
      ) : null}
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </fieldset>
  );
}
