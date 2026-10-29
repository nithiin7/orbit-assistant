import type { Notification, NotificationList, NotificationListQuery } from "@orbit/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";

import type { WithToken } from "../client";
import { getUnreadNotificationCount, listNotifications } from "./requests";

/**
 * How often the unread count is polled. Notifications arrive from the background worker, and
 * there is no push channel yet, so the bell asks; the request is a single indexed count.
 */
export const UNREAD_POLL_MS = 30_000;

/**
 * Cache keys for the signed-in user's notifications. They span workspaces, so they aren't keyed
 * by one; the whole cache is cleared when the user changes.
 */
export const notificationKeys = {
  /** Everything cached for notifications. Invalidate this after any change. */
  all: () => ["notifications"] as const,
  lists: () => [...notificationKeys.all(), "list"] as const,
  list: (query: NotificationListQuery) => [...notificationKeys.lists(), query] as const,
  unreadCount: () => [...notificationKeys.all(), "unread-count"] as const,
};

export function notificationListOptions(withToken: WithToken, query: NotificationListQuery) {
  return queryOptions({
    queryKey: notificationKeys.list(query),
    queryFn: ({ signal }) => withToken((token) => listNotifications(token, query, { signal })),
    // The list is shown on demand; always show what's new when it opens.
    staleTime: 0,
  });
}

export function unreadCountOptions(withToken: WithToken) {
  return queryOptions({
    queryKey: notificationKeys.unreadCount(),
    queryFn: ({ signal }) => withToken((token) => getUnreadNotificationCount(token, { signal })),
    refetchInterval: UNREAD_POLL_MS,
    staleTime: 0,
  });
}

/** Show a changed notification in every cached list, and adjust the unread counts to match. */
export function replaceCachedNotification(queryClient: QueryClient, notification: Notification) {
  let change = 0;
  queryClient.setQueriesData<NotificationList>({ queryKey: notificationKeys.lists() }, (list) => {
    if (!list) return list;
    const previous = list.notifications.find((item) => item.id === notification.id);
    if (!previous) return list;
    const delta = Number(previous.read_at !== null) - Number(notification.read_at !== null);
    change = delta;
    return {
      ...list,
      unread: Math.max(0, list.unread + delta),
      notifications: list.notifications.map((item) =>
        item.id === notification.id ? notification : item,
      ),
    };
  });
  if (change !== 0) {
    queryClient.setQueryData<{ unread: number }>(
      notificationKeys.unreadCount(),
      (count) => count && { unread: Math.max(0, count.unread + change) },
    );
  }
}
