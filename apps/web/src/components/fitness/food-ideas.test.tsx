import type { AiSettings } from "@orbit/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { METRIC_UNITS } from "@/lib/fitness";
import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { FoodIdeasDialog } from "./food-ideas";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => "/health",
  useSearchParams: () => new URLSearchParams(),
}));

const WS = `/api/v1/workspaces/${personal.id}`;

const aiSettings: AiSettings = {
  server_enabled: true,
  enabled: true,
  chat_provider_id: "p1",
  chat_model: "llama3",
  embedding_provider_id: null,
  embedding_model: null,
  fallback_provider_id: null,
  fallback_model: null,
  allow_cloud: false,
  modules: ["notes"],
  response_style: "balanced",
  monthly_token_limit: null,
  indexing_enabled: true,
};

function session(ai: AiSettings, saved: unknown[], extra: Record<string, unknown> = {}) {
  return {
    "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
    "GET /api/v1/me": json({ ...ada, timezone: "UTC" }),
    "GET /api/v1/me/avatar": status(204),
    "GET /api/v1/workspaces": json({ workspaces: [personal] }),
    "GET /api/v1/me/ai/settings": json(ai),
    [`POST ${WS}/fitness/foods`]: (request: MockRequest) => {
      saved.push(request.body);
      return Response.json({ id: `f${saved.length}` }, { status: 201 });
    },
    ...extra,
  } as Parameters<typeof mockApi>[0];
}

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("FoodIdeasDialog", () => {
  it("adds ticked foods from a pack and marks ones already saved", async () => {
    const saved: unknown[] = [];
    mockApi(session({ ...aiSettings, enabled: false }, saved));
    const onClose = vi.fn();
    const user = userEvent.setup();
    await renderSignedIn(
      <FoodIdeasDialog
        workspaceId={personal.id}
        units={METRIC_UNITS}
        savedNames={new Set(["chapati"])}
        onClose={onClose}
      />,
    );

    const chapati = await screen.findByRole("checkbox", { name: /^Chapati/ });
    expect(chapati).toBeDisabled();
    expect(chapati).toBeChecked();
    // AI is off, so only the packs are offered.
    expect(screen.queryByRole("button", { name: "Suggest" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /^Idli/ }));
    await user.click(screen.getByRole("checkbox", { name: /^Paneer/ }));
    await user.click(screen.getByRole("button", { name: "Add 2 foods" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(saved).toEqual([
      expect.objectContaining({ name: "Idli", serving_unit: "piece" }),
      expect.objectContaining({
        name: "Paneer",
        serving_quantity_milli: 100_000,
        nutrients: expect.objectContaining({ energy_cal: 265_000 }) as unknown,
      }),
    ]);
  });

  it("asks AI for foods of a typed region and saves them without the note", async () => {
    const saved: unknown[] = [];
    let asked: unknown = null;
    mockApi(
      session(aiSettings, saved, {
        [`POST ${WS}/ai/health/food-ideas`]: (request: MockRequest) => {
          asked = request.body;
          return Response.json({
            cuisine: "Kerala",
            foods: [
              {
                name: "Appam",
                serving_quantity_milli: 1000,
                serving_unit: "piece",
                nutrients: {
                  energy_cal: 120_000,
                  protein_mg: 2_000,
                  carbs_mg: 24_000,
                  fat_mg: 1_500,
                  fiber_mg: null,
                },
                note: "Rice and coconut pancake.",
              },
            ],
            provider_name: "Local",
            model: "llama3",
            processing: "local",
          });
        },
      }),
    );
    const onClose = vi.fn();
    const user = userEvent.setup();
    await renderSignedIn(
      <FoodIdeasDialog
        workspaceId={personal.id}
        units={METRIC_UNITS}
        savedNames={new Set()}
        onClose={onClose}
      />,
    );

    await user.type(
      await screen.findByRole("textbox", { name: "Or ask AI about any region or cuisine" }),
      "Kerala{Enter}",
    );
    expect(await screen.findByText("Rice and coconut pancake.")).toBeInTheDocument();
    expect(asked).toEqual({ cuisine: "Kerala" });
    expect(screen.getByRole("status")).toHaveTextContent("AI estimates for Kerala");
    expect(screen.queryByRole("checkbox", { name: /^Idli/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /^Appam/ }));
    await user.click(screen.getByRole("button", { name: "Add 1 food" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(saved).toEqual([
      {
        name: "Appam",
        serving_quantity_milli: 1000,
        serving_unit: "piece",
        nutrients: {
          energy_cal: 120_000,
          protein_mg: 2_000,
          carbs_mg: 24_000,
          fat_mg: 1_500,
          fiber_mg: null,
        },
      },
    ]);
  });
});
