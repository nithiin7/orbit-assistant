"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { Exercise, WorkoutTemplate } from "@orbit/contracts";
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  CalendarPlus,
  Check,
  Copy,
  LayoutList,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useId, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";

import { describeApiError } from "@/api/client";
import {
  archiveTemplate,
  deleteTemplate,
  duplicateTemplate,
  saveTemplate,
  scheduleWorkout,
} from "@/api/fitness";
import { useConfirm } from "@/components/confirm-dialog";
import { DialogShell } from "@/components/dialog-shell";
import { EmptyState } from "@/components/empty-state";
import { DateField, FormAlert, FormField, SelectField } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Menu } from "@/components/ui/menu";
import { Textarea } from "@/components/ui/textarea";
import { useAiReady } from "@/hooks/use-ai";
import { useExercises, useFitnessAction, useTemplates, useUnits } from "@/hooks/use-fitness";
import {
  builtinsByKey,
  describeStarterExercise,
  labelOf,
  localEnd,
  newTemplateExercise,
  newTemplateValues,
  type ScheduleFormValues,
  scheduleSchema,
  STARTER_TEMPLATES,
  type StarterTemplate,
  starterTemplateRequest,
  TEMPLATE_CATEGORIES,
  type TemplateFormValues,
  templateSchema,
  toTemplateFormValues,
  toTemplateRequest,
  type Units,
} from "@/lib/fitness";

import { ExercisePicker, Loaded } from "./shared";
import { WorkoutSuggestionDialog } from "./workout-suggestion";
import { useStartWorkout } from "./workouts";

export function TemplatesView({
  workspaceId,
  today,
  timeZone,
}: {
  workspaceId: string;
  today: string;
  timeZone: string;
}) {
  const templates = useTemplates(workspaceId);
  const exercises = useExercises(workspaceId);
  const units = useUnits(workspaceId);
  const run = useFitnessAction(workspaceId);
  const start = useStartWorkout(workspaceId, today, timeZone);
  const { confirm, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState<WorkoutTemplate | "new" | null>(null);
  const [scheduling, setScheduling] = useState<WorkoutTemplate | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  // Suggestions read goals and workouts, so they need permission to read Health.
  const aiReady = useAiReady("health");
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = (call: (token: string) => Promise<unknown>) => {
    setError(null);
    run(call).catch((reason: unknown) =>
      setError(describeApiError(reason, "Couldn’t change the template.")),
    );
  };

  async function remove(template: WorkoutTemplate) {
    const ok = await confirm({
      title: `Delete ${template.name}?`,
      description: "Workouts you started from it keep everything they logged.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (ok) act((token) => deleteTemplate(token, workspaceId, template.id));
  }

  const library =
    exercises.state.status === "success" ? builtinsByKey(exercises.state.data.exercises) : null;
  const names = new Set(
    templates.state.status === "success"
      ? templates.state.data.templates.map((t) => t.name.toLocaleLowerCase())
      : [],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setEditing("new")}>
          <Plus aria-hidden="true" />
          New template
        </Button>
        {aiReady ? (
          <Button variant="soft" onClick={() => setSuggesting(true)}>
            <Sparkles aria-hidden="true" />
            Suggest with AI
          </Button>
        ) : null}
        <Button
          variant={showArchived ? "soft" : "ghost"}
          aria-pressed={showArchived}
          onClick={() => setShowArchived(!showArchived)}
        >
          Archived
        </Button>
      </div>
      <FormAlert message={error} />
      <Loaded resource={templates.state} reload={templates.reload}>
        {(data) => {
          const shown = data.templates.filter((t) => t.archived === showArchived);
          if (shown.length === 0) {
            return showArchived ? (
              <EmptyState
                icon={LayoutList}
                title="No archived templates"
                description="Templates you archive are kept here, out of the way."
              />
            ) : (
              <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                No templates of your own yet. Add a starter below, or build one with New template.
              </p>
            );
          }
          return (
            <ul
              aria-label={showArchived ? "Archived templates" : "Your templates"}
              className="grid gap-3 @3xl:grid-cols-2 @6xl:grid-cols-3"
            >
              {shown.map((template) => (
                <li key={template.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold">{template.name}</h3>
                      <p className="text-xs text-muted-foreground">
                        {labelOf(TEMPLATE_CATEGORIES, template.category)} ·{" "}
                        {template.exercises.length} exercises
                      </p>
                    </div>
                    <Menu
                      variant="ghost"
                      size="icon"
                      chevron={false}
                      align="end"
                      aria-label={`Actions for ${template.name}`}
                      items={[
                        {
                          id: "edit",
                          label: "Edit",
                          icon: Pencil,
                          onSelect: () => setEditing(template),
                        },
                        {
                          id: "schedule",
                          label: "Schedule on the calendar",
                          icon: CalendarPlus,
                          onSelect: () => setScheduling(template),
                        },
                        {
                          id: "duplicate",
                          label: "Duplicate",
                          icon: Copy,
                          onSelect: () =>
                            act((token) => duplicateTemplate(token, workspaceId, template.id)),
                        },
                        {
                          id: "archive",
                          label: template.archived ? "Restore" : "Archive",
                          icon: template.archived ? ArchiveRestore : Archive,
                          onSelect: () =>
                            act((token) =>
                              archiveTemplate(token, workspaceId, template.id, !template.archived),
                            ),
                        },
                        {
                          id: "delete",
                          label: "Delete",
                          icon: Trash2,
                          destructive: true,
                          onSelect: () => void remove(template),
                        },
                      ]}
                    >
                      <MoreHorizontal aria-hidden="true" />
                    </Menu>
                  </div>
                  <ol className="space-y-0.5 text-sm">
                    {template.exercises.map((item) => (
                      <li key={item.id} className="flex justify-between gap-2">
                        <span className="truncate">{item.exercise_name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {describePlan(item, units)}
                        </span>
                      </li>
                    ))}
                  </ol>
                  {!template.archived ? (
                    <Button
                      variant="soft"
                      size="sm"
                      className="mt-auto self-start"
                      aria-label={`Start ${template.name}`}
                      onClick={() =>
                        start(template.id).catch((reason: unknown) =>
                          setError(describeApiError(reason, "Couldn’t start the workout.")),
                        )
                      }
                    >
                      <Play aria-hidden="true" />
                      Start
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          );
        }}
      </Loaded>
      {showArchived ? null : (
        <StarterTemplates
          library={library}
          existingNames={names}
          onAdd={(template) => {
            if (!library) return;
            const request = starterTemplateRequest(template, library);
            if (request === null) {
              setError("The exercises in this template are archived. Restore them first.");
              return;
            }
            act((token) => saveTemplate(token, workspaceId, null, request));
          }}
        />
      )}
      {editing ? (
        <TemplateDialog
          workspaceId={workspaceId}
          editing={editing === "new" ? null : editing}
          units={units}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {suggesting ? (
        <WorkoutSuggestionDialog
          workspaceId={workspaceId}
          units={units}
          onClose={() => setSuggesting(false)}
        />
      ) : null}
      {scheduling ? (
        <ScheduleDialog
          workspaceId={workspaceId}
          template={scheduling}
          today={today}
          timeZone={timeZone}
          onClose={() => setScheduling(null)}
        />
      ) : null}
      {confirmDialog}
    </div>
  );
}

/** Ready-made plans, added to the person's templates in one tap. */
function StarterTemplates({
  library,
  existingNames,
  onAdd,
}: {
  /** The person's built-in exercises by key; `null` while loading. */
  library: ReadonlyMap<string, Exercise> | null;
  /** Template names already in use, lowercased, so added starters say so. */
  existingNames: ReadonlySet<string>;
  onAdd: (template: StarterTemplate) => void;
}) {
  return (
    <section aria-labelledby="starter-templates-heading" className="space-y-3">
      <div className="space-y-0.5">
        <h3 id="starter-templates-heading" className="text-sm font-semibold">
          Starter templates
        </h3>
        <p className="text-xs text-muted-foreground">
          Ready-made plans from the exercise library. Add one, then change anything you like.
        </p>
      </div>
      <ul className="grid gap-3 @2xl:grid-cols-2 @5xl:grid-cols-3 @[96rem]:grid-cols-4">
        {STARTER_TEMPLATES.map((template) => {
          const added = existingNames.has(template.name.toLocaleLowerCase());
          return (
            <li
              key={template.id}
              className="flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors duration-150 hover:border-brand/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="truncate text-sm font-semibold">{template.name}</h4>
                  <p className="text-xs text-muted-foreground">
                    {template.exercises.length} exercises
                  </p>
                </div>
                <Badge variant="outline">{template.tag}</Badge>
              </div>
              <p className="text-sm text-pretty text-muted-foreground">{template.blurb}</p>
              <ol className="space-y-0.5 text-sm">
                {template.exercises.map((item) => (
                  <li key={item.key} className="flex justify-between gap-2">
                    <span className="truncate">
                      {library?.get(item.key)?.name ?? starterExerciseName(item.key)}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {describeStarterExercise(item)}
                    </span>
                  </li>
                ))}
              </ol>
              <div className="mt-auto pt-1">
                {added ? (
                  <p className="flex items-center gap-1 text-xs font-medium text-success">
                    <Check className="size-3.5" aria-hidden="true" />
                    In your templates
                  </p>
                ) : (
                  <Button
                    variant="soft"
                    size="sm"
                    disabled={library === null}
                    aria-label={`Add ${template.name} to my templates`}
                    onClick={() => onAdd(template)}
                  >
                    <Plus aria-hidden="true" />
                    Add to my templates
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** `barbell_bench_press` → "Barbell bench press", until the library has loaded. */
function starterExerciseName(key: string): string {
  const words = key.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function describePlan(item: WorkoutTemplate["exercises"][number], units: Units): string {
  const reps =
    item.target_reps_min && item.target_reps_max && item.target_reps_min !== item.target_reps_max
      ? `${item.target_reps_min}–${item.target_reps_max}`
      : (item.target_reps_max ?? item.target_reps_min);
  const weight = item.target_weight_g
    ? ` @ ${Math.round((item.target_weight_g / (units.weight_unit === "kg" ? 1000 : 453.59237)) * 10) / 10} ${units.weight_unit}`
    : "";
  return reps ? `${item.sets} × ${reps}${weight}` : `${item.sets} sets${weight}`;
}

function TemplateDialog({
  workspaceId,
  editing,
  units,
  onClose,
}: {
  workspaceId: string;
  editing: WorkoutTemplate | null;
  units: Units;
  onClose: () => void;
}) {
  const id = useId();
  const run = useFitnessAction(workspaceId);
  const exercises = useExercises(workspaceId);
  const [picking, setPicking] = useState(false);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<TemplateFormValues>({
    resolver: yupResolver(templateSchema),
    defaultValues: editing ? toTemplateFormValues(editing, units) : newTemplateValues(),
  });
  const { fields, append, remove, move } = useFieldArray({ control, name: "exercises" });
  const library = exercises.state.status === "success" ? exercises.state.data.exercises : [];
  const nameOf = (exerciseId: string) =>
    library.find((e) => e.id === exerciseId)?.name ??
    editing?.exercises.find((e) => e.exercise_id === exerciseId)?.exercise_name ??
    "Exercise";

  async function save(values: TemplateFormValues, close: () => void) {
    try {
      await run((token) =>
        saveTemplate(token, workspaceId, editing?.id ?? null, toTemplateRequest(values, units)),
      );
      close();
    } catch (reason) {
      setError("root.server", { message: describeApiError(reason, "Couldn’t save the template.") });
    }
  }

  return (
    <DialogShell
      title={editing ? "Edit template" : "New template"}
      description={editing ? "Workouts already started from it don’t change." : undefined}
      busy={isSubmitting}
      onClose={onClose}
      onSubmit={(event, close) => void handleSubmit((values) => save(values, close))(event)}
      submitLabel={editing ? "Save changes" : "Create template"}
      wide
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
        <FormField
          label="Name"
          autoFocus
          autoComplete="off"
          placeholder="Push day"
          {...register("name")}
          error={errors.name?.message}
        />
        <SelectField control={control} name="category" label="Type" options={TEMPLATE_CATEGORIES} />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Exercises</legend>
        {fields.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Add the exercises in the order you do them.
          </p>
        ) : null}
        <ol className="space-y-2">
          {fields.map((field, index) => {
            const rowErrors = errors.exercises?.[index];
            const label = `${index + 1}. ${nameOf(field.exerciseId)}`;
            return (
              <li key={field.id} className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{label}</span>
                  <div className="flex shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      aria-label={`Move ${label} up`}
                      disabled={index === 0}
                      onClick={() => move(index, index - 1)}
                    >
                      <ArrowUp aria-hidden="true" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      aria-label={`Move ${label} down`}
                      disabled={index === fields.length - 1}
                      onClick={() => move(index, index + 1)}
                    >
                      <ArrowDown aria-hidden="true" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      aria-label={`Remove ${label}`}
                      onClick={() => remove(index)}
                    >
                      <X aria-hidden="true" />
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {(
                    [
                      ["sets", "Sets"],
                      ["repsMin", "Reps from"],
                      ["repsMax", "Reps to"],
                      ["weight", `Weight (${units.weight_unit})`],
                      ["rest", "Rest (s)"],
                    ] as const
                  ).map(([key, text]) => (
                    <div key={key} className="space-y-1">
                      <label
                        htmlFor={`${id}-${index}-${key}`}
                        className="block text-xs font-medium"
                      >
                        {text}
                      </label>
                      <Input
                        id={`${id}-${index}-${key}`}
                        inputMode="decimal"
                        aria-invalid={rowErrors?.[key] ? true : undefined}
                        {...register(`exercises.${index}.${key}`)}
                      />
                    </div>
                  ))}
                </div>
                {rowErrors ? (
                  <p className="text-xs font-medium text-destructive">
                    {[
                      rowErrors.sets,
                      rowErrors.repsMin,
                      rowErrors.repsMax,
                      rowErrors.weight,
                      rowErrors.rest,
                    ]
                      .map((e) => e?.message)
                      .filter(Boolean)
                      .join(" ")}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPicking(true)}
          disabled={exercises.state.status !== "success"}
        >
          <Plus aria-hidden="true" />
          Add exercise
        </Button>
      </fieldset>

      <div className="space-y-1.5">
        <label htmlFor={`${id}-notes`} className="block text-sm font-medium">
          Notes <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Textarea id={`${id}-notes`} rows={2} {...register("notes")} />
      </div>
      <FormAlert message={errors.root?.server?.message ?? errors.exercises?.message ?? null} />
      {picking ? (
        <ExercisePicker
          exercises={library}
          onClose={() => setPicking(false)}
          onPick={(picked: Exercise[]) =>
            append(picked.map((exercise) => newTemplateExercise(exercise.id)))
          }
        />
      ) : null}
    </DialogShell>
  );
}

const ALERTS = [
  { value: "", label: "No reminder" },
  { value: "10", label: "10 minutes before" },
  { value: "30", label: "30 minutes before" },
  { value: "60", label: "1 hour before" },
];

/** Puts the template on the calendar as an ordinary event; its alert is the reminder. */
export function ScheduleDialog({
  workspaceId,
  template,
  today,
  timeZone,
  onClose,
}: {
  workspaceId: string;
  template: WorkoutTemplate;
  today: string;
  timeZone: string;
  onClose: () => void;
}) {
  const run = useFitnessAction(workspaceId);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ScheduleFormValues>({
    resolver: yupResolver(scheduleSchema),
    defaultValues: {
      name: template.name,
      templateId: template.id,
      date: today,
      time: "18:00",
      minutes: "60",
      alert: "30",
    },
  });

  async function save(values: ScheduleFormValues, close: () => void) {
    try {
      await run(
        (token) =>
          scheduleWorkout(token, workspaceId, {
            template_id: template.id,
            title: values.name || template.name,
            start: `${values.date}T${values.time}`,
            end: localEnd(values.date, values.time, Number(values.minutes)),
            timezone: timeZone,
            alerts: values.alert ? [Number(values.alert)] : [],
          }),
        { touches: ["calendar"] },
      );
      close();
    } catch (reason) {
      setError("root.server", { message: describeApiError(reason, "Couldn’t schedule it.") });
    }
  }

  return (
    <DialogShell
      title={`Schedule ${template.name}`}
      description="Adds an event to your calendar. Start the workout from it when it’s time."
      busy={isSubmitting}
      onClose={onClose}
      onSubmit={(event, close) => void handleSubmit((values) => save(values, close))(event)}
      submitLabel="Schedule"
    >
      <FormField
        label="Title"
        autoComplete="off"
        {...register("name")}
        error={errors.name?.message}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <DateField control={control} name="date" label="Date" />
        <FormField label="Start" type="time" {...register("time")} error={errors.time?.message} />
        <FormField
          label="Minutes"
          inputMode="numeric"
          {...register("minutes")}
          error={errors.minutes?.message}
        />
      </div>
      <SelectField control={control} name="alert" label="Reminder" options={ALERTS} />
      <FormAlert message={errors.root?.server?.message ?? null} />
    </DialogShell>
  );
}
