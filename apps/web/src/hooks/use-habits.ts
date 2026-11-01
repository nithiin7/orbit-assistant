"use client";

import type {
  CreateHabitCategoryRequest,
  CreateHabitRequest,
  CreateRoutineRequest,
  CreateTaskRequest,
  HabitAnalytics,
  HabitAnalyticsQuery,
  HabitCalendar,
  HabitCalendarQuery,
  HabitCategory,
  HabitDayState,
  HabitDetail,
  HabitHistory,
  HabitList,
  HabitProgress,
  HabitReminderTime,
  HabitStatus,
  HabitToday,
  LogHabitRequest,
  Routine,
  RoutineList,
  RoutineSessionList,
  RoutineStepStatus,
  UpdateHabitRequest,
  UpdateRoutineRequest,
  UpdateRoutineSessionRequest,
} from "@orbit/contracts";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { calendarKeys } from "@/api/calendar";
import {
  createHabit,
  createHabitCategory,
  createHabitNote,
  createHabitTask,
  createRoutine,
  createSessionNote,
  deleteHabit,
  deleteHabitCategory,
  deleteRoutine,
  habitAnalyticsOptions,
  habitCalendarOptions,
  habitCategoriesOptions,
  habitHistoryOptions,
  habitKeys,
  habitListOptions,
  habitOptions,
  habitTodayOptions,
  logHabit,
  routineListOptions,
  routineOptions,
  routineSessionsOptions,
  setHabitReminders,
  setRoutineReminders,
  setSessionStep,
  startRoutineSession,
  unlinkHabitNote,
  unlinkHabitTask,
  unlogHabit,
  updateHabit,
  updateRoutine,
  updateRoutineSession,
} from "@/api/habits";
import { noteKeys } from "@/api/notes";
import { reminderKeys } from "@/api/reminders";
import { taskKeys } from "@/api/tasks";
import { queryResource, type Resource } from "@/hooks/query-resource";
import { useWorkspaceNotFound } from "@/hooks/use-workspace-not-found";
import { useAuth } from "@/providers/auth";

type StatusFilter = HabitStatus | "all";

/** Today's habits, this week, and the days ahead, as of today in `timeZone`. */
export function useHabitToday(
  workspaceId: string | null,
  timeZone: string,
): { state: Resource<HabitToday>; reload: () => void } {
  const { withToken } = useAuth();
  const result = useQuery(habitTodayOptions(withToken, workspaceId, { timezone: timeZone }));
  useWorkspaceNotFound(result.error);
  return {
    state: queryResource(result, "Couldn’t load today’s habits."),
    reload: () => void result.refetch(),
  };
}

export function useHabitList(
  workspaceId: string | null,
  status: StatusFilter,
): { state: Resource<HabitList>; reload: () => void } {
  const { withToken } = useAuth();
  const result = useQuery(habitListOptions(withToken, workspaceId, { status }));
  useWorkspaceNotFound(result.error);
  return {
    state: queryResource(result, "Couldn’t load your habits."),
    reload: () => void result.refetch(),
  };
}

export function useHabit(
  workspaceId: string | null,
  habitId: string,
): { state: Resource<HabitDetail>; reload: () => void } {
  const { withToken } = useAuth();
  const result = useQuery(habitOptions(withToken, workspaceId, habitId));
  return {
    state: queryResource(result, "Couldn’t load this habit."),
    reload: () => void result.refetch(),
  };
}

export function useHabitHistory(
  workspaceId: string | null,
  habitId: string,
  start: string,
  end: string,
): Resource<HabitHistory> {
  const { withToken } = useAuth();
  const result = useQuery({
    ...habitHistoryOptions(withToken, workspaceId, habitId, { start, end }),
    placeholderData: keepPreviousData,
  });
  return queryResource(result, "Couldn’t load this habit’s history.");
}

export function useHabitAnalytics(
  workspaceId: string | null,
  query: HabitAnalyticsQuery,
): { state: Resource<HabitAnalytics>; refreshing: boolean; reload: () => void } {
  const { withToken } = useAuth();
  const result = useQuery({
    ...habitAnalyticsOptions(withToken, workspaceId, query),
    placeholderData: keepPreviousData,
  });
  useWorkspaceNotFound(result.error);
  const state = queryResource(result, "Couldn’t load your habit analytics.");
  return {
    state,
    refreshing: state.status === "success" && result.isFetching,
    reload: () => void result.refetch(),
  };
}

/** Habits and routines with a time of day, for the calendar. `null` fetches nothing. */
export function useHabitCalendar(
  workspaceId: string | null,
  query: HabitCalendarQuery | null,
): HabitCalendar["entries"] {
  const { withToken } = useAuth();
  const { data } = useQuery({
    ...habitCalendarOptions(withToken, workspaceId, query),
    placeholderData: keepPreviousData,
  });
  return query === null ? [] : (data?.entries ?? []);
}

export function useHabitCategories(workspaceId: string | null): readonly HabitCategory[] {
  const { withToken } = useAuth();
  const { data } = useQuery(habitCategoriesOptions(withToken, workspaceId));
  return data?.categories ?? [];
}

export function useRoutineList(
  workspaceId: string | null,
  status: StatusFilter,
): { state: Resource<RoutineList>; reload: () => void } {
  const { withToken } = useAuth();
  const result = useQuery(routineListOptions(withToken, workspaceId, { status }));
  useWorkspaceNotFound(result.error);
  return {
    state: queryResource(result, "Couldn’t load your routines."),
    reload: () => void result.refetch(),
  };
}

export function useRoutine(
  workspaceId: string | null,
  routineId: string,
): { state: Resource<Routine>; reload: () => void } {
  const { withToken } = useAuth();
  const result = useQuery(routineOptions(withToken, workspaceId, routineId));
  return {
    state: queryResource(result, "Couldn’t load this routine."),
    reload: () => void result.refetch(),
  };
}

export function useRoutineSessions(
  workspaceId: string | null,
  routineId: string,
): Resource<RoutineSessionList> {
  const { withToken } = useAuth();
  const result = useQuery(routineSessionsOptions(withToken, workspaceId, routineId, { limit: 20 }));
  return queryResource(result, "Couldn’t load this routine’s sessions.");
}

/** What a log entry will look like once saved, so check-offs show at once. */
function expectedState(body: LogHabitRequest | null): HabitDayState {
  if (body === null) return "pending";
  if (body.status === "skipped") return "skipped";
  if (body.status === "completed") return "completed";
  return "partial";
}

/**
 * Habit changes for the workspace. Each refetches the workspace's habit data, and the
 * reminders, tasks, notes, or calendar it may have changed. Logging a day updates Today at once
 * and rolls back if the API refuses. Await `mutateAsync` to handle failures.
 */
export function useHabitMutations(workspaceId: string) {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: habitKeys.all(workspaceId) });
    void queryClient.invalidateQueries({ queryKey: reminderKeys.all(workspaceId) });
    void queryClient.invalidateQueries({ queryKey: calendarKeys.all(workspaceId) });
  };

  const create = useMutation({
    mutationFn: (body: CreateHabitRequest) =>
      withToken((token) => createHabit(token, workspaceId, body)),
    onSettled: refresh,
  });

  const update = useMutation({
    mutationFn: ({
      habitId,
      changes,
      reminders,
    }: {
      habitId: string;
      changes: UpdateHabitRequest;
      reminders?: HabitReminderTime[];
    }) =>
      withToken(async (token) => {
        const updated = await updateHabit(token, workspaceId, habitId, changes);
        return reminders ? setHabitReminders(token, workspaceId, habitId, reminders) : updated;
      }),
    onSettled: refresh,
  });

  const remove = useMutation({
    mutationFn: (habitId: string) => withToken((token) => deleteHabit(token, workspaceId, habitId)),
    onSettled: refresh,
  });

  /** Record a day, or undo it (`body: null`). */
  const log = useMutation({
    mutationFn: ({
      habit,
      day,
      body,
    }: {
      habit: HabitProgress["habit"];
      day: string;
      body: LogHabitRequest | null;
    }) =>
      withToken((token) =>
        body === null
          ? unlogHabit(token, workspaceId, habit, day)
          : logHabit(token, workspaceId, habit, day, body),
      ),
    onMutate: async ({ habit, day, body }) => {
      const key = [...habitKeys.all(workspaceId), "today"];
      await queryClient.cancelQueries({ queryKey: key });
      const snapshot = queryClient.getQueriesData<HabitToday>({ queryKey: key });
      queryClient.setQueriesData<HabitToday>({ queryKey: key }, (today) =>
        today && today.day === day
          ? {
              ...today,
              habits: today.habits.map((item) =>
                item.habit.id === habit.id ? { ...item, state: expectedState(body) } : item,
              ),
            }
          : today,
      );
      return snapshot;
    },
    onError: (_error, _variables, snapshot) => {
      for (const [key, data] of snapshot ?? []) queryClient.setQueryData(key, data);
    },
    onSettled: refresh,
  });

  const createTask = useMutation({
    mutationFn: ({ habitId, body }: { habitId: string; body: CreateTaskRequest }) =>
      withToken((token) => createHabitTask(token, workspaceId, habitId, body)),
    onSettled: () => {
      refresh();
      void queryClient.invalidateQueries({ queryKey: taskKeys.all(workspaceId) });
    },
  });

  const unlinkTask = useMutation({
    mutationFn: ({ habitId, taskId }: { habitId: string; taskId: string }) =>
      withToken((token) => unlinkHabitTask(token, workspaceId, habitId, taskId)),
    onSettled: refresh,
  });

  const createNote = useMutation({
    mutationFn: ({ habitId, day }: { habitId: string; day: string }) =>
      withToken((token) => createHabitNote(token, workspaceId, habitId, { title: "", day })),
    onSettled: () => {
      refresh();
      void queryClient.invalidateQueries({ queryKey: noteKeys.all(workspaceId) });
    },
  });

  const unlinkNote = useMutation({
    mutationFn: ({ habitId, noteId }: { habitId: string; noteId: string }) =>
      withToken((token) => unlinkHabitNote(token, workspaceId, habitId, noteId)),
    onSettled: refresh,
  });

  const createCategory = useMutation({
    mutationFn: (body: CreateHabitCategoryRequest) =>
      withToken((token) => createHabitCategory(token, workspaceId, body)),
    onSettled: refresh,
  });

  const removeCategory = useMutation({
    mutationFn: (categoryId: string) =>
      withToken((token) => deleteHabitCategory(token, workspaceId, categoryId)),
    onSettled: refresh,
  });

  return {
    create,
    update,
    remove,
    log,
    createTask,
    unlinkTask,
    createNote,
    unlinkNote,
    createCategory,
    removeCategory,
  };
}

/** Routine and session changes for the workspace. Steps can complete habits, so every change
 * refetches the workspace's habit data too. */
export function useRoutineMutations(workspaceId: string) {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: habitKeys.all(workspaceId) });
    void queryClient.invalidateQueries({ queryKey: reminderKeys.all(workspaceId) });
    void queryClient.invalidateQueries({ queryKey: calendarKeys.all(workspaceId) });
  };

  const create = useMutation({
    mutationFn: (body: CreateRoutineRequest) =>
      withToken((token) => createRoutine(token, workspaceId, body)),
    onSettled: refresh,
  });

  const update = useMutation({
    mutationFn: ({
      routineId,
      changes,
      reminders,
    }: {
      routineId: string;
      changes: UpdateRoutineRequest;
      reminders?: HabitReminderTime[];
    }) =>
      withToken(async (token) => {
        const updated = await updateRoutine(token, workspaceId, routineId, changes);
        return reminders ? setRoutineReminders(token, workspaceId, routineId, reminders) : updated;
      }),
    onSettled: refresh,
  });

  const remove = useMutation({
    mutationFn: (routineId: string) =>
      withToken((token) => deleteRoutine(token, workspaceId, routineId)),
    onSettled: refresh,
  });

  const start = useMutation({
    mutationFn: (routineId: string) =>
      withToken((token) => startRoutineSession(token, workspaceId, routineId)),
    onSettled: refresh,
  });

  const setStep = useMutation({
    mutationFn: (args: {
      routineId: string;
      sessionId: string;
      stepId: string;
      status: RoutineStepStatus;
    }) =>
      withToken((token) =>
        setSessionStep(
          token,
          workspaceId,
          args.routineId,
          args.sessionId,
          args.stepId,
          args.status,
        ),
      ),
    onSettled: refresh,
  });

  const updateSession = useMutation({
    mutationFn: (args: {
      routineId: string;
      sessionId: string;
      body: UpdateRoutineSessionRequest;
    }) =>
      withToken((token) =>
        updateRoutineSession(token, workspaceId, args.routineId, args.sessionId, args.body),
      ),
    onSettled: refresh,
  });

  const createNote = useMutation({
    mutationFn: (args: { routineId: string; sessionId: string }) =>
      withToken((token) => createSessionNote(token, workspaceId, args.routineId, args.sessionId)),
    onSettled: () => {
      refresh();
      void queryClient.invalidateQueries({ queryKey: noteKeys.all(workspaceId) });
    },
  });

  return { create, update, remove, start, setStep, updateSession, createNote };
}
