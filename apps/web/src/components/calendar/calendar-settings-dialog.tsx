"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { CalendarPreferences, CalendarPreferencesRequest } from "@orbit/contracts";
import { X } from "lucide-react";
import Link from "next/link";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { boolean, mixed, object, string } from "yup";

import { describeApiError } from "@/api/client";
import { FormAlert, FormField, SelectField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { CALENDAR_VIEWS } from "@/lib/calendar";

type Values = {
  defaultView: CalendarPreferences["default_view"];
  weekStart: string;
  workStart: string;
  workEnd: string;
  showCompleted: boolean;
  showUnscheduled: boolean;
  showDue: boolean;
};

const schema = object({
  defaultView: mixed<Values["defaultView"]>()
    .oneOf(CALENDAR_VIEWS.map((view) => view.value))
    .defined(),
  weekStart: string().defined(),
  workStart: string()
    .defined()
    .matches(/^\d{2}:\d{2}$/, "Choose a time."),
  workEnd: string()
    .defined()
    .matches(/^\d{2}:\d{2}$/, "Choose a time.")
    .test("after", "Working hours must end after they start.", (value, context) => {
      const { workStart = "" } = context.parent as Partial<Values>;
      return !workStart || value > workStart;
    }),
  showCompleted: boolean().defined(),
  showUnscheduled: boolean().defined(),
  showDue: boolean().defined(),
});

const WEEK_STARTS = [
  { value: "", label: "Follow my locale" },
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "6", label: "Saturday" },
];

type Props = {
  preferences: CalendarPreferences;
  timeZone: string;
  onSave: (preferences: CalendarPreferencesRequest) => Promise<unknown>;
  onClose: () => void;
};

/** The user's calendar preferences. They follow the account across devices and workspaces. */
export function CalendarSettingsDialog({ preferences, timeZone, onSave, onClose }: Props) {
  const id = useId();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: saving },
  } = useForm<Values>({
    resolver: yupResolver(schema),
    defaultValues: {
      defaultView: preferences.default_view ?? "month",
      weekStart:
        preferences.week_start === null || preferences.week_start === undefined
          ? ""
          : String(preferences.week_start),
      workStart: (preferences.working_hours_start ?? "09:00").slice(0, 5),
      workEnd: (preferences.working_hours_end ?? "17:00").slice(0, 5),
      showCompleted: preferences.show_completed_tasks ?? true,
      showUnscheduled: preferences.show_unscheduled_tasks ?? true,
      showDue: preferences.show_due_tasks ?? true,
    },
  });
  const { close, dialogProps } = useModalDialog({ onClose, dismissible: !saving });

  async function save(values: Values) {
    try {
      await onSave({
        default_view: values.defaultView,
        week_start: values.weekStart === "" ? null : Number(values.weekStart),
        working_hours_start: values.workStart,
        working_hours_end: values.workEnd,
        show_completed_tasks: values.showCompleted,
        show_unscheduled_tasks: values.showUnscheduled,
        show_due_tasks: values.showDue,
      });
      close();
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t save your preferences."),
      });
    }
  }

  return (
    <dialog
      {...dialogProps}
      aria-labelledby={`${id}-heading`}
      className="dialog-motion dialog-pop mx-auto mt-[8vh] max-h-[84vh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-xl border bg-popover p-0 text-popover-foreground shadow-elevation-3"
    >
      <form
        noValidate
        onSubmit={(event) => void handleSubmit(save)(event)}
        className="space-y-4 p-5"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={`${id}-heading`} className="text-base font-semibold">
            Calendar settings
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
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            control={control}
            name="defaultView"
            label="Default view"
            options={CALENDAR_VIEWS}
          />
          <SelectField
            control={control}
            name="weekStart"
            label="Week starts on"
            options={WEEK_STARTS}
          />
          <FormField
            label="Working hours start"
            type="time"
            {...register("workStart")}
            error={errors.workStart?.message}
          />
          <FormField
            label="Working hours end"
            type="time"
            {...register("workEnd")}
            error={errors.workEnd?.message}
          />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Tasks on the calendar</legend>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox {...register("showDue")} />
            Show tasks on their due dates
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox {...register("showCompleted")} />
            Show completed tasks
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox {...register("showUnscheduled")} />
            Show the unscheduled tasks list
          </label>
        </fieldset>
        <p className="text-sm text-muted-foreground">
          Times show in {timeZone}.{" "}
          <Link
            href="/settings/account"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Change your time zone
          </Link>
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
    </dialog>
  );
}
