/** Health & Fitness views, labels, and display rules. Units are in `./units`. */

import type {
  ActivityKind,
  Equipment,
  ExerciseCategory,
  ExerciseType,
  FitnessGoal,
  FitnessGoalCategory,
  FitnessGoalPace,
  FitnessProfile,
  FitnessSection,
  MealType,
  Muscle,
  PersonalRecord,
  PersonalRecordKind,
  WorkoutSet,
  WorkoutSetType,
  WorkoutStatus,
  WorkoutTemplateCategory,
} from "@orbit/contracts";

import { type Option } from "@/utils/common";

import {
  formatDistance,
  formatDuration,
  formatEnergy,
  formatNumber,
  formatVolume,
  formatWater,
  formatWeight,
} from "./units";

export type Units = Pick<
  FitnessProfile,
  "weight_unit" | "length_unit" | "distance_unit" | "energy_unit" | "water_unit"
>;

export const METRIC_UNITS: Units = {
  weight_unit: "kg",
  length_unit: "cm",
  distance_unit: "km",
  energy_unit: "kcal",
  water_unit: "ml",
};

export const IMPERIAL_UNITS: Units = {
  weight_unit: "lb",
  length_unit: "in",
  distance_unit: "mi",
  energy_unit: "kcal",
  water_unit: "fl_oz",
};

// Views and URLs

export type FitnessView =
  | "overview"
  | "workouts"
  | "exercises"
  | "templates"
  | "body"
  | "nutrition"
  | "water"
  | "activity"
  | "goals"
  | "progress"
  | "settings";

export const FITNESS_VIEWS: readonly Option<FitnessView>[] = [
  { value: "overview", label: "Today" },
  { value: "workouts", label: "Workouts" },
  { value: "templates", label: "Templates" },
  { value: "exercises", label: "Exercises" },
  { value: "nutrition", label: "Food" },
  { value: "water", label: "Water" },
  { value: "body", label: "Body" },
  { value: "activity", label: "Activity" },
  { value: "goals", label: "Goals" },
  { value: "progress", label: "Progress" },
  { value: "settings", label: "Settings" },
];

/** The views in the order and groups the side rail shows them; a group without a label leads. */
export const FITNESS_VIEW_GROUPS: readonly {
  label: string | null;
  views: readonly FitnessView[];
}[] = [
  { label: null, views: ["overview"] },
  { label: "Train", views: ["workouts", "templates", "exercises"] },
  { label: "Track daily", views: ["nutrition", "water", "body", "activity"] },
  { label: "Review", views: ["goals", "progress"] },
  { label: null, views: ["settings"] },
];

/** What each view is for, in a line, so it's clear whether to use it. */
export const FITNESS_VIEW_HINTS: Record<FitnessView, string> = {
  overview: "Today at a glance. Start a workout or log something in a tap.",
  workouts: "Start a workout and log sets as you go, or record one you’ve already done.",
  templates:
    "Workouts you repeat, ready to start in one tap. Add a starter plan or build your own.",
  exercises: "Every exercise you can add to a workout, with your history for each.",
  nutrition: "Optional. Log meals to see calories and protein against your daily targets.",
  water: "Optional. Tap to add a glass and see how close you are to your target.",
  body: "Optional. Record your weight and measurements now and then to see the trend.",
  activity: "Optional. Steps, runs, walks, and other movement outside your workouts.",
  goals: "Set a target, like a body weight or a lift, and see if you’re on pace.",
  progress: "Personal records, weekly volume, and which muscles you’ve trained.",
  settings: "Units, daily targets, and which sections show on Today.",
};

export type FitnessLocation =
  | { kind: "view"; view: FitnessView }
  | { kind: "workout"; id: string }
  | { kind: "exercise"; id: string }
  | { kind: "goal"; id: string };

export function parseFitnessLocation(params: URLSearchParams): FitnessLocation {
  for (const kind of ["workout", "exercise", "goal"] as const) {
    const id = params.get(kind);
    if (id) return { kind, id };
  }
  const view = params.get("view");
  const known = FITNESS_VIEWS.find((option) => option.value === view);
  return { kind: "view", view: known?.value ?? "overview" };
}

export function fitnessHref(location: FitnessLocation): string {
  if (location.kind !== "view")
    return `/health?${location.kind}=${encodeURIComponent(location.id)}`;
  return location.view === "overview" ? "/health" : `/health?view=${location.view}`;
}

/** The view a detail page belongs to, for the tab strip. */
export function viewOf(location: FitnessLocation): FitnessView {
  switch (location.kind) {
    case "view":
      return location.view;
    case "workout":
      return "workouts";
    case "exercise":
      return "exercises";
    case "goal":
      return "goals";
  }
}

export const DASHBOARD_SECTIONS: readonly Option<FitnessSection>[] = [
  { value: "workout", label: "Today’s workout" },
  { value: "recent_workouts", label: "Recent workouts" },
  { value: "weight", label: "Weight trend" },
  { value: "goals", label: "Goals" },
  { value: "nutrition", label: "Nutrition" },
  { value: "water", label: "Water" },
  { value: "activity", label: "Activity" },
  { value: "records", label: "Personal records" },
];

// Exercises

export const EXERCISE_CATEGORIES: readonly Option<ExerciseCategory>[] = [
  { value: "strength", label: "Strength" },
  { value: "cardio", label: "Cardio" },
  { value: "bodyweight", label: "Bodyweight" },
  { value: "mobility", label: "Mobility" },
  { value: "flexibility", label: "Flexibility" },
  { value: "other", label: "Other" },
];

export const EXERCISE_TYPES: readonly Option<ExerciseType>[] = [
  { value: "weight_reps", label: "Weight and reps" },
  { value: "reps", label: "Reps only" },
  { value: "duration", label: "Time" },
  { value: "distance_duration", label: "Distance and time" },
];

export const EQUIPMENT: readonly Option<Equipment>[] = [
  { value: "barbell", label: "Barbell" },
  { value: "dumbbell", label: "Dumbbell" },
  { value: "cable", label: "Cable" },
  { value: "machine", label: "Machine" },
  { value: "kettlebell", label: "Kettlebell" },
  { value: "band", label: "Resistance band" },
  { value: "bodyweight", label: "Bodyweight" },
  { value: "none", label: "None" },
  { value: "other", label: "Other" },
];

export const MUSCLES: readonly Option<Muscle>[] = [
  { value: "chest", label: "Chest" },
  { value: "upper_back", label: "Upper back" },
  { value: "lats", label: "Lats" },
  { value: "lower_back", label: "Lower back" },
  { value: "traps", label: "Traps" },
  { value: "shoulders", label: "Shoulders" },
  { value: "biceps", label: "Biceps" },
  { value: "triceps", label: "Triceps" },
  { value: "forearms", label: "Forearms" },
  { value: "abs", label: "Abs" },
  { value: "obliques", label: "Obliques" },
  { value: "glutes", label: "Glutes" },
  { value: "quadriceps", label: "Quadriceps" },
  { value: "hamstrings", label: "Hamstrings" },
  { value: "calves", label: "Calves" },
  { value: "hip_flexors", label: "Hip flexors" },
  { value: "adductors", label: "Adductors" },
  { value: "full_body", label: "Full body" },
];

/** A muscle's label, for values read from a record keyed by muscle name. */
export function muscleLabel(name: string): string {
  return MUSCLES.find((muscle) => muscle.value === name)?.label ?? name.replaceAll("_", " ");
}

export const TEMPLATE_CATEGORIES: readonly Option<WorkoutTemplateCategory>[] = [
  { value: "push", label: "Push" },
  { value: "pull", label: "Pull" },
  { value: "legs", label: "Legs" },
  { value: "upper", label: "Upper body" },
  { value: "lower", label: "Lower body" },
  { value: "full_body", label: "Full body" },
  { value: "cardio", label: "Cardio" },
  { value: "mobility", label: "Mobility" },
  { value: "other", label: "Other" },
];

export const SET_TYPES: readonly Option<WorkoutSetType>[] = [
  { value: "warmup", label: "Warm-up" },
  { value: "working", label: "Working" },
  { value: "drop", label: "Drop set" },
  { value: "failure", label: "To failure" },
];

export const SET_TYPE_SHORT: Record<WorkoutSetType, string> = {
  warmup: "W",
  working: "",
  drop: "D",
  failure: "F",
};

export const STATUS_LABELS: Record<WorkoutStatus, string> = {
  active: "In progress",
  paused: "Paused",
  completed: "Completed",
  abandoned: "Stopped early",
};

export function labelOf<T extends string>(options: readonly Option<T>[], value: T): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

/** Which values a set of this exercise type records. */
export function setFields(type: ExerciseType): {
  weight: boolean;
  reps: boolean;
  duration: boolean;
  distance: boolean;
} {
  return {
    weight: type === "weight_reps",
    reps: type === "weight_reps" || type === "reps",
    duration: type === "duration" || type === "distance_duration",
    distance: type === "distance_duration",
  };
}

/** A set in a line: `100 kg × 5`, `12 reps`, `1:30`, `5 km in 25 min`. */
export function describeSet(
  set: Pick<WorkoutSet, "reps" | "weight_g" | "duration_s" | "distance_m">,
  type: ExerciseType,
  units: Units,
): string {
  switch (type) {
    case "weight_reps":
      return `${formatWeight(set.weight_g ?? 0, units.weight_unit)} × ${set.reps ?? 0}`;
    case "reps":
      return `${set.reps ?? 0} reps`;
    case "duration":
      return formatDuration(set.duration_s ?? 0);
    case "distance_duration": {
      const distance = set.distance_m ? formatDistance(set.distance_m, units.distance_unit) : null;
      const time = set.duration_s ? formatDuration(set.duration_s) : null;
      return [distance, time].filter(Boolean).join(" in ") || "—";
    }
  }
}

// Records

export const RECORD_LABELS: Record<PersonalRecordKind, string> = {
  max_weight: "Heaviest weight",
  max_reps: "Most reps",
  estimated_1rm: "Estimated 1-rep max",
  best_set_volume: "Best set volume",
  max_duration: "Longest time",
  max_distance: "Longest distance",
};

export function formatRecord(record: PersonalRecord, units: Units): string {
  switch (record.kind) {
    case "max_weight":
      return `${formatWeight(record.value, units.weight_unit)} × ${record.reps ?? 1}`;
    case "estimated_1rm":
      return `≈ ${formatWeight(record.value, units.weight_unit)}`;
    case "max_reps":
      return record.weight_g
        ? `${record.value} reps at ${formatWeight(record.weight_g, units.weight_unit)}`
        : `${record.value} reps`;
    case "best_set_volume":
      return formatVolume(record.value, units.weight_unit);
    case "max_duration":
      return formatDuration(record.value);
    case "max_distance":
      return formatDistance(record.value, units.distance_unit);
  }
}

export const ESTIMATE_NOTE =
  "Estimated with the Epley formula from sets of 1 to 10 reps. It’s an estimate, not a lift you did.";

export const BMI_NOTE =
  "BMI is a general measure of weight for height. It doesn’t account for muscle, frame, age, or sex, and isn’t an assessment of your health or fitness.";

// Nutrition and water

export const MEALS: readonly Option<MealType>[] = [
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" },
  { value: "snack", label: "Snacks" },
  { value: "other", label: "Other" },
];

/** A share of a target, from 0 to 1, or `null` without a target. */
export function share(value: number, target: number | null | undefined): number | null {
  if (!target) return null;
  return Math.min(1, Math.max(0, value / target));
}

// Activity

export const ACTIVITY_KINDS: readonly Option<ActivityKind>[] = [
  { value: "steps", label: "Steps" },
  { value: "walk", label: "Walk" },
  { value: "run", label: "Run" },
  { value: "cycle", label: "Ride" },
  { value: "swim", label: "Swim" },
  { value: "cardio", label: "Other cardio" },
  { value: "sleep", label: "Sleep" },
  { value: "rest_day", label: "Rest day" },
];

/** Which values an activity entry of this kind takes. */
export function activityFields(kind: ActivityKind): {
  steps: boolean;
  distance: boolean;
  duration: boolean;
} {
  return {
    steps: kind === "steps",
    distance: ["walk", "run", "cycle", "swim", "cardio"].includes(kind),
    duration: !["steps", "rest_day"].includes(kind),
  };
}

export function describeActivity(
  activity: {
    kind: ActivityKind;
    steps: number | null;
    distance_m: number | null;
    duration_s: number | null;
  },
  units: Units,
): string {
  if (activity.kind === "rest_day") return "Rest day";
  if (activity.kind === "steps") return `${formatNumber(activity.steps ?? 0)} steps`;
  const parts = [
    activity.distance_m ? formatDistance(activity.distance_m, units.distance_unit) : null,
    activity.duration_s ? formatDuration(activity.duration_s) : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

// Goals

export const GOAL_CATEGORIES: readonly Option<FitnessGoalCategory>[] = [
  { value: "body_weight", label: "Body weight" },
  { value: "strength", label: "Strength" },
  { value: "workout_frequency", label: "Workouts per week" },
  { value: "running_distance", label: "Running distance" },
  { value: "running_duration", label: "Running time" },
  { value: "nutrition", label: "Daily energy" },
  { value: "water", label: "Daily water" },
  { value: "custom", label: "Something else" },
];

export const PACE_LABELS: Record<FitnessGoalPace, string> = {
  ahead: "Ahead of plan",
  on_track: "On track",
  behind: "Behind plan",
  no_target_date: "No target date",
  reached: "Target reached",
};

/** What the person types and reads for a goal's values, by category. */
export function goalUnitLabel(category: FitnessGoalCategory, units: Units, custom: string): string {
  switch (category) {
    case "body_weight":
    case "strength":
      return units.weight_unit;
    case "running_distance":
      return units.distance_unit;
    case "running_duration":
      return "min";
    case "nutrition":
      return units.energy_unit === "kcal" ? "kcal" : "kJ";
    case "water":
      return units.water_unit === "fl_oz" ? "fl oz" : units.water_unit === "l" ? "L" : "ml";
    case "workout_frequency":
      return "workouts";
    case "custom":
      return custom;
  }
}

export function formatGoalValue(
  value: number,
  goal: Pick<FitnessGoal, "category" | "unit">,
  units: Units,
): string {
  switch (goal.category) {
    case "body_weight":
    case "strength":
      return formatWeight(value, units.weight_unit);
    case "running_distance":
      return formatDistance(value, units.distance_unit);
    case "running_duration":
      return formatDuration(value);
    case "nutrition":
      return formatEnergy(value, units.energy_unit);
    case "water":
      return formatWater(value, units.water_unit);
    case "workout_frequency":
      return `${formatNumber(value, 1)} a week`;
    case "custom":
      return `${formatNumber(value, 2)} ${goal.unit}`;
  }
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

export type FoodSort = "most-used" | "name-asc" | "name-desc";

export const FOOD_SORTS: readonly Option<FoodSort>[] = [
  { value: "most-used", label: "Most used" },
  { value: "name-asc", label: "Name A–Z" },
  { value: "name-desc", label: "Name Z–A" },
];

/** Whether a saved food or meal name matches the search box (case- and accent-insensitive). */
export function matchesName(name: string, query: string): boolean {
  const needle = fold(query.trim());
  return needle === "" || fold(name).includes(needle);
}

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Saved foods in the chosen order; "most used" keeps the API's order. */
export function sortFoods<T extends { name: string }>(foods: readonly T[], sort: FoodSort): T[] {
  if (sort === "most-used") return [...foods];
  const direction = sort === "name-asc" ? 1 : -1;
  return [...foods].sort(
    (a, b) =>
      direction * a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }),
  );
}
