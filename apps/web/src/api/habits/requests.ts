import type {
  CalendarLinkedNote,
  CreateHabitCategoryRequest,
  CreateHabitNoteRequest,
  CreateHabitRequest,
  CreateRoutineRequest,
  CreateTaskRequest,
  Habit,
  HabitAnalytics,
  HabitAnalyticsQuery,
  HabitCalendar,
  HabitCalendarQuery,
  HabitCategory,
  HabitCategoryList,
  HabitDetail,
  HabitHistory,
  HabitHistoryQuery,
  HabitList,
  HabitListQuery,
  HabitProgress,
  HabitReminderTime,
  HabitToday,
  HabitTodayQuery,
  LogHabitRequest,
  Routine,
  RoutineList,
  RoutineSession,
  RoutineSessionList,
  RoutineSessionListQuery,
  RoutineStepStatus,
  Task,
  UpdateHabitCategoryRequest,
  UpdateHabitRequest,
  UpdateRoutineRequest,
  UpdateRoutineSessionRequest,
} from "@orbit/contracts";

import { request, type Signal, toQueryString, workspacePath } from "../client";

function habitsPath(workspaceId: string, suffix = ""): string {
  return workspacePath(workspaceId, `/habits${suffix}`);
}

function habitPath(workspaceId: string, habitId: string, suffix = ""): string {
  return habitsPath(workspaceId, `/${encodeURIComponent(habitId)}${suffix}`);
}

function routinePath(workspaceId: string, routineId: string | null, suffix = ""): string {
  const id = routineId === null ? "" : `/${encodeURIComponent(routineId)}`;
  return workspacePath(workspaceId, `/routines${id}${suffix}`);
}

function sessionPath(
  workspaceId: string,
  routineId: string,
  sessionId: string,
  suffix = "",
): string {
  return routinePath(workspaceId, routineId, `/sessions/${encodeURIComponent(sessionId)}${suffix}`);
}

// Categories

export function listHabitCategories(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<HabitCategoryList> {
  return request<HabitCategoryList>(habitsPath(workspaceId, "/categories"), { token, signal });
}

export function createHabitCategory(
  token: string,
  workspaceId: string,
  body: CreateHabitCategoryRequest,
): Promise<HabitCategory> {
  return request<HabitCategory>(habitsPath(workspaceId, "/categories"), {
    method: "POST",
    body,
    token,
  });
}

export function updateHabitCategory(
  token: string,
  workspaceId: string,
  categoryId: string,
  body: UpdateHabitCategoryRequest,
): Promise<HabitCategory> {
  return request<HabitCategory>(
    habitsPath(workspaceId, `/categories/${encodeURIComponent(categoryId)}`),
    { method: "PATCH", body, token },
  );
}

export function deleteHabitCategory(
  token: string,
  workspaceId: string,
  categoryId: string,
): Promise<void> {
  return request<void>(habitsPath(workspaceId, `/categories/${encodeURIComponent(categoryId)}`), {
    method: "DELETE",
    token,
  });
}

// Views

/** Every habit that isn't archived, as of a day (today by default), with its week. */
export function getHabitToday(
  token: string,
  workspaceId: string,
  query: HabitTodayQuery = {},
  { signal }: Signal = {},
): Promise<HabitToday> {
  return request<HabitToday>(`${habitsPath(workspaceId, "/today")}${toQueryString(query)}`, {
    token,
    signal,
  });
}

export function getHabitAnalytics(
  token: string,
  workspaceId: string,
  query: HabitAnalyticsQuery,
  { signal }: Signal = {},
): Promise<HabitAnalytics> {
  return request<HabitAnalytics>(
    `${habitsPath(workspaceId, "/analytics")}${toQueryString(query)}`,
    { token, signal },
  );
}

/** Habits and routines with a time of day, for local dates `[start, end)`. */
export function getHabitCalendar(
  token: string,
  workspaceId: string,
  query: HabitCalendarQuery,
  { signal }: Signal = {},
): Promise<HabitCalendar> {
  return request<HabitCalendar>(`${habitsPath(workspaceId, "/calendar")}${toQueryString(query)}`, {
    token,
    signal,
  });
}

// Habits

export function listHabits(
  token: string,
  workspaceId: string,
  query: HabitListQuery = {},
  { signal }: Signal = {},
): Promise<HabitList> {
  return request<HabitList>(`${habitsPath(workspaceId)}${toQueryString(query)}`, {
    token,
    signal,
  });
}

export function getHabit(
  token: string,
  workspaceId: string,
  habitId: string,
  { signal }: Signal = {},
): Promise<HabitDetail> {
  return request<HabitDetail>(habitPath(workspaceId, habitId), { token, signal });
}

export function createHabit(
  token: string,
  workspaceId: string,
  body: CreateHabitRequest,
): Promise<HabitDetail> {
  return request<HabitDetail>(habitsPath(workspaceId), { method: "POST", body, token });
}

export function updateHabit(
  token: string,
  workspaceId: string,
  habitId: string,
  body: UpdateHabitRequest,
): Promise<HabitDetail> {
  return request<HabitDetail>(habitPath(workspaceId, habitId), { method: "PATCH", body, token });
}

export function deleteHabit(token: string, workspaceId: string, habitId: string): Promise<void> {
  return request<void>(habitPath(workspaceId, habitId), { method: "DELETE", token });
}

export function getHabitHistory(
  token: string,
  workspaceId: string,
  habitId: string,
  query: HabitHistoryQuery,
  { signal }: Signal = {},
): Promise<HabitHistory> {
  return request<HabitHistory>(
    `${habitPath(workspaceId, habitId, "/history")}${toQueryString(query)}`,
    { token, signal },
  );
}

/** Records one local date (`YYYY-MM-DD`): completed, progress toward the target, or skipped. */
export function logHabit(
  token: string,
  workspaceId: string,
  habit: Pick<Habit, "id">,
  day: string,
  body: LogHabitRequest,
): Promise<HabitProgress> {
  return request<HabitProgress>(habitPath(workspaceId, habit.id, `/log/${day}`), {
    method: "PUT",
    body,
    token,
  });
}

export function unlogHabit(
  token: string,
  workspaceId: string,
  habit: Pick<Habit, "id">,
  day: string,
): Promise<HabitProgress> {
  return request<HabitProgress>(habitPath(workspaceId, habit.id, `/log/${day}`), {
    method: "DELETE",
    token,
  });
}

export function setHabitReminders(
  token: string,
  workspaceId: string,
  habitId: string,
  reminders: HabitReminderTime[],
): Promise<HabitDetail> {
  return request<HabitDetail>(habitPath(workspaceId, habitId, "/reminders"), {
    method: "PUT",
    body: { reminders },
    token,
  });
}

export function createHabitTask(
  token: string,
  workspaceId: string,
  habitId: string,
  body: CreateTaskRequest,
): Promise<Task> {
  return request<Task>(habitPath(workspaceId, habitId, "/tasks"), { method: "POST", body, token });
}

export function unlinkHabitTask(
  token: string,
  workspaceId: string,
  habitId: string,
  taskId: string,
): Promise<void> {
  return request<void>(habitPath(workspaceId, habitId, `/tasks/${encodeURIComponent(taskId)}`), {
    method: "DELETE",
    token,
  });
}

/** Creates a reflection note in the Inbox, linked to the habit. */
export function createHabitNote(
  token: string,
  workspaceId: string,
  habitId: string,
  body: CreateHabitNoteRequest,
): Promise<CalendarLinkedNote> {
  return request<CalendarLinkedNote>(habitPath(workspaceId, habitId, "/notes"), {
    method: "POST",
    body,
    token,
  });
}

export function unlinkHabitNote(
  token: string,
  workspaceId: string,
  habitId: string,
  noteId: string,
): Promise<void> {
  return request<void>(habitPath(workspaceId, habitId, `/notes/${encodeURIComponent(noteId)}`), {
    method: "DELETE",
    token,
  });
}

// Routines

export function listRoutines(
  token: string,
  workspaceId: string,
  query: HabitListQuery = {},
  { signal }: Signal = {},
): Promise<RoutineList> {
  return request<RoutineList>(`${routinePath(workspaceId, null)}${toQueryString(query)}`, {
    token,
    signal,
  });
}

export function getRoutine(
  token: string,
  workspaceId: string,
  routineId: string,
  { signal }: Signal = {},
): Promise<Routine> {
  return request<Routine>(routinePath(workspaceId, routineId), { token, signal });
}

export function createRoutine(
  token: string,
  workspaceId: string,
  body: CreateRoutineRequest,
): Promise<Routine> {
  return request<Routine>(routinePath(workspaceId, null), { method: "POST", body, token });
}

export function updateRoutine(
  token: string,
  workspaceId: string,
  routineId: string,
  body: UpdateRoutineRequest,
): Promise<Routine> {
  return request<Routine>(routinePath(workspaceId, routineId), { method: "PATCH", body, token });
}

export function deleteRoutine(
  token: string,
  workspaceId: string,
  routineId: string,
): Promise<void> {
  return request<void>(routinePath(workspaceId, routineId), { method: "DELETE", token });
}

export function setRoutineReminders(
  token: string,
  workspaceId: string,
  routineId: string,
  reminders: HabitReminderTime[],
): Promise<Routine> {
  return request<Routine>(routinePath(workspaceId, routineId, "/reminders"), {
    method: "PUT",
    body: { reminders },
    token,
  });
}

export function listRoutineSessions(
  token: string,
  workspaceId: string,
  routineId: string,
  query: RoutineSessionListQuery = {},
  { signal }: Signal = {},
): Promise<RoutineSessionList> {
  return request<RoutineSessionList>(
    `${routinePath(workspaceId, routineId, "/sessions")}${toQueryString(query)}`,
    { token, signal },
  );
}

/** Starts a session for today, copying the routine's steps. 409 if one is in progress. */
export function startRoutineSession(
  token: string,
  workspaceId: string,
  routineId: string,
): Promise<RoutineSession> {
  return request<RoutineSession>(routinePath(workspaceId, routineId, "/sessions"), {
    method: "POST",
    body: {},
    token,
  });
}

export function updateRoutineSession(
  token: string,
  workspaceId: string,
  routineId: string,
  sessionId: string,
  body: UpdateRoutineSessionRequest,
): Promise<RoutineSession> {
  return request<RoutineSession>(sessionPath(workspaceId, routineId, sessionId), {
    method: "PATCH",
    body,
    token,
  });
}

export function setSessionStep(
  token: string,
  workspaceId: string,
  routineId: string,
  sessionId: string,
  stepId: string,
  status: RoutineStepStatus,
): Promise<RoutineSession> {
  return request<RoutineSession>(
    sessionPath(workspaceId, routineId, sessionId, `/steps/${encodeURIComponent(stepId)}`),
    { method: "PATCH", body: { status }, token },
  );
}

export function createSessionNote(
  token: string,
  workspaceId: string,
  routineId: string,
  sessionId: string,
): Promise<CalendarLinkedNote> {
  return request<CalendarLinkedNote>(sessionPath(workspaceId, routineId, sessionId, "/note"), {
    method: "POST",
    body: {},
    token,
  });
}
