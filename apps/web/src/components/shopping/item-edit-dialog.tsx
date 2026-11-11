"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { ShoppingItem, UpdateShoppingItemRequest } from "@orbit/contracts";
import { useId } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { InferType } from "yup";

import { describeApiError } from "@/api/client";
import { FormAlert, FormField } from "@/components/form-field";
import { Dialog, DialogFormActions, DialogHeader } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useModalDialog } from "@/hooks/use-modal-dialog";
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
  const { close, dialogProps } = useModalDialog({ onClose, dismissible: !saving });
  const notes = useWatch({ control, name: "notes" });

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
    <Dialog {...dialogProps} aria-labelledby={`${id}-heading`} className="mt-[10vh] max-w-lg">
      <form
        noValidate
        // Called here, not during render: `save` closes the dialog through a ref.
        onSubmit={(event) => void handleSubmit(save)(event)}
        className="space-y-4 p-5"
      >
        <DialogHeader titleId={`${id}-heading`} title="Edit item" onClose={close} />

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

        <DialogFormActions busy={saving} onCancel={close} submitLabel="Save changes" />
      </form>
    </Dialog>
  );
}
