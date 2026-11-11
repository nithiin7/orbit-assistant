"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { ShoppingListIcon } from "@orbit/contracts";
import { useId } from "react";
import { Controller, useForm } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { FormAlert, FormField } from "@/components/form-field";
import { Dialog, DialogFormActions, DialogHeader } from "@/components/ui/dialog";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { listSchema, SHOPPING_LIST_ICONS } from "@/lib/shopping";
import { cn } from "@/utils/common";

import { SHOPPING_LIST_ICON_COMPONENTS } from "./list-icon";

export type ListDetails = { name: string; icon: ShoppingListIcon };

type ListNameDialogProps = {
  title: string;
  submitLabel: string;
  initial: ListDetails;
  /** Called only when the name or icon changed. */
  onSave: (details: ListDetails) => Promise<void>;
  /** Called once the dialog has closed, whether saved or cancelled. */
  onClose: () => void;
};

/**
 * Names a new list or edits one's name and icon, in a modal `<dialog>`. Focus returns to whatever
 * opened it.
 */
export function ListNameDialog({
  title,
  submitLabel,
  initial,
  onSave,
  onClose,
}: ListNameDialogProps) {
  const id = useId();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: saving },
  } = useForm({ resolver: yupResolver(listSchema), defaultValues: initial });
  const { close, dialogProps } = useModalDialog({ onClose, dismissible: !saving });

  async function save(details: ListDetails) {
    if (details.name === initial.name && details.icon === initial.icon) {
      close();
      return;
    }
    try {
      await onSave(details);
      close();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t save the list. Try again."),
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
        <DialogHeader titleId={`${id}-heading`} title={title} onClose={close} />

        <FormField
          label="List name"
          autoComplete="off"
          autoFocus
          placeholder="Electronics"
          {...register("name")}
          error={errors.name?.message}
        />

        <Controller
          control={control}
          name="icon"
          render={({ field }) => <IconChoices value={field.value} onChange={field.onChange} />}
        />

        <FormAlert message={errors.root?.server?.message ?? null} />

        <DialogFormActions busy={saving} onCancel={close} submitLabel={submitLabel} />
      </form>
    </Dialog>
  );
}

function IconChoices({
  value,
  onChange,
}: {
  value: ShoppingListIcon;
  onChange: (icon: ShoppingListIcon) => void;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">Icon</legend>
      <div className="flex flex-wrap gap-1">
        {SHOPPING_LIST_ICONS.map((option) => {
          const Icon = SHOPPING_LIST_ICON_COMPONENTS[option.value];
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              aria-label={option.label}
              title={option.label}
              onClick={() => onChange(option.value)}
              className={cn(
                "flex size-9 items-center justify-center rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected
                  ? "border-brand bg-brand-subtle text-brand"
                  : "bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
