"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import { X } from "lucide-react";
import { useId } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { InferType } from "yup";

import { describeApiError } from "@/api/client";
import { FormAlert, FormField, SelectField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useCreateBackup } from "@/hooks/use-backups";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { createBackupSchema, ENCRYPTION_CHOICES, MIN_PASSWORD_LENGTH } from "@/lib/backups";

type Values = InferType<typeof createBackupSchema>;

/** Choose what a manual backup includes and whether it's encrypted, then make it. */
export function CreateBackupDialog({
  hasBackupPassword,
  onClose,
}: {
  hasBackupPassword: boolean;
  onClose: () => void;
}) {
  const id = useId();
  const create = useCreateBackup();
  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: yupResolver(createBackupSchema),
    defaultValues: {
      includeFiles: true,
      encryption: hasBackupPassword ? "backup_key" : "none",
      password: "",
      confirm: "",
    },
  });
  const { close, dialogProps } = useModalDialog({ onClose, dismissible: !isSubmitting });
  const encryption = useWatch({ control, name: "encryption" });
  const choices = ENCRYPTION_CHOICES.filter(
    (choice) => choice.value !== "backup_key" || hasBackupPassword,
  );

  async function save(values: Values) {
    try {
      await create.mutateAsync({
        include_files: values.includeFiles,
        encryption: values.encryption,
        password: values.encryption === "password" ? values.password : null,
      });
      close();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t create the backup. Try again."),
      });
    }
  }

  return (
    <dialog
      {...dialogProps}
      aria-labelledby={`${id}-heading`}
      className="dialog-motion dialog-pop mx-auto mt-[10vh] w-[calc(100%-2rem)] max-w-md rounded-xl border bg-popover p-0 text-popover-foreground shadow-elevation-3"
    >
      <form
        noValidate
        onSubmit={(event) => void handleSubmit(save)(event)}
        className="space-y-4 p-5"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={`${id}-heading`} className="text-base font-semibold">
            Create a backup
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

        <label className="flex items-start gap-3 text-sm">
          <Checkbox {...register("includeFiles")} className="mt-0.5" />
          <span className="space-y-0.5">
            <span className="block font-medium">Include files</span>
            <span className="block text-muted-foreground">
              Documents, note attachments, and progress photos. Without them the backup is smaller,
              but restored records show their files as missing.
            </span>
          </span>
        </label>

        <SelectField
          control={control}
          name="encryption"
          label="Encryption"
          options={choices}
          hint={
            encryption === "none"
              ? "Anyone with the file can read it. Store it as carefully as the data itself."
              : encryption === "backup_key"
                ? "Opens with the backup password from the automatic backup settings."
                : "Orbit never stores this password. Without it the backup can’t be opened."
          }
        />

        {encryption === "password" ? (
          <>
            <FormField
              label="Password"
              type="password"
              autoComplete="new-password"
              hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
              {...register("password")}
              error={errors.password?.message}
            />
            <FormField
              label="Confirm password"
              type="password"
              autoComplete="new-password"
              {...register("confirm")}
              error={errors.confirm?.message}
            />
          </>
        ) : null}

        <FormAlert message={errors.root?.server?.message ?? null} />

        <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
          <Button variant="ghost" disabled={isSubmitting} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Backing up…" : "Create backup"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
