import { afterEach, describe, expect, it, vi } from "vitest";

import { json, mockApi, status } from "@/test/api-mock";

import {
  addWorkoutSet,
  getScheduledWorkout,
  saveGoal,
  updateWorkoutSet,
  uploadPhoto,
} from "./requests";

const WS = "/api/v1/workspaces/w1/fitness";

afterEach(() => vi.unstubAllGlobals());

describe("fitness requests", () => {
  it("address a set under its workout and exercise", async () => {
    const fetchMock = mockApi({
      [`PUT ${WS}/sessions/s1/exercises/e1/sets/t1`]: json({ id: "s1" }),
    });
    const values = {
      set_type: "working" as const,
      reps: 5,
      weight_g: 100_000,
      duration_s: null,
      distance_m: null,
      rpe: null,
      completed: true,
    };
    await updateWorkoutSet("token", "w1", "s1", "e1", "t1", values);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual(values);
  });

  it("ask the API to copy the last set when no values are given", async () => {
    const fetchMock = mockApi({ [`POST ${WS}/sessions/s1/exercises/e1/sets`]: json({ id: "s1" }) });
    await addWorkoutSet("token", "w1", "s1", "e1", null);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ values: null });
  });

  it("upload a photo as the raw body, with its date and name in the query", async () => {
    const fetchMock = mockApi({ [`POST ${WS}/photos`]: json({ id: "p1" }) });
    const file = new File(["png"], "front view.png", { type: "image/png" });
    await uploadPhoto("token", "w1", file, "2030-01-14", "Front");
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain("filename=front+view.png");
    expect(String(url)).toContain("day=2030-01-14");
    expect(init?.body).toBe(file);
  });

  it("send today with goal changes, for pace", async () => {
    const fetchMock = mockApi({ [`PUT ${WS}/goals/g1`]: json({ id: "g1" }) });
    await saveGoal(
      "token",
      "w1",
      "g1",
      {
        name: "Run",
        category: "custom",
        unit: "km",
        start_value: 1,
        target_value: 5,
        start_date: "2030-01-01",
        description: "",
        target_date: null,
        auto_track: false,
        exercise_id: null,
        habit_id: null,
      },
      "2030-01-14",
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("date=2030-01-14");
  });

  it("treat an event that isn't a workout as none", async () => {
    mockApi({ [`GET ${WS}/schedule/ev1`]: status(404, "Scheduled workout not found.") });
    await expect(getScheduledWorkout("token", "w1", "ev1")).resolves.toBeNull();
  });
});
