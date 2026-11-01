import { afterEach, describe, expect, it, vi } from "vitest";

import { json, mockApi, status } from "@/test/api-mock";

import { deleteOccurrence, getCalendarRange, updateOccurrence } from "./requests";

const WS = "/api/v1/workspaces/w1/calendar";

afterEach(() => vi.unstubAllGlobals());

describe("calendar requests", () => {
  it("ask for a range with the viewer's time zone", async () => {
    const fetchMock = mockApi({
      [`GET ${WS}/range`]: json({ occurrences: [], scheduled_tasks: [], due_tasks: [] }),
    });
    await getCalendarRange("token", "w1", {
      start: "2030-01-14",
      end: "2030-01-21",
      timezone: "Europe/Paris",
    });
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("start=2030-01-14");
    expect(url).toContain("timezone=Europe%2FParis");
  });

  it("address an occurrence by its original start, with a scope", async () => {
    const fetchMock = mockApi({
      [`PATCH ${WS}/events/e1/occurrences/2030-01-14T09%3A00`]: json({ id: "e1" }),
      [`DELETE ${WS}/events/e1/occurrences/2030-01-14T09%3A00`]: status(204),
    });
    await updateOccurrence("token", "w1", "e1", "2030-01-14T09:00", { scope: "this", title: "X" });
    await deleteOccurrence("token", "w1", "e1", "2030-01-14T09:00", "following");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("scope=following");
  });
});
