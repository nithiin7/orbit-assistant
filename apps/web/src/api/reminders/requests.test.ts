import { afterEach, describe, expect, it, vi } from "vitest";

import { reminderKeys } from "./queries";
import { listReminders, listUpcomingReminders, updateReminder } from "./requests";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reminder requests", () => {
  it("encode list filters and paths", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(Response.json({ reminders: [], total: 0 })));
    vi.stubGlobal("fetch", fetchMock);

    await listReminders("token", "w 1", { status: "overdue", limit: 50 });
    await listUpcomingReminders("token", "w1", { limit: 5 });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://localhost:8000/api/v1/workspaces/w%201/reminders?status=overdue&limit=50",
      "http://localhost:8000/api/v1/workspaces/w1/reminders/upcoming?limit=5",
    ]);
  });

  it("send updates as PATCH with the token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal("fetch", fetchMock);

    await updateReminder("token", "w1", "r/1", { enabled: false });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8000/api/v1/workspaces/w1/reminders/r%2F1");
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe('{"enabled":false}');
    expect(init.headers).toMatchObject({ Authorization: "Bearer token" });
  });

  it("scope cache keys to the workspace", () => {
    expect(reminderKeys.list("w1", { status: "scheduled" })).toEqual([
      "workspaces",
      "w1",
      "reminders",
      "list",
      { status: "scheduled" },
    ]);
    expect(reminderKeys.upcoming("w1", {}).slice(0, 3)).toEqual(reminderKeys.all("w1"));
  });
});
