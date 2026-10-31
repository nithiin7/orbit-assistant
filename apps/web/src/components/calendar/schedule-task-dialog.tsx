"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { Task } from "@orbit/contracts";
import { X } from "lucide-react";
import { useId } from "react";
import { useForm } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { DateField, FormAlert, FormField, SelectField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import {
  minutesOfTime,
  TASK_LENGTHS,
  taskSchedule,
  taskScheduleSchema,
  type TaskScheduleValues,
} from "@/lib/calendar";

type ScheduleTaskDialogProps = {
  task: Task;
  initial: TaskScheduleValues;
  timeZone: string;
  onSave: (schedule: { scheduled_start: string; scheduled_end: string }) => Promise<void>;
  onClose: () => void;
};

/**
 * Gives a task a time block on the calendar: the keyboard-friendly way to do what dragging a
 * task onto the calendar does. The due date stays as it is.
 */
export function ScheduleTaskDialog({
  task,
  initial,
  timeZone,
  onSave,
  onClose,
}: ScheduleTaskDialogProps) {
  const id = useId();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: saving },
  } = useForm<TaskScheduleValues>({
    resolver: yupResolver(taskScheduleSchema),
    defaultValues: initial,
  });
  const { close, dialogProps } = useModalDialog({ onClose, dismissible: !saving });

  async function save(values: TaskScheduleValues) {
    try {
      await onSave(
        taskSchedule(values.date, minutesOfTime(values.time), Number(values.length), timeZone),
      );
      close();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t schedule the task. Try again."),
      });
    }
  }

  return (
    <dialog
      {...dialogProps}
      aria-labelledby={`${id}-heading`}
      className="dialog-motion dialog-pop mx-auto mt-[10vh] w-[calc(100%-2rem)] max-w-sm rounded-xl border bg-popover p-0 text-popover-foreground shadow-elevation-3"
    >
      <form
        noValidate
        onSubmit={(event) => void handleSubmit(save)(event)}
        className="space-y-4 p-5"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={`${id}-heading`} className="text-base font-semibold">
              Schedule task
            </h2>
            <p className="truncate text-sm text-muted-foreground">{task.title}</p>
          </div>
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
        <DateField control={control} name="date" label="Date" />
        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="Start time"
            type="time"
            {...register("time")}
            error={errors.time?.message}
          />
          <SelectField control={control} name="length" label="For" options={TASK_LENGTHS} />
        </div>
        <FormAlert message={errors.root?.server?.message ?? null} />
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button variant="ghost" disabled={saving} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Schedule"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
