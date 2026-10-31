"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { Task, UpdateTaskRequest } from "@orbit/contracts";
import { X } from "lucide-react";
import { useId } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import type { InferType } from "yup";

import { describeApiError } from "@/api/client";
import { FormAlert, FormField } from "@/components/form-field";
import { TaskNotes } from "@/components/notes/task-notes";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Textarea } from "@/components/ui/textarea";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { TASK_DESCRIPTION_MAX_LENGTH, taskSchema } from "@/lib/tasks";

import { PrioritySelect } from "./priority-select";

type TaskEditDialogProps = {
  task: Task;
  onSave: (task: Task, changes: UpdateTaskRequest) => Promise<void>;
  /** Called once the dialog has closed, whether saved or cancelled. */
  onClose: () => void;
};

/**
 * Edits a task in a modal `<dialog>`, which provides focus containment, Escape to close, and an
 * inert background. Focus returns to whatever opened it.
 */
export function TaskEditDialog({ task, onSave, onClose }: TaskEditDialogProps) {
  const id = useId();
  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting: saving },
  } = useForm({
    resolver: yupResolver(taskSchema),
    defaultValues: {
      title: task.title,
      description: task.description,
      dueDate: task.due_date ?? "",
      priority: task.priority,
    },
  });
  const { close, dialogProps } = useModalDialog({ onClose, dismissible: !saving });
  const description = useWatch({ control, name: "description" });
  const dueDate = useWatch({ control, name: "dueDate" });

  async function save(values: InferType<typeof taskSchema>) {
    const changes: UpdateTaskRequest = {};
    if (values.title !== task.title) changes.title = values.title;
    if (values.description !== task.description) changes.description = values.description;
    if ((values.dueDate || null) !== task.due_date) changes.due_date = values.dueDate || null;
    if (values.priority !== task.priority) changes.priority = values.priority;
    if (Object.keys(changes).length === 0) {
      close();
      return;
    }

    try {
      await onSave(task, changes);
      close();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t save the task. Try again."),
      });
    }
  }

  return (
    <dialog
      {...dialogProps}
      aria-labelledby={`${id}-heading`}
      className="dialog-motion dialog-pop mx-auto mt-[10vh] w-[calc(100%-2rem)] max-w-lg rounded-xl border bg-popover p-0 text-popover-foreground shadow-elevation-3"
    >
      <form
        noValidate
        // Called here, not during render: `save` closes the dialog through a ref.
        onSubmit={(event) => void handleSubmit(save)(event)}
        className="space-y-4 p-5"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={`${id}-heading`} className="text-base font-semibold">
            Edit task
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
          {...register("title")}
          error={errors.title?.message}
        />

        <div className="space-y-1.5">
          <label htmlFor={`${id}-description`} className="block text-sm font-medium">
            Description <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Textarea
            id={`${id}-description`}
            rows={4}
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
              `${description.trim().length} / ${TASK_DESCRIPTION_MAX_LENGTH} characters`}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor={`${id}-due`} className="block text-sm font-medium">
              Due date
            </label>
            <div className="flex gap-2">
              <Controller
                control={control}
                name="dueDate"
                render={({ field }) => (
                  <DatePicker
                    id={`${id}-due`}
                    ref={field.ref}
                    value={field.value}
                    onValueChange={field.onChange}
                    onBlur={field.onBlur}
                    placeholder="No due date"
                    className="flex-1"
                  />
                )}
              />
              {dueDate ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9"
                  aria-label="Clear due date"
                  onClick={() => setValue("dueDate", "")}
                >
                  Clear
                </Button>
              ) : null}
            </div>
          </div>
          <Controller
            control={control}
            name="priority"
            render={({ field }) => (
              <PrioritySelect id={`${id}-priority`} value={field.value} onChange={field.onChange} />
            )}
          />
        </div>

        <TaskNotes taskId={task.id} />

        <FormAlert message={errors.root?.server?.message ?? null} />

        <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
          <Button variant="ghost" disabled={saving} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
