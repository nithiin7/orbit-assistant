import type {
  MarkAllNotificationsReadResponse,
  Notification,
  NotificationList,
  NotificationListQuery,
  UnreadNotificationCount,
} from "@orbit/contracts";

import { request, type Signal, toQueryString } from "../client";

const NOTIFICATIONS = "/api/v1/me/notifications";

/** The signed-in user's notifications from every workspace, newest first. */
export function listNotifications(
  token: string,
  query: NotificationListQuery = {},
  { signal }: Signal = {},
): Promise<NotificationList> {
  // `unread=false` is the default; leave it out rather than send it.
  const { unread, ...rest } = query;
  return request<NotificationList>(
    `${NOTIFICATIONS}${toQueryString({ ...rest, unread: unread ? "true" : undefined })}`,
    { token, signal },
  );
}

export function getUnreadNotificationCount(
  token: string,
  { signal }: Signal = {},
): Promise<UnreadNotificationCount> {
  return request<UnreadNotificationCount>(`${NOTIFICATIONS}/unread-count`, { token, signal });
}

export function setNotificationRead(
  token: string,
  notificationId: string,
  read: boolean,
): Promise<Notification> {
  return request<Notification>(`${NOTIFICATIONS}/${encodeURIComponent(notificationId)}`, {
    method: "PATCH",
    body: { read },
    token,
  });
}

export function markAllNotificationsRead(token: string): Promise<MarkAllNotificationsReadResponse> {
  return request<MarkAllNotificationsReadResponse>(`${NOTIFICATIONS}/read-all`, {
    method: "POST",
    token,
  });
}
