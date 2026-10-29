"use client";

import type { CreateTaskRequest, TaskPriority } from "@orbit/contracts";
import { Plus } from "lucide-react";
import { type FormEvent, type Ref, useId, useState } from "react";

import { FormAlert } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { describeApiError } from "@/lib/api";
import { validateTaskTitle } from "@/lib/tasks";

import { PrioritySelect } from "./priority-select";

type TaskComposerProps = {
  onCreate: (draft: CreateTaskRequest) => Promise<void>;
  /** Lets the page focus the title field from its keyboard shortcut. */
  titleRef?: Ref<HTMLInputElement>;
};

/** Quick entry: type a title, optionally set a due date and priority, press Enter. */
export function TaskComposer({ onCreate, titleRef }: TaskComposerProps) {
  const id = useId();
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("none");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const error = validateTaskTitle(title);
    setFieldError(error);
    setFormError(null);
    if (error) return;
    setSaving(true);
    try {
      await onCreate({ title: title.trim(), description: "", priority, due_date: dueDate || null });
      // Ready for the next task; focus stays in the title field.
      setTitle("");
      setDueDate("");
      setPriority("none");
    } catch (reason) {
      setFormError(describeApiError(reason, "Couldn’t add the task. Try again."));
    }
    setSaving(false);
  }

  const errorId = `${id}-error`;
  return (
    <form
      noValidate
      onSubmit={onSubmit}
      aria-label="Add a task"
      className="space-y-3 rounded-xl border bg-card p-3 shadow-elevation-1 sm:p-4"
    >
      <div className="flex flex-col gap-2 lg:flex-row">
        <div className="relative min-w-0 flex-1">
          <label htmlFor={`${id}-title`} className="sr-only">
            Task title
          </label>
          <Input
            ref={titleRef}
            id={`${id}-title`}
            name="title"
            autoComplete="off"
            placeholder="Add a task…"
            aria-keyshortcuts="N"
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? errorId : undefined}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              if (fieldError) setFieldError(undefined);
            }}
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
          <Input
            id={`${id}-due`}
            type="date"
            name="due_date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            className="w-auto min-w-36 flex-1 sm:flex-none"
          />
          <PrioritySelect
            id={`${id}-priority`}
            value={priority}
            onChange={setPriority}
            className="min-w-36 flex-1 sm:flex-none"
            hiddenLabel
          />
          <Button type="submit" disabled={saving} className="flex-1 sm:flex-none">
            <Plus aria-hidden="true" />
            {saving ? "Adding…" : "Add task"}
          </Button>
        </div>
      </div>
      {fieldError ? (
        <p id={errorId} className="text-xs font-medium text-destructive">
          {fieldError}
        </p>
      ) : null}
      <FormAlert message={formError} />
    </form>
  );
}
