"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { BackupSettings } from "@orbit/contracts";
import { CalendarClock } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { InferType } from "yup";

import { describeApiError } from "@/api/client";
import { FormAlert, FormField, SelectField } from "@/components/form-field";
import { Section } from "@/components/integrations/section";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useUpdateBackupSettings } from "@/hooks/use-backups";
import {
  backupSettingsSchema,
  formatWhen,
  FREQUENCIES,
  MAX_RETENTION,
  MIN_PASSWORD_LENGTH,
} from "@/lib/backups";

type Values = InferType<typeof backupSettingsSchema>;

/** How often the server backs this workspace up, how many to keep, and how. */
export function AutomaticBackups({ settings }: { settings: BackupSettings }) {
  const update = useUpdateBackupSettings();
  const [changingPassword, setChangingPassword] = useState(false);
  const [saved, setSaved] = useState(false);
  const {
    register,
    control,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<Values>({
    resolver: yupResolver(backupSettingsSchema),
    defaultValues: {
      frequency: settings.frequency,
      retention: settings.retention_count,
      includeFiles: settings.include_files,
      encrypt: settings.encrypt,
      password: "",
      confirm: "",
    },
  });
  const encrypt = useWatch({ control, name: "encrypt" });
  const askPassword = changingPassword || (encrypt && !settings.has_backup_password);

  const onSubmit = handleSubmit(async (values) => {
    setSaved(false);
    if (values.encrypt && !settings.has_backup_password && !values.password) {
      setError("password", { message: "Choose a backup password to encrypt backups." });
      return;
    }
    try {
      const next = await update.mutateAsync({
        frequency: values.frequency,
        retention_count: values.retention,
        include_files: values.includeFiles,
        encrypt: values.encrypt,
        password: askPassword && values.password ? values.password : null,
      });
      reset({
        frequency: next.frequency,
        retention: next.retention_count,
        includeFiles: next.include_files,
        encrypt: next.encrypt,
        password: "",
        confirm: "",
      });
      setChangingPassword(false);
      setSaved(true);
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t save automatic backups. Try again."),
      });
    }
  });

  return (
    <Section
      id="backup-schedule"
      icon={CalendarClock}
      title="Automatic backups"
      description="Back up this workspace on a schedule."
    >
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField control={control} name="frequency" label="Frequency" options={FREQUENCIES} />
          <FormField
            label="Backups to keep"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_RETENTION}
            hint="Manual backups are always kept."
            {...register("retention", { valueAsNumber: true })}
            error={errors.retention?.message}
          />
        </div>
        <label className="flex items-start gap-3 text-sm">
          <Checkbox {...register("includeFiles")} className="mt-0.5" />
          <span>
            <span className="block font-medium">Include files</span>
            <span className="block text-muted-foreground">Documents, attachments, and photos.</span>
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <Checkbox {...register("encrypt")} className="mt-0.5" />
          <span>
            <span className="block font-medium">Encrypt with a backup password</span>
            <span className="block text-muted-foreground">
              {settings.has_backup_password && settings.backup_password_set_at
                ? `Password set ${formatWhen(settings.backup_password_set_at)}. `
                : ""}
              If you forget it, these backups can’t be restored.
            </span>
          </span>
        </label>
        {settings.has_backup_password && !changingPassword ? (
          <Button variant="ghost" size="sm" onClick={() => setChangingPassword(true)}>
            Change backup password
          </Button>
        ) : null}
        {askPassword ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={settings.has_backup_password ? "New backup password" : "Backup password"}
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
          </div>
        ) : null}
        <FormAlert message={errors.root?.server?.message ?? null} />
        <div className="flex items-center gap-3">
          <Button
            type="submit"
            size="sm"
            disabled={isSubmitting || (!isDirty && !changingPassword)}
          >
            {isSubmitting ? "Saving…" : "Save"}
          </Button>
          <p role="status" className="text-sm text-muted-foreground">
            {saved ? "Saved." : null}
          </p>
        </div>
      </form>
    </Section>
  );
}
