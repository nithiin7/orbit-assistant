"use client";

import type {
  Exercise,
  Workout,
  WorkoutExercise,
  WorkoutSet,
  WorkoutSetRequest,
  WorkoutSetType,
} from "@orbit/contracts";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  Dumbbell,
  FileText,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Square,
  Timer,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useId, useState } from "react";

import { describeApiError } from "@/api/client";
import {
  addWorkoutExercise,
  addWorkoutSet,
  createWorkoutNote,
  deleteWorkout,
  deleteWorkoutSet,
  removeWorkoutExercise,
  reorderWorkout,
  updateWorkout,
  updateWorkoutExercise,
  updateWorkoutSet,
  type WorkoutAction,
  workoutAction,
} from "@/api/fitness";
import { useConfirm } from "@/components/confirm-dialog";
import { FormAlert } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Menu } from "@/components/ui/menu";
import { Textarea } from "@/components/ui/textarea";
import { useExercises, useFitnessAction, useUnits, useWorkout } from "@/hooks/use-fitness";
import {
  clockInput,
  describeSet,
  distanceInput,
  fitnessHref,
  formatClock,
  formatDuration,
  formatVolume,
  parseClock,
  parseDistance,
  parseWeight,
  SET_TYPE_SHORT,
  SET_TYPES,
  setFields,
  STATUS_LABELS,
  type Units,
  weightInput,
} from "@/lib/fitness";
import { cn } from "@/utils/common";

import { ExercisePicker, LinkedRecords, Loaded, Meter, shortDate } from "./shared";
import { Clock, elapsedSeconds } from "./workouts";

const DEFAULT_REST = 90;

/** The current time, ticking every second while `active`. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/** A workout's page: the live logger while it's in progress, and corrections afterwards. */
export function WorkoutDetail({
  workspaceId,
  sessionId,
}: {
  workspaceId: string;
  sessionId: string;
}) {
  const workout = useWorkout(workspaceId, sessionId);
  return (
    <div className="space-y-4">
      <Link
        href={fitnessHref({ kind: "view", view: "workouts" })}
        className="inline-flex items-center gap-1 rounded-md text-sm text-muted-foreground transition-colors duration-150 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Workouts
      </Link>
      <Loaded resource={workout.state} reload={workout.reload} skeleton="h-96">
        {(data) => <WorkoutLogger key={data.id} workspaceId={workspaceId} workout={data} />}
      </Loaded>
    </div>
  );
}

/** Adjustments to the running rest timer, tied to the set that started it. */
type RestAdjust = { key: string; extra: number; skipped: boolean };

function WorkoutLogger({ workspaceId, workout }: { workspaceId: string; workout: Workout }) {
  const run = useFitnessAction(workspaceId);
  const units = useUnits(workspaceId);
  const exercises = useExercises(workspaceId);
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adjust, setAdjust] = useState<RestAdjust | null>(null);
  const live = workout.status === "active" || workout.status === "paused";
  const now = useNow(live);
  const rest = restTimer(workout, now, adjust);
  const totalSets = workout.exercises.reduce((sum, item) => sum + item.sets.length, 0);
  const doneSets = workout.exercises.reduce(
    (sum, item) => sum + item.sets.filter((set) => set.completed).length,
    0,
  );
  // The exercise to do next: the first with a set still to tick.
  const upNext = live
    ? workout.exercises.find((item) => item.sets.some((set) => !set.completed))?.id
    : undefined;
  const canPick = exercises.state.status === "success";

  const act = (call: (token: string) => Promise<unknown>, touchesHabits = false) => {
    setError(null);
    run(call, { workout: true, touches: touchesHabits ? ["habits"] : [] }).catch(
      (reason: unknown) => setError(describeApiError(reason, "Couldn’t save that. Try again.")),
    );
  };
  const action = (name: WorkoutAction) =>
    act((token) => workoutAction(token, workspaceId, workout.id, name), name === "complete");

  async function finish() {
    const left = totalSets - doneSets;
    if (left > 0) {
      const ok = await confirm({
        title:
          doneSets === 0
            ? "Finish without any sets done?"
            : `Finish with ${left} ${left === 1 ? "set" : "sets"} not ticked?`,
        description:
          "Sets you haven’t ticked stay in the log but don’t count toward volume or records.",
        confirmLabel: "Finish workout",
      });
      if (!ok) return;
    }
    action("complete");
  }

  async function abandon() {
    const ok = await confirm({
      title: "Stop this workout early?",
      description: "It stays in your history but won’t count toward totals or records.",
      confirmLabel: "Stop workout",
      destructive: true,
    });
    if (ok) action("abandon");
  }

  async function remove() {
    const ok = await confirm({
      title: "Delete this workout?",
      description: "Its exercises and sets are deleted too. This can’t be undone.",
      confirmLabel: "Delete workout",
      destructive: true,
    });
    if (!ok) return;
    try {
      await run((token) => deleteWorkout(token, workspaceId, workout.id));
      router.push(fitnessHref({ kind: "view", view: "workouts" }));
    } catch (reason) {
      setError(describeApiError(reason, "Couldn’t delete the workout."));
    }
  }

  const move = (index: number, delta: number) => {
    const ids = workout.exercises.map((e) => e.id);
    const target = index + delta;
    const [item] = ids.splice(index, 1);
    if (item === undefined || target < 0 || target > ids.length) return;
    ids.splice(target, 0, item);
    act((token) => reorderWorkout(token, workspaceId, workout.id, ids));
  };

  const addExercises = (picked: Exercise[]) =>
    act(async (token) => {
      // One at a time, so they land in the order they were picked.
      let latest: Workout | null = null;
      for (const exercise of picked) {
        latest = await addWorkoutExercise(token, workspaceId, workout.id, exercise.id);
      }
      return latest;
    });

  const moreActions = (
    <Menu
      variant="ghost"
      size="icon"
      chevron={false}
      align="end"
      aria-label="More workout actions"
      items={[
        ...(live
          ? [{ id: "abandon", label: "Stop early", icon: Square, onSelect: () => void abandon() }]
          : []),
        {
          id: "delete",
          label: "Delete workout",
          icon: Trash2,
          destructive: true,
          onSelect: () => void remove(),
        },
      ]}
    >
      <MoreHorizontal aria-hidden="true" />
    </Menu>
  );

  return (
    <div className="space-y-4">
      {live ? (
        // Sticks below the mobile app bar (h-14), so the clock, rest timer, and Finish stay in reach.
        <header className="sticky top-16 z-10 space-y-3 rounded-xl border bg-card/95 p-4 shadow-elevation-1 backdrop-blur md:top-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <p className="flex items-center gap-1.5 text-xs font-medium text-brand">
                <span aria-hidden="true" className="relative flex size-2">
                  {workout.status === "active" ? (
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60 motion-reduce:animate-none" />
                  ) : null}
                  <span className="relative inline-flex size-2 rounded-full bg-brand" />
                </span>
                {STATUS_LABELS[workout.status]}
              </p>
              <h2 className="truncate text-lg font-semibold">{workout.name}</h2>
              <p className="text-xs text-muted-foreground">
                {shortDate(workout.day)}
                {workout.template_name ? ` · From ${workout.template_name}` : ""}
              </p>
            </div>
            <div className="text-right">
              <Clock seconds={elapsedSeconds(workout, now)} className="text-2xl font-semibold" />
              {workout.volume_g > 0 ? (
                <p className="text-xs text-muted-foreground tabular-nums">
                  {formatVolume(workout.volume_g, units.weight_unit)} lifted
                </p>
              ) : null}
            </div>
          </div>
          {totalSets > 0 ? (
            <Meter
              label="Sets done"
              value={`${doneSets} of ${totalSets}`}
              fraction={doneSets / totalSets}
              tone={doneSets === totalSets ? "success" : "brand"}
            />
          ) : null}
          {rest ? (
            <RestBar
              rest={rest}
              onAdd={() =>
                setAdjust({
                  key: rest.key,
                  extra: (adjust?.key === rest.key ? adjust.extra : 0) + 15,
                  skipped: false,
                })
              }
              onSkip={() => setAdjust({ key: rest.key, extra: 0, skipped: true })}
            />
          ) : null}
          <div className="flex items-center gap-2">
            <Button className="flex-1 sm:flex-none" onClick={() => void finish()}>
              <Check aria-hidden="true" />
              Finish
            </Button>
            {workout.status === "active" ? (
              <Button variant="outline" onClick={() => action("pause")}>
                <Pause aria-hidden="true" />
                Pause
              </Button>
            ) : (
              <Button variant="soft" onClick={() => action("resume")}>
                <Play aria-hidden="true" />
                Resume
              </Button>
            )}
            <div className="ml-auto">{moreActions}</div>
          </div>
        </header>
      ) : (
        <WorkoutSummary workout={workout} units={units} doneSets={doneSets} actions={moreActions} />
      )}

      <FormAlert message={error} />

      {workout.exercises.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center">
          <span
            aria-hidden="true"
            className="flex size-11 items-center justify-center rounded-full bg-brand-subtle text-brand"
          >
            <Dumbbell className="size-5" />
          </span>
          <div className="space-y-1">
            <p className="text-sm font-semibold">Add your first exercise</p>
            <p className="mx-auto max-w-sm text-xs text-muted-foreground">
              Pick one or more from your library. Enter the weight and reps for each set, then tick
              it when you’re done; a rest timer starts on its own.
            </p>
          </div>
          <Button variant="soft" onClick={() => setPicking(true)} disabled={!canPick}>
            <Plus aria-hidden="true" />
            Add exercises
          </Button>
        </div>
      ) : (
        <>
          <ol className="space-y-3">
            {workout.exercises.map((item, index) => (
              <li key={item.id}>
                <ExerciseCard
                  workspaceId={workspaceId}
                  workout={workout}
                  item={item}
                  index={index}
                  units={units}
                  upNext={item.id === upNext}
                  last={index === workout.exercises.length - 1}
                  onMove={(delta) => move(index, delta)}
                  act={act}
                  confirm={confirm}
                />
              </li>
            ))}
          </ol>
          <Button
            variant="outline"
            className="w-full border-dashed"
            onClick={() => setPicking(true)}
            disabled={!canPick}
          >
            <Plus aria-hidden="true" />
            Add exercises
          </Button>
        </>
      )}

      <WorkoutNotes workspaceId={workspaceId} workout={workout} act={act} />

      {picking && exercises.state.status === "success" ? (
        <ExercisePicker
          exercises={exercises.state.data.exercises}
          added={new Set(workout.exercises.flatMap((item) => item.exercise_id ?? []))}
          onClose={() => setPicking(false)}
          onPick={addExercises}
        />
      ) : null}
      {confirmDialog}
    </div>
  );
}

/** A finished (or stopped) workout at a glance. */
function WorkoutSummary({
  workout,
  units,
  doneSets,
  actions,
}: {
  workout: Workout;
  units: Units;
  doneSets: number;
  actions: ReactNode;
}) {
  const completed = workout.status === "completed";
  const stats = [
    { label: "Time", value: <Clock seconds={workout.duration_s ?? 0} /> },
    { label: "Exercises", value: workout.exercises.length },
    { label: "Sets done", value: doneSets },
    {
      label: "Volume",
      value: workout.volume_g > 0 ? formatVolume(workout.volume_g, units.weight_unit) : "—",
    },
  ];
  return (
    <header className="space-y-4 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-full",
              completed ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
            )}
          >
            {completed ? <Check className="size-5" /> : <Square className="size-4" />}
          </span>
          <div className="min-w-0 space-y-0.5">
            <h2 className="truncate text-lg font-semibold">{workout.name}</h2>
            <p className="text-xs text-muted-foreground">
              {shortDate(workout.day)}
              {workout.template_name ? ` · From ${workout.template_name}` : ""}
              {` · ${STATUS_LABELS[workout.status]}`}
            </p>
          </div>
        </div>
        {actions}
      </div>
      <dl className="grid grid-cols-2 gap-2 @md:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg bg-muted/50 px-3 py-2">
            <dt className="text-xs text-muted-foreground">{stat.label}</dt>
            <dd className="text-base font-semibold tabular-nums">{stat.value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        You can still correct sets below; templates aren’t changed.
      </p>
    </header>
  );
}

type Rest = { key: string; name: string; total: number; left: number };

/** The rest countdown after the most recently completed set, while it's still running. */
function restTimer(workout: Workout, now: number, adjust: RestAdjust | null): Rest | null {
  if (workout.status !== "active") return null;
  let latest: { at: number; key: string; name: string; rest: number } | null = null;
  for (const item of workout.exercises) {
    for (const set of item.sets) {
      if (!set.completed_at) continue;
      const at = Date.parse(set.completed_at);
      if (!latest || at > latest.at) {
        latest = {
          at,
          key: `${set.id}@${set.completed_at}`,
          name: item.name,
          rest: item.rest_seconds ?? DEFAULT_REST,
        };
      }
    }
  }
  if (!latest || latest.rest === 0) return null;
  const mine = adjust?.key === latest.key ? adjust : null;
  if (mine?.skipped) return null;
  const total = latest.rest + (mine?.extra ?? 0);
  const left = Math.round(total - (now - latest.at) / 1000);
  return left > 0 ? { key: latest.key, name: latest.name, total, left } : null;
}

function RestBar({ rest, onAdd, onSkip }: { rest: Rest; onAdd: () => void; onSkip: () => void }) {
  return (
    <div className="space-y-2 rounded-lg bg-brand-subtle px-3 py-2.5 text-brand">
      <div className="flex items-center gap-3">
        <div role="timer" aria-live="off" className="flex min-w-0 flex-1 items-center gap-2">
          <Timer aria-hidden="true" className="size-4 shrink-0" />
          <span className="min-w-0 truncate text-sm">Rest after {rest.name}</span>
          <span className="ml-auto font-mono text-lg font-semibold tabular-nums">
            {formatClock(rest.left)}
          </span>
        </div>
        <Button size="sm" variant="ghost" className="h-8 px-2 text-brand" onClick={onAdd}>
          +15s
        </Button>
        <Button size="sm" variant="ghost" className="h-8 px-2 text-brand" onClick={onSkip}>
          Skip
        </Button>
      </div>
      <div aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-brand/15">
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-1000 ease-linear"
          style={{ width: `${Math.min(100, (rest.left / rest.total) * 100)}%` }}
        />
      </div>
    </div>
  );
}

type Act = (call: (token: string) => Promise<unknown>, touchesHabits?: boolean) => void;

function ExerciseCard({
  workspaceId,
  workout,
  item,
  index,
  units,
  upNext,
  last,
  onMove,
  act,
  confirm,
}: {
  workspaceId: string;
  workout: Workout;
  item: WorkoutExercise;
  index: number;
  units: Units;
  upNext: boolean;
  last: boolean;
  onMove: (delta: number) => void;
  act: Act;
  confirm: ReturnType<typeof useConfirm>["confirm"];
}) {
  const id = useId();
  const [editingRest, setEditingRest] = useState(false);
  const fields = setFields(item.exercise_type);
  const previous = item.previous;
  const done = item.sets.filter((set) => set.completed).length;
  const allDone = item.sets.length > 0 && done === item.sets.length;
  const restSeconds = item.rest_seconds ?? DEFAULT_REST;
  const lastTime = previous
    ? previous.sets
        .filter((s) => s.completed)
        .map((s) => describeSet(s, item.exercise_type, units))
        .join(", ")
    : "";

  async function removeExercise() {
    const ok = await confirm({
      title: `Remove ${item.name}?`,
      description: "Its sets in this workout are removed too.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (ok) act((token) => removeWorkoutExercise(token, workspaceId, workout.id, item.id));
  }

  const column = "pb-1.5 text-center text-xs font-medium text-muted-foreground";

  return (
    <article
      aria-labelledby={`${id}-name`}
      className={cn(
        "space-y-3 rounded-xl border bg-card p-4 transition-colors duration-150",
        upNext && "border-brand/40 ring-1 ring-brand/20",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
            allDone
              ? "bg-success text-white"
              : upNext
                ? "bg-brand text-brand-foreground"
                : "bg-muted text-muted-foreground",
          )}
        >
          {allDone ? <Check className="size-3.5" /> : index + 1}
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-2">
            <h3 id={`${id}-name`} className="truncate text-sm font-semibold">
              {item.name}
            </h3>
            {upNext ? <Badge variant="brand">Up next</Badge> : null}
          </div>
          <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {done} of {item.sets.length} sets
            </span>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => setEditingRest(true)}
              aria-label={`Rest ${formatDuration(restSeconds)}, change`}
              className="inline-flex items-center gap-1 rounded-sm underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Timer aria-hidden="true" className="size-3" />
              Rest {restSeconds === 0 ? "off" : formatClock(restSeconds)}
            </button>
          </p>
          <p className="text-xs text-muted-foreground">
            {previous
              ? `Last time (${shortDate(previous.day)}): ${lastTime || "no sets done"}`
              : "First time logging this exercise."}
          </p>
        </div>
        <Menu
          variant="ghost"
          size="icon"
          chevron={false}
          align="end"
          aria-label={`Actions for ${item.name}`}
          items={[
            {
              id: "up",
              label: "Move up",
              icon: ArrowUp,
              disabled: index === 0,
              onSelect: () => onMove(-1),
            },
            {
              id: "down",
              label: "Move down",
              icon: ArrowDown,
              disabled: last,
              onSelect: () => onMove(1),
            },
            {
              id: "rest",
              label: "Rest time",
              icon: Timer,
              onSelect: () => setEditingRest(true),
            },
            {
              id: "remove",
              label: "Remove exercise",
              icon: Trash2,
              destructive: true,
              onSelect: () => void removeExercise(),
            },
          ]}
        >
          <MoreHorizontal aria-hidden="true" />
        </Menu>
      </div>

      {editingRest ? (
        <RestEditor
          initial={item.rest_seconds}
          onCancel={() => setEditingRest(false)}
          onSave={(seconds) => {
            setEditingRest(false);
            act((token) =>
              updateWorkoutExercise(token, workspaceId, workout.id, item.id, {
                rest_seconds: seconds,
                notes: item.notes,
              }),
            );
          }}
        />
      ) : null}

      {item.sets.length > 0 ? (
        <table className="w-full table-fixed text-sm">
          <caption className="sr-only">Sets of {item.name}</caption>
          <thead>
            <tr>
              <th scope="col" className={cn(column, "w-11")}>
                Set
              </th>
              {previous ? (
                <th scope="col" className={cn(column, "hidden @sm:table-cell")}>
                  Previous
                </th>
              ) : null}
              {fields.weight ? (
                <th scope="col" className={column}>
                  {units.weight_unit}
                </th>
              ) : null}
              {fields.reps ? (
                <th scope="col" className={column}>
                  Reps
                </th>
              ) : null}
              {fields.distance ? (
                <th scope="col" className={column}>
                  {units.distance_unit}
                </th>
              ) : null}
              {fields.duration ? (
                <th scope="col" className={column}>
                  Time
                </th>
              ) : null}
              <th scope="col" className={cn(column, "w-12")}>
                <span className="sr-only">Done</span>
                <Check aria-hidden="true" className="mx-auto size-3.5" />
              </th>
            </tr>
          </thead>
          <tbody>
            {item.sets.map((set, number) => (
              <SetRow
                key={set.id}
                set={set}
                number={number + 1}
                item={item}
                previous={previous?.sets[number] ?? null}
                units={units}
                onSave={(values) =>
                  act((token) =>
                    updateWorkoutSet(token, workspaceId, workout.id, item.id, set.id, values),
                  )
                }
                onDelete={() =>
                  act((token) => deleteWorkoutSet(token, workspaceId, workout.id, item.id, set.id))
                }
              />
            ))}
          </tbody>
        </table>
      ) : null}

      <Button
        variant="ghost"
        size="sm"
        className="w-full"
        onClick={() => act((token) => addWorkoutSet(token, workspaceId, workout.id, item.id, null))}
      >
        <Plus aria-hidden="true" />
        Add set
      </Button>
    </article>
  );
}

function RestEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: number | null;
  onSave: (seconds: number | null) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [text, setText] = useState(clockInput(initial ?? DEFAULT_REST));
  const seconds = parseClock(text);
  const valid = text.trim() === "" || (seconds !== null && seconds <= 3600);
  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-lg bg-muted/50 p-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onSave(text.trim() === "" ? null : seconds);
      }}
    >
      <div className="space-y-1">
        <label htmlFor={id} className="block text-xs font-medium">
          Rest between sets (m:ss, 0 for none)
        </label>
        <Input
          id={id}
          autoFocus
          className="w-28"
          value={text}
          aria-invalid={!valid || undefined}
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      <Button type="submit" size="sm" disabled={!valid}>
        Save
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

type SetDraft = {
  setType: WorkoutSetType;
  weight: string;
  reps: string;
  distance: string;
  duration: string;
};

type ValueKey = "weight" | "reps" | "distance" | "duration";

function draftOf(set: WorkoutSet, units: Units): SetDraft {
  return {
    setType: set.set_type,
    weight: weightInput(set.weight_g, units.weight_unit),
    reps: set.reps === null ? "" : String(set.reps),
    distance: distanceInput(set.distance_m, units.distance_unit),
    duration: clockInput(set.duration_s),
  };
}

/** Blank fields take the hint's values, so ticking an empty set repeats last time. */
function filled(draft: SetDraft, hint: SetDraft | null): SetDraft {
  if (!hint) return draft;
  const pick = (key: ValueKey) => (draft[key].trim() === "" ? hint[key] : draft[key]);
  return {
    ...draft,
    weight: pick("weight"),
    reps: pick("reps"),
    distance: pick("distance"),
    duration: pick("duration"),
  };
}

function requestOf(
  draft: SetDraft,
  set: WorkoutSet,
  completed: boolean,
  units: Units,
): WorkoutSetRequest | null {
  const reps = draft.reps.trim() === "" ? null : Number(draft.reps);
  const duration = draft.duration.trim() === "" ? null : parseClock(draft.duration);
  const weight = draft.weight.trim() === "" ? null : parseWeight(draft.weight, units.weight_unit);
  const distance =
    draft.distance.trim() === "" ? null : parseDistance(draft.distance, units.distance_unit);
  const invalid =
    (reps !== null && (!Number.isInteger(reps) || reps < 0)) ||
    (draft.duration.trim() !== "" && duration === null) ||
    (draft.weight.trim() !== "" && weight === null) ||
    (draft.distance.trim() !== "" && distance === null);
  if (invalid) return null;
  return {
    set_type: draft.setType,
    reps,
    weight_g: weight,
    duration_s: duration,
    distance_m: distance,
    rpe: set.rpe,
    completed,
  };
}

const SET_TYPE_TONE: Record<WorkoutSetType, string> = {
  working: "text-foreground",
  warmup: "text-warning",
  drop: "text-brand",
  failure: "text-destructive",
};

/**
 * One set: its values, saved when a field loses focus, and a check to mark it done. Blank
 * fields show last time's values, and ticking a blank set uses them. The row keeps what's typed
 * while it's mounted, so a save landing mid-typing never overwrites it.
 */
function SetRow({
  set,
  number,
  item,
  previous,
  units,
  onSave,
  onDelete,
}: {
  set: WorkoutSet;
  number: number;
  item: WorkoutExercise;
  /** The same set last time, when there was one; tapping it copies its values. */
  previous: WorkoutSet | null;
  units: Units;
  onSave: (values: WorkoutSetRequest) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(() => draftOf(set, units));
  const [invalid, setInvalid] = useState(false);
  const fields = setFields(item.exercise_type);
  const label = `Set ${number}`;
  const hint = previous ? draftOf(previous, units) : null;

  const save = (completed: boolean, next: SetDraft = draft) => {
    const request = requestOf(next, set, completed, units);
    setInvalid(request === null);
    if (request === null) return;
    const unchanged =
      request.completed === set.completed &&
      request.set_type === set.set_type &&
      request.reps === set.reps &&
      request.weight_g === set.weight_g &&
      request.duration_s === set.duration_s &&
      request.distance_m === set.distance_m;
    if (!unchanged) onSave(request);
  };

  const toggleDone = () => {
    if (set.completed) {
      save(false);
      return;
    }
    const next = filled(draft, hint);
    setDraft(next);
    save(true, next);
  };

  const field = (key: ValueKey, name: string) => (
    <td className="px-1 py-1">
      <Input
        aria-label={`${label} ${name}`}
        inputMode={key === "duration" ? "text" : key === "reps" ? "numeric" : "decimal"}
        placeholder={hint?.[key] || (key === "duration" ? "m:ss" : "–")}
        autoComplete="off"
        className={cn(
          "h-10 min-w-0 px-1 text-center font-medium tabular-nums placeholder:font-normal placeholder:text-muted-foreground/60",
          set.completed && "border-transparent bg-transparent",
        )}
        value={draft[key]}
        aria-invalid={invalid || undefined}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
        onBlur={() => save(set.completed)}
      />
    </td>
  );

  const short = SET_TYPE_SHORT[draft.setType];

  return (
    <tr className={cn("transition-colors duration-150", set.completed && "bg-success/10")}>
      <td className="rounded-l-lg py-1 pl-1">
        <Menu
          variant="ghost"
          size="sm"
          chevron={false}
          aria-label={`${label} options`}
          className={cn("h-10 w-9 px-0 font-semibold tabular-nums", SET_TYPE_TONE[draft.setType])}
          items={[
            ...SET_TYPES.map((option) => ({
              id: option.value,
              label: option.label,
              group: "Set type",
              checked: draft.setType === option.value,
              onSelect: () => {
                const next = { ...draft, setType: option.value };
                setDraft(next);
                save(set.completed, next);
              },
            })),
            {
              id: "remove",
              label: "Remove set",
              icon: Trash2,
              destructive: true,
              onSelect: onDelete,
            },
          ]}
        >
          {short || number}
        </Menu>
      </td>
      {item.previous ? (
        <td className="hidden px-1 py-1 text-center @sm:table-cell">
          {previous ? (
            <button
              type="button"
              aria-label={`${label}: use last time, ${describeSet(previous, item.exercise_type, units)}`}
              title="Use these values"
              onClick={() => {
                const next = { ...draftOf(previous, units), setType: draft.setType };
                setDraft(next);
                save(set.completed, next);
              }}
              className="max-w-full truncate rounded-md px-1.5 py-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums transition-colors duration-150 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {describeSet(previous, item.exercise_type, units)}
            </button>
          ) : (
            <span className="text-xs text-muted-foreground/60">—</span>
          )}
        </td>
      ) : null}
      {fields.weight ? field("weight", units.weight_unit) : null}
      {fields.reps ? field("reps", "reps") : null}
      {fields.distance ? field("distance", units.distance_unit) : null}
      {fields.duration ? field("duration", "time") : null}
      <td className="rounded-r-lg py-1 pr-1 text-right">
        <Button
          size="icon"
          variant={set.completed ? "default" : "outline"}
          aria-label={`${label} done`}
          aria-pressed={set.completed}
          className={cn("size-10", set.completed && "bg-success text-white hover:bg-success/90")}
          onClick={toggleDone}
        >
          <Check aria-hidden="true" />
        </Button>
      </td>
    </tr>
  );
}

function WorkoutNotes({
  workspaceId,
  workout,
  act,
}: {
  workspaceId: string;
  workout: Workout;
  act: Act;
}) {
  const id = useId();
  const run = useFitnessAction(workspaceId);
  const [notes, setNotes] = useState(workout.notes);
  const [error, setError] = useState<string | null>(null);

  const addNote = () => {
    setError(null);
    run((token) => createWorkoutNote(token, workspaceId, workout.id), { touches: ["notes"] }).catch(
      (reason: unknown) => setError(describeApiError(reason, "Couldn’t create the note.")),
    );
  };

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3 rounded-xl border bg-card p-4">
      <h3 id={`${id}-title`} className="text-sm font-semibold">
        Notes
      </h3>
      <div className="space-y-1">
        <label htmlFor={`${id}-notes`} className="sr-only">
          Workout notes
        </label>
        <Textarea
          id={`${id}-notes`}
          rows={3}
          placeholder="How it went, what to change next time"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          onBlur={() => {
            if (notes.trim() !== workout.notes) {
              act((token) => updateWorkout(token, workspaceId, workout.id, { notes }));
            }
          }}
        />
      </div>
      <LinkedRecords
        workspaceId={workspaceId}
        owner="sessions"
        ownerId={workout.id}
        links={workout.links}
      >
        <Button variant="soft" size="sm" onClick={addNote}>
          <FileText aria-hidden="true" />
          Write a training note
        </Button>
      </LinkedRecords>
      <FormAlert message={error} />
    </section>
  );
}
