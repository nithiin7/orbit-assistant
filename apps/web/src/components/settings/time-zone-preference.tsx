"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { updateMe } from "@/api/profile";
import { FormAlert, SelectField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { useAuth, useCurrentUser } from "@/providers/auth";
import {
  browserTimeZone,
  timeZoneLabel,
  timeZoneNames,
  timeZonePreferenceSchema,
} from "@/utils/time-zones";

/** The account's time zone, which new reminders start in. */
export function TimeZonePreference() {
  const { withToken, setUser } = useAuth();
  const user = useCurrentUser();
  const detected = browserTimeZone();
  const zoneOptions = useMemo(
    () => [
      { value: "", label: `Not set: use this device’s (${timeZoneLabel(detected)})` },
      ...timeZoneNames(detected, user.timezone).map((zone) => ({
        value: zone,
        label: timeZoneLabel(zone),
      })),
    ],
    [detected, user.timezone],
  );
  const {
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
      <SelectField
        control={control}
        name="timeZone"
        label="Time zone"
        options={zoneOptions}
        onValueChange={() => setSaved(false)}
        hint="New reminders start in this time zone. Each reminder keeps its own, so changing this doesn’t move existing reminders."
      />
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
