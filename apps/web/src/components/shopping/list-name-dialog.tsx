"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { useForm } from "react-hook-form";
import type { InferType } from "yup";

import { describeApiError } from "@/api/client";
import { FormAlert, FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { listNameSchema } from "@/lib/shopping";

type ListNameDialogProps = {
  title: string;
  submitLabel: string;
  initialName: string;
  onSave: (name: string) => Promise<void>;
  /** Called once the dialog has closed, whether saved or cancelled. */
  onClose: () => void;
};

/** Names a new list or renames one, in a modal `<dialog>`. Focus returns to whatever opened it. */
export function ListNameDialog({
  title,
  submitLabel,
  initialName,
  onSave,
  onClose,
}: ListNameDialogProps) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: saving },
  } = useForm({ resolver: yupResolver(listNameSchema), defaultValues: { name: initialName } });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
  }, []);

  const close = () => dialogRef.current?.close();

  async function save({ name }: InferType<typeof listNameSchema>) {
    if (name === initialName) {
      close();
      return;
    }
    try {
      await onSave(name);
      close();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t save the list. Try again."),
      });
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${id}-heading`}
      className="dialog-motion dialog-pop mx-auto mt-[10vh] w-[calc(100%-2rem)] max-w-sm rounded-xl border bg-popover p-0 text-popover-foreground shadow-elevation-3"
      onClose={() => {
        returnFocusRef.current?.focus();
        onClose();
      }}
      onClick={(event) => {
        // A click on the dialog element itself (not its content) is a backdrop click.
        if (event.target === event.currentTarget && !saving) close();
      }}
    >
      <form
        noValidate
        // Called here, not during render: `save` closes the dialog through a ref.
        onSubmit={(event) => void handleSubmit(save)(event)}
        className="space-y-4 p-5"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={`${id}-heading`} className="text-base font-semibold">
            {title}
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
          label="List name"
          autoComplete="off"
          autoFocus
          placeholder="Electronics"
          {...register("name")}
          error={errors.name?.message}
        />

        <FormAlert message={errors.root?.server?.message ?? null} />

        <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
          <Button variant="ghost" disabled={saving} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : submitLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
