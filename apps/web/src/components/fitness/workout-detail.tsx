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
  FileText,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Square,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";

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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Menu } from "@/components/ui/menu";
import { Select } from "@/components/ui/select";
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

function WorkoutLogger({ workspaceId, workout }: { workspaceId: string; workout: Workout }) {
  const run = useFitnessAction(workspaceId);
  const units = useUnits(workspaceId);
  const exercises = useExercises(workspaceId);
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = workout.status === "active" || workout.status === "paused";
  const now = useNow(live);
  const rest = restTimer(workout, now);
  const totalSets = workout.exercises.reduce((sum, item) => sum + item.sets.length, 0);
  const doneSets = workout.exercises.reduce(
    (sum, item) => sum + item.sets.filter((set) => set.completed).length,
    0,
  );

  const act = (call: (token: string) => Promise<unknown>, touchesHabits = false) => {
    setError(null);
    run(call, { workout: true, touches: touchesHabits ? ["habits"] : [] }).catch(
      (reason: unknown) => setError(describeApiError(reason, "Couldn’t save that. Try again.")),
    );
  };
  const action = (name: WorkoutAction) =>
    act((token) => workoutAction(token, workspaceId, workout.id, name), name === "complete");

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

  return (
    <div className="space-y-4">
      {/* Sticks below the mobile app bar (h-14), so the clock and Finish stay in reach. */}
      <header className="sticky top-16 z-10 space-y-3 rounded-xl border bg-card/95 p-4 shadow-elevation-1 backdrop-blur md:top-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <h2 className="truncate text-lg font-semibold">{workout.name}</h2>
            <p className="text-xs text-muted-foreground">
              {shortDate(workout.day)}
              {workout.template_name ? ` · From ${workout.template_name}` : ""}
              {workout.status !== "active" ? ` · ${STATUS_LABELS[workout.status]}` : ""}
            </p>
          </div>
          <div className="text-right">
            <Clock
              seconds={live ? elapsedSeconds(workout, now) : (workout.duration_s ?? 0)}
              className="text-2xl font-semibold"
            />
            {workout.volume_g > 0 ? (
              <p className="text-xs text-muted-foreground">
                Volume {formatVolume(workout.volume_g, units.weight_unit)}
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
        <div className="flex flex-wrap items-center gap-2">
          {live ? (
            <>
              <Button className="flex-1 sm:flex-none" onClick={() => action("complete")}>
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
            </>
          ) : null}
          <Menu
            variant="ghost"
            size="icon"
            chevron={false}
            align="end"
            aria-label="More workout actions"
            className="ml-auto"
            items={[
              ...(live
                ? [
                    {
                      id: "abandon",
                      label: "Stop early",
                      icon: Square,
                      onSelect: () => void abandon(),
                    },
                  ]
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
        </div>
        {rest ? (
          <div
            role="timer"
            aria-live="off"
            className="flex items-center justify-between gap-2 rounded-lg bg-brand-subtle px-3 py-2 text-sm text-brand"
          >
            <span className="flex items-center gap-2">
              <Timer aria-hidden="true" className="size-4" />
              Rest after {rest.name}
            </span>
            <span className="font-mono font-semibold tabular-nums">{formatClock(rest.left)}</span>
          </div>
        ) : null}
      </header>

      <FormAlert message={error} />

      {workout.exercises.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-xl border border-dashed p-8 text-center">
          <p className="text-sm font-medium">No exercises yet</p>
          <p className="text-xs text-muted-foreground">
            Add the first one, then tick off each set as you finish it.
          </p>
        </div>
      ) : null}

      <ol className="space-y-3">
        {workout.exercises.map((item, index) => (
          <li key={item.id}>
            <ExerciseCard
              workspaceId={workspaceId}
              workout={workout}
              item={item}
              units={units}
              first={index === 0}
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
        disabled={exercises.state.status !== "success"}
      >
        <Plus aria-hidden="true" />
        Add exercise
      </Button>

      <WorkoutNotes workspaceId={workspaceId} workout={workout} act={act} />

      {picking && exercises.state.status === "success" ? (
        <ExercisePicker
          exercises={exercises.state.data.exercises}
          onClose={() => setPicking(false)}
          onPick={(exercise: Exercise) =>
            act((token) => addWorkoutExercise(token, workspaceId, workout.id, exercise.id))
          }
        />
      ) : null}
      {confirmDialog}
    </div>
  );
}

/** The rest countdown after the most recently completed set, while it's still running. */
function restTimer(workout: Workout, now: number): { name: string; left: number } | null {
  if (workout.status !== "active") return null;
  let latest: { at: number; name: string; rest: number } | null = null;
  for (const item of workout.exercises) {
    for (const set of item.sets) {
      if (!set.completed_at) continue;
      const at = Date.parse(set.completed_at);
      if (!latest || at > latest.at) {
        latest = { at, name: item.name, rest: item.rest_seconds ?? DEFAULT_REST };
      }
    }
  }
  if (!latest || latest.rest === 0) return null;
  const left = Math.round(latest.rest - (now - latest.at) / 1000);
  return left > 0 ? { name: latest.name, left } : null;
}

type Act = (call: (token: string) => Promise<unknown>, touchesHabits?: boolean) => void;

function ExerciseCard({
  workspaceId,
  workout,
  item,
  units,
  first,
  last,
  onMove,
  act,
  confirm,
}: {
  workspaceId: string;
  workout: Workout;
  item: WorkoutExercise;
  units: Units;
  first: boolean;
  last: boolean;
  onMove: (delta: number) => void;
  act: Act;
  confirm: ReturnType<typeof useConfirm>["confirm"];
}) {
  const id = useId();
  const [editingRest, setEditingRest] = useState(false);
  const fields = setFields(item.exercise_type);
  const previous = item.previous;

  async function removeExercise() {
    const ok = await confirm({
      title: `Remove ${item.name}?`,
      description: "Its sets in this workout are removed too.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (ok) act((token) => removeWorkoutExercise(token, workspaceId, workout.id, item.id));
  }

  return (
    <article aria-labelledby={`${id}-name`} className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={`${id}-name`} className="truncate text-sm font-semibold">
            {item.name}
          </h3>
          {previous ? (
            <p className="text-xs text-muted-foreground">
              Last time ({shortDate(previous.day)}):{" "}
              {previous.sets
                .filter((s) => s.completed)
                .map((s) => describeSet(s, item.exercise_type, units))
                .join(", ") || "no sets done"}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">First time logging this exercise.</p>
          )}
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
              disabled: first,
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

      <table className="w-full text-sm">
        <caption className="sr-only">Sets of {item.name}</caption>
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th scope="col" className="w-8 pb-1 font-medium">
              Set
            </th>
            {fields.weight ? (
              <th scope="col" className="pb-1 font-medium">
                {units.weight_unit}
              </th>
            ) : null}
            {fields.reps ? (
              <th scope="col" className="pb-1 font-medium">
                Reps
              </th>
            ) : null}
            {fields.distance ? (
              <th scope="col" className="pb-1 font-medium">
                {units.distance_unit}
              </th>
            ) : null}
            {fields.duration ? (
              <th scope="col" className="pb-1 font-medium">
                Time
              </th>
            ) : null}
            {previous ? (
              <th scope="col" className="hidden pb-1 font-medium @lg:table-cell">
                Last time
              </th>
            ) : null}
            <th scope="col" className="w-20 pb-1 text-right font-medium">
              <span className="sr-only">Done</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {item.sets.map((set, index) => (
            <SetRow
              key={set.id}
              set={set}
              number={index + 1}
              item={item}
              previous={previous?.sets[index] ?? null}
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

      <Button
        variant="ghost"
        size="sm"
        onClick={() => act((token) => addWorkoutSet(token, workspaceId, workout.id, item.id, null))}
      >
        <Plus aria-hidden="true" />
        Add set
        {item.sets.length > 0 ? (
          <span className="font-normal text-muted-foreground">(copies the last)</span>
        ) : null}
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
          Rest between sets (m:ss)
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

function draftOf(set: WorkoutSet, units: Units): SetDraft {
  return {
    setType: set.set_type,
    weight: weightInput(set.weight_g, units.weight_unit),
    reps: set.reps === null ? "" : String(set.reps),
    distance: distanceInput(set.distance_m, units.distance_unit),
    duration: clockInput(set.duration_s),
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

/**
 * One set: its values, saved when a field loses focus, and a check to mark it done. The row
 * keeps what's typed while it's mounted, so a save landing mid-typing never overwrites it.
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

  const field = (key: "weight" | "reps" | "distance" | "duration", name: string) => (
    <td className="py-1 pr-2">
      <Input
        aria-label={`${label} ${name}`}
        inputMode={key === "duration" ? "text" : key === "reps" ? "numeric" : "decimal"}
        placeholder={key === "duration" ? "m:ss" : undefined}
        autoComplete="off"
        className="h-10 min-w-0 px-2 text-center tabular-nums"
        value={draft[key]}
        aria-invalid={invalid || undefined}
        onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
        onBlur={() => save(set.completed)}
      />
    </td>
  );

  return (
    <tr className={cn(set.completed && "[&_input]:bg-success/10")}>
      <td className="py-1 pr-2">
        <Select
          aria-label={`${label} type`}
          value={draft.setType}
          onValueChange={(setType) => {
            const next = { ...draft, setType };
            setDraft(next);
            save(set.completed, next);
          }}
          options={SET_TYPES.map((option) => ({
            value: option.value,
            label:
              option.value === "working"
                ? String(number)
                : `${number} ${SET_TYPE_SHORT[option.value]}`,
          }))}
          className="h-10 w-14 px-1.5"
        />
      </td>
      {fields.weight ? field("weight", units.weight_unit) : null}
      {fields.reps ? field("reps", "reps") : null}
      {fields.distance ? field("distance", units.distance_unit) : null}
      {fields.duration ? field("duration", "time") : null}
      {item.previous ? (
        <td className="hidden py-1 pr-2 @lg:table-cell">
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
              className="rounded-md px-1.5 py-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums transition-colors duration-150 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {describeSet(previous, item.exercise_type, units)}
            </button>
          ) : (
            <span className="px-1.5 text-xs text-muted-foreground/60">—</span>
          )}
        </td>
      ) : null}
      <td className="py-1 text-right whitespace-nowrap">
        <Button
          size="icon"
          variant={set.completed ? "default" : "outline"}
          aria-label={`${label} done`}
          aria-pressed={set.completed}
          className={cn("size-10", set.completed && "bg-success hover:bg-success/90")}
          onClick={() => save(!set.completed)}
        >
          <Check aria-hidden="true" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Remove ${label.toLowerCase()}`}
          className="size-8 text-muted-foreground hover:text-foreground"
          onClick={onDelete}
        >
          <X aria-hidden="true" />
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
      {workout.status === "completed" || workout.status === "abandoned" ? (
        <p className="text-xs text-muted-foreground">
          {workout.duration_s !== null ? `Took ${formatDuration(workout.duration_s)}. ` : ""}
          Edits to sets here correct the record; templates aren’t changed.
        </p>
      ) : null}
    </section>
  );
}
