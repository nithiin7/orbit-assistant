"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import { useId } from "react";
import { useForm } from "react-hook-form";
import type { InferType } from "yup";

import { describeApiError } from "@/api/client";
import { FormAlert, FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
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
    <dialog
      {...dialogProps}
      aria-labelledby={`${id}-heading`}
      className="dialog-motion dialog-pop mx-auto mt-[10vh] w-[calc(100%-2rem)] max-w-sm rounded-xl border bg-popover p-0 text-popover-foreground shadow-elevation-3"
    >
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
        <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
          <Button variant="ghost" disabled={saving} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Rename"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
