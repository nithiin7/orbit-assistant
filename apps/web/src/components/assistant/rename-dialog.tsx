"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import { useId } from "react";
import { useForm } from "react-hook-form";
import type { InferType } from "yup";

import { describeApiError } from "@/api/client";
import { FormAlert, FormField } from "@/components/form-field";
import { Dialog, DialogFormActions } from "@/components/ui/dialog";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { conversationTitleSchema } from "@/lib/ai";

type RenameDialogProps = {
  initialTitle: string;
  onSave: (title: string) => Promise<unknown>;
  onClose: () => void;
};

/** Renames a conversation, in a modal `<dialog>`. */
export function RenameDialog({ initialTitle, onSave, onClose }: RenameDialogProps) {
  const id = useId();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: saving },
  } = useForm({
    resolver: yupResolver(conversationTitleSchema),
    defaultValues: { title: initialTitle },
  });
  const { close, dialogProps } = useModalDialog({ onClose, dismissible: !saving });

  async function save({ title }: InferType<typeof conversationTitleSchema>) {
    try {
      if (title !== initialTitle) await onSave(title);
      close();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t rename it. Try again."),
      });
    }
  }

  return (
    <Dialog {...dialogProps} aria-labelledby={`${id}-heading`} className="mt-[10vh] max-w-sm">
      <form
        noValidate
        onSubmit={(event) => void handleSubmit(save)(event)}
        className="space-y-4 p-5"
      >
        <h2 id={`${id}-heading`} className="text-base font-semibold">
          Rename conversation
        </h2>
        <FormField
          label="Title"
          autoComplete="off"
          autoFocus
          {...register("title")}
          error={errors.title?.message}
        />
        <FormAlert message={errors.root?.server?.message ?? null} />
        <DialogFormActions busy={saving} onCancel={close} submitLabel="Rename" />
      </form>
    </Dialog>
  );
}
