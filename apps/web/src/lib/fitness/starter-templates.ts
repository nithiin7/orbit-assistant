/**
 * Ready-made workout templates built from the built-in exercises. Adding one saves it as an
 * ordinary template, so it can be edited, started, or deleted like any other.
 */

import type {
  Exercise,
  WorkoutTemplateCategory,
  WorkoutTemplateExerciseRequest,
  WorkoutTemplateRequest,
} from "@orbit/contracts";

export type StarterTemplateTag = "Beginner" | "Split" | "No equipment" | "Cardio" | "Recovery";

export type StarterExercise = {
  /** The built-in exercise's stable key (`builtin_key`). */
  key: string;
  sets: number;
  /** Target reps as a range, or a single number. */
  reps?: readonly [number, number] | number;
  /** Target time per set, in seconds, for timed exercises. */
  seconds?: number;
  rest?: number;
};

export type StarterTemplate = {
  id: string;
  name: string;
  category: WorkoutTemplateCategory;
  tag: StarterTemplateTag;
  /** Who it's for and how often, shown on the card and saved as the description. */
  blurb: string;
  exercises: readonly StarterExercise[];
};

export const STARTER_TEMPLATES: readonly StarterTemplate[] = [
  {
    id: "full-body",
    name: "Full body",
    category: "full_body",
    tag: "Beginner",
    blurb: "A simple start with dumbbells. Two or three times a week, with a day off between.",
    exercises: [
      { key: "goblet_squat", sets: 3, reps: [8, 12], rest: 90 },
      { key: "dumbbell_bench_press", sets: 3, reps: [8, 12], rest: 90 },
      { key: "dumbbell_row", sets: 3, reps: [8, 12], rest: 90 },
      { key: "dumbbell_shoulder_press", sets: 2, reps: [10, 12], rest: 60 },
      { key: "plank", sets: 3, seconds: 30, rest: 45 },
    ],
  },
  {
    id: "home-bodyweight",
    name: "Home bodyweight",
    category: "full_body",
    tag: "No equipment",
    blurb: "Train anywhere, no gear needed. About 25 minutes.",
    exercises: [
      { key: "push_up", sets: 3, reps: [8, 15], rest: 60 },
      { key: "bodyweight_squat", sets: 3, reps: [15, 20], rest: 60 },
      { key: "burpee", sets: 3, reps: [8, 10], rest: 60 },
      { key: "crunch", sets: 3, reps: [15, 20], rest: 45 },
      { key: "plank", sets: 3, seconds: 45, rest: 45 },
      { key: "side_plank", sets: 2, seconds: 30, rest: 30 },
    ],
  },
  {
    id: "push",
    name: "Push day",
    category: "push",
    tag: "Split",
    blurb: "Chest, shoulders, and triceps. Rotate Push, Pull, and Legs through the week.",
    exercises: [
      { key: "barbell_bench_press", sets: 4, reps: [5, 8], rest: 150 },
      { key: "incline_dumbbell_press", sets: 3, reps: [8, 12], rest: 90 },
      { key: "dumbbell_shoulder_press", sets: 3, reps: [8, 12], rest: 90 },
      { key: "lateral_raise", sets: 3, reps: [12, 15], rest: 60 },
      { key: "triceps_pushdown", sets: 3, reps: [10, 15], rest: 60 },
    ],
  },
  {
    id: "pull",
    name: "Pull day",
    category: "pull",
    tag: "Split",
    blurb: "Back and biceps. Rotate Push, Pull, and Legs through the week.",
    exercises: [
      { key: "lat_pulldown", sets: 4, reps: [8, 12], rest: 90 },
      { key: "barbell_row", sets: 3, reps: [6, 10], rest: 120 },
      { key: "seated_cable_row", sets: 3, reps: [10, 12], rest: 90 },
      { key: "face_pull", sets: 3, reps: [12, 15], rest: 60 },
      { key: "dumbbell_curl", sets: 3, reps: [10, 12], rest: 60 },
    ],
  },
  {
    id: "legs",
    name: "Leg day",
    category: "legs",
    tag: "Split",
    blurb: "Quads, hamstrings, glutes, and calves. Rotate Push, Pull, and Legs through the week.",
    exercises: [
      { key: "barbell_squat", sets: 4, reps: [5, 8], rest: 150 },
      { key: "romanian_deadlift", sets: 3, reps: [8, 10], rest: 120 },
      { key: "leg_press", sets: 3, reps: [10, 12], rest: 90 },
      { key: "leg_curl", sets: 3, reps: [10, 12], rest: 60 },
      { key: "calf_raise", sets: 3, reps: [12, 15], rest: 60 },
    ],
  },
  {
    id: "upper",
    name: "Upper body",
    category: "upper",
    tag: "Split",
    blurb: "Pair with Lower body for a four-day week: upper, lower, rest, repeat.",
    exercises: [
      { key: "barbell_bench_press", sets: 4, reps: [6, 8], rest: 150 },
      { key: "barbell_row", sets: 4, reps: [6, 10], rest: 120 },
      { key: "barbell_overhead_press", sets: 3, reps: [6, 10], rest: 120 },
      { key: "lat_pulldown", sets: 3, reps: [10, 12], rest: 90 },
      { key: "barbell_curl", sets: 2, reps: [10, 12], rest: 60 },
      { key: "triceps_pushdown", sets: 2, reps: [10, 12], rest: 60 },
    ],
  },
  {
    id: "lower",
    name: "Lower body",
    category: "lower",
    tag: "Split",
    blurb: "Pair with Upper body for a four-day week: upper, lower, rest, repeat.",
    exercises: [
      { key: "barbell_deadlift", sets: 3, reps: 5, rest: 180 },
      { key: "walking_lunge", sets: 3, reps: [10, 12], rest: 90 },
      { key: "hip_thrust", sets: 3, reps: [8, 12], rest: 90 },
      { key: "leg_extension", sets: 3, reps: [12, 15], rest: 60 },
      { key: "hanging_leg_raise", sets: 3, reps: [10, 15], rest: 60 },
    ],
  },
  {
    id: "cardio",
    name: "Cardio mix",
    category: "cardio",
    tag: "Cardio",
    blurb: "Thirty minutes of steady work across three machines. Good on lifting rest days.",
    exercises: [
      { key: "rowing_machine", sets: 1, seconds: 600, rest: 60 },
      { key: "stationary_bike", sets: 1, seconds: 900, rest: 60 },
      { key: "jump_rope", sets: 3, seconds: 60, rest: 60 },
    ],
  },
  {
    id: "mobility",
    name: "Mobility & stretch",
    category: "mobility",
    tag: "Recovery",
    blurb: "Fifteen easy minutes to loosen up after sitting, or on days off.",
    exercises: [
      { key: "cat_cow", sets: 2, reps: 10, rest: 15 },
      { key: "worlds_greatest_stretch", sets: 2, reps: 6, rest: 15 },
      { key: "hip_flexor_stretch", sets: 2, seconds: 45, rest: 15 },
      { key: "hamstring_stretch", sets: 2, seconds: 45, rest: 15 },
      { key: "foam_rolling", sets: 1, seconds: 300, rest: 0 },
    ],
  },
];

/** A planned exercise in a line: `3 × 8–12`, `3 × 45s`, `1 × 10 min`. */
export function describeStarterExercise(item: StarterExercise): string {
  if (item.seconds !== undefined) {
    const time =
      item.seconds >= 120 && item.seconds % 60 === 0
        ? `${item.seconds / 60} min`
        : `${item.seconds}s`;
    return `${item.sets} × ${time}`;
  }
  if (item.reps === undefined) return `${item.sets} sets`;
  const reps = typeof item.reps === "number" ? String(item.reps) : item.reps.join("–");
  return `${item.sets} × ${reps}`;
}

/** Built-in exercises in the person's library, by key; archived ones are left out. */
export function builtinsByKey(exercises: readonly Exercise[]): Map<string, Exercise> {
  const byKey = new Map<string, Exercise>();
  for (const exercise of exercises) {
    if (exercise.builtin_key !== null && !exercise.archived) {
      byKey.set(exercise.builtin_key, exercise);
    }
  }
  return byKey;
}

/**
 * The template to save for a starter, using the person's copies of the built-in exercises.
 * Exercises they've archived are skipped; `null` when none are left.
 */
export function starterTemplateRequest(
  template: StarterTemplate,
  library: ReadonlyMap<string, Exercise>,
): WorkoutTemplateRequest | null {
  const exercises: WorkoutTemplateExerciseRequest[] = [];
  for (const item of template.exercises) {
    const exercise = library.get(item.key);
    if (!exercise) continue;
    const [min, max] =
      item.reps === undefined
        ? [null, null]
        : typeof item.reps === "number"
          ? [item.reps, item.reps]
          : item.reps;
    exercises.push({
      exercise_id: exercise.id,
      sets: item.sets,
      target_reps_min: min,
      target_reps_max: max,
      target_weight_g: null,
      target_duration_s: item.seconds ?? null,
      target_distance_m: null,
      rest_seconds: item.rest ?? null,
      notes: "",
    });
  }
  if (exercises.length === 0) return null;
  return {
    name: template.name,
    category: template.category,
    description: template.blurb,
    notes: "",
    exercises,
  };
}
