"use client";

import { X } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";

import { FormAlert, FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { describeApiError } from "@/lib/api";
import { validateListName } from "@/lib/shopping";

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
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | undefined>();
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
    const nameError = validateListName(name);
    setError(nameError);
    setFormError(null);
    if (nameError) return;
    if (name.trim() === initialName) {
      close();
      return;
    }
    setSaving(true);
    try {
      await onSave(name.trim());
      close();
    } catch (reason) {
      setFormError(describeApiError(reason, "Couldn’t save the list. Try again."));
      setSaving(false);
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
      <form noValidate onSubmit={onSubmit} className="space-y-4 p-5">
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
          name="name"
          autoComplete="off"
          autoFocus
          placeholder="Electronics"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (error) setError(undefined);
          }}
          error={error}
        />

        <FormAlert message={formError} />

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
