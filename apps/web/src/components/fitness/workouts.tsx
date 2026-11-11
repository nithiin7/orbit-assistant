"use client";

import { yupResolver } from "@hookform/resolvers/yup";
import type { WorkoutStatus, WorkoutSummary, WorkoutTemplate } from "@orbit/contracts";
import { ChevronRight, Dumbbell, History, LayoutTemplate, Play, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { describeApiError } from "@/api/client";
import { logWorkout, startWorkout } from "@/api/fitness";
import { DialogShell } from "@/components/dialog-shell";
import { EmptyState } from "@/components/empty-state";
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
        className="group/row flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
        >
          <Dumbbell className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{workout.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {shortDate(workout.day)}
            {workout.duration_s !== null ? ` · ${formatDuration(workout.duration_s)}` : ""}
            {` · ${workout.exercise_count} exercises · ${workout.set_count} sets`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {workout.volume_g > 0 ? (
            <span className="hidden text-xs text-muted-foreground tabular-nums @md:inline">
              {formatVolume(workout.volume_g, units.weight_unit)}
            </span>
          ) : null}
          <StatusBadge status={workout.status} />
          <ChevronRight
            aria-hidden="true"
            className="size-4 text-muted-foreground/60 transition-transform duration-150 group-hover/row:translate-x-0.5"
          />
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
  const paused = session.status === "paused";
  return (
    <Link
      href={fitnessHref({ kind: "workout", id: session.id })}
      className="group/banner flex items-center gap-3 rounded-xl border border-brand/30 bg-brand-subtle px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span aria-hidden="true" className="relative flex size-2.5 shrink-0">
        {paused ? null : (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60 motion-reduce:animate-none" />
        )}
        <span className="relative inline-flex size-2.5 rounded-full bg-brand" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-brand">
          {paused ? "Paused" : "Workout in progress"}: {session.name}
        </p>
        <p className="text-xs text-muted-foreground">
          Started {new Date(session.started_at).toLocaleTimeString([], { timeStyle: "short" })}.
          Everything you log is saved as you go.
        </p>
      </div>
      <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-brand">
        Continue
        <ChevronRight
          aria-hidden="true"
          className="size-4 transition-transform duration-150 group-hover/banner:translate-x-0.5"
        />
      </span>
    </Link>
  );
}

const HISTORY_FILTERS = [
  { value: "all", label: "All" },
  { value: "completed", label: "Completed" },
  { value: "abandoned", label: "Stopped early" },
] as const;

/** `2030-01` → "January 2030", for grouping history by month. */
function monthLabel(day: string): string {
  const [year, month] = day.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

function byMonth(
  sessions: readonly WorkoutSummary[],
): { month: string; items: WorkoutSummary[] }[] {
  const groups: { month: string; items: WorkoutSummary[] }[] = [];
  for (const workout of sessions) {
    const month = workout.day.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.items.push(workout);
    else groups.push({ month, items: [workout] });
  }
  return groups;
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
  const active = useActiveWorkout(workspaceId);
  const start = useStartWorkout(workspaceId, today, timeZone);
  const [error, setError] = useState<string | null>(null);
  const running = active.state.status === "success" && active.state.data.session !== null;
  const ready =
    templates.state.status === "success"
      ? templates.state.data.templates.filter((t) => !t.archived)
      : [];

  const begin = (templateId: string | null) => {
    setError(null);
    start(templateId).catch((reason: unknown) =>
      setError(describeApiError(reason, "Couldn’t start the workout.")),
    );
  };

  return (
    <div className="space-y-4">
      <ActiveWorkoutBanner workspaceId={workspaceId} />
      <FormAlert message={error} />
      {running ? null : (
        <Section
          title="Start a workout"
          description="Pick a template, or start empty and add exercises as you go."
          action={
            <Button variant="ghost" size="sm" onClick={onLogPast}>
              <History aria-hidden="true" />
              Log a past workout
            </Button>
          }
        >
          <ul className="grid gap-3 @xl:grid-cols-2 @4xl:grid-cols-3 @7xl:grid-cols-4">
            {ready.map((template) => (
              <li key={template.id}>
                <StartCard template={template} onStart={() => begin(template.id)} />
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={() => begin(null)}
                className="flex h-full min-h-24 w-full items-center gap-3 rounded-lg border border-dashed p-3 text-left transition-colors duration-150 outline-none hover:border-brand/40 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  aria-hidden="true"
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                >
                  <Plus className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">Empty workout</span>
                  <span className="block text-xs text-muted-foreground">
                    Add exercises as you go.
                  </span>
                </span>
              </button>
            </li>
            {templates.state.status === "success" && ready.length === 0 ? (
              <li>
                <Link
                  href={fitnessHref({ kind: "view", view: "templates" })}
                  className="flex h-full min-h-24 items-center gap-3 rounded-lg border border-dashed p-3 transition-colors duration-150 outline-none hover:border-brand/40 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand"
                  >
                    <LayoutTemplate className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">Browse starter templates</span>
                    <span className="block text-xs text-muted-foreground">
                      Full body, push/pull/legs, home workouts, and more.
                    </span>
                  </span>
                </Link>
              </li>
            ) : null}
          </ul>
        </Section>
      )}
      <Section
        title="History"
        action={
          <div role="group" aria-label="Show" className="flex gap-1">
            {HISTORY_FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={status === option.value}
                onClick={() => setStatus(option.value)}
                className={cn(
                  "h-7 rounded-full px-2.5 text-xs font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  status === option.value
                    ? "bg-brand-subtle text-brand"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      >
        <Loaded resource={workouts.state} reload={workouts.reload}>
          {({ sessions }) =>
            sessions.length === 0 ? (
              <EmptyState
                icon={Dumbbell}
                title={status === "all" ? "No workouts yet" : "Nothing here"}
                description={
                  status === "all"
                    ? "Workouts you start or log show up here, newest first."
                    : "No workouts match this filter."
                }
              />
            ) : (
              <div className="space-y-4">
                {byMonth(sessions).map((group) => (
                  <div key={group.month} className="space-y-1">
                    <h3 className="text-xs font-medium text-muted-foreground">
                      {monthLabel(group.month)}
                    </h3>
                    <ul className="-mx-3">
                      {group.items.map((workout) => (
                        <WorkoutRow key={workout.id} workout={workout} units={units} />
                      ))}
                    </ul>
                  </div>
                ))}
                {sessions.length >= limit ? (
                  <Button variant="ghost" size="sm" onClick={() => setLimit(limit + PAGE)}>
                    Show more
                  </Button>
                ) : null}
              </div>
            )
          }
        </Loaded>
      </Section>
    </div>
  );
}

/** A template ready to start, with the first few exercises so it's recognisable. */
function StartCard({ template, onStart }: { template: WorkoutTemplate; onStart: () => void }) {
  const names = template.exercises.map((item) => item.exercise_name);
  const preview = names.slice(0, 3).join(", ");
  return (
    <div className="flex h-full min-h-24 flex-col gap-2 rounded-lg border bg-card p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{template.name}</p>
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {names.length === 0
            ? "No exercises yet"
            : `${preview}${names.length > 3 ? ` +${names.length - 3} more` : ""}`}
        </p>
      </div>
      <Button
        size="sm"
        variant="soft"
        className="mt-auto self-start"
        aria-label={`Start ${template.name}`}
        onClick={onStart}
      >
        <Play aria-hidden="true" />
        Start
      </Button>
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
