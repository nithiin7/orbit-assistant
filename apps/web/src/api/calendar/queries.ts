import type {
  CalendarAgendaQuery,
  CalendarEventListQuery,
  CalendarRangeQuery,
} from "@orbit/contracts";
import { queryOptions, skipToken } from "@tanstack/react-query";

import type { WithToken } from "../client";
import {
  getCalendarAgenda,
  getCalendarEvent,
  getCalendarPreferences,
  getCalendarRange,
  listCalendarCategories,
  listCalendarEvents,
} from "./requests";

/**
 * Cache keys for a workspace's calendar. Every key starts with the workspace ID, so one
 * workspace's results can never be served for another. `null` (no active workspace yet) never
 * fetches. Preferences belong to the user, under `["me", …]`.
 */
export const calendarKeys = {
  /** Everything cached for the workspace's calendar. Invalidate this after any change. */
  all: (workspaceId: string | null) => ["workspaces", workspaceId, "calendar"] as const,
  ranges: (workspaceId: string | null) => [...calendarKeys.all(workspaceId), "range"] as const,
  range: (workspaceId: string | null, query: CalendarRangeQuery) =>
    [...calendarKeys.ranges(workspaceId), query] as const,
  agenda: (workspaceId: string | null, query: CalendarAgendaQuery) =>
    [...calendarKeys.all(workspaceId), "agenda", query] as const,
  events: (workspaceId: string | null, query: CalendarEventListQuery) =>
    [...calendarKeys.all(workspaceId), "events", query] as const,
  event: (workspaceId: string | null, eventId: string | null) =>
    [...calendarKeys.all(workspaceId), "event", eventId] as const,
  categories: (workspaceId: string | null) =>
    [...calendarKeys.all(workspaceId), "categories"] as const,
  preferences: () => ["me", "calendar-preferences"] as const,
};

export function calendarRangeOptions(
  withToken: WithToken,
  workspaceId: string | null,
  query: CalendarRangeQuery,
) {
  return queryOptions({
    queryKey: calendarKeys.range(workspaceId, query),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => getCalendarRange(token, workspaceId, query, { signal })),
  });
}

export function calendarAgendaOptions(
  withToken: WithToken,
  workspaceId: string | null,
  query: CalendarAgendaQuery,
) {
  return queryOptions({
    queryKey: calendarKeys.agenda(workspaceId, query),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => getCalendarAgenda(token, workspaceId, query, { signal })),
  });
}

export function calendarEventListOptions(
  withToken: WithToken,
  workspaceId: string | null,
  query: CalendarEventListQuery,
) {
  return queryOptions({
    queryKey: calendarKeys.events(workspaceId, query),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => listCalendarEvents(token, workspaceId, query, { signal })),
  });
}

export function calendarEventOptions(
  withToken: WithToken,
  workspaceId: string | null,
  eventId: string | null,
) {
  return queryOptions({
    queryKey: calendarKeys.event(workspaceId, eventId),
    queryFn:
      workspaceId === null || eventId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => getCalendarEvent(token, workspaceId, eventId, { signal })),
  });
}

export function calendarCategoriesOptions(withToken: WithToken, workspaceId: string | null) {
  return queryOptions({
    queryKey: calendarKeys.categories(workspaceId),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => listCalendarCategories(token, workspaceId, { signal })),
  });
}

export function calendarPreferencesOptions(withToken: WithToken) {
  return queryOptions({
    queryKey: calendarKeys.preferences(),
    queryFn: ({ signal }) => withToken((token) => getCalendarPreferences(token, { signal })),
  });
}
