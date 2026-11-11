"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { ShoppingListIcon } from "@orbit/contracts";
import { X } from "lucide-react";
import { useId } from "react";
import { Controller, useForm } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { FormAlert, FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
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

        <Controller
          control={control}
          name="icon"
          render={({ field }) => <IconChoices value={field.value} onChange={field.onChange} />}
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
