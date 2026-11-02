"use client";

import type {
  FitnessProfile,
  Workout,
  WorkoutAnalyticsQuery,
  WorkoutListQuery,
} from "@orbit/contracts";
import {
  keepPreviousData,
  type QueryKey,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import { calendarKeys } from "@/api/calendar";
import { documentListOptions } from "@/api/documents";
import {
  activeWorkoutOptions,
  activitiesOptions,
  downloadPhoto,
  exerciseHistoryOptions,
  exercisesOptions,
  fitnessKeys,
  fitnessOverviewOptions,
  fitnessProfileOptions,
  foodsOptions,
  goalsOptions,
  habitLinksOptions,
  mealsOptions,
  measurementsOptions,
  nutritionDayOptions,
  nutritionHistoryOptions,
  photosOptions,
  recordsOptions,
  scheduledWorkoutOptions,
  templatesOptions,
  waterDayOptions,
  waterHistoryOptions,
  workoutAnalyticsOptions,
  workoutOptions,
  workoutsOptions,
} from "@/api/fitness";
import { habitKeys } from "@/api/habits";
import { noteKeys, noteListOptions } from "@/api/notes";
import { reminderKeys } from "@/api/reminders";
import { queryResource, type Resource } from "@/hooks/query-resource";
import { useWorkspaceNotFound } from "@/hooks/use-workspace-not-found";
import { METRIC_UNITS, type Units } from "@/lib/fitness";
import { useAuth } from "@/providers/auth";

type Loaded<T> = { state: Resource<T>; reload: () => void };

function useResource<T, K extends QueryKey>(
  options: UseQueryOptions<T, Error, T, K>,
  message: string,
  { keepPrevious = false }: { keepPrevious?: boolean } = {},
): Loaded<T> {
  const result = useQuery({
    ...options,
    placeholderData: keepPrevious ? keepPreviousData : undefined,
  });
  useWorkspaceNotFound(result.error);
  return { state: queryResource(result, message), reload: () => void result.refetch() };
}

export function useFitnessProfile(workspaceId: string | null): Loaded<FitnessProfile> {
  const { withToken } = useAuth();
  return useResource(
    fitnessProfileOptions(withToken, workspaceId),
    "Couldn’t load your health settings.",
  );
}

/** The person's units, metric until their profile loads. */
export function useUnits(workspaceId: string | null): Units {
  const { state } = useFitnessProfile(workspaceId);
  return state.status === "success" ? state.data : METRIC_UNITS;
}

export function useFitnessOverview(workspaceId: string | null, day: string, timeZone: string) {
  const { withToken } = useAuth();
  return useResource(
    fitnessOverviewOptions(withToken, workspaceId, day, timeZone),
    "Couldn’t load your health overview.",
  );
}

export function useExercises(workspaceId: string | null) {
  const { withToken } = useAuth();
  return useResource(exercisesOptions(withToken, workspaceId), "Couldn’t load your exercises.");
}

export function useExerciseHistory(workspaceId: string | null, exerciseId: string) {
  const { withToken } = useAuth();
  return useResource(
    exerciseHistoryOptions(withToken, workspaceId, exerciseId),
    "Couldn’t load this exercise’s history.",
  );
}

export function useTemplates(workspaceId: string | null) {
  const { withToken } = useAuth();
  return useResource(templatesOptions(withToken, workspaceId), "Couldn’t load your templates.");
}

export function useWorkouts(workspaceId: string | null, query: WorkoutListQuery) {
  const { withToken } = useAuth();
  return useResource(workoutsOptions(withToken, workspaceId, query), "Couldn’t load workouts.", {
    keepPrevious: true,
  });
}

export function useActiveWorkout(workspaceId: string | null) {
  const { withToken } = useAuth();
  return useResource(activeWorkoutOptions(withToken, workspaceId), "Couldn’t load your workout.");
}

export function useWorkout(workspaceId: string | null, sessionId: string) {
  const { withToken } = useAuth();
  return useResource(
    workoutOptions(withToken, workspaceId, sessionId),
    "Couldn’t load this workout.",
  );
}

export function useRecords(workspaceId: string | null) {
  const { withToken } = useAuth();
  return useResource(recordsOptions(withToken, workspaceId), "Couldn’t load your records.");
}

export function useWorkoutAnalytics(workspaceId: string | null, query: WorkoutAnalyticsQuery) {
  const { withToken } = useAuth();
  return useResource(
    workoutAnalyticsOptions(withToken, workspaceId, query),
    "Couldn’t load your progress.",
    { keepPrevious: true },
  );
}

export function useMeasurements(workspaceId: string | null) {
  const { withToken } = useAuth();
  return useResource(
    measurementsOptions(withToken, workspaceId),
    "Couldn’t load your measurements.",
  );
}

export function usePhotos(workspaceId: string | null) {
  const { withToken } = useAuth();
  return useResource(photosOptions(withToken, workspaceId), "Couldn’t load your photos.");
}

export function useFoods(workspaceId: string | null) {
  const { withToken } = useAuth();
  return useResource(foodsOptions(withToken, workspaceId), "Couldn’t load your saved foods.");
}

export function useMeals(workspaceId: string | null) {
  const { withToken } = useAuth();
  return useResource(mealsOptions(withToken, workspaceId), "Couldn’t load your saved meals.");
}

export function useNutritionDay(workspaceId: string | null, day: string) {
  const { withToken } = useAuth();
  return useResource(nutritionDayOptions(withToken, workspaceId, day), "Couldn’t load this day.", {
    keepPrevious: true,
  });
}

export function useNutritionHistory(workspaceId: string | null, start: string, end: string) {
  const { withToken } = useAuth();
  return useResource(
    nutritionHistoryOptions(withToken, workspaceId, start, end),
    "Couldn’t load your meal history.",
  );
}

export function useWaterDay(workspaceId: string | null, day: string) {
  const { withToken } = useAuth();
  return useResource(waterDayOptions(withToken, workspaceId, day), "Couldn’t load your water.", {
    keepPrevious: true,
  });
}

export function useWaterHistory(workspaceId: string | null, start: string, end: string) {
  const { withToken } = useAuth();
  return useResource(
    waterHistoryOptions(withToken, workspaceId, start, end),
    "Couldn’t load your water history.",
  );
}

export function useActivities(workspaceId: string | null) {
  const { withToken } = useAuth();
  return useResource(activitiesOptions(withToken, workspaceId), "Couldn’t load your activity.");
}

export function useGoals(workspaceId: string | null, day: string) {
  const { withToken } = useAuth();
  return useResource(goalsOptions(withToken, workspaceId, day), "Couldn’t load your goals.");
}

export function useHabitLinks(workspaceId: string | null) {
  const { withToken } = useAuth();
  return useResource(habitLinksOptions(withToken, workspaceId), "Couldn’t load linked habits.");
}

/** The workout a calendar event schedules; `null` when it doesn't schedule one. */
export function useScheduledWorkout(workspaceId: string | null, eventId: string) {
  const { withToken } = useAuth();
  return useResource(
    scheduledWorkoutOptions(withToken, workspaceId, eventId),
    "Couldn’t check for a scheduled workout.",
  );
}

/** A progress photo's image, fetched with the token. Photos never change, so it's kept. */
export function usePhotoFile(workspaceId: string, photoId: string) {
  const { withToken } = useAuth();
  return useQuery({
    queryKey: [...fitnessKeys.photos(workspaceId), "file", photoId],
    queryFn: ({ signal }) =>
      withToken((token) => downloadPhoto(token, workspaceId, photoId, { signal })),
    staleTime: Infinity,
  });
}

/** Notes or documents matching `search`, to link to a workout or goal. */
export function useLinkCandidates(
  workspaceId: string,
  kind: "note" | "document",
  search: string,
): Resource<{ id: string; title: string }[]> {
  const { withToken } = useAuth();
  const q = search.trim() || null;
  const notes = useQuery({
    ...noteListOptions(withToken, workspaceId, { q, limit: 20, state: "active" }),
    enabled: kind === "note",
    placeholderData: keepPreviousData,
  });
  const documents = useQuery({
    ...documentListOptions(withToken, workspaceId, { q, limit: 20, state: "active" }),
    enabled: kind === "document",
    placeholderData: keepPreviousData,
  });
  if (kind === "note") {
    const state = queryResource(notes, "Couldn’t load your notes.");
    return state.status === "success"
      ? {
          status: "success",
          data: state.data.notes.map((n) => ({ id: n.id, title: n.title || "Untitled" })),
        }
      : state;
  }
  const state = queryResource(documents, "Couldn’t load your documents.");
  return state.status === "success"
    ? { status: "success", data: state.data.documents.map((d) => ({ id: d.id, title: d.title })) }
    : state;
}

/** What else a change can touch besides health records. */
export type Touches = "habits" | "calendar" | "notes";

/**
 * Runs a change with the user's token, then refetches the workspace's health records (records
 * affect each other: a workout changes records, goals, and the overview) and anything else it
 * touches. A workout returned by the change is put in the cache at once, so set logging shows
 * without waiting for the refetch.
 */
export function useFitnessAction(workspaceId: string) {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();

  return async function run<T>(
    call: (token: string) => Promise<T>,
    { touches = [], workout = false }: { touches?: readonly Touches[]; workout?: boolean } = {},
  ): Promise<T> {
    try {
      const result = await withToken(call);
      if (workout && isWorkout(result)) {
        queryClient.setQueryData(fitnessKeys.workout(workspaceId, result.id), result);
      }
      return result;
    } finally {
      void queryClient.invalidateQueries({ queryKey: fitnessKeys.all(workspaceId) });
      if (touches.includes("habits")) {
        void queryClient.invalidateQueries({ queryKey: habitKeys.all(workspaceId) });
      }
      if (touches.includes("calendar")) {
        void queryClient.invalidateQueries({ queryKey: calendarKeys.all(workspaceId) });
        void queryClient.invalidateQueries({ queryKey: reminderKeys.all(workspaceId) });
      }
      if (touches.includes("notes")) {
        void queryClient.invalidateQueries({ queryKey: noteKeys.all(workspaceId) });
      }
    }
  };
}

function isWorkout(value: unknown): value is Workout {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "exercises" in value &&
    "status" in value
  );
}
