"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { CreateTaskRequest } from "@orbit/contracts";
import { Plus } from "lucide-react";
import { type Ref, useId } from "react";
import { Controller, useForm } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { FormAlert } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { newTaskSchema } from "@/lib/tasks";
import { mergeRefs } from "@/utils/common";

import { PrioritySelect } from "./priority-select";

type TaskComposerProps = {
  onCreate: (draft: CreateTaskRequest) => Promise<void>;
  /** Lets the page focus the title field from its keyboard shortcut. */
  titleRef?: Ref<HTMLInputElement>;
};

/** Quick entry: type a title, optionally set a due date and priority, press Enter. */
export function TaskComposer({ onCreate, titleRef }: TaskComposerProps) {
  const id = useId();
  const {
    register,
    control,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: yupResolver(newTaskSchema),
    defaultValues: { title: "", dueDate: "", priority: "none" as const },
  });

  const onSubmit = handleSubmit(async ({ title, dueDate, priority }) => {
    try {
      await onCreate({ title, description: "", priority, due_date: dueDate || null });
      // Ready for the next task; focus stays in the title field.
      reset();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t add the task. Try again."),
      });
    }
  });

  const titleField = register("title");
  const fieldError = errors.title?.message;
  const errorId = `${id}-error`;
  return (
    <form
      noValidate
      onSubmit={(event) => {
        // Enter in the title field submits even while the button is disabled.
        if (isSubmitting) event.preventDefault();
        else void onSubmit(event);
      }}
      aria-label="Add a task"
      className="space-y-3 rounded-xl border bg-card p-3 shadow-elevation-1 sm:p-4"
    >
      <div className="flex flex-col gap-2 lg:flex-row">
        <div className="relative min-w-0 flex-1">
          <label htmlFor={`${id}-title`} className="sr-only">
            Task title
          </label>
          <Input
            {...titleField}
            ref={mergeRefs(titleField.ref, titleRef)}
            id={`${id}-title`}
            autoComplete="off"
            placeholder="Add a task…"
            aria-keyshortcuts="N"
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? errorId : undefined}
            className="pr-9"
          />
          <Kbd
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 sm:inline-flex"
          >
            N
          </Kbd>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`${id}-due`} className="sr-only">
            Due date
          </label>
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
                placeholder="Due date"
                clearable
                className="min-w-40 flex-1 sm:flex-none"
              />
            )}
          />
          <Controller
            control={control}
            name="priority"
            render={({ field }) => (
              <PrioritySelect
                id={`${id}-priority`}
                value={field.value}
                onChange={field.onChange}
                className="min-w-36 flex-1 sm:flex-none"
                hiddenLabel
              />
            )}
          />
          <Button type="submit" disabled={isSubmitting} className="flex-1 sm:flex-none">
            <Plus aria-hidden="true" />
            {isSubmitting ? "Adding…" : "Add task"}
          </Button>
        </div>
      </div>
      {fieldError ? (
        <p id={errorId} className="text-xs font-medium text-destructive">
          {fieldError}
        </p>
      ) : null}
      <FormAlert message={errors.root?.server?.message ?? null} />
    </form>
  );
}
