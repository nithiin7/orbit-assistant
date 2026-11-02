import type { WorkoutAnalyticsQuery, WorkoutListQuery } from "@orbit/contracts";
import { queryOptions, skipToken } from "@tanstack/react-query";

import type { WithToken } from "../client";
import {
  getActiveWorkout,
  getExerciseHistory,
  getFitnessOverview,
  getFitnessProfile,
  getNutritionDay,
  getNutritionHistory,
  getScheduledWorkout,
  getWaterDay,
  getWaterHistory,
  getWorkout,
  getWorkoutAnalytics,
  listActivities,
  listExercises,
  listFoods,
  listGoals,
  listHabitLinks,
  listMeals,
  listMeasurements,
  listPhotos,
  listRecords,
  listTemplates,
  listWorkouts,
} from "./requests";

/**
 * Cache keys for the signed-in person's health records in a workspace. Every key starts with the
 * workspace ID, so one workspace's records are never served for another, and the query cache is
 * cleared when the user changes. `null` (no active workspace yet) never fetches. Records affect
 * each other (a workout changes records, goals, and the overview), so changes invalidate `all`.
 */
export const fitnessKeys = {
  all: (workspaceId: string | null) => ["workspaces", workspaceId, "fitness"] as const,
  overview: (workspaceId: string | null, day: string, timeZone: string) =>
    [...fitnessKeys.all(workspaceId), "overview", day, timeZone] as const,
  profile: (workspaceId: string | null) => [...fitnessKeys.all(workspaceId), "profile"] as const,
  exercises: (workspaceId: string | null) =>
    [...fitnessKeys.all(workspaceId), "exercises"] as const,
  exerciseHistory: (workspaceId: string | null, exerciseId: string) =>
    [...fitnessKeys.all(workspaceId), "exercise-history", exerciseId] as const,
  templates: (workspaceId: string | null) =>
    [...fitnessKeys.all(workspaceId), "templates"] as const,
  workouts: (workspaceId: string | null, query: WorkoutListQuery) =>
    [...fitnessKeys.all(workspaceId), "workouts", query] as const,
  active: (workspaceId: string | null) => [...fitnessKeys.all(workspaceId), "active"] as const,
  workout: (workspaceId: string | null, sessionId: string) =>
    [...fitnessKeys.all(workspaceId), "workout", sessionId] as const,
  records: (workspaceId: string | null) => [...fitnessKeys.all(workspaceId), "records"] as const,
  analytics: (workspaceId: string | null, query: WorkoutAnalyticsQuery) =>
    [...fitnessKeys.all(workspaceId), "analytics", query] as const,
  measurements: (workspaceId: string | null) =>
    [...fitnessKeys.all(workspaceId), "measurements"] as const,
  photos: (workspaceId: string | null) => [...fitnessKeys.all(workspaceId), "photos"] as const,
  foods: (workspaceId: string | null) => [...fitnessKeys.all(workspaceId), "foods"] as const,
  meals: (workspaceId: string | null) => [...fitnessKeys.all(workspaceId), "meals"] as const,
  nutrition: (workspaceId: string | null, day: string) =>
    [...fitnessKeys.all(workspaceId), "nutrition", day] as const,
  nutritionHistory: (workspaceId: string | null, start: string, end: string) =>
    [...fitnessKeys.all(workspaceId), "nutrition-history", start, end] as const,
  water: (workspaceId: string | null, day: string) =>
    [...fitnessKeys.all(workspaceId), "water", day] as const,
  waterHistory: (workspaceId: string | null, start: string, end: string) =>
    [...fitnessKeys.all(workspaceId), "water-history", start, end] as const,
  activities: (workspaceId: string | null) =>
    [...fitnessKeys.all(workspaceId), "activities"] as const,
  goals: (workspaceId: string | null, day: string) =>
    [...fitnessKeys.all(workspaceId), "goals", day] as const,
  habitLinks: (workspaceId: string | null) =>
    [...fitnessKeys.all(workspaceId), "habit-links"] as const,
  scheduled: (workspaceId: string | null, eventId: string) =>
    [...fitnessKeys.all(workspaceId), "scheduled", eventId] as const,
};

type Fetch<T> = (
  token: string,
  workspaceId: string,
  options: { signal: AbortSignal },
) => Promise<T>;

function options<T, K extends readonly unknown[]>(
  withToken: WithToken,
  workspaceId: string | null,
  queryKey: K,
  fetch: Fetch<T>,
) {
  return queryOptions({
    queryKey,
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) => withToken((token) => fetch(token, workspaceId, { signal })),
  });
}

export function fitnessOverviewOptions(
  withToken: WithToken,
  workspaceId: string | null,
  day: string,
  timeZone: string,
) {
  return options(
    withToken,
    workspaceId,
    fitnessKeys.overview(workspaceId, day, timeZone),
    (t, w, o) => getFitnessOverview(t, w, { date: day, timezone: timeZone }, o),
  );
}

export function fitnessProfileOptions(withToken: WithToken, workspaceId: string | null) {
  return options(withToken, workspaceId, fitnessKeys.profile(workspaceId), getFitnessProfile);
}

export function exercisesOptions(withToken: WithToken, workspaceId: string | null) {
  return options(withToken, workspaceId, fitnessKeys.exercises(workspaceId), listExercises);
}

export function exerciseHistoryOptions(
  withToken: WithToken,
  workspaceId: string | null,
  exerciseId: string,
) {
  return options(
    withToken,
    workspaceId,
    fitnessKeys.exerciseHistory(workspaceId, exerciseId),
    (t, w, o) => getExerciseHistory(t, w, exerciseId, o),
  );
}

export function templatesOptions(withToken: WithToken, workspaceId: string | null) {
  return options(withToken, workspaceId, fitnessKeys.templates(workspaceId), listTemplates);
}

export function workoutsOptions(
  withToken: WithToken,
  workspaceId: string | null,
  query: WorkoutListQuery,
) {
  return options(withToken, workspaceId, fitnessKeys.workouts(workspaceId, query), (t, w, o) =>
    listWorkouts(t, w, query, o),
  );
}

export function activeWorkoutOptions(withToken: WithToken, workspaceId: string | null) {
  return options(withToken, workspaceId, fitnessKeys.active(workspaceId), getActiveWorkout);
}

export function workoutOptions(
  withToken: WithToken,
  workspaceId: string | null,
  sessionId: string,
) {
  return options(withToken, workspaceId, fitnessKeys.workout(workspaceId, sessionId), (t, w, o) =>
    getWorkout(t, w, sessionId, o),
  );
}

export function recordsOptions(withToken: WithToken, workspaceId: string | null) {
  return options(withToken, workspaceId, fitnessKeys.records(workspaceId), listRecords);
}

export function workoutAnalyticsOptions(
  withToken: WithToken,
  workspaceId: string | null,
  query: WorkoutAnalyticsQuery,
) {
  return options(withToken, workspaceId, fitnessKeys.analytics(workspaceId, query), (t, w, o) =>
    getWorkoutAnalytics(t, w, query, o),
  );
}

export function measurementsOptions(withToken: WithToken, workspaceId: string | null) {
  return options(withToken, workspaceId, fitnessKeys.measurements(workspaceId), listMeasurements);
}

export function photosOptions(withToken: WithToken, workspaceId: string | null) {
  return options(withToken, workspaceId, fitnessKeys.photos(workspaceId), listPhotos);
}

export function foodsOptions(withToken: WithToken, workspaceId: string | null) {
  return options(withToken, workspaceId, fitnessKeys.foods(workspaceId), listFoods);
}

export function mealsOptions(withToken: WithToken, workspaceId: string | null) {
  return options(withToken, workspaceId, fitnessKeys.meals(workspaceId), listMeals);
}

export function nutritionDayOptions(withToken: WithToken, workspaceId: string | null, day: string) {
  return options(withToken, workspaceId, fitnessKeys.nutrition(workspaceId, day), (t, w, o) =>
    getNutritionDay(t, w, { date: day }, o),
  );
}

export function nutritionHistoryOptions(
  withToken: WithToken,
  workspaceId: string | null,
  start: string,
  end: string,
) {
  return options(
    withToken,
    workspaceId,
    fitnessKeys.nutritionHistory(workspaceId, start, end),
    (t, w, o) => getNutritionHistory(t, w, { start, end }, o),
  );
}

export function waterDayOptions(withToken: WithToken, workspaceId: string | null, day: string) {
  return options(withToken, workspaceId, fitnessKeys.water(workspaceId, day), (t, w, o) =>
    getWaterDay(t, w, { date: day }, o),
  );
}

export function waterHistoryOptions(
  withToken: WithToken,
  workspaceId: string | null,
  start: string,
  end: string,
) {
  return options(
    withToken,
    workspaceId,
    fitnessKeys.waterHistory(workspaceId, start, end),
    (t, w, o) => getWaterHistory(t, w, { start, end }, o),
  );
}

export function activitiesOptions(withToken: WithToken, workspaceId: string | null) {
  return options(withToken, workspaceId, fitnessKeys.activities(workspaceId), (t, w, o) =>
    listActivities(t, w, { limit: 200 }, o),
  );
}

export function goalsOptions(withToken: WithToken, workspaceId: string | null, day: string) {
  return options(withToken, workspaceId, fitnessKeys.goals(workspaceId, day), (t, w, o) =>
    listGoals(t, w, { date: day }, o),
  );
}

export function habitLinksOptions(withToken: WithToken, workspaceId: string | null) {
  return options(withToken, workspaceId, fitnessKeys.habitLinks(workspaceId), listHabitLinks);
}

export function scheduledWorkoutOptions(
  withToken: WithToken,
  workspaceId: string | null,
  eventId: string,
) {
  return options(withToken, workspaceId, fitnessKeys.scheduled(workspaceId, eventId), (t, w, o) =>
    getScheduledWorkout(t, w, eventId, o),
  );
}
