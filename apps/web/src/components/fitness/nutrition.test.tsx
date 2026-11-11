import type { FitnessProfile, Food, Portion, SavedMeal } from "@orbit/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { chooseOption } from "@/test/controls";
import { renderSignedIn } from "@/test/session";

import { NutritionView } from "./nutrition";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => "/health",
  useSearchParams: () => new URLSearchParams(),
}));

const WS = `/api/v1/workspaces/${personal.id}/fitness`;
const TODAY = "2030-01-14";
const NUTRIENTS = { energy_cal: 200_000, protein_mg: 5_000, carbs_mg: 40_000, fat_mg: 1_000 };

const profile: FitnessProfile = {
  unit_system: "metric",
  weight_unit: "kg",
  length_unit: "cm",
  distance_unit: "km",
  energy_unit: "kcal",
  water_unit: "ml",
  height_mm: null,
  date_of_birth: null,
  targets: {
    energy_cal: null,
    protein_mg: null,
    carbs_mg: null,
    fat_mg: null,
    fiber_mg: null,
    water_ml: null,
    steps: null,
    active_s: null,
    sleep_s: null,
  },
  water_quick_amounts_ml: [250],
  hidden_sections: [],
  updated_at: "2030-01-01T00:00:00Z",
};

function food(id: string, name: string): Food {
  return {
    id,
    name,
    serving_quantity_milli: 100_000,
    serving_unit: "g",
    nutrients: NUTRIENTS,
    use_count: 1,
    last_used_at: null,
  };
}

function portion(name: string): Portion {
  return {
    food_id: null,
    name,
    quantity_milli: 150_000,
    serving_unit: "g",
    nutrients: NUTRIENTS,
  };
}

function meal(id: string, name: string, items: Portion[]): SavedMeal {
  return { id, name, items, totals: NUTRIENTS };
}

function routes({
  foods = [],
  meals = [],
  entries = [],
  extra = {},
}: {
  foods?: Food[];
  meals?: SavedMeal[];
  entries?: Portion[];
  extra?: Record<string, (request: MockRequest) => Response | Promise<Response>>;
}) {
  return {
    "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
    "GET /api/v1/me": json({ ...ada, timezone: "UTC" }),
    "GET /api/v1/me/avatar": status(204),
    "GET /api/v1/workspaces": json({ workspaces: [personal] }),
    [`GET ${WS}/profile`]: json(profile),
    [`GET ${WS}/foods`]: json({ foods }),
    [`GET ${WS}/meals`]: json({ meals }),
    [`GET ${WS}/nutrition/history`]: json({ days: [] }),
    [`GET ${WS}/nutrition`]: json({
      day: TODAY,
      entries: entries.map((p, i) => ({
        id: `e${i}`,
        day: TODAY,
        meal: "lunch",
        portion: p,
        note: "",
      })),
      totals: NUTRIENTS,
      by_meal: { lunch: NUTRIENTS },
      targets: profile.targets,
    }),
    ...extra,
  };
}

function names(list: HTMLElement) {
  return within(list)
    .getAllByRole("listitem")
    .map((item) => item.querySelector("p")?.textContent);
}

describe("NutritionView", () => {
  it("searches and sorts saved foods", async () => {
    mockApi(
      routes({
        foods: [food("f1", "Oats"), food("f2", "Banana"), food("f3", "Crème fraîche")],
      }),
    );
    const user = userEvent.setup();
    await renderSignedIn(<NutritionView workspaceId={personal.id} today={TODAY} />);

    const section = (await screen.findByRole("heading", { name: "Saved foods" })).closest(
      "section",
    );
    if (!section) throw new Error("Saved foods section missing");
    await within(section).findByText("Oats");
    const list = () => within(section).getByRole("list");
    expect(names(list())).toEqual(["Oats", "Banana", "Crème fraîche"]);

    await chooseOption(
      user,
      within(section).getByRole("combobox", { name: "Sort saved foods" }),
      "Name A–Z",
    );
    expect(names(list())).toEqual(["Banana", "Crème fraîche", "Oats"]);
    await chooseOption(
      user,
      within(section).getByRole("combobox", { name: "Sort saved foods" }),
      "Name Z–A",
    );
    expect(names(list())).toEqual(["Oats", "Crème fraîche", "Banana"]);

    await user.type(
      within(section).getByRole("searchbox", { name: "Search saved foods" }),
      "creme",
    );
    expect(names(list())).toEqual(["Crème fraîche"]);

    await user.clear(within(section).getByRole("searchbox", { name: "Search saved foods" }));
    await user.type(
      within(section).getByRole("searchbox", { name: "Search saved foods" }),
      "pizza",
    );
    expect(within(section).getByText("No saved foods match your search.")).toBeInTheDocument();
  });

  it("names a meal when saving it, and searches saved meals", async () => {
    const posts: unknown[] = [];
    mockApi(
      routes({
        entries: [portion("Rice"), portion("Dal")],
        meals: [
          meal("m1", "Rice combo", [portion("Rice")]),
          meal("m2", "Smoothie", []),
          meal("m3", "Toast", []),
          meal("m4", "Salad", []),
        ],
        extra: {
          [`POST ${WS}/meals`]: (request) => {
            posts.push(request.body);
            return Response.json(meal("m5", "Lunch plate", []), { status: 201 });
          },
        },
      }),
    );
    const user = userEvent.setup();
    await renderSignedIn(<NutritionView workspaceId={personal.id} today={TODAY} />);

    await user.click(await screen.findByRole("button", { name: "Save as meal" }));
    const dialog = await screen.findByRole("dialog", { name: "Save as meal" });
    await user.click(within(dialog).getByRole("button", { name: "Save meal" }));
    expect(await within(dialog).findByText(/Name the meal/)).toBeInTheDocument();
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Lunch plate");
    await user.click(within(dialog).getByRole("button", { name: "Save meal" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({
      name: "Lunch plate",
      items: [{ name: "Rice" }, { name: "Dal" }],
    });

    await user.type(screen.getByRole("searchbox", { name: "Search saved meals" }), "rice");
    expect(screen.getByText("Rice combo")).toBeInTheDocument();
    expect(screen.queryByText("Smoothie")).not.toBeInTheDocument();
  });

  it("renames a saved meal and keeps its foods", async () => {
    const puts: unknown[] = [];
    mockApi(
      routes({
        meals: [meal("m1", "Lunch (Jan 3)", [portion("Rice"), portion("Curd")])],
        extra: {
          [`PUT ${WS}/meals/m1`]: (request) => {
            puts.push(request.body);
            return Response.json(meal("m1", "Rice combo", []));
          },
        },
      }),
    );
    const user = userEvent.setup();
    await renderSignedIn(<NutritionView workspaceId={personal.id} today={TODAY} />);

    await user.click(await screen.findByRole("button", { name: "Log Lunch (Jan 3)" }));
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename meal" });
    const field = within(dialog).getByRole("textbox", { name: "Name" });
    expect(field).toHaveValue("Lunch (Jan 3)");
    await user.clear(field);
    await user.type(field, "Rice combo");
    await user.click(within(dialog).getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({
      name: "Rice combo",
      items: [{ name: "Rice" }, { name: "Curd" }],
    });
  });

  it("fills a new food's nutrients with an AI estimate to review before saving", async () => {
    let asked: unknown = null;
    let saved: unknown = null;
    mockApi(
      routes({
        extra: {
          "GET /api/v1/me/ai/settings": json({
            server_enabled: true,
            enabled: true,
            chat_provider_id: "p1",
            chat_model: "llama3",
            embedding_provider_id: null,
            embedding_model: null,
            fallback_provider_id: null,
            fallback_model: null,
            allow_cloud: false,
            modules: [],
            response_style: "balanced",
            monthly_token_limit: null,
            indexing_enabled: true,
          }),
          [`POST /api/v1/workspaces/${personal.id}/ai/health/food-estimate`]: (request) => {
            asked = request.body;
            return Response.json({
              food: {
                name: "Masala dosa",
                serving_quantity_milli: 1000,
                serving_unit: "piece",
                nutrients: {
                  energy_cal: 168_000,
                  protein_mg: 4_000,
                  carbs_mg: 29_000,
                  fat_mg: 3_500,
                  fiber_mg: 2_000,
                },
                note: "A medium dosa with potato filling.",
              },
              provider_name: "Local",
              model: "llama3",
              processing: "local",
            });
          },
          [`POST ${WS}/foods`]: (request) => {
            saved = request.body;
            return Response.json(food("f9", "Masala dosa"), { status: 201 });
          },
        },
      }),
    );
    const user = userEvent.setup();
    await renderSignedIn(<NutritionView workspaceId={personal.id} today={TODAY} />);

    await user.click(await screen.findByRole("button", { name: "New food" }));
    const dialog = await screen.findByRole("dialog", { name: "New food" });
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Masala dosa");
    await user.clear(within(dialog).getByRole("textbox", { name: "Serving" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Serving" }), "1");
    await user.clear(within(dialog).getByRole("textbox", { name: "Unit" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Unit" }), "piece");
    await user.click(await within(dialog).findByRole("button", { name: "Estimate with AI" }));

    expect(await within(dialog).findByRole("status")).toHaveTextContent(
      "A medium dosa with potato filling.",
    );
    expect(asked).toEqual({ description: "Masala dosa, 1 piece" });
    expect(within(dialog).getByRole("textbox", { name: "Energy (kcal)" })).toHaveValue("168");
    expect(within(dialog).getByRole("textbox", { name: "Fat (g)" })).toHaveValue("3.5");

    await user.click(within(dialog).getByRole("button", { name: "Save food" }));
    await waitFor(() =>
      expect(saved).toEqual({
        name: "Masala dosa",
        serving_quantity_milli: 1000,
        serving_unit: "piece",
        nutrients: {
          energy_cal: 168_000,
          protein_mg: 4_000,
          carbs_mg: 29_000,
          fat_mg: 3_500,
          fiber_mg: 2_000,
        },
      }),
    );
  });
});
