import type { Activity, FitnessProfile } from "@orbit/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { ActivityView } from "./activity";

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
  height_mm: null,
  date_of_birth: null,
  targets: {
    energy_cal: null,
    protein_mg: null,
    carbs_mg: null,
    fat_mg: null,
    fiber_mg: null,
    water_ml: null,
    steps: 8000,
    active_s: null,
    sleep_s: null,
  },
  water_quick_amounts_ml: [250],
  hidden_sections: [],
  updated_at: "2030-01-01T00:00:00Z",
};

function activity(overrides: Partial<Activity>): Activity {
  return {
    id: "a1",
    day: TODAY,
    kind: "steps",
    steps: null,
    distance_m: null,
    duration_s: null,
    note: "",
    source: "manual",
    ...overrides,
  };
}

function routes(activities: Activity[]) {
  return {
    "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
    "GET /api/v1/me": json({ ...ada, timezone: "UTC" }),
    "GET /api/v1/me/avatar": status(204),
    "GET /api/v1/workspaces": json({ workspaces: [personal] }),
    [`GET ${WS}/profile`]: json(profile),
    [`GET ${WS}/activities`]: json({ activities }),
  };
}

describe("ActivityView", () => {
  it("shows the day's rings against the person's goals", async () => {
    mockApi(
      routes([
        activity({ id: "a1", steps: 6000 }),
        activity({ id: "a2", kind: "run", duration_s: 30 * 60, distance_m: 5000 }),
        activity({ id: "a3", day: "2030-01-13", kind: "rest_day" }),
      ]),
    );
    await renderSignedIn(<ActivityView workspaceId={personal.id} today={TODAY} />);

    expect(await screen.findByText("1 of 3 rings closed")).toBeInTheDocument();
    // Steps use the saved goal of 8,000; active time the default of 30 minutes.
    expect(screen.getByRole("progressbar", { name: "Steps" })).toHaveAttribute(
      "aria-valuenow",
      "75",
    );
    expect(screen.getByRole("progressbar", { name: "Active" })).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
    expect(screen.getByRole("img", { name: "Active 100%, Steps 75%, Sleep 0%" })).toBeVisible();
    expect(screen.getByText("Steps: 2,000 steps to go.")).toBeInTheDocument();
    expect(screen.getByText("1 day")).toBeInTheDocument();

    const history = screen.getByRole("region", { name: "History" });
    expect(within(history).getByRole("heading", { name: "Today" })).toBeInTheDocument();
    expect(within(history).getByRole("heading", { name: "Yesterday" })).toBeInTheDocument();
  });

  it("moves between days from the week strip and the stepper", async () => {
    const user = userEvent.setup();
    mockApi(routes([activity({ day: "2030-01-12", kind: "sleep", duration_s: 8 * 3600 })]));
    await renderSignedIn(<ActivityView workspaceId={personal.id} today={TODAY} />);

    expect(await screen.findByText("Let’s get moving")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next day" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /1 of 3 rings closed/ }));
    expect(screen.getByText("1 of 3 rings closed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByText("Let’s get moving")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Previous day" }));
    expect(screen.getByText("Yesterday", { selector: "p" })).toBeInTheDocument();
  });

  it("celebrates when a log closes a ring", async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...routes([activity({ id: "a1", steps: 7000 })]),
      [`POST ${WS}/activities`]: json(activity({ id: "a2", steps: 1500 })),
    });
    await renderSignedIn(<ActivityView workspaceId={personal.id} today={TODAY} />);

    await user.click(await screen.findByRole("button", { name: "Log steps" }));
    const dialog = screen.getByRole("dialog", { name: "Record activity" });
    await user.type(within(dialog).getByLabelText("Steps"), "1500");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const call = api.mock.calls.find(([, init]) => init?.method === "POST");
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
        day: TODAY,
        kind: "steps",
        steps: 1500,
      });
    });
    expect(await screen.findByText("Steps ring closed!")).toBeInTheDocument();
  });

  it("saves ring goals to the profile", async () => {
    const user = userEvent.setup();
    const api = mockApi({
      ...routes([]),
      [`PUT ${WS}/profile`]: json(profile),
    });
    await renderSignedIn(<ActivityView workspaceId={personal.id} today={TODAY} />);

    expect(await screen.findByText("No activity recorded")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Goals" }));
    const dialog = screen.getByRole("dialog", { name: "Ring goals" });
    expect(within(dialog).getByLabelText("Steps")).toHaveValue("8000");
    await user.type(within(dialog).getByLabelText("Active minutes"), "45");
    await user.type(within(dialog).getByLabelText("Sleep (hours)"), "7.5");
    await user.click(within(dialog).getByRole("button", { name: "Save goals" }));

    await waitFor(() => {
      const call = api.mock.calls.find(([, init]) => init?.method === "PUT");
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
        targets: { steps: 8000, active_s: 2700, sleep_s: 27_000 },
      });
    });
  });
});
