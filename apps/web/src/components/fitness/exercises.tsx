"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { Equipment, Exercise, ExerciseCategory, Muscle } from "@orbit/contracts";
import {
  Archive,
  ArchiveRestore,
  Dumbbell,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { type Control, Controller, useForm } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { archiveExercise, createExercise, deleteExercise, updateExercise } from "@/api/fitness";
import { useConfirm } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { DialogShell } from "@/components/finance/dialog-shell";
import { StatGrid, StatTile } from "@/components/finance/stat-tile";
import { FormAlert, FormField, SelectField } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Menu } from "@/components/ui/menu";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useExerciseHistory, useExercises, useFitnessAction, useUnits } from "@/hooks/use-fitness";
import {
  describeSet,
  EQUIPMENT,
  ESTIMATE_NOTE,
  EXERCISE_CATEGORIES,
  EXERCISE_TYPES,
  type ExerciseFormValues,
  exerciseSchema,
  fitnessHref,
  formatDistance,
  formatDuration,
  formatRecord,
  formatVolume,
  formatWeight,
  gramsTo,
  labelOf,
  MUSCLES,
  newExerciseValues,
  RECORD_LABELS,
  toExerciseFormValues,
  toExerciseRequest,
} from "@/lib/fitness";
import { cn } from "@/utils/common";

import { LineChart, Loaded, Section, shortDate } from "./shared";

type Filter<T extends string> = T | "all";

export function ExercisesView({ workspaceId }: { workspaceId: string }) {
  const exercises = useExercises(workspaceId);
  const run = useFitnessAction(workspaceId);
  const { confirm, confirmDialog } = useConfirm();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<Filter<ExerciseCategory>>("all");
  const [equipment, setEquipment] = useState<Filter<Equipment>>("all");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Exercise | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = (call: (token: string) => Promise<unknown>) => {
    setError(null);
    run(call).catch((reason: unknown) =>
      setError(describeApiError(reason, "Couldn’t change the exercise.")),
    );
  };

  async function remove(exercise: Exercise) {
    const ok = await confirm({
      title: `Delete ${exercise.name}?`,
      description: "Only exercises no template or workout uses can be deleted.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (ok) act((token) => deleteExercise(token, workspaceId, exercise.id));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <Input
            type="search"
            aria-label="Search exercises"
            placeholder="Search by name or muscle"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <Select
          aria-label="Category"
          className="w-40"
          value={category}
          onValueChange={setCategory}
          options={[{ value: "all", label: "All categories" }, ...EXERCISE_CATEGORIES]}
        />
        <Select
          aria-label="Equipment"
          className="w-40"
          value={equipment}
          onValueChange={setEquipment}
          options={[{ value: "all", label: "All equipment" }, ...EQUIPMENT]}
        />
        <Button
          variant={showArchived ? "soft" : "ghost"}
          aria-pressed={showArchived}
          onClick={() => setShowArchived(!showArchived)}
        >
          Archived
        </Button>
        <Button onClick={() => setEditing("new")}>
          <Plus aria-hidden="true" />
          New exercise
        </Button>
      </div>
      <FormAlert message={error} />
      <Loaded resource={exercises.state} reload={exercises.reload}>
        {(data) => {
          const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
          const shown = data.exercises.filter(
            (e) =>
              e.archived === showArchived &&
              (category === "all" || e.category === category) &&
              (equipment === "all" || e.equipment === equipment) &&
              words.every((word) =>
                [e.name, ...e.primary_muscles, ...e.secondary_muscles]
                  .join(" ")
                  .toLowerCase()
                  .replaceAll("_", " ")
                  .includes(word),
              ),
          );
          if (shown.length === 0) {
            return (
              <EmptyState
                icon={Dumbbell}
                title={showArchived ? "No archived exercises" : "No exercises match"}
                description="Try another search or filter, or create your own exercise."
              />
            );
          }
          return (
            <ul className="grid gap-2 @3xl:grid-cols-2">
              {shown.map((exercise) => (
                <li
                  key={exercise.id}
                  className="flex items-center justify-between gap-2 rounded-xl border bg-card p-3"
                >
                  <Link
                    href={fitnessHref({ kind: "exercise", id: exercise.id })}
                    className="min-w-0 flex-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <p className="flex items-center gap-2 truncate text-sm font-medium">
                      {exercise.name}
                      {exercise.is_custom ? <Badge variant="outline">Custom</Badge> : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {labelOf(EXERCISE_CATEGORIES, exercise.category)} ·{" "}
                      {labelOf(EQUIPMENT, exercise.equipment)}
                      {exercise.primary_muscles.length > 0
                        ? ` · ${exercise.primary_muscles.map((m) => labelOf(MUSCLES, m)).join(", ")}`
                        : ""}
                    </p>
                  </Link>
                  <Menu
                    variant="ghost"
                    size="icon"
                    chevron={false}
                    align="end"
                    aria-label={`Actions for ${exercise.name}`}
                    items={[
                      ...(exercise.is_custom
                        ? [
                            {
                              id: "edit",
                              label: "Edit",
                              icon: Pencil,
                              onSelect: () => setEditing(exercise),
                            },
                          ]
                        : []),
                      {
                        id: "archive",
                        label: exercise.archived ? "Restore" : "Archive",
                        description: exercise.archived ? undefined : "Hide it from pickers.",
                        icon: exercise.archived ? ArchiveRestore : Archive,
                        onSelect: () =>
                          act((token) =>
                            archiveExercise(token, workspaceId, exercise.id, !exercise.archived),
                          ),
                      },
                      ...(exercise.is_custom
                        ? [
                            {
                              id: "delete",
                              label: "Delete",
                              icon: Trash2,
                              destructive: true,
                              onSelect: () => void remove(exercise),
                            },
                          ]
                        : []),
                    ]}
                  >
                    <MoreHorizontal aria-hidden="true" />
                  </Menu>
                </li>
              ))}
            </ul>
          );
        }}
      </Loaded>
      {editing ? (
        <ExerciseDialog
          workspaceId={workspaceId}
          editing={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {confirmDialog}
    </div>
  );
}

function MusclePicker({
  control,
  name,
  label,
}: {
  control: Control<ExerciseFormValues>;
  name: "primaryMuscles" | "secondaryMuscles";
  label: string;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{label}</legend>
          <div className="flex flex-wrap gap-1.5">
            {MUSCLES.map((muscle) => {
              const on = field.value.includes(muscle.value);
              return (
                <button
                  key={muscle.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    field.onChange(
                      on
                        ? field.value.filter((m: Muscle) => m !== muscle.value)
                        : [...field.value, muscle.value],
                    )
                  }
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    on ? "border-brand bg-brand-subtle text-brand" : "hover:bg-accent",
                  )}
                >
                  {muscle.label}
                </button>
              );
            })}
          </div>
          {fieldState.error ? (
            <p className="text-xs font-medium text-destructive">{fieldState.error.message}</p>
          ) : null}
        </fieldset>
      )}
    />
  );
}

function ExerciseDialog({
  workspaceId,
  editing,
  onClose,
}: {
  workspaceId: string;
  editing: Exercise | null;
  onClose: () => void;
}) {
  const id = useId();
  const run = useFitnessAction(workspaceId);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ExerciseFormValues>({
    resolver: yupResolver(exerciseSchema),
    defaultValues: editing ? toExerciseFormValues(editing) : newExerciseValues(),
  });

  async function save(values: ExerciseFormValues, close: () => void) {
    try {
      const body = toExerciseRequest(values);
      await run((token) =>
        editing
          ? updateExercise(token, workspaceId, editing.id, body)
          : createExercise(token, workspaceId, body),
      );
      close();
    } catch (reason) {
      setError("root.server", { message: describeApiError(reason, "Couldn’t save the exercise.") });
    }
  }

  return (
    <DialogShell
      title={editing ? "Edit exercise" : "New exercise"}
      description={
        editing ? "Past workouts keep the name and type they were logged with." : undefined
      }
      busy={isSubmitting}
      onClose={onClose}
      onSubmit={(event, close) => void handleSubmit((values) => save(values, close))(event)}
      submitLabel={editing ? "Save changes" : "Create exercise"}
      wide
    >
      <FormField
        label="Name"
        autoFocus
        autoComplete="off"
        {...register("name")}
        error={errors.name?.message}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField
          control={control}
          name="category"
          label="Category"
          options={EXERCISE_CATEGORIES}
        />
        <SelectField
          control={control}
          name="exerciseType"
          label="Records"
          options={EXERCISE_TYPES}
          hint="Decides what a set records and which records apply."
        />
        <SelectField control={control} name="equipment" label="Equipment" options={EQUIPMENT} />
      </div>
      <MusclePicker control={control} name="primaryMuscles" label="Primary muscles" />
      <MusclePicker control={control} name="secondaryMuscles" label="Secondary muscles" />
      <div className="space-y-1.5">
        <label htmlFor={`${id}-instructions`} className="block text-sm font-medium">
          How to do it <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Textarea id={`${id}-instructions`} rows={3} {...register("instructions")} />
      </div>
      <FormAlert message={errors.root?.server?.message ?? null} />
    </DialogShell>
  );
}

/** An exercise's details, progression, records, and every workout it was in. */
export function ExerciseDetail({
  workspaceId,
  exerciseId,
}: {
  workspaceId: string;
  exerciseId: string;
}) {
  const history = useExerciseHistory(workspaceId, exerciseId);
  const units = useUnits(workspaceId);
  const router = useRouter();
  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => router.back()}>
        ← Back
      </Button>
      <Loaded resource={history.state} reload={history.reload} skeleton="h-80">
        {({ exercise, points, records }) => {
          const weighted = exercise.exercise_type === "weight_reps";
          const chart = points
            .map((p) => ({
              label: shortDate(p.day),
              value: weighted
                ? (p.estimated_1rm_g ?? p.max_weight_g ?? 0)
                : (p.max_distance_m ?? p.max_duration_s ?? p.max_reps ?? 0),
            }))
            .filter((p) => p.value > 0);
          return (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">{exercise.name}</h2>
                <p className="text-sm text-muted-foreground">
                  {labelOf(EXERCISE_CATEGORIES, exercise.category)} ·{" "}
                  {labelOf(EXERCISE_TYPES, exercise.exercise_type)} ·{" "}
                  {labelOf(EQUIPMENT, exercise.equipment)}
                </p>
                {exercise.instructions ? (
                  <p className="mt-2 text-sm whitespace-pre-line">{exercise.instructions}</p>
                ) : null}
              </div>
              {records.length > 0 ? (
                <StatGrid>
                  {records.map((record) => (
                    <StatTile
                      key={record.kind}
                      label={RECORD_LABELS[record.kind]}
                      value={formatRecord(record, units)}
                    >
                      {record.estimated ? ESTIMATE_NOTE : `Set on ${shortDate(record.day)}`}
                    </StatTile>
                  ))}
                </StatGrid>
              ) : null}
              {chart.length > 1 ? (
                <Section
                  title={weighted ? "Estimated 1-rep max over time" : "Best per workout"}
                  description={weighted ? "An estimate from your sets of 1 to 10 reps." : undefined}
                >
                  <LineChart
                    title={`${exercise.name} progression`}
                    points={chart}
                    format={(value) =>
                      weighted
                        ? `${Math.round(gramsTo(value, units.weight_unit) * 10) / 10} ${units.weight_unit}`
                        : exercise.exercise_type === "distance_duration"
                          ? formatDistance(value, units.distance_unit)
                          : exercise.exercise_type === "duration"
                            ? formatDuration(value)
                            : `${value} reps`
                    }
                  />
                </Section>
              ) : null}
              <Section title="History">
                {points.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No completed workouts with this exercise yet.
                  </p>
                ) : (
                  <ul className="divide-y">
                    {[...points].reverse().map((point) => (
                      <li key={point.session_id} className="py-2">
                        <Link
                          href={fitnessHref({ kind: "workout", id: point.session_id })}
                          className="text-sm font-medium underline-offset-2 hover:underline"
                        >
                          {shortDate(point.day)}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {point.sets
                            .filter((s) => s.completed)
                            .map(
                              (s) =>
                                `${s.set_type === "warmup" ? "W " : ""}${describeSet(s, exercise.exercise_type, units)}`,
                            )
                            .join(", ")}
                          {point.volume_g > 0
                            ? ` · ${formatVolume(point.volume_g, units.weight_unit)}`
                            : ""}
                          {point.max_weight_g
                            ? ` · top ${formatWeight(point.max_weight_g, units.weight_unit)}`
                            : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>
          );
        }}
      </Loaded>
    </div>
  );
}
