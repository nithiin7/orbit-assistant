import type { AiWorkoutSuggestion } from "@orbit/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { METRIC_UNITS } from "@/lib/fitness";
import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { WorkoutSuggestionDialog } from "./workout-suggestion";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => "/health",
  useSearchParams: () => new URLSearchParams(),
}));

const WS = `/api/v1/workspaces/${personal.id}`;

const suggestion: AiWorkoutSuggestion = {
  name: "Upper body",
  category: "upper",
  description: "Chest and back.",
  notes: "Legs were trained recently.",
  exercises: [
    {
      exercise_id: "e1",
      exercise_name: "Bench press",
      sets: 3,
      target_reps_min: 8,
      target_reps_max: 12,
      target_duration_s: null,
      target_distance_m: null,
      rest_seconds: 90,
      notes: "Control the lowering.",
    },
  ],
  provider_name: "Local",
  model: "llama3",
  processing: "local",
};

afterEach(() => vi.unstubAllGlobals());

describe("WorkoutSuggestionDialog", () => {
  it("suggests a workout, then saves it as a template", async () => {
    let asked: unknown = null;
    let saved: unknown = null;
    mockApi({
      "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
      "GET /api/v1/me": json({ ...ada, timezone: "UTC" }),
      "GET /api/v1/me/avatar": status(204),
      "GET /api/v1/workspaces": json({ workspaces: [personal] }),
      [`POST ${WS}/ai/health/workout-suggestion`]: (request: MockRequest) => {
        asked = request.body;
        return Response.json(suggestion);
      },
      [`POST ${WS}/fitness/templates`]: (request: MockRequest) => {
        saved = request.body;
        return Response.json({ id: "t1" }, { status: 201 });
      },
    });
    const onClose = vi.fn();
    const user = userEvent.setup();
    await renderSignedIn(
      <WorkoutSuggestionDialog workspaceId={personal.id} units={METRIC_UNITS} onClose={onClose} />,
    );

    await user.type(
      await screen.findByRole("textbox", { name: "What would you like?" }),
      "upper body",
    );
    await user.click(screen.getByRole("button", { name: "Suggest" }));

    const draft = await screen.findByRole("region", { name: "Suggested workout" });
    expect(draft).toHaveTextContent("Bench press · 3 × 8–12 · rest 90 s");
    expect(draft).toHaveTextContent("Legs were trained recently.");
    expect(asked).toEqual({ focus: "upper body", timezone: "UTC" });

    await user.click(screen.getByRole("button", { name: "Save as template" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(saved).toEqual({
      name: "Upper body",
      category: "upper",
      description: "Chest and back.",
      notes: "Legs were trained recently.",
      exercises: [
        {
          exercise_id: "e1",
          sets: 3,
          target_reps_min: 8,
          target_reps_max: 12,
          target_weight_g: null,
          target_duration_s: null,
          target_distance_m: null,
          rest_seconds: 90,
          notes: "Control the lowering.",
        },
      ],
    });
  });

  it("shows why a suggestion failed", async () => {
    mockApi({
      "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
      "GET /api/v1/me": json({ ...ada, timezone: "UTC" }),
      "GET /api/v1/me/avatar": status(204),
      "GET /api/v1/workspaces": json({ workspaces: [personal] }),
      [`POST ${WS}/ai/health/workout-suggestion`]: status(
        422,
        "Add some exercises to your library first.",
      ),
    });
    const user = userEvent.setup();
    await renderSignedIn(
      <WorkoutSuggestionDialog workspaceId={personal.id} units={METRIC_UNITS} onClose={vi.fn()} />,
    );
    await user.click(await screen.findByRole("button", { name: "Suggest" }));
    expect(
      await screen.findByText("Add some exercises to your library first."),
    ).toBeInTheDocument();
  });
});
