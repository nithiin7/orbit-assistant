"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { BookmarkCollectionColor } from "@orbit/contracts";
import { useId } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { InferType } from "yup";

import { describeApiError } from "@/api/client";
import { FormAlert, FormField, SelectField } from "@/components/form-field";
import { Dialog, DialogFormActions, DialogHeader } from "@/components/ui/dialog";
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
    <Dialog {...dialogProps} aria-labelledby={`${id}-heading`} className="mt-[10vh] max-w-sm">
      <form
        noValidate
        // Called here, not during render: `save` closes the dialog through a ref.
        onSubmit={(event) => void handleSubmit(save)(event)}
        className="space-y-4 p-5"
      >
        <DialogHeader
          titleId={`${id}-heading`}
          titleClassName="flex items-center gap-2"
          title={
            <>
              <span
                aria-hidden="true"
                className={cn("size-2.5 rounded-full", TASK_LIST_STYLES[color].dot)}
              />
              {title}
            </>
          }
          onClose={close}
        />

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

        <DialogFormActions busy={saving} onCancel={close} submitLabel={submitLabel} />
      </form>
    </Dialog>
  );
}
