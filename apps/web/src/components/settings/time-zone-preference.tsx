"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import { useId, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { updateMe } from "@/api/profile";
import { FormAlert } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { useAuth, useCurrentUser } from "@/providers/auth";
import {
  browserTimeZone,
  timeZoneLabel,
  timeZoneNames,
  timeZonePreferenceSchema,
} from "@/utils/time-zones";

/** The account's time zone, which new reminders start in. */
export function TimeZonePreference() {
  const id = useId();
  const { withToken, setUser } = useAuth();
  const user = useCurrentUser();
  const detected = browserTimeZone();
  const zones = useMemo(() => timeZoneNames(detected, user.timezone), [detected, user.timezone]);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: yupResolver(timeZonePreferenceSchema),
    defaultValues: { timeZone: user.timezone ?? "" },
  });
  const [saved, setSaved] = useState(false);
  const unchanged = useWatch({ control, name: "timeZone" }) === (user.timezone ?? "");

  const onSubmit = handleSubmit(async ({ timeZone }) => {
    setSaved(false);
    try {
      const updated = await withToken((token) => updateMe(token, { timezone: timeZone || null }));
      setUser(updated);
      reset({ timeZone: updated.timezone ?? "" });
      setSaved(true);
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t save your time zone. Try again."),
      });
    }
  });

  return (
    <form noValidate onSubmit={onSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor={`${id}-zone`} className="block text-sm font-medium">
          Time zone
        </label>
        <NativeSelect
          id={`${id}-zone`}
          aria-describedby={`${id}-hint`}
          {...register("timeZone", { onChange: () => setSaved(false) })}
        >
          <option value="">Not set: use this device’s ({timeZoneLabel(detected)})</option>
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {timeZoneLabel(zone)}
            </option>
          ))}
        </NativeSelect>
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          New reminders start in this time zone. Each reminder keeps its own, so changing this
          doesn’t move existing reminders.
        </p>
      </div>
      <FormAlert message={errors.root?.server?.message ?? null} />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={isSubmitting || unchanged}>
          {isSubmitting ? "Saving…" : "Save time zone"}
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {saved ? "Saved." : null}
        </p>
      </div>
    </form>
  );
}
