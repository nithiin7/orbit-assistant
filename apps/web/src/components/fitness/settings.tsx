"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { ActivityKind, FitnessHabitLink, FitnessProfile } from "@orbit/contracts";
import { Link2, Trash2 } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { deleteHabitLink, saveFitnessProfile, saveHabitLink } from "@/api/fitness";
import { DateField, FormAlert, FormField, SelectField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";
import { useFitnessAction, useFitnessProfile, useHabitLinks } from "@/hooks/use-fitness";
import { useHabitList } from "@/hooks/use-habits";
import {
  ACTIVITY_KINDS,
  DASHBOARD_SECTIONS,
  DEFAULT_ACTIVITY_GOALS,
  formatNumber,
  IMPERIAL_UNITS,
  labelOf,
  METRIC_UNITS,
  type ProfileFormValues,
  profileSchema,
  toProfileFormValues,
  toProfileRequest,
} from "@/lib/fitness";

import { Loaded, Section } from "./shared";

export function SettingsView({ workspaceId }: { workspaceId: string }) {
  const profile = useFitnessProfile(workspaceId);
  return (
    <div className="space-y-4">
      <Loaded resource={profile.state} reload={profile.reload} skeleton="h-96">
        {(data) => <ProfileForm key={data.updated_at} workspaceId={workspaceId} profile={data} />}
      </Loaded>
      <HabitLinks workspaceId={workspaceId} />
    </div>
  );
}

function ProfileForm({ workspaceId, profile }: { workspaceId: string; profile: FitnessProfile }) {
  const run = useFitnessAction(workspaceId);
  const [saved, setSaved] = useState(false);
  const {
    register,
    control,
    handleSubmit,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ProfileFormValues>({
    resolver: yupResolver(profileSchema),
    defaultValues: toProfileFormValues(profile),
  });

  async function save(values: ProfileFormValues) {
    setSaved(false);
    try {
      await run((token) => saveFitnessProfile(token, workspaceId, toProfileRequest(values)));
      setSaved(true);
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t save your settings."),
      });
    }
  }

  const applySystem = (system: string) => {
    const units = system === "imperial" ? IMPERIAL_UNITS : METRIC_UNITS;
    setValue("weightUnit", units.weight_unit);
    setValue("lengthUnit", units.length_unit);
    setValue("distanceUnit", units.distance_unit);
    setValue("energyUnit", units.energy_unit);
    setValue("waterUnit", units.water_unit);
  };

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(save)(event)} className="space-y-4">
      <Section
        title="Units"
        description="Records are stored in exact metric units and shown in yours. Changing units never changes your data."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField
            control={control}
            name="unitSystem"
            label="System"
            options={[
              { value: "metric", label: "Metric" },
              { value: "imperial", label: "Imperial (US)" },
            ]}
            onValueChange={applySystem}
          />
          <SelectField
            control={control}
            name="weightUnit"
            label="Weight"
            options={[
              { value: "kg", label: "Kilograms" },
              { value: "lb", label: "Pounds" },
            ]}
          />
          <SelectField
            control={control}
            name="lengthUnit"
            label="Body measurements"
            options={[
              { value: "cm", label: "Centimetres" },
              { value: "in", label: "Inches" },
            ]}
          />
          <SelectField
            control={control}
            name="distanceUnit"
            label="Distance"
            options={[
              { value: "km", label: "Kilometres" },
              { value: "mi", label: "Miles" },
            ]}
          />
          <SelectField
            control={control}
            name="energyUnit"
            label="Energy"
            options={[
              { value: "kcal", label: "Kilocalories (kcal)" },
              { value: "kj", label: "Kilojoules (kJ)" },
            ]}
          />
          <SelectField
            control={control}
            name="waterUnit"
            label="Water"
            options={[
              { value: "ml", label: "Millilitres" },
              { value: "l", label: "Litres" },
              { value: "fl_oz", label: "Fluid ounces (US)" },
            ]}
          />
        </div>
      </Section>
      <Section
        title="About you"
        description="Both optional. Height is used only for BMI; nothing is calculated from your date of birth."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={`Height (${profile.length_unit})`}
            inputMode="decimal"
            {...register("height")}
            error={errors.height?.message}
            hint="Shown in the unit you had when the page loaded; save to switch."
          />
          <DateField control={control} name="dateOfBirth" label="Date of birth" clearable />
        </div>
      </Section>
      <Section
        title="Daily targets"
        description="Leave any blank to not track it against a target."
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <FormField
            label={`Energy (${profile.energy_unit === "kcal" ? "kcal" : "kJ"})`}
            inputMode="decimal"
            {...register("energyTarget")}
            error={errors.energyTarget?.message}
          />
          <FormField
            label="Protein (g)"
            inputMode="decimal"
            {...register("proteinTarget")}
            error={errors.proteinTarget?.message}
          />
          <FormField
            label="Carbohydrates (g)"
            inputMode="decimal"
            {...register("carbsTarget")}
            error={errors.carbsTarget?.message}
          />
          <FormField
            label="Fat (g)"
            inputMode="decimal"
            {...register("fatTarget")}
            error={errors.fatTarget?.message}
          />
          <FormField
            label="Fiber (g)"
            inputMode="decimal"
            {...register("fiberTarget")}
            error={errors.fiberTarget?.message}
          />
          <FormField
            label={`Water (${profile.water_unit === "fl_oz" ? "fl oz" : profile.water_unit})`}
            inputMode="decimal"
            {...register("waterTarget")}
            error={errors.waterTarget?.message}
          />
        </div>
      </Section>
      <Section
        title="Activity rings"
        description={`Leave any blank to use the default: ${formatNumber(DEFAULT_ACTIVITY_GOALS.steps)} steps, ${DEFAULT_ACTIVITY_GOALS.active_s / 60} active minutes, and ${DEFAULT_ACTIVITY_GOALS.sleep_s / 3600} hours of sleep.`}
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <FormField
            label="Steps"
            inputMode="numeric"
            {...register("stepsTarget")}
            error={errors.stepsTarget?.message}
          />
          <FormField
            label="Active minutes"
            inputMode="numeric"
            {...register("activeTarget")}
            error={errors.activeTarget?.message}
          />
          <FormField
            label="Sleep (hours)"
            inputMode="decimal"
            {...register("sleepTarget")}
            error={errors.sleepTarget?.message}
          />
        </div>
        <FormField
          label="Water quick-add amounts"
          hint="Up to six, separated by commas."
          {...register("quickAmounts")}
          error={errors.quickAmounts?.message}
        />
      </Section>
      <Section title="Overview sections" description="Hide what you don’t use.">
        <Controller
          control={control}
          name="hiddenSections"
          render={({ field }) => (
            <fieldset className="grid gap-2 sm:grid-cols-2">
              <legend className="sr-only">Sections shown on the overview</legend>
              {DASHBOARD_SECTIONS.map((section) => (
                <label key={section.value} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={!field.value.includes(section.value)}
                    onChange={(event) =>
                      field.onChange(
                        event.target.checked
                          ? field.value.filter((s) => s !== section.value)
                          : [...field.value, section.value],
                      )
                    }
                  />
                  {section.label}
                </label>
              ))}
            </fieldset>
          )}
        />
      </Section>
      <FormAlert message={errors.root?.server?.message ?? null} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Save settings"}
        </Button>
        {saved ? (
          <p role="status" className="text-sm text-muted-foreground">
            Saved.
          </p>
        ) : null}
      </div>
    </form>
  );
}

const SOURCES = [
  { value: "workout", label: "Workouts" },
  { value: "water", label: "Water" },
  ...ACTIVITY_KINDS.map((kind) => ({ value: `activity:${kind.value}`, label: kind.label })),
];

function sourceOf(link: Pick<FitnessHabitLink, "source" | "activity_kind">): string {
  return link.source === "activity" ? `activity:${link.activity_kind ?? ""}` : link.source;
}

function parseSource(value: string): {
  source: FitnessHabitLink["source"];
  activity_kind: ActivityKind | null;
} {
  if (value.startsWith("activity:")) {
    const kind = ACTIVITY_KINDS.find((k) => `activity:${k.value}` === value)?.value ?? "steps";
    return { source: "activity", activity_kind: kind };
  }
  return { source: value === "water" ? "water" : "workout", activity_kind: null };
}

/** Habits related to kinds of health records, optionally counting them as progress. */
function HabitLinks({ workspaceId }: { workspaceId: string }) {
  const links = useHabitLinks(workspaceId);
  const habits = useHabitList(workspaceId, "active");
  const run = useFitnessAction(workspaceId);
  const [habitId, setHabitId] = useState("");
  const [source, setSource] = useState("workout");
  const [error, setError] = useState<string | null>(null);

  const save = (link: { habit_id: string; source: string; contributes: boolean }) => {
    setError(null);
    run(
      (token) =>
        saveHabitLink(token, workspaceId, {
          habit_id: link.habit_id,
          contributes: link.contributes,
          ...parseSource(link.source),
        }),
      { touches: ["habits"] },
    ).catch((reason: unknown) => setError(describeApiError(reason, "Couldn’t link the habit.")));
  };

  const habitOptions =
    habits.state.status === "success"
      ? habits.state.data.habits.map((h) => ({ value: h.habit.id, label: h.habit.name }))
      : [];

  return (
    <Section
      title="Linked habits"
      description="Relate a habit to workouts, water, or an activity. With “Count toward the habit” on, records you save from then on add progress to that day of the habit; nothing is lowered or undone, and checking off a habit never creates a record."
    >
      <Loaded resource={links.state} reload={links.reload} skeleton="h-16">
        {({ links: list }) =>
          list.length === 0 ? (
            <p className="text-sm text-muted-foreground">No linked habits.</p>
          ) : (
            <ul className="divide-y">
              {list.map((link) => (
                <li
                  key={link.habit_id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <div className="min-w-0 text-sm">
                    <p className="font-medium">{link.habit_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {link.source === "activity"
                        ? labelOf(ACTIVITY_KINDS, link.activity_kind ?? "steps")
                        : link.source === "water"
                          ? "Water"
                          : "Workouts"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 text-xs">
                      <Checkbox
                        checked={link.contributes}
                        onChange={(event) =>
                          save({
                            habit_id: link.habit_id,
                            source: sourceOf(link),
                            contributes: event.target.checked,
                          })
                        }
                      />
                      Count toward the habit
                    </label>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={`Unlink ${link.habit_name}`}
                      onClick={() =>
                        run((token) => deleteHabitLink(token, workspaceId, link.habit_id)).catch(
                          (reason: unknown) =>
                            setError(describeApiError(reason, "Couldn’t unlink it.")),
                        )
                      }
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )
        }
      </Loaded>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (habitId) save({ habit_id: habitId, source, contributes: true });
        }}
      >
        <Select
          aria-label="Habit"
          className="w-48"
          value={habitId}
          onValueChange={setHabitId}
          placeholder={habitOptions.length ? "Choose a habit" : "No active habits"}
          options={habitOptions}
        />
        <Select
          aria-label="Records"
          className="w-44"
          value={source}
          onValueChange={setSource}
          options={SOURCES}
        />
        <Button type="submit" variant="soft" disabled={!habitId}>
          <Link2 aria-hidden="true" />
          Link
        </Button>
      </form>
      <FormAlert message={error} />
    </Section>
  );
}
