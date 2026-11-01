import { afterEach, describe, expect, it, vi } from "vitest";

import { json, mockApi } from "@/test/api-mock";

import { getHabitToday, logHabit, setSessionStep } from "./requests";

const WS = "/api/v1/workspaces/w1";

afterEach(() => vi.unstubAllGlobals());

describe("habit requests", () => {
  it("ask for today in the viewer's time zone", async () => {
    const fetchMock = mockApi({
      [`GET ${WS}/habits/today`]: json({ day: "2030-01-14", habits: [], week: [], upcoming: [] }),
    });
    await getHabitToday("token", "w1", { timezone: "Asia/Kolkata" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("timezone=Asia%2FKolkata");
  });

  it("log a day by its date and send the status", async () => {
    const fetchMock = mockApi({
      [`PUT ${WS}/habits/h1/log/2030-01-14`]: json({ state: "partial" }),
    });
    await logHabit("token", "w1", { id: "h1" }, "2030-01-14", {
      status: "progress",
      value: 2,
      note: "",
    });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toEqual({ status: "progress", value: 2, note: "" });
  });

  it("address a session step under its routine", async () => {
    const fetchMock = mockApi({
      [`PATCH ${WS}/routines/r1/sessions/s1/steps/t1`]: json({ id: "s1" }),
    });
    await setSessionStep("token", "w1", "r1", "s1", "t1", "skipped");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ status: "skipped" });
  });
});
