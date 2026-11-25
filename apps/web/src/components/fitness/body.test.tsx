import type { FitnessProfile, Measurement } from "@orbit/contracts";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { BodyView } from "./body";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
  usePathname: () => "/health",
  useSearchParams: () => new URLSearchParams(),
}));

const WS = `/api/v1/workspaces/${personal.id}/fitness`;
const TODAY = "2030-01-14";

const profile: FitnessProfile = {
  unit_system: "metric",
  weight_unit: "kg",
  length_unit: "cm",
  distance_unit: "km",
  energy_unit: "kcal",
  water_unit: "ml",
  height_mm: 1_800,
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

function entry(day: string, values: Partial<Measurement>): Measurement {
  return {
    id: day,
    day,
    weight_g: null,
    body_fat_pct: null,
    height_mm: null,
    waist_mm: null,
    chest_mm: null,
    hips_mm: null,
    arm_mm: null,
    thigh_mm: null,
    neck_mm: null,
    note: "",
    updated_at: `${day}T00:00:00Z`,
    ...values,
  };
}

function routes(measurements: Measurement[]) {
  return {
    "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
    "GET /api/v1/me": json({ ...ada, timezone: "UTC" }),
    "GET /api/v1/me/avatar": status(204),
    "GET /api/v1/workspaces": json({ workspaces: [personal] }),
    [`GET ${WS}/profile`]: json(profile),
    [`GET ${WS}/measurements`]: json({
      measurements,
      bmi:
        measurements.length > 0
          ? { value: 24.2, weight_g: 78_500, height_mm: 1_800, weight_day: "2030-01-12" }
          : null,
    }),
    [`GET ${WS}/photos`]: json({ photos: [] }),
  };
}

describe("BodyView", () => {
  it("shows the latest weight, its changes, and the latest of each measurement", async () => {
    mockApi(
      routes([
        entry("2030-01-01", { weight_g: 80_000, waist_mm: 860 }),
        entry("2030-01-08", { weight_g: 79_000, body_fat_pct: 18.5 }),
        entry("2030-01-12", { weight_g: 78_500, waist_mm: 850, note: "After a run" }),
      ]),
    );
    await renderSignedIn(<BodyView workspaceId={personal.id} today={TODAY} />);

    const weight = await screen.findByRole("region", { name: "Weight" });
    expect(within(weight).getByText("78.5 kg", { selector: "p" })).toBeInTheDocument();
    expect(within(weight).getByText("−0.5 kg")).toBeInTheDocument();
    expect(within(weight).getByText("−1.5 kg")).toBeInTheDocument();

    // The Body fat tile and the history chip.
    expect(screen.getAllByText("18.5%")).toHaveLength(2);
    expect(screen.getByText("24.2")).toBeInTheDocument();

    const measurements = screen.getByRole("region", { name: "Measurements" });
    expect(within(measurements).getByText("Waist")).toBeInTheDocument();
    expect(within(measurements).getByText("85 cm")).toBeInTheDocument();
    expect(within(measurements).getByText("−1 cm")).toBeInTheDocument();
    expect(within(measurements).queryByText("Chest")).not.toBeInTheDocument();

    const history = screen.getByRole("region", { name: "History" });
    expect(within(history).getByText("3 entries")).toBeInTheDocument();
    expect(within(history).getByText("After a run")).toBeInTheDocument();
  });

  it("shows the newest entries first and the rest on demand", async () => {
    const list = Array.from({ length: 10 }, (_, i) =>
      entry(`2030-01-${String(i + 1).padStart(2, "0")}`, { weight_g: 80_000 - i * 100 }),
    );
    mockApi(routes(list));
    const user = userEvent.setup();
    await renderSignedIn(<BodyView workspaceId={personal.id} today={TODAY} />);

    const history = await screen.findByRole("region", { name: "History" });
    const rows = () =>
      within(history)
        .getAllByRole("button", { name: /^Actions for/ })
        .map((button) => button.getAttribute("aria-label"));
    expect(rows()).toHaveLength(8);
    await user.click(within(history).getByRole("button", { name: "Show all 10" }));
    expect(rows()).toHaveLength(10);
  });

  it("explains how to start when nothing is recorded", async () => {
    mockApi(routes([]));
    await renderSignedIn(<BodyView workspaceId={personal.id} today={TODAY} />);
    expect(await screen.findByText("No measurements yet")).toBeInTheDocument();
  });
});
