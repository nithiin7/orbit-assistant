import type {
  Exercise,
  FitnessOverview,
  FitnessProfile,
  Workout,
  WorkoutExercise,
  WorkoutSet,
  WorkoutTemplate,
} from "@orbit/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { STARTER_TEMPLATES } from "@/lib/fitness";
import { ada, json, mockApi, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { EventWorkout } from "./event-workout";
import { HealthPanel } from "./health-view";

const navigation = vi.hoisted(() => ({ params: new URLSearchParams(), push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: navigation.push, back: vi.fn() }),
  usePathname: () => "/health",
  useSearchParams: () => navigation.params,
}));

const WS = `/api/v1/workspaces/${personal.id}/fitness`;

function profile(overrides: Partial<FitnessProfile> = {}): FitnessProfile {
  return {
    unit_system: "metric",
    weight_unit: "kg",
    length_unit: "cm",
    distance_unit: "km",
    energy_unit: "kcal",
    water_unit: "ml",
    height_mm: null,
    date_of_birth: null,
    targets: {
      energy_cal: 2_000_000,
      protein_mg: null,
      carbs_mg: null,
      fat_mg: null,
      fiber_mg: null,
      water_ml: 2000,
    },
    water_quick_amounts_ml: [250, 500],
    hidden_sections: [],
    updated_at: "2030-01-01T00:00:00Z",
    ...overrides,
  };
}

function set(overrides: Partial<WorkoutSet> = {}): WorkoutSet {
  return {
    id: "set-1",
    position: 0,
    set_type: "working",
    reps: null,
    weight_g: null,
    duration_s: null,
    distance_m: null,
    rpe: null,
    completed: false,
    completed_at: null,
    ...overrides,
  };
}

function exercise(overrides: Partial<WorkoutExercise> = {}): WorkoutExercise {
  return {
    id: "item-1",
    exercise_id: "bench",
    position: 0,
    name: "Bench press",
    exercise_type: "weight_reps",
    category: "strength",
    primary_muscles: ["chest"],
    rest_seconds: 120,
    notes: "",
    volume_g: 0,
    sets: [set()],
    previous: {
      session_id: "old",
      day: "2030-01-10",
      sets: [set({ id: "old-set", reps: 5, weight_g: 100_000, completed: true })],
    },
    ...overrides,
  };
}

function workout(overrides: Partial<Workout> = {}): Workout {
  return {
    id: "w1",
    name: "Push day",
    day: "2030-01-14",
    timezone: "UTC",
    status: "active",
    started_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    ended_at: null,
    paused_at: null,
    paused_seconds: 0,
    duration_s: null,
    notes: "",
    template_id: null,
    template_name: null,
    calendar_event_id: null,
    volume_g: 0,
    exercises: [exercise()],
    links: [],
    ...overrides,
  };
}

function overview(overrides: Partial<FitnessOverview> = {}): FitnessOverview {
  return {
    day: "2030-01-14",
    active_session: null,
    completed_today: [],
    scheduled_today: [],
    recent_sessions: [],
    week_workouts: 2,
    weight_trend: [
      { day: "2030-01-01", weight_g: 82_000 },
      { day: "2030-01-14", weight_g: 80_500 },
    ],
    goals: [],
    nutrition: {
      energy_cal: 1_200_000,
      protein_mg: 80_000,
      carbs_mg: 0,
      fat_mg: 0,
      fiber_mg: null,
    },
    targets: profile().targets,
    water_ml: 750,
    recent_activities: [],
    records: [],
    hidden_sections: [],
    ...overrides,
  };
}

function session(units: Partial<FitnessProfile> = {}) {
  return {
    "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
    "GET /api/v1/me": json({ ...ada, timezone: "UTC" }),
    "GET /api/v1/me/avatar": status(204),
    "GET /api/v1/workspaces": json({ workspaces: [personal] }),
    [`GET ${WS}/profile`]: json(profile(units)),
    [`GET ${WS}/templates`]: json({ templates: [] }),
    [`GET ${WS}/exercises`]: json({ exercises: [] }),
    [`GET ${WS}/sessions/active`]: json({ session: null }),
  };
}

function builtin(key: string): Exercise {
  return {
    id: `ex-${key}`,
    name: key,
    category: "strength",
    exercise_type: "weight_reps",
    equipment: "dumbbell",
    description: "",
    instructions: "",
    primary_muscles: [],
    secondary_muscles: [],
    is_custom: false,
    builtin_key: key,
    archived: false,
    updated_at: "2030-01-01T00:00:00Z",
  };
}

function template(overrides: Partial<WorkoutTemplate> = {}): WorkoutTemplate {
  return {
    id: "t1",
    name: "Push day",
    category: "push",
    description: "",
    notes: "",
    archived: false,
    exercises: [],
    updated_at: "2030-01-01T00:00:00Z",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  navigation.params = new URLSearchParams();
  navigation.push.mockReset();
});

describe("HealthPanel: overview", () => {
  it("shows the day's summaries in the person's units", async () => {
    mockApi({ ...session(), [`GET ${WS}/overview`]: json(overview()) });
    await renderSignedIn(<HealthPanel />);
    expect((await screen.findAllByText("80.5 kg")).length).toBeGreaterThan(0);
    expect(screen.getByText(/2 workouts so far this week/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Energy" })).toHaveAttribute(
      "aria-valuenow",
      "60",
    );
    expect(screen.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");
  });

  it("leaves out the sections the person hid", async () => {
    mockApi({
      ...session(),
      [`GET ${WS}/overview`]: json(overview({ hidden_sections: ["weight", "nutrition"] })),
    });
    await renderSignedIn(<HealthPanel />);
    expect(await screen.findByRole("heading", { name: "Water today" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Weight" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Food today" })).not.toBeInTheDocument();
  });

  it("adds water in one tap", async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...session(),
      [`GET ${WS}/overview`]: json(overview()),
      [`POST ${WS}/water`]: json({
        day: "2030-01-14",
        entries: [],
        total_ml: 1000,
        target_ml: 2000,
      }),
    });
    await renderSignedIn(<HealthPanel />);
    await user.click(await screen.findByRole("button", { name: "+250 ml" }));
    await waitFor(() => {
      const call = api.mock.calls.find(([, init]) => init?.method === "POST");
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ amount_ml: 250 });
    });
  });
});

describe("HealthPanel: getting started", () => {
  it("guides someone who hasn't trained yet", async () => {
    mockApi({ ...session(), [`GET ${WS}/overview`]: json(overview({ week_workouts: 0 })) });
    await renderSignedIn(<HealthPanel />);
    expect(
      await screen.findByRole("heading", { name: "New here? Start with these" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Pick a starter template/ })).toHaveAttribute(
      "href",
      "/health?view=templates",
    );
  });

  it("stays out of the way once there are workouts", async () => {
    mockApi({ ...session(), [`GET ${WS}/overview`]: json(overview()) });
    await renderSignedIn(<HealthPanel />);
    expect(await screen.findByText(/2 workouts so far this week/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /New here/ })).not.toBeInTheDocument();
  });
});

describe("HealthPanel: workouts", () => {
  it("starts a template from its card", async () => {
    navigation.params = new URLSearchParams("view=workouts");
    const user = userEvent.setup();
    const api = mockApi({
      ...session(),
      [`GET ${WS}/templates`]: json({ templates: [template()] }),
      [`GET ${WS}/sessions`]: json({ sessions: [] }),
      [`POST ${WS}/sessions`]: json(workout({ id: "w9", template_id: "t1" })),
    });
    await renderSignedIn(<HealthPanel />);
    expect(screen.queryByRole("link", { name: /Browse starter templates/ })).toBeNull();
    await user.click(await screen.findByRole("button", { name: "Start Push day" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/health?workout=w9"));
    const call = api.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ template_id: "t1" });
  });

  it("points to the starter templates when there are none", async () => {
    navigation.params = new URLSearchParams("view=workouts");
    mockApi({ ...session(), [`GET ${WS}/sessions`]: json({ sessions: [] }) });
    await renderSignedIn(<HealthPanel />);
    expect(await screen.findByRole("link", { name: /Browse starter templates/ })).toHaveAttribute(
      "href",
      "/health?view=templates",
    );
    expect(screen.getByRole("button", { name: /Empty workout/ })).toBeInTheDocument();
    expect(screen.getByText("No workouts yet")).toBeInTheDocument();
  });
});

describe("HealthPanel: starter templates", () => {
  it("adds a starter as the person's own template", async () => {
    navigation.params = new URLSearchParams("view=templates");
    const user = userEvent.setup();
    const starter = STARTER_TEMPLATES.find((t) => t.id === "full-body");
    const saved: WorkoutTemplate[] = [];
    const api = mockApi({
      ...session(),
      [`GET ${WS}/templates`]: (request) => json({ templates: saved })(request),
      [`GET ${WS}/exercises`]: json({
        exercises: starter?.exercises.map((item) => builtin(item.key)) ?? [],
      }),
      [`POST ${WS}/templates`]: (request) => {
        saved.push(template({ id: "t2", name: "Full body", category: "full_body" }));
        return json(saved[0])(request);
      },
    });
    await renderSignedIn(<HealthPanel />);
    const add = await screen.findByRole("button", { name: "Add Full body to my templates" });
    await waitFor(() => expect(add).toBeEnabled());
    await user.click(add);
    await waitFor(() => {
      const call = api.mock.calls.find(([, init]) => init?.method === "POST");
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
        name: "Full body",
        category: "full_body",
        exercises: expect.arrayContaining([
          expect.objectContaining({ exercise_id: "ex-goblet_squat", sets: 3 }),
        ]) as unknown,
      });
    });
    expect(await screen.findByText("In your templates")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Full body" })).toBeInTheDocument();
  });
});

describe("HealthPanel: logging a workout", () => {
  it("shows the last performance and saves a set in canonical units", async () => {
    const user = userEvent.setup();
    navigation.params = new URLSearchParams("workout=w1");
    let current = workout();
    const api = mockApi({
      ...session({ weight_unit: "lb" }),
      [`GET ${WS}/sessions/w1`]: () => Response.json(current),
      [`PUT ${WS}/sessions/w1/exercises/item-1/sets/set-1`]: (request) => {
        const { body } = request;
        const done =
          typeof body === "object" &&
          body !== null &&
          "completed" in body &&
          body.completed === true;
        const saved = set({
          reps: 5,
          weight_g: 102_058,
          completed: done,
          completed_at: done ? new Date().toISOString() : null,
        });
        current = workout({ exercises: [exercise({ sets: [saved] })] });
        return Response.json(current);
      },
    });
    await renderSignedIn(<HealthPanel />);
    const card = await screen.findByRole("article", { name: "Bench press" });
    expect(within(card).getByText(/Last time .*220\.5 lb × 5/)).toBeInTheDocument();

    await user.type(within(card).getByRole("textbox", { name: "Set 1 lb" }), "225");
    await user.type(within(card).getByRole("textbox", { name: "Set 1 reps" }), "5");
    await user.click(within(card).getByRole("button", { name: "Set 1 done" }));

    await waitFor(() => {
      const saves = api.mock.calls.filter(([, init]) => init?.method === "PUT");
      // Each field saves when it loses focus; the check saves the finished set.
      expect(JSON.parse(String(saves.at(-1)?.[1]?.body))).toEqual({
        set_type: "working",
        reps: 5,
        weight_g: 102_058,
        duration_s: null,
        distance_m: null,
        rpe: null,
        completed: true,
      });
    });
    expect(await screen.findByRole("timer")).toHaveTextContent("Rest after Bench press");
  });

  it("finishes a workout", async () => {
    const user = userEvent.setup();
    navigation.params = new URLSearchParams("workout=w1");
    let current = workout();
    const api = mockApi({
      ...session(),
      [`GET ${WS}/sessions/w1`]: () => Response.json(current),
      [`POST ${WS}/sessions/w1/complete`]: () => {
        current = workout({
          status: "completed",
          ended_at: new Date().toISOString(),
          duration_s: 600,
        });
        return Response.json(current);
      },
    });
    await renderSignedIn(<HealthPanel />);
    await user.click(await screen.findByRole("button", { name: "Finish" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Finish without any sets done?");
    await user.click(within(dialog).getByRole("button", { name: "Finish workout" }));
    await waitFor(() =>
      expect(api.mock.calls.some(([url]) => String(url).endsWith("/sessions/w1/complete"))).toBe(
        true,
      ),
    );
    expect(await screen.findByText(/· Completed/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish" })).not.toBeInTheDocument();
    expect(screen.getByText("10:00")).toBeInTheDocument();
  });

  it("ticks a blank set with last time's values, and the rest timer can be skipped", async () => {
    const user = userEvent.setup();
    navigation.params = new URLSearchParams("workout=w1");
    let current = workout();
    const api = mockApi({
      ...session(),
      [`GET ${WS}/sessions/w1`]: () => Response.json(current),
      [`PUT ${WS}/sessions/w1/exercises/item-1/sets/set-1`]: () => {
        const saved = set({
          reps: 5,
          weight_g: 100_000,
          completed: true,
          completed_at: new Date().toISOString(),
        });
        current = workout({ exercises: [exercise({ sets: [saved] })] });
        return Response.json(current);
      },
    });
    await renderSignedIn(<HealthPanel />);
    const card = await screen.findByRole("article", { name: "Bench press" });
    expect(within(card).getByRole("textbox", { name: "Set 1 kg" })).toHaveAttribute(
      "placeholder",
      "100",
    );

    await user.click(within(card).getByRole("button", { name: "Set 1 done" }));
    await waitFor(() => {
      const saves = api.mock.calls.filter(([, init]) => init?.method === "PUT");
      expect(JSON.parse(String(saves.at(-1)?.[1]?.body))).toMatchObject({
        reps: 5,
        weight_g: 100_000,
        completed: true,
      });
    });
    expect(await screen.findByRole("timer")).toHaveTextContent("Rest after Bench press");
    await user.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  });

  it("adds several exercises at once, in the order picked", async () => {
    const user = userEvent.setup();
    navigation.params = new URLSearchParams("workout=w1");
    const added: string[] = [];
    const library = [
      { ...builtin("goblet_squat"), id: "squat", name: "Squat" },
      { ...builtin("goblet_squat"), id: "row", name: "Row" },
    ];
    mockApi({
      ...session(),
      [`GET ${WS}/exercises`]: json({ exercises: library }),
      [`GET ${WS}/sessions/w1`]: () => Response.json(workout({ exercises: [] })),
      [`POST ${WS}/sessions/w1/exercises`]: (request) => {
        const { body } = request;
        if (typeof body === "object" && body !== null && "exercise_id" in body) {
          added.push(String(body.exercise_id));
        }
        return Response.json(workout({ exercises: [] }));
      },
    });
    await renderSignedIn(<HealthPanel />);
    await user.click(await screen.findByRole("button", { name: "Add exercises" }));
    const dialog = await screen.findByRole("dialog", { name: "Add exercises" });
    await user.click(within(dialog).getByRole("button", { name: /Row/ }));
    await user.click(within(dialog).getByRole("button", { name: /Squat/ }));
    await user.click(within(dialog).getByRole("button", { name: "Add 2 exercises" }));
    await waitFor(() => expect(added).toEqual(["row", "squat"]));
  });

  it("explains when a workout can't be loaded", async () => {
    navigation.params = new URLSearchParams("workout=missing");
    mockApi({ ...session(), [`GET ${WS}/sessions/missing`]: status(404, "Workout not found.") });
    await renderSignedIn(<HealthPanel />);
    expect(await screen.findByText("Workout not found.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("HealthPanel: water", () => {
  it("adds a custom amount in the person's unit", async () => {
    const user = userEvent.setup();
    navigation.params = new URLSearchParams("view=water");
    const api = mockApi({
      ...session({ water_unit: "l" }),
      [`GET ${WS}/water`]: json({ day: "2030-01-14", entries: [], total_ml: 0, target_ml: 2000 }),
      [`GET ${WS}/water/history`]: json({ days: [] }),
      [`POST ${WS}/water`]: json({
        day: "2030-01-14",
        entries: [],
        total_ml: 500,
        target_ml: 2000,
      }),
    });
    await renderSignedIn(<HealthPanel />);
    await user.type(await screen.findByRole("textbox", { name: "Another amount" }), "0.5");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => {
      const call = api.mock.calls.find(([, init]) => init?.method === "POST");
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ amount_ml: 500 });
    });
  });
});

describe("EventWorkout", () => {
  it("offers to mark an ordinary event as a workout", async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...session(),
      [`GET ${WS}/schedule/ev1`]: status(404, "Scheduled workout not found."),
      [`PUT ${WS}/schedule/ev1`]: json({
        calendar_event_id: "ev1",
        title: "Gym",
        template_id: null,
        template_name: null,
        start_at: null,
        end_at: null,
        session_ids: [],
      }),
    });
    await renderSignedIn(<EventWorkout workspaceId={personal.id} eventId="ev1" timeZone="UTC" />);
    await user.click(await screen.findByRole("button", { name: "Mark as a workout" }));
    await waitFor(() =>
      expect(api.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true),
    );
  });

  it("starts the scheduled workout from the event", async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...session(),
      [`GET ${WS}/schedule/ev1`]: json({
        calendar_event_id: "ev1",
        title: "Push day",
        template_id: "t1",
        template_name: "Push day",
        start_at: "2030-01-14T18:00:00Z",
        end_at: "2030-01-14T19:00:00Z",
        session_ids: [],
      }),
      [`POST ${WS}/sessions`]: json(workout({ id: "w9", calendar_event_id: "ev1" })),
    });
    await renderSignedIn(<EventWorkout workspaceId={personal.id} eventId="ev1" timeZone="UTC" />);
    expect(await screen.findByText("From the Push day template.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start workout" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/health?workout=w9"));
    const call = api.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      template_id: "t1",
      calendar_event_id: "ev1",
    });
  });
});
