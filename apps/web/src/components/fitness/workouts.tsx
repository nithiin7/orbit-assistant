"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { WorkoutStatus, WorkoutSummary, WorkoutTemplate } from "@orbit/contracts";
import { Dumbbell, History, Play, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { logWorkout, startWorkout } from "@/api/fitness";
import { EmptyState } from "@/components/empty-state";
import { DialogShell } from "@/components/finance/dialog-shell";
import { DateField, FormAlert, FormField, SelectField } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import {
  useActiveWorkout,
  useFitnessAction,
  useTemplates,
  useUnits,
  useWorkouts,
} from "@/hooks/use-fitness";
import {
  fitnessHref,
  formatClock,
  formatDuration,
  formatVolume,
  loggedTimes,
  STATUS_LABELS,
  type Units,
  type WhenFormValues,
  whenSchema,
} from "@/lib/fitness";
import { cn } from "@/utils/common";

import { Loaded, Section, shortDate } from "./shared";

const PAGE = 20;

/** Starting a workout: empty, or from one of the templates. */
export function useStartWorkout(workspaceId: string, today: string, timeZone: string) {
  const run = useFitnessAction(workspaceId);
  const router = useRouter();
  return async (templateId: string | null, calendarEventId: string | null = null) => {
    const workout = await run(
      (token) =>
        startWorkout(token, workspaceId, {
          day: today,
          timezone: timeZone,
          name: null,
          template_id: templateId,
          calendar_event_id: calendarEventId,
        }),
      { workout: true },
    );
    router.push(fitnessHref({ kind: "workout", id: workout.id }));
  };
}

export function StartWorkoutMenu({
  workspaceId,
  templates,
  onStart,
  label = "Start workout",
}: {
  workspaceId: string;
  templates: readonly WorkoutTemplate[];
  onStart: (templateId: string | null) => void;
  label?: string;
}) {
  const active = templates.filter((t) => !t.archived);
  return (
    <Menu
      aria-label={label}
      items={[
        {
          id: "empty",
          label: "Empty workout",
          description: "Add exercises as you go.",
          icon: Plus,
          onSelect: () => onStart(null),
        },
        ...active.map((template) => ({
          id: template.id,
          label: template.name,
          description: `${template.exercises.length} exercises`,
          icon: Dumbbell,
          group: "From a template",
          onSelect: () => onStart(template.id),
        })),
      ]}
      key={workspaceId}
    >
      <Play aria-hidden="true" />
      {label}
    </Menu>
  );
}

export function WorkoutRow({ workout, units }: { workout: WorkoutSummary; units: Units }) {
  return (
    <li>
      <Link
        href={fitnessHref({ kind: "workout", id: workout.id })}
        className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{workout.name}</p>
          <p className="text-xs text-muted-foreground">
            {shortDate(workout.day)}
            {workout.duration_s !== null ? ` · ${formatDuration(workout.duration_s)}` : ""}
            {` · ${workout.exercise_count} exercises · ${workout.set_count} sets`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {workout.volume_g > 0 ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatVolume(workout.volume_g, units.weight_unit)}
            </span>
          ) : null}
          <StatusBadge status={workout.status} />
        </div>
      </Link>
    </li>
  );
}

export function StatusBadge({ status }: { status: WorkoutStatus }) {
  if (status === "completed") return null;
  return (
    <Badge variant={status === "abandoned" ? "outline" : "default"}>{STATUS_LABELS[status]}</Badge>
  );
}

/** The workout in progress, as a banner linking back to it. */
export function ActiveWorkoutBanner({ workspaceId }: { workspaceId: string }) {
  const { state } = useActiveWorkout(workspaceId);
  if (state.status !== "success" || state.data.session === null) return null;
  const session = state.data.session;
  return (
    <Link
      href={fitnessHref({ kind: "workout", id: session.id })}
      className="flex items-center justify-between gap-3 rounded-xl border border-brand/30 bg-brand-subtle px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div>
        <p className="text-sm font-semibold text-brand">
          {session.status === "paused" ? "Paused" : "Workout in progress"}: {session.name}
        </p>
        <p className="text-xs text-muted-foreground">
          Started {new Date(session.started_at).toLocaleTimeString([], { timeStyle: "short" })}.
          Everything you log is saved as you go.
        </p>
      </div>
      <span className="text-sm font-medium text-brand">Continue</span>
    </Link>
  );
}

export function WorkoutsView({
  workspaceId,
  today,
  timeZone,
  onLogPast,
}: {
  workspaceId: string;
  today: string;
  timeZone: string;
  onLogPast: () => void;
}) {
  const units = useUnits(workspaceId);
  const [limit, setLimit] = useState(PAGE);
  const [status, setStatus] = useState<"all" | "completed" | "abandoned">("all");
  const workouts = useWorkouts(workspaceId, { status, limit, offset: 0 });
  const templates = useTemplates(workspaceId);
  const start = useStartWorkout(workspaceId, today, timeZone);
  const [error, setError] = useState<string | null>(null);

  const begin = (templateId: string | null) => {
    setError(null);
    start(templateId).catch((reason: unknown) =>
      setError(describeApiError(reason, "Couldn’t start the workout.")),
    );
  };

  return (
    <div className="space-y-4">
      <ActiveWorkoutBanner workspaceId={workspaceId} />
      <div className="flex flex-wrap items-center gap-2">
        <StartWorkoutMenu
          workspaceId={workspaceId}
          templates={templates.state.status === "success" ? templates.state.data.templates : []}
          onStart={begin}
        />
        <Button variant="soft" onClick={onLogPast}>
          <History aria-hidden="true" />
          Log a past workout
        </Button>
      </div>
      <FormAlert message={error} />
      <Section
        title="History"
        action={
          <div role="group" aria-label="Show" className="flex gap-1">
            {(["all", "completed", "abandoned"] as const).map((value) => (
              <Button
                key={value}
                size="sm"
                variant={status === value ? "soft" : "ghost"}
                aria-pressed={status === value}
                onClick={() => setStatus(value)}
              >
                {value === "all" ? "All" : value === "completed" ? "Completed" : "Stopped early"}
              </Button>
            ))}
          </div>
        }
      >
        <Loaded resource={workouts.state} reload={workouts.reload}>
          {({ sessions }) =>
            sessions.length === 0 ? (
              <EmptyState
                icon={Dumbbell}
                title="No workouts yet"
                description="Start one from a template or an empty workout, or log one you’ve already done."
              />
            ) : (
              <>
                <ul className="-mx-3 divide-y">
                  {sessions.map((workout) => (
                    <WorkoutRow key={workout.id} workout={workout} units={units} />
                  ))}
                </ul>
                {sessions.length >= limit ? (
                  <Button variant="ghost" size="sm" onClick={() => setLimit(limit + PAGE)}>
                    Show more
                  </Button>
                ) : null}
              </>
            )
          }
        </Loaded>
      </Section>
    </div>
  );
}

/** Recording a workout that already happened; its exercises are added on its page. */
export function LogWorkoutDialog({
  workspaceId,
  today,
  timeZone,
  onClose,
}: {
  workspaceId: string;
  today: string;
  timeZone: string;
  onClose: () => void;
}) {
  const run = useFitnessAction(workspaceId);
  const router = useRouter();
  const templates = useTemplates(workspaceId);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<WhenFormValues>({
    resolver: yupResolver(whenSchema),
    defaultValues: { name: "", templateId: "", date: today, time: "07:00", minutes: "60" },
  });
  const options = templates.state.status === "success" ? templates.state.data.templates : [];

  async function save(values: WhenFormValues, close: () => void) {
    try {
      const template = options.find((t) => t.id === values.templateId);
      const times = loggedTimes(values, timeZone);
      const workout = await run(
        (token) =>
          logWorkout(token, workspaceId, {
            name: values.name || template?.name || "Workout",
            day: values.date,
            timezone: timeZone,
            ...times,
            notes: "",
            template_id: template?.id ?? null,
            exercises:
              template?.exercises.map((item) => ({
                exercise_id: item.exercise_id,
                notes: "",
                sets: Array.from({ length: item.sets }, () => ({
                  set_type: "working" as const,
                  reps: item.target_reps_max ?? item.target_reps_min,
                  weight_g: item.target_weight_g,
                  duration_s: item.target_duration_s,
                  distance_m: item.target_distance_m,
                  rpe: null,
                  completed: true,
                })),
              })) ?? [],
          }),
        { touches: ["habits"], workout: true },
      );
      close();
      router.push(fitnessHref({ kind: "workout", id: workout.id }));
    } catch (reason) {
      setError("root.server", {
        message: describeApiError(reason, "Couldn’t log the workout. Try again."),
      });
    }
  }

  return (
    <DialogShell
      title="Log a past workout"
      description="Its sets start as done, from the template if you choose one. Adjust them on the next page."
      busy={isSubmitting}
      onClose={onClose}
      onSubmit={(event, close) => void handleSubmit((values) => save(values, close))(event)}
      submitLabel="Log workout"
    >
      <SelectField
        control={control}
        name="templateId"
        label="Template"
        options={[
          { value: "", label: "None" },
          ...options.filter((t) => !t.archived).map((t) => ({ value: t.id, label: t.name })),
        ]}
      />
      <FormField
        label="Name"
        placeholder="Defaults to the template’s name"
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
      <FormAlert message={errors.root?.server?.message ?? null} />
    </DialogShell>
  );
}

/** A running clock of a workout's elapsed time, minus pauses. */
export function elapsedSeconds(
  workout: { started_at: string; paused_at: string | null; paused_seconds: number },
  now: number,
): number {
  const end = workout.paused_at ? Date.parse(workout.paused_at) : now;
  return Math.max(0, (end - Date.parse(workout.started_at)) / 1000 - workout.paused_seconds);
}

export function Clock({ seconds, className }: { seconds: number; className?: string }) {
  return (
    <span className={cn("font-mono tabular-nums", className)} aria-label={formatDuration(seconds)}>
      {formatClock(seconds)}
    </span>
  );
}
