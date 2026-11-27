"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";

import { SelectField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import {
  FOCUS_CHOICES,
  type FocusSettings,
  focusSettingsSchema,
  type FocusSettingsValues,
  notificationsSupported,
  settingsToValues,
  valuesToSettings,
} from "@/lib/focus";

function minuteOptions(choices: readonly number[]) {
  return choices.map((minutes) => ({
    value: String(minutes),
    label: minutes === 1 ? "1 minute" : `${minutes} minutes`,
  }));
}

const SESSION_OPTIONS = FOCUS_CHOICES.sessionsPerLongBreak.map((count) => ({
  value: String(count),
  label: `After ${count} sessions`,
}));

type Props = {
  settings: FocusSettings;
  /** The timer running now, which keeps the lengths it started with. */
  running: boolean;
  onSave: (settings: FocusSettings) => void;
  onClose: () => void;
};

/** Focus timer lengths and alerts, saved in this browser. */
export function FocusSettingsDialog({ settings, running, onSave, onClose }: Props) {
  const id = useId();
  const { register, control, handleSubmit, setValue } = useForm<FocusSettingsValues>({
    resolver: yupResolver(focusSettingsSchema),
    defaultValues: settingsToValues(settings),
  });
  const { close, dialogProps } = useModalDialog({ onClose });
  const [notice, setNotice] = useState<string | null>(null);
  const notifyField = register("notify");

  function save(values: FocusSettingsValues) {
    onSave(valuesToSettings(values));
    close();
  }

  async function changeNotify(event: React.ChangeEvent<HTMLInputElement>) {
    await notifyField.onChange(event);
    if (!event.target.checked) return;
    setNotice(null);
    // Notifications need the browser's permission, asked for here, when the user turns them on.
    const permission =
      Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
    if (permission !== "granted") {
      setValue("notify", false);
      setNotice("Your browser blocked notifications. Allow them in its site settings first.");
    }
  }

  const canNotify = notificationsSupported();

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
        <DialogHeader titleId={`${id}-heading`} title="Focus timer settings" onClose={close} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            control={control}
            name="focusMinutes"
            label="Focus"
            options={minuteOptions(FOCUS_CHOICES.focusMinutes)}
          />
          <SelectField
            control={control}
            name="shortBreakMinutes"
            label="Short break"
            options={minuteOptions(FOCUS_CHOICES.shortBreakMinutes)}
          />
          <SelectField
            control={control}
            name="longBreakMinutes"
            label="Long break"
            options={minuteOptions(FOCUS_CHOICES.longBreakMinutes)}
          />
          <SelectField
            control={control}
            name="sessionsPerLongBreak"
            label="Long break comes"
            options={SESSION_OPTIONS}
          />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">When a session or break ends</legend>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox {...register("sound")} />
            Play a soft chime
          </label>
          {canNotify ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox {...notifyField} onChange={(event) => void changeNotify(event)} />
              Show a notification when Orbit is in the background
            </label>
          ) : null}
          {notice ? (
            <p role="alert" className="text-sm text-destructive">
              {notice}
            </p>
          ) : null}
        </fieldset>
        <p className="text-sm text-muted-foreground">
          Saved in this browser.
          {running ? " The timer running now keeps its lengths; new ones start with these." : null}
        </p>
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit">Save</Button>
        </div>
      </form>
    </Dialog>
  );
}
