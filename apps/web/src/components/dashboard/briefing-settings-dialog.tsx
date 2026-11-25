"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { BriefingSettings } from "@orbit/contracts";
import Link from "next/link";
import { useId } from "react";
import { useForm } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { FormAlert, FormField, SelectField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import {
  BRIEFING_MODULES,
  briefingSettingsSchema,
  type BriefingSettingsValues,
  MODULE_LABELS,
  settingsToValues,
  valuesToSettings,
} from "@/lib/briefing";

const HORIZONS = Array.from({ length: 14 }, (_, index) => {
  const days = index + 1;
  return { value: String(days), label: days === 1 ? "1 day" : `${days} days` };
});

type Props = {
  settings: BriefingSettings;
  timeZone: string;
  onSave: (settings: BriefingSettings) => Promise<unknown>;
  onClose: () => void;
};

/** How the briefing is prepared in this workspace. Applies from the next briefing prepared. */
export function BriefingSettingsDialog({ settings, timeZone, onSave, onClose }: Props) {
  const id = useId();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: saving },
  } = useForm<BriefingSettingsValues>({
    resolver: yupResolver(briefingSettingsSchema),
    defaultValues: settingsToValues(settings),
  });
  const { close, dialogProps } = useModalDialog({ onClose, dismissible: !saving });

  async function save(values: BriefingSettingsValues) {
    try {
      await onSave(valuesToSettings(values));
      close();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t save your briefing settings."),
      });
    }
  }

  return (
    <Dialog
      {...dialogProps}
      aria-labelledby={`${id}-heading`}
      className="mt-[8vh] max-h-[84vh] max-w-md overflow-y-auto"
    >
      <form
        noValidate
        onSubmit={(event) => void handleSubmit(save)(event)}
        className="space-y-4 p-5"
      >
        <DialogHeader titleId={`${id}-heading`} title="Briefing settings" onClose={close} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField control={control} name="horizonDays" label="Look ahead" options={HORIZONS} />
          <FormField
            label="Prepare it at"
            type="time"
            {...register("prepareAt")}
            error={errors.prepareAt?.message}
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Leave the time empty to prepare your briefing when you open it. Times are in {timeZone}.{" "}
          <Link
            href="/settings/account"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Change your time zone
          </Link>
        </p>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Include</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {BRIEFING_MODULES.map((module) => (
              <label key={module} className="flex items-center gap-2 text-sm">
                <Checkbox value={module} {...register("shown")} />
                {MODULE_LABELS[module]}
              </label>
            ))}
          </div>
          {errors.shown?.message ? (
            <p role="alert" className="text-sm text-destructive">
              {errors.shown.message}
            </p>
          ) : null}
        </fieldset>
        <p className="text-sm text-muted-foreground">
          Changes apply to your next briefing. Regenerate today’s to see them now.
        </p>
        <FormAlert message={errors.root?.server?.message ?? null} />
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button variant="ghost" disabled={saving} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
