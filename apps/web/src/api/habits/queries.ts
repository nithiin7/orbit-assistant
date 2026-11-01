import type {
  HabitAnalyticsQuery,
  HabitCalendarQuery,
  HabitHistoryQuery,
  HabitListQuery,
  HabitTodayQuery,
  RoutineSessionListQuery,
} from "@orbit/contracts";
import { queryOptions, skipToken } from "@tanstack/react-query";

import type { WithToken } from "../client";
import {
  getHabit,
  getHabitAnalytics,
  getHabitCalendar,
  getHabitHistory,
  getHabitToday,
  getRoutine,
  listHabitCategories,
  listHabits,
  listRoutines,
  listRoutineSessions,
} from "./requests";

/**
 * Cache keys for a workspace's habits and routines. Every key starts with the workspace ID, so
 * one workspace's results can never be served for another. `null` (no active workspace yet)
 * never fetches. Habits and routines share one root: logging a habit from a routine step
 * changes both.
 */
export const habitKeys = {
  /** Everything cached for the workspace's habits and routines. Invalidate after any change. */
  all: (workspaceId: string | null) => ["workspaces", workspaceId, "habits"] as const,
  categories: (workspaceId: string | null) =>
    [...habitKeys.all(workspaceId), "categories"] as const,
  today: (workspaceId: string | null, query: HabitTodayQuery) =>
    [...habitKeys.all(workspaceId), "today", query] as const,
  list: (workspaceId: string | null, query: HabitListQuery) =>
    [...habitKeys.all(workspaceId), "list", query] as const,
  habit: (workspaceId: string | null, habitId: string | null) =>
    [...habitKeys.all(workspaceId), "habit", habitId] as const,
  history: (workspaceId: string | null, habitId: string | null, query: HabitHistoryQuery) =>
    [...habitKeys.habit(workspaceId, habitId), "history", query] as const,
  analytics: (workspaceId: string | null, query: HabitAnalyticsQuery) =>
    [...habitKeys.all(workspaceId), "analytics", query] as const,
  calendar: (workspaceId: string | null, query: HabitCalendarQuery) =>
    [...habitKeys.all(workspaceId), "calendar", query] as const,
  routines: (workspaceId: string | null, query: HabitListQuery) =>
    [...habitKeys.all(workspaceId), "routines", query] as const,
  routine: (workspaceId: string | null, routineId: string | null) =>
    [...habitKeys.all(workspaceId), "routine", routineId] as const,
  sessions: (
    workspaceId: string | null,
    routineId: string | null,
    query: RoutineSessionListQuery,
  ) => [...habitKeys.routine(workspaceId, routineId), "sessions", query] as const,
};

export function habitCategoriesOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: habitKeys.categories(workspaceId),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) => withToken((token) => listHabitCategories(token, workspaceId, { signal })),
  });
}

export function habitTodayOptions(
  withToken: WithToken,
  workspaceId: string | null,
  query: HabitTodayQuery,
) {
  return queryOptions({
    queryKey: habitKeys.today(workspaceId, query),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => getHabitToday(token, workspaceId, query, { signal })),
  });
}

export function habitListOptions(
  withToken: WithToken,
  workspaceId: string | null,
  query: HabitListQuery,
) {
  return queryOptions({
    queryKey: habitKeys.list(workspaceId, query),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) => withToken((token) => listHabits(token, workspaceId, query, { signal })),
  });
}

export function habitOptions(
  withToken: WithToken,
  workspaceId: string | null,
  habitId: string | null,
) {
  return queryOptions({
    queryKey: habitKeys.habit(workspaceId, habitId),
    queryFn:
      workspaceId === null || habitId === null
        ? skipToken
        : ({ signal }) => withToken((token) => getHabit(token, workspaceId, habitId, { signal })),
  });
}

export function habitHistoryOptions(
  withToken: WithToken,
  workspaceId: string | null,
  habitId: string | null,
  query: HabitHistoryQuery,
) {
  return queryOptions({
    queryKey: habitKeys.history(workspaceId, habitId, query),
    queryFn:
      workspaceId === null || habitId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => getHabitHistory(token, workspaceId, habitId, query, { signal })),
  });
}

export function habitAnalyticsOptions(
  withToken: WithToken,
  workspaceId: string | null,
  query: HabitAnalyticsQuery,
) {
  return queryOptions({
    queryKey: habitKeys.analytics(workspaceId, query),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => getHabitAnalytics(token, workspaceId, query, { signal })),
  });
}

export function habitCalendarOptions(
  withToken: WithToken,
  workspaceId: string | null,
  query: HabitCalendarQuery | null,
) {
  return queryOptions({
    queryKey: habitKeys.calendar(workspaceId, query ?? { start: "", end: "" }),
    queryFn:
      workspaceId === null || query === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => getHabitCalendar(token, workspaceId, query, { signal })),
  });
}

export function routineListOptions(
  withToken: WithToken,
  workspaceId: string | null,
  query: HabitListQuery,
) {
  return queryOptions({
    queryKey: habitKeys.routines(workspaceId, query),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) => withToken((token) => listRoutines(token, workspaceId, query, { signal })),
  });
}

export function routineOptions(
  withToken: WithToken,
  workspaceId: string | null,
  routineId: string | null,
) {
  return queryOptions({
    queryKey: habitKeys.routine(workspaceId, routineId),
    queryFn:
      workspaceId === null || routineId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => getRoutine(token, workspaceId, routineId, { signal })),
  });
}

export function routineSessionsOptions(
  withToken: WithToken,
  workspaceId: string | null,
  routineId: string | null,
  query: RoutineSessionListQuery,
) {
  return queryOptions({
    queryKey: habitKeys.sessions(workspaceId, routineId, query),
    queryFn:
      workspaceId === null || routineId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) =>
              listRoutineSessions(token, workspaceId, routineId, query, { signal }),
            ),
  });
}
