import type {
  Reminder,
  ReminderList,
  ReminderListQuery,
  UpcomingReminders,
  UpcomingRemindersQuery,
} from "@orbit/contracts";
import { type QueryClient, queryOptions, skipToken } from "@tanstack/react-query";

import type { WithToken } from "../client";
import { listReminders, listUpcomingReminders } from "./requests";

/**
 * How often reminder views refetch while open. Delivery happens in the background, so a
 * reminder's status and next occurrence change without the user doing anything.
 */
export const REMINDER_REFRESH_MS = 60_000;

/**
 * Cache keys for a workspace's reminders. Every key starts with the workspace ID, so one
 * workspace's results can never be served for another. `null` (no active workspace yet) never
 * fetches.
 */
export const reminderKeys = {
  /** Everything cached for the workspace's reminders. Invalidate this after any change. */
  all: (workspaceId: string | null) => ["workspaces", workspaceId, "reminders"] as const,
  list: (workspaceId: string | null, query: ReminderListQuery) =>
    [...reminderKeys.all(workspaceId), "list", query] as const,
  upcoming: (workspaceId: string | null, query: UpcomingRemindersQuery) =>
    [...reminderKeys.all(workspaceId), "upcoming", query] as const,
};

export function reminderListOptions(
  withToken: WithToken,
  workspaceId: string | null,
  query: ReminderListQuery,
) {
  return queryOptions({
    queryKey: reminderKeys.list(workspaceId, query),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => listReminders(token, workspaceId, query, { signal })),
    refetchInterval: REMINDER_REFRESH_MS,
  });
}

export function upcomingRemindersOptions(
  withToken: WithToken,
  workspaceId: string | null,
  query: UpcomingRemindersQuery,
) {
  return queryOptions({
    queryKey: reminderKeys.upcoming(workspaceId, query),
    queryFn:
      workspaceId === null
        ? skipToken
        : ({ signal }) =>
            withToken((token) => listUpcomingReminders(token, workspaceId, query, { signal })),
    refetchInterval: REMINDER_REFRESH_MS,
  });
}

/**
 * Change the reminders in every cached list and Up next, without refetching; a list's total
 * drops by however many `change` removed.
 */
export function updateCachedReminders(
  queryClient: QueryClient,
  workspaceId: string,
  change: (reminders: Reminder[]) => Reminder[],
) {
  queryClient.setQueriesData<ReminderList | UpcomingReminders>(
    { queryKey: reminderKeys.all(workspaceId) },
    (page) => {
      if (!page) return page;
      const reminders = change(page.reminders);
      if (!("total" in page)) return { ...page, reminders };
      const removed = page.reminders.length - reminders.length;
      return { ...page, reminders, total: Math.max(0, page.total - removed) };
    },
  );
}
