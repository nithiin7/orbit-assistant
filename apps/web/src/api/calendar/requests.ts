import type {
  CalendarAgenda,
  CalendarAgendaQuery,
  CalendarCategory,
  CalendarCategoryList,
  CalendarEditScope,
  CalendarEvent,
  CalendarEventList,
  CalendarEventListQuery,
  CalendarLinkedNote,
  CalendarPreferences,
  CalendarPreferencesRequest,
  CalendarRange,
  CalendarRangeQuery,
  CreateCalendarCategoryRequest,
  CreateCalendarEventRequest,
  CreateEventNoteRequest,
  UpdateCalendarCategoryRequest,
  UpdateCalendarEventRequest,
  UpdateOccurrenceRequest,
} from "@orbit/contracts";

import { request, type Signal, toQueryString, workspacePath } from "../client";

function calendarPath(workspaceId: string, suffix = ""): string {
  return workspacePath(workspaceId, `/calendar${suffix}`);
}

function eventPath(workspaceId: string, eventId: string, suffix = ""): string {
  return calendarPath(workspaceId, `/events/${encodeURIComponent(eventId)}${suffix}`);
}

/** The occurrence's original local start (`YYYY-MM-DDTHH:MM`) identifies it in its series. */
function occurrencePath(workspaceId: string, eventId: string, originalStart: string): string {
  return eventPath(workspaceId, eventId, `/occurrences/${encodeURIComponent(originalStart)}`);
}

/** Occurrences and tasks for local dates `[start, end)` in the viewer's time zone. */
export function getCalendarRange(
  token: string,
  workspaceId: string,
  query: CalendarRangeQuery,
  { signal }: Signal = {},
): Promise<CalendarRange> {
  return request<CalendarRange>(`${calendarPath(workspaceId, "/range")}${toQueryString(query)}`, {
    token,
    signal,
  });
}

/** What hasn't ended by `start`, in order, a page at a time. */
export function getCalendarAgenda(
  token: string,
  workspaceId: string,
  query: CalendarAgendaQuery = {},
  { signal }: Signal = {},
): Promise<CalendarAgenda> {
  return request<CalendarAgenda>(`${calendarPath(workspaceId, "/agenda")}${toQueryString(query)}`, {
    token,
    signal,
  });
}

export function listCalendarEvents(
  token: string,
  workspaceId: string,
  query: CalendarEventListQuery = {},
  { signal }: Signal = {},
): Promise<CalendarEventList> {
  return request<CalendarEventList>(
    `${calendarPath(workspaceId, "/events")}${toQueryString(query)}`,
    { token, signal },
  );
}

export function getCalendarEvent(
  token: string,
  workspaceId: string,
  eventId: string,
  { signal }: Signal = {},
): Promise<CalendarEvent> {
  return request<CalendarEvent>(eventPath(workspaceId, eventId), { token, signal });
}

export function createCalendarEvent(
  token: string,
  workspaceId: string,
  body: CreateCalendarEventRequest,
): Promise<CalendarEvent> {
  return request<CalendarEvent>(calendarPath(workspaceId, "/events"), {
    method: "POST",
    body,
    token,
  });
}

/** Changes the whole event or series. */
export function updateCalendarEvent(
  token: string,
  workspaceId: string,
  eventId: string,
  body: UpdateCalendarEventRequest,
): Promise<CalendarEvent> {
  return request<CalendarEvent>(eventPath(workspaceId, eventId), {
    method: "PATCH",
    body,
    token,
  });
}

export function deleteCalendarEvent(
  token: string,
  workspaceId: string,
  eventId: string,
): Promise<void> {
  return request<void>(eventPath(workspaceId, eventId), { method: "DELETE", token });
}

export function duplicateCalendarEvent(
  token: string,
  workspaceId: string,
  eventId: string,
): Promise<CalendarEvent> {
  return request<CalendarEvent>(eventPath(workspaceId, eventId, "/duplicate"), {
    method: "POST",
    token,
  });
}

/** Changes one occurrence, it and the following ones, or the series (`body.scope`). */
export function updateOccurrence(
  token: string,
  workspaceId: string,
  eventId: string,
  originalStart: string,
  body: UpdateOccurrenceRequest,
): Promise<CalendarEvent> {
  return request<CalendarEvent>(occurrencePath(workspaceId, eventId, originalStart), {
    method: "PATCH",
    body,
    token,
  });
}

export function deleteOccurrence(
  token: string,
  workspaceId: string,
  eventId: string,
  originalStart: string,
  scope: CalendarEditScope,
): Promise<void> {
  return request<void>(
    `${occurrencePath(workspaceId, eventId, originalStart)}${toQueryString({ scope })}`,
    { method: "DELETE", token },
  );
}

/** Creates a note (such as meeting notes) and links it to the event. */
export function createEventNote(
  token: string,
  workspaceId: string,
  eventId: string,
  body: CreateEventNoteRequest = {},
): Promise<CalendarLinkedNote> {
  return request<CalendarLinkedNote>(eventPath(workspaceId, eventId, "/notes"), {
    method: "POST",
    body,
    token,
  });
}

export function linkEventNote(
  token: string,
  workspaceId: string,
  eventId: string,
  noteId: string,
  linked: boolean,
): Promise<void> {
  return request<void>(eventPath(workspaceId, eventId, `/notes/${encodeURIComponent(noteId)}`), {
    method: linked ? "PUT" : "DELETE",
    token,
  });
}

export function linkEventTask(
  token: string,
  workspaceId: string,
  eventId: string,
  taskId: string,
  linked: boolean,
): Promise<void> {
  return request<void>(eventPath(workspaceId, eventId, `/tasks/${encodeURIComponent(taskId)}`), {
    method: linked ? "PUT" : "DELETE",
    token,
  });
}

/** The workspace's categories; the first call creates the defaults. */
export function listCalendarCategories(
  token: string,
  workspaceId: string,
  { signal }: Signal = {},
): Promise<CalendarCategoryList> {
  return request<CalendarCategoryList>(calendarPath(workspaceId, "/categories"), {
    token,
    signal,
  });
}

export function createCalendarCategory(
  token: string,
  workspaceId: string,
  body: CreateCalendarCategoryRequest,
): Promise<CalendarCategory> {
  return request<CalendarCategory>(calendarPath(workspaceId, "/categories"), {
    method: "POST",
    body,
    token,
  });
}

export function updateCalendarCategory(
  token: string,
  workspaceId: string,
  categoryId: string,
  body: UpdateCalendarCategoryRequest,
): Promise<CalendarCategory> {
  return request<CalendarCategory>(
    calendarPath(workspaceId, `/categories/${encodeURIComponent(categoryId)}`),
    { method: "PATCH", body, token },
  );
}

export function deleteCalendarCategory(
  token: string,
  workspaceId: string,
  categoryId: string,
): Promise<void> {
  return request<void>(calendarPath(workspaceId, `/categories/${encodeURIComponent(categoryId)}`), {
    method: "DELETE",
    token,
  });
}

export function getCalendarPreferences(
  token: string,
  { signal }: Signal = {},
): Promise<CalendarPreferences> {
  return request<CalendarPreferences>("/api/v1/me/calendar-preferences", { token, signal });
}

export function putCalendarPreferences(
  token: string,
  body: CalendarPreferencesRequest,
): Promise<CalendarPreferences> {
  return request<CalendarPreferences>("/api/v1/me/calendar-preferences", {
    method: "PUT",
    body,
    token,
  });
}
