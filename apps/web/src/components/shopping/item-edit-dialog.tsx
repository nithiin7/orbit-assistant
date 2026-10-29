"use client";

import type { ShoppingItem, UpdateShoppingItemRequest } from "@orbit/contracts";
import { X } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";

import { focusFirstInvalid, FormAlert, FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { describeApiError } from "@/lib/api";
import {
  NOTES_MAX_LENGTH,
  optionalText,
  validateItemName,
  validateNotes,
  validateQuantity,
  validateUrl,
} from "@/lib/shopping";

type ItemEditDialogProps = {
  item: ShoppingItem;
  onSave: (item: ShoppingItem, changes: UpdateShoppingItemRequest) => Promise<void>;
  /** Called once the dialog has closed, whether saved or cancelled. */
  onClose: () => void;
};

type Errors = { name?: string; quantity?: string; url?: string; notes?: string };

/** Edits an item in a modal `<dialog>`. Focus returns to whatever opened it. */
export function ItemEditDialog({ item, onSave, onClose }: ItemEditDialogProps) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [name, setName] = useState(item.name);
  const [quantity, setQuantity] = useState(item.quantity ?? "");
  const [url, setUrl] = useState(item.url ?? "");
  const [notes, setNotes] = useState(item.notes);
  const [errors, setErrors] = useState<Errors>({});
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
    const next: Errors = {
      name: validateItemName(name),
      quantity: validateQuantity(quantity),
      url: validateUrl(url),
      notes: validateNotes(notes),
    };
    setErrors(next);
    setFormError(null);
    if (next.name || next.quantity || next.url || next.notes) {
      focusFirstInvalid(formRef.current, next, {
        name: "name",
        quantity: "quantity",
        url: "url",
        notes: "notes",
      });
      return;
    }

    const changes: UpdateShoppingItemRequest = {};
    if (name.trim() !== item.name) changes.name = name.trim();
    if (optionalText(quantity) !== item.quantity) changes.quantity = optionalText(quantity);
    if (optionalText(url) !== item.url) changes.url = optionalText(url);
    if (notes.trim() !== item.notes) changes.notes = notes.trim();
    if (Object.keys(changes).length === 0) {
      close();
      return;
    }

    setSaving(true);
    try {
      await onSave(item, changes);
      close();
    } catch (reason) {
      setFormError(describeApiError(reason, "Couldn’t save the item. Try again."));
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
            Edit item
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
          label="Item"
          name="name"
          autoComplete="off"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={errors.name}
        />

        <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
          <FormField
            label="Quantity"
            name="quantity"
            autoComplete="off"
            placeholder="2 kg"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            error={errors.quantity}
          />
          <FormField
            label="Link"
            name="url"
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            error={errors.url}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`${id}-notes`} className="block text-sm font-medium">
            Notes <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Textarea
            id={`${id}-notes`}
            name="notes"
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            aria-invalid={errors.notes ? true : undefined}
            aria-describedby={`${id}-notes-hint`}
          />
          <p
            id={`${id}-notes-hint`}
            className={
              errors.notes
                ? "text-xs font-medium text-destructive"
                : "text-xs text-muted-foreground"
            }
          >
            {errors.notes ?? `${notes.trim().length} / ${NOTES_MAX_LENGTH} characters`}
          </p>
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
