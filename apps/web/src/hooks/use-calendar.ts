"use client";

import type {
  CalendarAgenda,
  CalendarCategory,
  CalendarEditScope,
  CalendarEvent,
  CalendarOccurrence,
  CalendarPreferences,
  CalendarPreferencesRequest,
  CalendarRange,
  CalendarRangeQuery,
  CreateCalendarCategoryRequest,
  CreateCalendarEventRequest,
  Task,
  TaskListQuery,
  UpdateCalendarCategoryRequest,
  UpdateCalendarEventRequest,
  UpdateOccurrenceRequest,
} from "@orbit/contracts";
import {
  keepPreviousData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import {
  calendarCategoriesOptions,
  calendarEventOptions,
  calendarKeys,
  calendarPreferencesOptions,
  calendarRangeOptions,
  createCalendarCategory,
  createCalendarEvent,
  createEventNote,
  deleteCalendarCategory,
  deleteCalendarEvent,
  deleteOccurrence,
  duplicateCalendarEvent,
  getCalendarAgenda,
  linkEventNote,
  linkEventTask,
  putCalendarPreferences,
  updateCalendarCategory,
  updateCalendarEvent,
  updateOccurrence,
} from "@/api/calendar";
import { noteKeys } from "@/api/notes";
import { reminderKeys } from "@/api/reminders";
import { taskKeys, taskListOptions, updateTask } from "@/api/tasks";
import { queryResource, type Resource } from "@/hooks/query-resource";
import { useWorkspaceNotFound } from "@/hooks/use-workspace-not-found";
import { useAuth, useCurrentUser } from "@/providers/auth";
import { useWorkspaces } from "@/providers/workspace";
import { browserTimeZone } from "@/utils/time-zones";

/** The time zone the calendar is shown in: the user's preference, else this browser's. */
export function useViewerTimeZone(): string {
  const user = useCurrentUser();
  return user.timezone ?? browserTimeZone();
}

/** Occurrences and tasks for a range. The previous range stays visible while the next loads. */
export function useCalendarRange(
  workspaceId: string | null,
  query: CalendarRangeQuery,
): { state: Resource<CalendarRange>; refreshing: boolean; reload: () => void } {
  const { withToken } = useAuth();
  const result = useQuery({
    ...calendarRangeOptions(withToken, workspaceId, query),
    placeholderData: keepPreviousData,
  });
  useWorkspaceNotFound(result.error);
  const state = queryResource(result, "Couldn’t load your calendar.");
  const { refetch } = result;
  const reload = useCallback(() => void refetch(), [refetch]);
  return { state, refreshing: state.status === "success" && result.isFetching, reload };
}

const AGENDA_PAGE = 30;

/** Upcoming occurrences and scheduled tasks from `start`, a page at a time. */
export function useCalendarAgenda(workspaceId: string | null, start: string, limit = AGENDA_PAGE) {
  const { withToken } = useAuth();
  const query = { start, limit };
  const result = useInfiniteQuery({
    queryKey: calendarKeys.agenda(workspaceId, query),
    queryFn: ({ pageParam, signal }) =>
      withToken((token) =>
        getCalendarAgenda(
          token,
          workspaceId ?? "",
          pageParam ? { ...query, cursor: pageParam } : query,
          { signal },
        ),
      ),
    enabled: workspaceId !== null,
    initialPageParam: null as string | null,
    getNextPageParam: (page: CalendarAgenda) => page.next_cursor,
  });
  useWorkspaceNotFound(result.error);
  const items = useMemo(
    () => result.data?.pages.flatMap((page) => page.items) ?? [],
    [result.data],
  );
  return {
    resource:
      result.isError && !result.isFetching
        ? ({ status: "error", message: "Couldn’t load your agenda." } as const)
        : result.data
          ? ({ status: "success", data: items } as const)
          : ({ status: "loading" } as const),
    hasMore: result.hasNextPage,
    loadingMore: result.isFetchingNextPage,
    loadMore: () => void result.fetchNextPage(),
    reload: () => void result.refetch(),
  };
}

export function useCalendarCategories(workspaceId: string | null): {
  categories: CalendarCategory[];
  byId: ReadonlyMap<string, CalendarCategory>;
} {
  const { withToken } = useAuth();
  const { data } = useQuery(calendarCategoriesOptions(withToken, workspaceId));
  return useMemo(() => {
    const categories = data?.categories ?? [];
    return { categories, byId: new Map(categories.map((category) => [category.id, category])) };
  }, [data]);
}

export function useCalendarEvent(workspaceId: string | null, eventId: string | null) {
  const { withToken } = useAuth();
  const result = useQuery(calendarEventOptions(withToken, workspaceId, eventId));
  return { state: queryResource(result, "Couldn’t load this event."), reload: result.refetch };
}

/** Open tasks without a scheduled time, soonest due first, to plan onto the calendar. */
export function useUnscheduledTasks(workspaceId: string | null, enabled = true) {
  const { withToken } = useAuth();
  const query: TaskListQuery = { status: "open", scheduled: false, sort: "due_date", limit: 50 };
  const result = useQuery({
    ...taskListOptions(withToken, enabled ? workspaceId : null, query),
  });
  return queryResource(result, "Couldn’t load your tasks.");
}

/** The signed-in user's calendar preferences (defaults until saved), and saving them. */
export function useCalendarPreferences(): {
  preferences: CalendarPreferences | undefined;
  /** Loaded, or failed (the defaults apply). */
  ready: boolean;
  save: (preferences: CalendarPreferencesRequest) => Promise<CalendarPreferences>;
} {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery(calendarPreferencesOptions(withToken));
  const mutation = useMutation({
    mutationFn: (body: CalendarPreferencesRequest) =>
      withToken((token) => putCalendarPreferences(token, body)),
    onSuccess: (saved) => queryClient.setQueryData(calendarKeys.preferences(), saved),
  });
  return { preferences: data, ready: !isPending, save: mutation.mutateAsync };
}

/** The active workspace's ID, or `null` while workspaces load. */
export function useActiveWorkspaceId(): string | null {
  const { state } = useWorkspaces();
  return state.status === "ready" ? state.active.id : null;
}

type RangeSnapshot = [readonly unknown[], CalendarRange | undefined][];

/** Apply `change` to every cached range at once, returning what to restore on failure. */
async function changeRanges(
  queryClient: QueryClient,
  workspaceId: string,
  change: (range: CalendarRange) => CalendarRange,
): Promise<RangeSnapshot> {
  const key = calendarKeys.ranges(workspaceId);
  await queryClient.cancelQueries({ queryKey: key });
  const snapshot = queryClient.getQueriesData<CalendarRange>({ queryKey: key });
  queryClient.setQueriesData<CalendarRange>({ queryKey: key }, (range) => range && change(range));
  return snapshot;
}

function restore(queryClient: QueryClient, snapshot: RangeSnapshot | undefined) {
  for (const [key, data] of snapshot ?? []) queryClient.setQueryData(key, data);
}

/**
 * Calendar changes for the workspace. Moves and schedules show at once (optimistically) and roll
 * back if the API refuses. Every change then refetches the calendar, and the tasks or reminders
 * it may have changed (event alerts are reminders). Await `mutateAsync` for failures.
 */
export function useCalendarMutations(workspaceId: string) {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: calendarKeys.all(workspaceId) });
    void queryClient.invalidateQueries({ queryKey: reminderKeys.all(workspaceId) });
  }, [queryClient, workspaceId]);
  const refreshTasks = () =>
    void queryClient.invalidateQueries({ queryKey: taskKeys.all(workspaceId) });
  const remember = (event: CalendarEvent) =>
    queryClient.setQueryData(calendarKeys.event(workspaceId, event.id), event);

  const create = useMutation({
    mutationFn: (body: CreateCalendarEventRequest) =>
      withToken((token) => createCalendarEvent(token, workspaceId, body)),
    onSuccess: remember,
    onSettled: refresh,
  });

  const update = useMutation({
    mutationFn: ({ eventId, body }: { eventId: string; body: UpdateCalendarEventRequest }) =>
      withToken((token) => updateCalendarEvent(token, workspaceId, eventId, body)),
    onSuccess: remember,
    onSettled: refresh,
  });

  const remove = useMutation({
    mutationFn: (eventId: string) =>
      withToken((token) => deleteCalendarEvent(token, workspaceId, eventId)),
    onSettled: refresh,
  });

  const duplicate = useMutation({
    mutationFn: (eventId: string) =>
      withToken((token) => duplicateCalendarEvent(token, workspaceId, eventId)),
    onSuccess: remember,
    onSettled: refresh,
  });

  /** Change occurrences. `preview`, when given, is shown at once in place of the occurrence. */
  const updateOne = useMutation({
    mutationFn: ({
      occurrence,
      body,
    }: {
      occurrence: CalendarOccurrence;
      body: UpdateOccurrenceRequest;
      preview?: CalendarOccurrence;
    }) =>
      withToken((token) =>
        updateOccurrence(
          token,
          workspaceId,
          occurrence.event_id,
          occurrence.original_start.slice(0, 16),
          body,
        ),
      ),
    onMutate: async ({ occurrence, preview }) => {
      if (!preview) return undefined;
      return changeRanges(queryClient, workspaceId, (range) => ({
        ...range,
        occurrences: range.occurrences.map((item) => (item.id === occurrence.id ? preview : item)),
      }));
    },
    onError: (_error, _variables, snapshot) => restore(queryClient, snapshot),
    onSuccess: remember,
    onSettled: refresh,
  });

  const removeOne = useMutation({
    mutationFn: ({
      occurrence,
      scope,
    }: {
      occurrence: CalendarOccurrence;
      scope: CalendarEditScope;
    }) =>
      withToken((token) =>
        deleteOccurrence(
          token,
          workspaceId,
          occurrence.event_id,
          occurrence.original_start.slice(0, 16),
          scope,
        ),
      ),
    onSettled: refresh,
  });

  /** Schedule, move, or unschedule a task's time block, shown at once. */
  const scheduleTask = useMutation({
    mutationFn: ({
      task,
      schedule,
    }: {
      task: Task;
      schedule: { scheduled_start: string; scheduled_end: string } | null;
    }) =>
      withToken((token) =>
        updateTask(
          token,
          workspaceId,
          task.id,
          schedule ?? { scheduled_start: null, scheduled_end: null },
        ),
      ),
    onMutate: async ({ task, schedule }) => {
      const moved: Task = {
        ...task,
        scheduled_start: schedule?.scheduled_start ?? null,
        scheduled_end: schedule?.scheduled_end ?? null,
      };
      return changeRanges(queryClient, workspaceId, (range) => {
        const others = range.scheduled_tasks.filter((item) => item.id !== task.id);
        return {
          ...range,
          scheduled_tasks: schedule ? [...others, moved] : others,
          due_tasks: range.due_tasks.filter((item) => item.id !== task.id),
        };
      });
    },
    onError: (_error, _variables, snapshot) => restore(queryClient, snapshot),
    onSettled: () => {
      refresh();
      refreshTasks();
    },
  });

  const createNote = useMutation({
    mutationFn: ({ eventId, occurrenceStart }: { eventId: string; occurrenceStart?: string }) =>
      withToken((token) =>
        createEventNote(
          token,
          workspaceId,
          eventId,
          occurrenceStart ? { occurrence_start: occurrenceStart } : {},
        ),
      ),
    onSettled: () => {
      refresh();
      void queryClient.invalidateQueries({ queryKey: noteKeys.all(workspaceId) });
    },
  });

  const linkNote = useMutation({
    mutationFn: ({
      eventId,
      noteId,
      linked,
    }: {
      eventId: string;
      noteId: string;
      linked: boolean;
    }) => withToken((token) => linkEventNote(token, workspaceId, eventId, noteId, linked)),
    onSettled: refresh,
  });

  const linkTask = useMutation({
    mutationFn: ({
      eventId,
      taskId,
      linked,
    }: {
      eventId: string;
      taskId: string;
      linked: boolean;
    }) => withToken((token) => linkEventTask(token, workspaceId, eventId, taskId, linked)),
    onSettled: refresh,
  });

  return {
    create,
    update,
    remove,
    duplicate,
    updateOne,
    removeOne,
    scheduleTask,
    createNote,
    linkNote,
    linkTask,
  };
}

/** Category changes; each refetches the calendar, since visibility filters its views. */
export function useCategoryMutations(workspaceId: string) {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: calendarKeys.all(workspaceId) });

  const create = useMutation({
    mutationFn: (body: CreateCalendarCategoryRequest) =>
      withToken((token) => createCalendarCategory(token, workspaceId, body)),
    onSettled: refresh,
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateCalendarCategoryRequest }) =>
      withToken((token) => updateCalendarCategory(token, workspaceId, id, body)),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      withToken((token) => deleteCalendarCategory(token, workspaceId, id)),
    onSettled: refresh,
  });
  return { create, update, remove };
}
