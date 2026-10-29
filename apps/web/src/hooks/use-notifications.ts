"use client";

import type { Notification, NotificationList } from "@orbit/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";

import {
  markAllNotificationsRead,
  notificationKeys,
  notificationListOptions,
  replaceCachedNotification,
  setNotificationRead,
  unreadCountOptions,
} from "@/api/notifications";
import { queryResource, type Resource } from "@/hooks/query-resource";
import { useAuth } from "@/providers/auth";

const INBOX_SIZE = 20;

/**
 * The unread count, polled while the app is open. When it rises, a reminder was just delivered,
 * so cached reminder lists (whose statuses changed) are marked stale too.
 */
export function useUnreadCount(): number | null {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();
  const { data } = useQuery(unreadCountOptions(withToken));
  const unread = data?.unread ?? null;
  const previous = useRef(unread);

  useEffect(() => {
    if (unread !== null && previous.current !== null && unread > previous.current) {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.lists() });
      void queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === "workspaces" && query.queryKey[2] === "reminders",
      });
    }
    previous.current = unread;
  }, [unread, queryClient]);

  return unread;
}

/** The newest notifications, loaded while `enabled` (the notification panel is open). */
export function useNotificationList(enabled: boolean): {
  state: Resource<NotificationList>;
  reload: () => void;
} {
  const { withToken } = useAuth();
  const result = useQuery({
    ...notificationListOptions(withToken, { limit: INBOX_SIZE }),
    enabled,
  });
  const state = queryResource(result, "Couldn’t load your notifications.");
  const { refetch } = result;
  const reload = useCallback(() => void refetch(), [refetch]);
  return { state, reload };
}

/** Mark notifications read or unread. The unread count and lists update to match. */
export function useNotificationMutations() {
  const { withToken } = useAuth();
  const queryClient = useQueryClient();

  const setRead = useMutation({
    mutationFn: ({ notification, read }: { notification: Notification; read: boolean }) =>
      withToken((token) => setNotificationRead(token, notification.id, read)),
    onSuccess: (updated) => replaceCachedNotification(queryClient, updated),
  });

  const readAll = useMutation({
    mutationFn: () => withToken((token) => markAllNotificationsRead(token)),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: notificationKeys.all() }),
  });

  return { setRead, readAll };
}
