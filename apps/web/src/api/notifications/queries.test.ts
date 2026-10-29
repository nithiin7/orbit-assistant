import type { Notification, NotificationList } from "@orbit/contracts";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { notificationKeys, replaceCachedNotification } from "./queries";
import { listNotifications } from "./requests";

function notification(id: string, readAt: string | null = null): Notification {
  return {
    id,
    workspace_id: "w1",
    reminder_id: "r1",
    title: id,
    body: "",
    scheduled_for: "2030-01-15T08:00:00Z",
    created_at: "2030-01-15T08:00:00Z",
    read_at: readAt,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listNotifications", () => {
  it("sends `unread` only when asking for unread notifications", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(Response.json({ notifications: [], total: 0, unread: 0 })),
      );
    vi.stubGlobal("fetch", fetchMock);

    await listNotifications("token", { limit: 20 });
    await listNotifications("token", { unread: true, limit: 20 });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://localhost:8000/api/v1/me/notifications?limit=20",
      "http://localhost:8000/api/v1/me/notifications?limit=20&unread=true",
    ]);
  });
});

describe("replaceCachedNotification", () => {
  it("updates the notification in cached lists and adjusts the unread counts", () => {
    const client = new QueryClient();
    const key = notificationKeys.list({ limit: 20 });
    client.setQueryData<NotificationList>(key, {
      notifications: [notification("a"), notification("b")],
      total: 2,
      unread: 2,
    });
    client.setQueryData(notificationKeys.unreadCount(), { unread: 2 });

    replaceCachedNotification(client, notification("a", "2030-01-15T09:00:00Z"));

    const list = client.getQueryData<NotificationList>(key);
    expect(list?.unread).toBe(1);
    expect(list?.notifications[0]?.read_at).toBe("2030-01-15T09:00:00Z");
    expect(client.getQueryData(notificationKeys.unreadCount())).toEqual({ unread: 1 });

    replaceCachedNotification(client, notification("a"));
    expect(client.getQueryData(notificationKeys.unreadCount())).toEqual({ unread: 2 });
  });
});
