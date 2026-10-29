"use client";

import type { Task, TaskPriority, UpdateTaskRequest } from "@orbit/contracts";
import { X } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";

import { FormAlert, FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { describeApiError } from "@/lib/api";
import {
  TASK_DESCRIPTION_MAX_LENGTH,
  validateTaskDescription,
  validateTaskTitle,
} from "@/lib/tasks";

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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [dueDate, setDueDate] = useState(task.due_date ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [errors, setErrors] = useState<{ title?: string; description?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
  }, []);

  const close = () => dialogRef.current?.close();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = {
      title: validateTaskTitle(title),
      description: validateTaskDescription(description),
    };
    setErrors(next);
    setFormError(null);
    if (next.title || next.description) {
      formRef.current
        ?.querySelector<HTMLElement>(next.title ? '[name="title"]' : '[name="description"]')
        ?.focus();
      return;
    }

    const changes: UpdateTaskRequest = {};
    if (title.trim() !== task.title) changes.title = title.trim();
    if (description.trim() !== task.description) changes.description = description.trim();
    if ((dueDate || null) !== task.due_date) changes.due_date = dueDate || null;
    if (priority !== task.priority) changes.priority = priority;
    if (Object.keys(changes).length === 0) {
      close();
      return;
    }

    setSaving(true);
    try {
      await onSave(task, changes);
      close();
    } catch (reason) {
      setFormError(describeApiError(reason, "Couldn’t save the task. Try again."));
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${id}-heading`}
      className="dialog-motion dialog-pop mx-auto mt-[10vh] w-[calc(100%-2rem)] max-w-lg rounded-xl border bg-popover p-0 text-popover-foreground shadow-elevation-3"
      onClose={() => {
        returnFocusRef.current?.focus();
        onClose();
      }}
      onClick={(event) => {
        // A click on the dialog element itself (not its content) is a backdrop click.
        if (event.target === event.currentTarget && !saving) close();
      }}
    >
      <form ref={formRef} noValidate onSubmit={onSubmit} className="space-y-4 p-5">
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
          name="title"
          autoComplete="off"
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          error={errors.title}
        />

        <div className="space-y-1.5">
          <label htmlFor={`${id}-description`} className="block text-sm font-medium">
            Description <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Textarea
            id={`${id}-description`}
            name="description"
            rows={4}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
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
            {errors.description ??
              `${description.trim().length} / ${TASK_DESCRIPTION_MAX_LENGTH} characters`}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor={`${id}-due`} className="block text-sm font-medium">
              Due date
            </label>
            <div className="flex gap-2">
              <Input
                id={`${id}-due`}
                type="date"
                name="due_date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
              {dueDate ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9"
                  aria-label="Clear due date"
                  onClick={() => setDueDate("")}
                >
                  Clear
                </Button>
              ) : null}
            </div>
          </div>
          <PrioritySelect id={`${id}-priority`} value={priority} onChange={setPriority} />
        </div>

        <FormAlert message={formError} />

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
