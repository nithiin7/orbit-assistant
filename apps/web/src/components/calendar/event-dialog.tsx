"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { CalendarCategory, Task } from "@orbit/contracts";
import { Plus, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { DateField, FormAlert, FormField, SelectField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import {
  ALERT_PRESETS,
  describeAlert,
  describeRule,
  EVENT_DESCRIPTION_MAX_LENGTH,
  type EventFormValues,
  eventSchema,
  MAX_ALERTS,
  REPEAT_ENDS,
  REPEATS,
  toRule,
  WEEKDAY_OPTIONS,
  weekdayOf,
} from "@/lib/calendar";
import { cn } from "@/utils/common";
import { timeZoneLabel, timeZoneNames } from "@/utils/time-zones";

/**
 * `create`: a new event. `series`: every occurrence of an event. `occurrence`: one occurrence, or
 * it and the following ones; the repeat rule, time zone, and alerts belong to the series and
 * aren't offered.
 */
export type EventDialogMode = "create" | "series" | "occurrence";

type EventDialogProps = {
  mode: EventDialogMode;
  initial: EventFormValues;
  categories: readonly CalendarCategory[];
  /** Open tasks a new event can be linked to. */
  tasks?: readonly Task[];
  /** Saves; throw to show the error in the dialog. */
  onSave: (values: EventFormValues, taskId: string | null) => Promise<void>;
  onClose: () => void;
};

const HEADINGS: Record<EventDialogMode, string> = {
  create: "New event",
  series: "Edit event",
  occurrence: "Edit occurrence",
};

/**
 * Creates or edits an event in a modal `<dialog>`, which provides focus containment, Escape to
 * close, and an inert background. Focus returns to whatever opened it.
 */
export function EventDialog({
  mode,
  initial,
  categories,
  tasks = [],
  onSave,
  onClose,
}: EventDialogProps) {
  const id = useId();
  const [taskId, setTaskId] = useState("");
  const [customAlert, setCustomAlert] = useState("");
  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    getValues,
    formState: { errors, isSubmitting: saving },
  } = useForm<EventFormValues>({ resolver: yupResolver(eventSchema), defaultValues: initial });
  const { close, dialogProps } = useModalDialog({ onClose, dismissible: !saving });
  const values = useWatch({ control }) as EventFormValues;
  const zoneOptions = useMemo(
    () =>
      timeZoneNames(initial.timeZone).map((zone) => ({ value: zone, label: timeZoneLabel(zone) })),
    [initial.timeZone],
  );
  const repeating = mode !== "occurrence";

  async function save(form: EventFormValues) {
    try {
      await onSave(form, taskId || null);
      close();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t save the event. Try again."),
      });
    }
  }

  const addAlert = (minutes: number) => {
    const current = getValues("alerts");
    if (current.includes(minutes) || current.length >= MAX_ALERTS) return;
    setValue(
      "alerts",
      [...current, minutes].sort((a, b) => a - b),
      { shouldDirty: true },
    );
  };

  return (
    <dialog
      {...dialogProps}
      aria-labelledby={`${id}-heading`}
      className="dialog-motion dialog-pop mx-auto mt-[4vh] max-h-[92vh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-xl border bg-popover p-0 text-popover-foreground shadow-elevation-3"
    >
      <form
        noValidate
        onSubmit={(event) => void handleSubmit(save)(event)}
        className="space-y-4 p-5"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={`${id}-heading`} className="text-base font-semibold">
            {HEADINGS[mode]}
          </h2>
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
          label="Title"
          autoComplete="off"
          autoFocus
          placeholder="Team standup"
          {...register("title")}
          error={errors.title?.message}
        />

        {mode === "occurrence" ? null : (
          <label className="flex w-fit items-center gap-2 text-sm font-medium">
            <Checkbox {...register("allDay")} />
            All day
          </label>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <DateField control={control} name="startDate" label="Starts" />
          {values.allDay ? null : (
            <FormField
              label="Start time"
              type="time"
              {...register("startTime")}
              error={errors.startTime?.message}
            />
          )}
          <DateField control={control} name="endDate" label={values.allDay ? "Last day" : "Ends"} />
          {values.allDay ? null : (
            <FormField
              label="End time"
              type="time"
              {...register("endTime")}
              error={errors.endTime?.message}
            />
          )}
        </div>

        {mode === "occurrence" ? null : (
          <SelectField
            control={control}
            name="timeZone"
            label="Time zone"
            options={zoneOptions}
            hint="The event keeps this wall-clock time, including across daylight saving changes."
          />
        )}

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
          <FormField
            label="Location"
            autoComplete="off"
            placeholder="Optional"
            {...register("location")}
            error={errors.location?.message}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`${id}-description`} className="block text-sm font-medium">
            Description <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Textarea
            id={`${id}-description`}
            rows={3}
            {...register("description")}
            aria-invalid={errors.description ? true : undefined}
            aria-describedby={`${id}-description-hint`}
          />
          <p
            id={`${id}-description-hint`}
            className={cn(
              "text-xs",
              errors.description ? "font-medium text-destructive" : "text-muted-foreground",
            )}
          >
            {errors.description?.message ??
              `${values.description.trim().length} / ${EVENT_DESCRIPTION_MAX_LENGTH} characters`}
          </p>
        </div>

        {repeating ? (
          <fieldset className="space-y-3 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">Repeat</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField
                control={control}
                name="repeat"
                label="Repeats"
                options={REPEATS}
                onValueChange={(value) => {
                  if (value === "weekly") setValue("weekdays", [weekdayOf(getValues("startDate"))]);
                }}
              />
              {values.repeat === "none" ? null : (
                <FormField
                  label="Every"
                  type="number"
                  min={1}
                  max={99}
                  inputMode="numeric"
                  {...register("interval", { valueAsNumber: true })}
                  error={errors.interval?.message}
                />
              )}
            </div>
            {values.repeat === "weekly" ? (
              <Controller
                control={control}
                name="weekdays"
                render={({ field }) => {
                  const startDay = weekdayOf(values.startDate);
                  return (
                    <fieldset className="space-y-1.5">
                      <legend className="text-sm font-medium">On</legend>
                      <div className="flex flex-wrap gap-1.5">
                        {WEEKDAY_OPTIONS.map((day) => {
                          const locked = day.value === startDay;
                          const selected = locked || field.value.includes(day.value);
                          return (
                            <button
                              key={day.value}
                              type="button"
                              aria-pressed={selected}
                              disabled={locked}
                              title={
                                locked ? "The start date’s weekday is always included" : undefined
                              }
                              onClick={() =>
                                field.onChange(
                                  selected
                                    ? field.value.filter((value) => value !== day.value)
                                    : [...field.value, day.value],
                                )
                              }
                              className={cn(
                                "h-8 min-w-11 rounded-md border px-2 text-sm font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
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
                      {errors.weekdays ? (
                        <p className="text-xs font-medium text-destructive">
                          {errors.weekdays.message}
                        </p>
                      ) : null}
                    </fieldset>
                  );
                }}
              />
            ) : null}
            {values.repeat === "none" ? null : (
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField control={control} name="ends" label="Ends" options={REPEAT_ENDS} />
                {values.ends === "count" ? (
                  <FormField
                    label="Times"
                    type="number"
                    min={1}
                    max={999}
                    inputMode="numeric"
                    {...register("count", { valueAsNumber: true })}
                    error={errors.count?.message}
                  />
                ) : values.ends === "until" ? (
                  <DateField control={control} name="until" label="Last date" />
                ) : null}
              </div>
            )}
            {values.repeat === "none" || !values.startDate ? null : (
              <p className="text-xs text-muted-foreground">
                {describeRule(toRule(values), values.startDate)}.
              </p>
            )}
          </fieldset>
        ) : null}

        {repeating ? (
          <Controller
            control={control}
            name="alerts"
            render={({ field }) => (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Reminders</legend>
                {field.value.length > 0 ? (
                  <ul className="flex flex-wrap gap-1.5">
                    {field.value.map((minutes) => (
                      <li
                        key={minutes}
                        className="flex items-center gap-1 rounded-full bg-secondary py-0.5 pr-1 pl-2.5 text-xs font-medium"
                      >
                        {describeAlert(minutes)}
                        <button
                          type="button"
                          aria-label={`Remove reminder ${describeAlert(minutes)}`}
                          onClick={() =>
                            field.onChange(field.value.filter((value) => value !== minutes))
                          }
                          className="rounded-full p-0.5 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <X className="size-3" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No reminders. Reminders arrive as notifications.
                  </p>
                )}
                {field.value.length < MAX_ALERTS ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {ALERT_PRESETS.filter((minutes) => !field.value.includes(minutes)).map(
                      (minutes) => (
                        <Button
                          key={minutes}
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => addAlert(minutes)}
                        >
                          <Plus aria-hidden="true" />
                          {describeAlert(minutes)}
                        </Button>
                      ),
                    )}
                    <span className="flex items-center gap-1">
                      <Input
                        aria-label="Custom reminder, minutes before"
                        type="number"
                        min={0}
                        max={40320}
                        inputMode="numeric"
                        placeholder="Minutes"
                        value={customAlert}
                        onChange={(event) => setCustomAlert(event.target.value)}
                        className="h-7 w-24 text-xs"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={!/^\d+$/.test(customAlert) || Number(customAlert) > 40320}
                        onClick={() => {
                          addAlert(Number(customAlert));
                          setCustomAlert("");
                        }}
                      >
                        Add
                      </Button>
                    </span>
                  </div>
                ) : null}
                {errors.alerts?.message ? (
                  <p className="text-xs font-medium text-destructive">{errors.alerts.message}</p>
                ) : null}
              </fieldset>
            )}
          />
        ) : null}

        {mode === "create" && tasks.length > 0 ? (
          <div className="space-y-1.5">
            <label htmlFor={`${id}-task`} className="block text-sm font-medium">
              Related task <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <Select
              id={`${id}-task`}
              value={taskId}
              onValueChange={setTaskId}
              options={[
                { value: "", label: "No task" },
                ...tasks.map((task) => ({ value: task.id, label: task.title })),
              ]}
            />
          </div>
        ) : null}

        <FormAlert message={errors.root?.server?.message ?? null} />

        <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
          <Button variant="ghost" disabled={saving} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : mode === "create" ? "Create event" : "Save changes"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
