"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { ShoppingItem, UpdateShoppingItemRequest } from "@orbit/contracts";
import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { InferType } from "yup";

import { describeApiError } from "@/api/client";
import { FormAlert, FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { itemSchema, NOTES_MAX_LENGTH, optionalText } from "@/lib/shopping";

type ItemEditDialogProps = {
  item: ShoppingItem;
  onSave: (item: ShoppingItem, changes: UpdateShoppingItemRequest) => Promise<void>;
  /** Called once the dialog has closed, whether saved or cancelled. */
  onClose: () => void;
};

/** Edits an item in a modal `<dialog>`. Focus returns to whatever opened it. */
export function ItemEditDialog({ item, onSave, onClose }: ItemEditDialogProps) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors, isSubmitting: saving },
  } = useForm({
    resolver: yupResolver(itemSchema),
    defaultValues: {
      name: item.name,
      quantity: item.quantity ?? "",
      url: item.url ?? "",
      notes: item.notes,
    },
  });
  const notes = useWatch({ control, name: "notes" });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
  }, []);

  const close = () => dialogRef.current?.close();

  async function save(values: InferType<typeof itemSchema>) {
    const quantity = optionalText(values.quantity);
    const url = optionalText(values.url);
    const changes: UpdateShoppingItemRequest = {};
    if (values.name !== item.name) changes.name = values.name;
    if (quantity !== item.quantity) changes.quantity = quantity;
    if (url !== item.url) changes.url = url;
    if (values.notes !== item.notes) changes.notes = values.notes;
    if (Object.keys(changes).length === 0) {
      close();
      return;
    }

    try {
      await onSave(item, changes);
      close();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t save the item. Try again."),
      });
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
      <form
        noValidate
        // Called here, not during render: `save` closes the dialog through a ref.
        onSubmit={(event) => void handleSubmit(save)(event)}
        className="space-y-4 p-5"
      >
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
          autoComplete="off"
          autoFocus
          {...register("name")}
          error={errors.name?.message}
        />

        <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
          <FormField
            label="Quantity"
            autoComplete="off"
            placeholder="2 kg"
            {...register("quantity")}
            error={errors.quantity?.message}
          />
          <FormField
            label="Link"
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://"
            {...register("url")}
            error={errors.url?.message}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`${id}-notes`} className="block text-sm font-medium">
            Notes <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Textarea
            id={`${id}-notes`}
            rows={3}
            {...register("notes")}
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
            {errors.notes?.message ?? `${notes.trim().length} / ${NOTES_MAX_LENGTH} characters`}
          </p>
        </div>

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
