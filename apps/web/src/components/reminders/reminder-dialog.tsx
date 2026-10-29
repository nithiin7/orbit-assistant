"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { Reminder, Task } from "@orbit/contracts";
import { X } from "lucide-react";
import { useId, useMemo } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { FormAlert, FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import {
  describeRecurrence,
  nextHour,
  REMINDER_DESCRIPTION_MAX_LENGTH,
  type ReminderFields,
  type ReminderFormValues,
  reminderSchema,
  REPEATS,
  timeZoneLabel,
  timeZoneNames,
  toFormValues,
  toRecurrence,
  toReminderRequest,
  weekdayOf,
  WEEKDAYS,
} from "@/lib/reminders";
import { cn } from "@/lib/utils";

type ReminderDialogProps = {
  /** The reminder to edit, or `null` to create one. */
  reminder: Reminder | null;
  /** Open tasks the reminder can be about. */
  tasks: readonly Task[];
  /** The time zone a new reminder starts in: the user's preference, or this browser's. */
  defaultTimeZone: string;
  onSave: (fields: ReminderFields) => Promise<void>;
  /** Called once the dialog has closed, whether saved or cancelled. */
  onClose: () => void;
};

function initialValues(reminder: Reminder | null, timeZone: string): ReminderFormValues {
  if (reminder) return toFormValues(reminder);
  const { date, time } = nextHour(timeZone);
  return {
    title: "",
    description: "",
    taskId: "",
    date,
    time,
    timeZone,
    repeat: "none",
    weekdays: [weekdayOf(date)],
  };
}

/**
 * Creates or edits a reminder in a modal `<dialog>`, which provides focus containment, Escape to
 * close, and an inert background. Focus returns to whatever opened it.
 */
export function ReminderDialog({
  reminder,
  tasks,
  defaultTimeZone,
  onSave,
  onClose,
}: ReminderDialogProps) {
  const id = useId();
  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    getValues,
    formState: { errors, isSubmitting: saving },
  } = useForm<ReminderFormValues>({
    resolver: yupResolver(reminderSchema),
    defaultValues: initialValues(reminder, defaultTimeZone),
  });
  const { close, dialogProps } = useModalDialog({ onClose, dismissible: !saving });
  const [description, date, repeat, weekdays] = useWatch({
    control,
    name: ["description", "date", "repeat", "weekdays"],
  });
  const zones = useMemo(
    () => timeZoneNames(defaultTimeZone, reminder?.timezone),
    [defaultTimeZone, reminder?.timezone],
  );
  // A reminder about a completed task keeps it as an option, so editing doesn't detach it.
  const taskOptions =
    reminder?.task && !tasks.some((task) => task.id === reminder.task?.id)
      ? [{ id: reminder.task.id, title: `${reminder.task.title} (completed)` }, ...tasks]
      : tasks;

  async function save(values: ReminderFormValues) {
    try {
      await onSave(toReminderRequest(values));
      close();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t save the reminder. Try again."),
      });
    }
  }

  const heading = reminder ? "Edit reminder" : "New reminder";

  return (
    <dialog
      {...dialogProps}
      aria-labelledby={`${id}-heading`}
      className="dialog-motion dialog-pop mx-auto mt-[6vh] max-h-[88vh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-xl border bg-popover p-0 text-popover-foreground shadow-elevation-3"
    >
      <form
        noValidate
        // Called here, not during render: `save` closes the dialog through a ref.
        onSubmit={(event) => void handleSubmit(save)(event)}
        className="space-y-4 p-5"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={`${id}-heading`} className="text-base font-semibold">
            {heading}
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
          placeholder="Call the dentist"
          {...register("title")}
          error={errors.title?.message}
        />

        <div className="space-y-1.5">
          <label htmlFor={`${id}-description`} className="block text-sm font-medium">
            Note <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Textarea
            id={`${id}-description`}
            rows={2}
            {...register("description")}
            aria-invalid={errors.description ? true : undefined}
            aria-describedby={`${id}-description-hint`}
          />
          <p
            id={`${id}-description-hint`}
            className={
              errors.description
                ? "text-xs font-medium text-destructive"
                : "text-xs text-muted-foreground"
            }
          >
            {errors.description?.message ??
              `Shown in the notification. ${description.trim().length} / ${REMINDER_DESCRIPTION_MAX_LENGTH} characters`}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={repeat === "none" ? "Date" : "Starts on"}
            type="date"
            {...register("date")}
            error={errors.date?.message}
          />
          <FormField label="Time" type="time" {...register("time")} error={errors.time?.message} />
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`${id}-zone`} className="block text-sm font-medium">
            Time zone
          </label>
          <NativeSelect id={`${id}-zone`} {...register("timeZone")}>
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {timeZoneLabel(zone)}
              </option>
            ))}
          </NativeSelect>
          <p className="text-xs text-muted-foreground">
            The reminder keeps this wall-clock time, including across daylight saving changes.
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`${id}-repeat`} className="block text-sm font-medium">
            Repeat
          </label>
          <NativeSelect
            id={`${id}-repeat`}
            {...register("repeat", {
              // Start weekly reminders on the start date's weekday.
              onChange: (event: { target: { value: string } }) => {
                if (event.target.value === "weekly") {
                  setValue("weekdays", [weekdayOf(getValues("date"))]);
                }
              },
            })}
          >
            {REPEATS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
          {repeat !== "none" && repeat !== "weekly" && date ? (
            <p className="text-xs text-muted-foreground">
              {describeRecurrence(toRecurrence(repeat, weekdays), date)}.
            </p>
          ) : null}
        </div>

        {repeat === "weekly" ? (
          <Controller
            control={control}
            name="weekdays"
            render={({ field }) => (
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium">Repeat on</legend>
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAYS.map((day) => {
                    const selected = field.value.includes(day.value);
                    return (
                      <button
                        key={day.value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() =>
                          field.onChange(
                            selected
                              ? field.value.filter((value) => value !== day.value)
                              : [...field.value, day.value],
                          )
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
                {errors.weekdays ? (
                  <p className="text-xs font-medium text-destructive">{errors.weekdays.message}</p>
                ) : null}
              </fieldset>
            )}
          />
        ) : null}

        <div className="space-y-1.5">
          <label htmlFor={`${id}-task`} className="block text-sm font-medium">
            Task <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <NativeSelect id={`${id}-task`} {...register("taskId")}>
            <option value="">No task</option>
            {taskOptions.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </NativeSelect>
          <p className="text-xs text-muted-foreground">
            A reminder about a task stays quiet while the task is completed, and is deleted with it.
            Changing the task’s due date doesn’t move the reminder.
          </p>
        </div>

        <FormAlert message={errors.root?.server?.message ?? null} />

        <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
          <Button variant="ghost" disabled={saving} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : reminder ? "Save changes" : "Create reminder"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
