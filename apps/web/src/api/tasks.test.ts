import { afterEach, describe, expect, it, vi } from "vitest";

import { getTaskSummary, listTasks } from "./tasks";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("task requests", () => {
  it("encode list filters as query parameters, repeating multi-value ones", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ tasks: [], total: 0 }));
    vi.stubGlobal("fetch", fetchMock);

    await listTasks("token-123", "w 1", {
      status: "open",
      priority: ["high", "medium"],
      q: "rent & bills",
      sort: "due_date",
      order: null,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/workspaces/w%201/tasks?status=open&priority=high&priority=medium&q=rent+%26+bills&sort=due_date",
      expect.anything(),
    );
  });

  it("omit the query string when there is nothing to send", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ open: 0 }));
    vi.stubGlobal("fetch", fetchMock);

    await getTaskSummary("token-123", "w1");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/workspaces/w1/tasks/summary",
      expect.anything(),
    );
  });
});
