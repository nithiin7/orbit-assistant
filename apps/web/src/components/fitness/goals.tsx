"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { FitnessGoal, FitnessGoalStatus } from "@orbit/contracts";
import {
  CheckCircle2,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Target,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { checkInGoal, deleteCheckIn, deleteGoal, saveGoal, setGoalStatus } from "@/api/fitness";
import { useConfirm } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { DialogShell } from "@/components/finance/dialog-shell";
import { DateField, FormAlert, FormField, SelectField } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { useExercises, useFitnessAction, useGoals, useUnits } from "@/hooks/use-fitness";
import { useHabitList } from "@/hooks/use-habits";
import {
  fitnessHref,
  formatGoalValue,
  formatPercent,
  GOAL_CATEGORIES,
  type GoalFormValues,
  goalSchema,
  goalUnitLabel,
  labelOf,
  newGoalValues,
  PACE_LABELS,
  parseGoalValue,
  toGoalFormValues,
  toGoalRequest,
  type Units,
} from "@/lib/fitness";

import { LineChart, LinkedRecords, Loaded, Meter, NumberInput, Section, shortDate } from "./shared";

const STATUS_FILTERS: { value: FitnessGoalStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
];

export function GoalCard({ goal, units }: { goal: FitnessGoal; units: Units }) {
  const next = goal.milestones.find((m) => m.reached_on === null);
  return (
    <Link
      href={fitnessHref({ kind: "goal", id: goal.id })}
      className="block space-y-2 rounded-xl border bg-card p-4 outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{goal.name}</p>
          <p className="text-xs text-muted-foreground">
            {labelOf(GOAL_CATEGORIES, goal.category)}
            {goal.target_date ? ` · by ${shortDate(goal.target_date)}` : ""}
          </p>
        </div>
        <Badge variant={goal.pace === "behind" ? "outline" : "default"}>
          {PACE_LABELS[goal.pace]}
        </Badge>
      </div>
      <Meter
        label={`${formatGoalValue(goal.current_value, goal, units)} now`}
        value={`${formatPercent(goal.fraction)} of the way to ${formatGoalValue(goal.target_value, goal, units)}`}
        fraction={goal.fraction}
        tone={goal.reached ? "success" : "brand"}
      />
      {next && !goal.reached ? (
        <p className="text-xs text-muted-foreground">
          Next milestone: {formatGoalValue(next.value, goal, units)}
          {next.expected_by ? ` by ${shortDate(next.expected_by)}` : ""}
        </p>
      ) : null}
    </Link>
  );
}

export function GoalsView({ workspaceId, today }: { workspaceId: string; today: string }) {
  const units = useUnits(workspaceId);
  const goals = useGoals(workspaceId, today);
  const [status, setStatus] = useState<FitnessGoalStatus>("active");
  const [creating, setCreating] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Show" className="flex gap-1">
          {STATUS_FILTERS.map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={status === option.value ? "soft" : "ghost"}
              aria-pressed={status === option.value}
              onClick={() => setStatus(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus aria-hidden="true" />
          New goal
        </Button>
      </div>
      <Loaded resource={goals.state} reload={goals.reload}>
        {(data) => {
          const shown = data.goals.filter((g) => g.status === status);
          if (shown.length === 0) {
            return (
              <EmptyState
                icon={Target}
                title={status === "active" ? "No active goals" : `No ${status} goals`}
                description="Set a target, like a body weight, a lift, or a running distance, and track how you’re getting there."
              />
            );
          }
          return (
            <ul className="grid gap-3 @3xl:grid-cols-2">
              {shown.map((goal) => (
                <li key={goal.id}>
                  <GoalCard goal={goal} units={units} />
                </li>
              ))}
            </ul>
          );
        }}
      </Loaded>
      {creating ? (
        <GoalDialog
          workspaceId={workspaceId}
          editing={null}
          today={today}
          units={units}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </div>
  );
}

function GoalDialog({
  workspaceId,
  editing,
  today,
  units,
  onClose,
}: {
  workspaceId: string;
  editing: FitnessGoal | null;
  today: string;
  units: Units;
  onClose: () => void;
}) {
  const run = useFitnessAction(workspaceId);
  const exercises = useExercises(workspaceId);
  const habits = useHabitList(workspaceId, "active");
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<GoalFormValues>({
    resolver: yupResolver(goalSchema),
    defaultValues: editing ? toGoalFormValues(editing, units) : newGoalValues(today),
  });
  const [category, unit, autoTrack] = useWatch({
    control,
    name: ["category", "unit", "autoTrack"],
  });
  const unitLabel = goalUnitLabel(category, units, unit);
  const trackable = category === "body_weight" || category === "strength";

  async function save(values: GoalFormValues, close: () => void) {
    try {
      await run((token) =>
        saveGoal(token, workspaceId, editing?.id ?? null, toGoalRequest(values, units), today),
      );
      close();
    } catch (reason) {
      setError("root.server", { message: describeApiError(reason, "Couldn’t save the goal.") });
    }
  }

  return (
    <DialogShell
      title={editing ? "Edit goal" : "New goal"}
      busy={isSubmitting}
      onClose={onClose}
      onSubmit={(event, close) => void handleSubmit((values) => save(values, close))(event)}
      submitLabel={editing ? "Save changes" : "Create goal"}
      wide
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_14rem]">
        <FormField
          label="Name"
          autoFocus
          autoComplete="off"
          {...register("name")}
          error={errors.name?.message}
        />
        <SelectField
          control={control}
          name="category"
          label="Kind"
          options={GOAL_CATEGORIES}
          disabled={editing !== null}
        />
      </div>
      {category === "custom" ? (
        <FormField
          label="Unit"
          placeholder="pages, km, minutes"
          {...register("unit")}
          error={errors.unit?.message}
        />
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label={`Starting at (${unitLabel || "value"})`}
          inputMode="decimal"
          {...register("startValue")}
          error={errors.startValue?.message}
        />
        <FormField
          label={`Target (${unitLabel || "value"})`}
          inputMode="decimal"
          {...register("targetValue")}
          error={errors.targetValue?.message}
        />
        <DateField control={control} name="startDate" label="Start date" />
        <DateField control={control} name="targetDate" label="Target date (optional)" clearable />
      </div>
      {trackable ? (
        <Controller
          control={control}
          name="autoTrack"
          render={({ field }) => (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={field.value}
                onChange={(event) => field.onChange(event.target.checked)}
              />
              <span>
                Track it from my records
                <span className="block text-xs text-muted-foreground">
                  {category === "body_weight"
                    ? "Reads the weight measurements you record from the start date."
                    : "Reads the heaviest completed set of the exercise in each workout from the start date (warm-ups excluded)."}
                </span>
              </span>
            </label>
          )}
        />
      ) : null}
      {category === "strength" ? (
        <SelectField
          control={control}
          name="exerciseId"
          label={autoTrack ? "Exercise" : "Exercise (optional)"}
          options={[
            { value: "", label: "None" },
            ...(exercises.state.status === "success"
              ? exercises.state.data.exercises
                  .filter((e) => e.exercise_type === "weight_reps" && !e.archived)
                  .map((e) => ({ value: e.id, label: e.name }))
              : []),
          ]}
        />
      ) : null}
      <SelectField
        control={control}
        name="habitId"
        label="Related habit (optional)"
        hint="Just a link; the goal doesn’t change the habit, or the habit the goal."
        options={[
          { value: "", label: "None" },
          ...(habits.state.status === "success"
            ? habits.state.data.habits.map((h) => ({ value: h.habit.id, label: h.habit.name }))
            : []),
        ]}
      />
      <FormAlert message={errors.root?.server?.message ?? errors.exerciseId?.message ?? null} />
    </DialogShell>
  );
}

export function GoalDetail({
  workspaceId,
  goalId,
  today,
}: {
  workspaceId: string;
  goalId: string;
  today: string;
}) {
  const units = useUnits(workspaceId);
  const goals = useGoals(workspaceId, today);
  const run = useFitnessAction(workspaceId);
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState(false);
  const [day, setDay] = useState(today);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const act = (call: (token: string) => Promise<unknown>) => {
    setError(null);
    run(call).catch((reason: unknown) => setError(describeApiError(reason, "Couldn’t save that.")));
  };

  return (
    <div className="space-y-4">
      <Link
        href={fitnessHref({ kind: "view", view: "goals" })}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Goals
      </Link>
      <Loaded resource={goals.state} reload={goals.reload} skeleton="h-80">
        {(data) => {
          const goal = data.goals.find((g) => g.id === goalId);
          if (!goal) {
            return (
              <p className="text-sm text-muted-foreground">This goal doesn’t exist anymore.</p>
            );
          }
          const remove = async () => {
            const ok = await confirm({
              title: `Delete ${goal.name}?`,
              description: "Its check-ins are deleted too.",
              confirmLabel: "Delete",
              destructive: true,
            });
            if (!ok) return;
            await run((token) => deleteGoal(token, workspaceId, goal.id));
            router.push(fitnessHref({ kind: "view", view: "goals" }));
          };
          const status = (next: FitnessGoalStatus) =>
            act((token) => setGoalStatus(token, workspaceId, goal.id, next, today));
          const checkIn = () => {
            const parsed = parseGoalValue(value, goal.category, units);
            if (parsed === null) {
              setError("Enter a value.");
              return;
            }
            act((token) =>
              checkInGoal(token, workspaceId, goal.id, { day, value: parsed, note: "" }, today),
            );
            setValue("");
          };
          return (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{goal.name}</h2>
                  <p className="text-sm text-muted-foreground">
                    {labelOf(GOAL_CATEGORIES, goal.category)} · {PACE_LABELS[goal.pace]}
                    {goal.status !== "active"
                      ? ` · ${goal.status === "paused" ? "Paused" : "Completed"}`
                      : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {goal.status === "active" ? (
                    <>
                      <Button onClick={() => status("completed")}>
                        <CheckCircle2 aria-hidden="true" />
                        Mark complete
                      </Button>
                      <Button variant="outline" onClick={() => status("paused")}>
                        <Pause aria-hidden="true" />
                        Pause
                      </Button>
                    </>
                  ) : (
                    <Button variant="soft" onClick={() => status("active")}>
                      {goal.status === "paused" ? (
                        <Play aria-hidden="true" />
                      ) : (
                        <RotateCcw aria-hidden="true" />
                      )}
                      {goal.status === "paused" ? "Resume" : "Reopen"}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Edit goal"
                    onClick={() => setEditing(true)}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete goal"
                    onClick={() => void remove()}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <FormAlert message={error} />
              <Section title="Progress">
                <Meter
                  label={`${formatGoalValue(goal.current_value, goal, units)} now`}
                  value={`${formatPercent(goal.fraction)} from ${formatGoalValue(goal.start_value, goal, units)} to ${formatGoalValue(goal.target_value, goal, units)}`}
                  fraction={goal.fraction}
                  tone={goal.reached ? "success" : "brand"}
                />
                {goal.reached && goal.status === "active" ? (
                  <p className="text-sm text-success">
                    You’ve reached the target. Mark it complete when you’re ready.
                  </p>
                ) : null}
                {goal.history.length > 1 ? (
                  <LineChart
                    title={`${goal.name} over time`}
                    points={goal.history.map((c) => ({ label: shortDate(c.day), value: c.value }))}
                    format={(v) => formatGoalValue(v, goal, units)}
                  />
                ) : null}
                <ol className="grid gap-2 sm:grid-cols-4" aria-label="Milestones">
                  {goal.milestones.map((m) => (
                    <li
                      key={m.fraction}
                      className={`rounded-lg border p-2 text-xs ${m.reached_on ? "border-success/40 bg-success/10" : ""}`}
                    >
                      <p className="font-medium">
                        {formatPercent(m.fraction)} · {formatGoalValue(m.value, goal, units)}
                      </p>
                      <p className="text-muted-foreground">
                        {m.reached_on
                          ? `Reached ${shortDate(m.reached_on)}`
                          : m.expected_by
                            ? `Planned by ${shortDate(m.expected_by)}`
                            : "Not reached yet"}
                      </p>
                    </li>
                  ))}
                </ol>
              </Section>
              <Section
                title="Check-ins"
                description={
                  goal.auto_track
                    ? goal.category === "body_weight"
                      ? "Read from your weight measurements."
                      : `Read from your ${goal.exercise_name ?? "exercise"} workouts.`
                    : "Record where you are now and then."
                }
              >
                {!goal.auto_track ? (
                  <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      checkIn();
                    }}
                  >
                    <DatePicker
                      aria-label="Check-in date"
                      value={day}
                      onValueChange={setDay}
                      className="w-40"
                    />
                    <NumberInput
                      label="Value"
                      unit={goalUnitLabel(goal.category, units, goal.unit)}
                      value={value}
                      onChange={setValue}
                      className="w-40"
                    />
                    <Button type="submit" variant="soft">
                      Check in
                    </Button>
                  </form>
                ) : null}
                {goal.history.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No progress recorded yet.</p>
                ) : (
                  <ul className="divide-y">
                    {[...goal.history].reverse().map((c) => (
                      <li
                        key={c.id}
                        className="flex items-center justify-between gap-2 py-1.5 text-sm"
                      >
                        <span>
                          {shortDate(c.day)}: {formatGoalValue(c.value, goal, units)}
                        </span>
                        {c.source === "manual" ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label={`Delete check-in from ${shortDate(c.day)}`}
                            onClick={() =>
                              act((token) =>
                                deleteCheckIn(token, workspaceId, goal.id, c.id, today),
                              )
                            }
                          >
                            <X aria-hidden="true" />
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
              <Section title="Related">
                {goal.habit_name ? (
                  <p className="text-sm">
                    Habit:{" "}
                    <Link
                      href={`/habits?habit=${goal.habit_id ?? ""}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {goal.habit_name}
                    </Link>
                  </p>
                ) : null}
                <LinkedRecords
                  workspaceId={workspaceId}
                  owner="goals"
                  ownerId={goal.id}
                  links={goal.links}
                />
              </Section>
              {editing ? (
                <GoalDialog
                  workspaceId={workspaceId}
                  editing={goal}
                  today={today}
                  units={units}
                  onClose={() => setEditing(false)}
                />
              ) : null}
            </div>
          );
        }}
      </Loaded>
      {confirmDialog}
    </div>
  );
}
