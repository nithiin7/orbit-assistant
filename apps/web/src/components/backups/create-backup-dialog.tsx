"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import { useId } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { InferType } from "yup";

import { describeApiError } from "@/api/client";
import { FormAlert, FormField, SelectField } from "@/components/form-field";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogFormActions, DialogHeader } from "@/components/ui/dialog";
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
    <Dialog {...dialogProps} aria-labelledby={`${id}-heading`} className="mt-[10vh] max-w-md">
      <form
        noValidate
        onSubmit={(event) => void handleSubmit(save)(event)}
        className="space-y-4 p-5"
      >
        <DialogHeader titleId={`${id}-heading`} title="Create a backup" onClose={close} />

        <label className="flex items-start gap-3 text-sm">
          <Checkbox {...register("includeFiles")} className="mt-0.5" />
          <span className="space-y-0.5">
            <span className="block font-medium">Include files</span>
            <span className="block text-muted-foreground">Documents, attachments, and photos.</span>
          </span>
        </label>

        <SelectField
          control={control}
          name="encryption"
          label="Encryption"
          options={choices}
          hint={
            encryption === "none"
              ? "Anyone with the file can read it."
              : encryption === "backup_key"
                ? "Uses your automatic backup password."
                : "Not stored. Without it the backup can’t be opened."
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

        <DialogFormActions
          busy={isSubmitting}
          onCancel={close}
          submitLabel="Create backup"
          busyLabel="Backing up…"
        />
      </form>
    </Dialog>
  );
}
