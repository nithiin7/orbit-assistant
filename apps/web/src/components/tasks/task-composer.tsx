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
      className="space-y-2 rounded-2xl border bg-card p-2 shadow-elevation-2 transition-[border-color,box-shadow] duration-150 focus-within:border-ring/60 focus-within:shadow-elevation-3 has-[[aria-invalid=true]]:border-destructive/60"
    >
      <div className="flex flex-col gap-2 @2xl/list:flex-row @2xl/list:items-center">
        <div className="relative flex min-w-0 flex-1 items-center">
          <Plus
            aria-hidden="true"
            className="pointer-events-none absolute left-3 size-5 text-brand"
          />
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
            // The card draws the field's frame and focus state.
            className="h-11 border-transparent bg-transparent pr-10 pl-11 text-base shadow-none focus-visible:border-transparent focus-visible:ring-0 aria-invalid:border-transparent @2xl/list:text-sm dark:bg-transparent"
          />
          <Kbd
            aria-hidden="true"
            className="pointer-events-none absolute right-2 hidden sm:inline-flex"
          >
            N
          </Kbd>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t pt-2 @2xl/list:border-t-0 @2xl/list:border-l @2xl/list:pt-0 @2xl/list:pl-2">
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
                className="min-w-32 flex-1 @2xl/list:w-40 @2xl/list:flex-none"
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
                className="min-w-32 flex-1 @2xl/list:w-36 @2xl/list:flex-none"
                hiddenLabel
              />
            )}
          />
          <Button type="submit" disabled={isSubmitting} className="flex-1 @md/list:flex-none">
            {isSubmitting ? "Adding…" : "Add task"}
          </Button>
        </div>
      </div>
      {fieldError ? (
        <p id={errorId} className="px-3 pb-1 text-xs font-medium text-destructive">
          {fieldError}
        </p>
      ) : null}
      <FormAlert message={errors.root?.server?.message ?? null} />
    </form>
  );
}
