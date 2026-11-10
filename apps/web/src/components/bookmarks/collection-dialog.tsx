"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { BookmarkCollectionColor } from "@orbit/contracts";
import { X } from "lucide-react";
import { useId } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { InferType } from "yup";

import { describeApiError } from "@/api/client";
import { FormAlert, FormField, SelectField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { COLLECTION_COLORS, collectionSchema } from "@/lib/bookmarks";
import { TASK_LIST_STYLES } from "@/lib/tasks";
import { cn } from "@/utils/common";

export type CollectionValues = InferType<typeof collectionSchema>;

type CollectionDialogProps = {
  title: string;
  submitLabel: string;
  initial: CollectionValues;
  onSave: (values: CollectionValues) => Promise<void>;
  /** Called once the dialog has closed, whether saved or cancelled. */
  onClose: () => void;
};

/** Names and colors a new collection or changes one, in a modal `<dialog>`. */
export function CollectionDialog({
  title,
  submitLabel,
  initial,
  onSave,
  onClose,
}: CollectionDialogProps) {
  const id = useId();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: saving },
  } = useForm({ resolver: yupResolver(collectionSchema), defaultValues: initial });
  const { close, dialogProps } = useModalDialog({ onClose, dismissible: !saving });
  const color: BookmarkCollectionColor = useWatch({ control, name: "color" });

  async function save(values: CollectionValues) {
    if (values.name === initial.name && values.color === initial.color) {
      close();
      return;
    }
    try {
      await onSave(values);
      close();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t save the collection. Try again."),
      });
    }
  }

  return (
    <dialog
      {...dialogProps}
      aria-labelledby={`${id}-heading`}
      className="dialog-motion dialog-pop mx-auto mt-[10vh] w-[calc(100%-2rem)] max-w-sm rounded-xl border bg-popover p-0 text-popover-foreground shadow-elevation-3"
    >
      <form
        noValidate
        // Called here, not during render: `save` closes the dialog through a ref.
        onSubmit={(event) => void handleSubmit(save)(event)}
        className="space-y-4 p-5"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={`${id}-heading`} className="flex items-center gap-2 text-base font-semibold">
            <span
              aria-hidden="true"
              className={cn("size-2.5 rounded-full", TASK_LIST_STYLES[color].dot)}
            />
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
          label="Collection name"
          autoComplete="off"
          autoFocus
          placeholder="Recipes"
          {...register("name")}
          error={errors.name?.message}
        />
        <SelectField control={control} name="color" label="Color" options={COLLECTION_COLORS} />

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
