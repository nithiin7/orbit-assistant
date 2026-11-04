import type { Exercise } from "@orbit/contracts";
import { describe, expect, it } from "vitest";

import {
  builtinsByKey,
  describeStarterExercise,
  STARTER_TEMPLATES,
  starterTemplateRequest,
} from "./starter-templates";

function exercise(key: string | null, overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: `id-${key ?? "custom"}`,
    name: key ?? "Custom",
    category: "strength",
    exercise_type: "weight_reps",
    equipment: "dumbbell",
    description: "",
    instructions: "",
    primary_muscles: [],
    secondary_muscles: [],
    is_custom: key === null,
    builtin_key: key,
    archived: false,
    updated_at: "2030-01-01T00:00:00Z",
    ...overrides,
  };
}

function starter(id: string) {
  const template = STARTER_TEMPLATES.find((t) => t.id === id);
  if (!template) throw new Error(`No starter template ${id}`);
  return template;
}

const fullBody = starter("full-body");

describe("starter templates", () => {
  it("have unique ids and names", () => {
    expect(new Set(STARTER_TEMPLATES.map((t) => t.id)).size).toBe(STARTER_TEMPLATES.length);
    expect(new Set(STARTER_TEMPLATES.map((t) => t.name)).size).toBe(STARTER_TEMPLATES.length);
  });

  it("describe sets as reps or time", () => {
    expect(describeStarterExercise({ key: "x", sets: 3, reps: [8, 12] })).toBe("3 × 8–12");
    expect(describeStarterExercise({ key: "x", sets: 3, reps: 5 })).toBe("3 × 5");
    expect(describeStarterExercise({ key: "x", sets: 3, seconds: 45 })).toBe("3 × 45s");
    expect(describeStarterExercise({ key: "x", sets: 1, seconds: 600 })).toBe("1 × 10 min");
  });

  it("build a template from the person's built-in exercises", () => {
    const library = builtinsByKey(fullBody.exercises.map((item) => exercise(item.key)));
    const request = starterTemplateRequest(fullBody, library);
    expect(request?.name).toBe("Full body");
    expect(request?.category).toBe("full_body");
    expect(request?.exercises?.[0]).toMatchObject({
      exercise_id: "id-goblet_squat",
      sets: 3,
      target_reps_min: 8,
      target_reps_max: 12,
      target_duration_s: null,
      rest_seconds: 90,
    });
    expect(request?.exercises?.at(-1)).toMatchObject({
      exercise_id: "id-plank",
      target_reps_min: null,
      target_duration_s: 30,
    });
  });

  it("skip archived and custom exercises", () => {
    const library = builtinsByKey([
      exercise("goblet_squat", { archived: true }),
      exercise("plank"),
      exercise(null),
    ]);
    const request = starterTemplateRequest(fullBody, library);
    expect(request?.exercises?.map((e) => e.exercise_id)).toEqual(["id-plank"]);
    expect(starterTemplateRequest(fullBody, builtinsByKey([]))).toBeNull();
  });
});
