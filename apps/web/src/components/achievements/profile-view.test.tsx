import type { Achievement, AchievementProfile, RewardItem } from "@orbit/contracts";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { ProfilePanel } from "./profile-view";

let search = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/profile",
  useSearchParams: () => search,
}));

const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json(ada),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};
const BASE = "/api/v1/me/achievements";

function achievement(overrides: Partial<Achievement> & Pick<Achievement, "key">): Achievement {
  return {
    title: overrides.key,
    description: "Do the thing.",
    area: "tasks",
    tier: "easy",
    xp: 15,
    current: 0,
    target: 10,
    secret: false,
    unlocked_at: null,
    earned_xp: null,
    ...overrides,
  };
}

function item(overrides: Partial<RewardItem> & Pick<RewardItem, "key" | "name">): RewardItem {
  return {
    slot: "frame",
    description: "A ring.",
    cost: 60,
    min_level: 1,
    owned: false,
    equipped: false,
    ...overrides,
  };
}

const PROFILE: AchievementProfile = {
  earned_xp: 130,
  spent_xp: 0,
  balance: 130,
  level: { level: 2, floor_xp: 100, next_xp: 300 },
  achievements: [
    achievement({
      key: "first_task",
      title: "First step",
      current: 1,
      target: 1,
      unlocked_at: "2026-11-10T09:00:00Z",
      earned_xp: 15,
    }),
    achievement({ key: "tasks_10", title: "Warming up", current: 7 }),
    achievement({ key: "streak_30", title: "Month of momentum", area: "habits", tier: "hard" }),
    achievement({ key: "renaissance", title: "Secret achievement", secret: true, target: 1 }),
  ],
  store: [
    item({ key: "frame_sunrise", name: "Sunrise" }),
    item({ key: "frame_aurora", name: "Aurora", cost: 450, min_level: 4 }),
    item({ key: "banner_dusk", name: "Dusk", slot: "banner", cost: 500 }),
  ],
  equipped: { frame: null, banner: null, title: null, confetti: null },
  new_unlocks: [],
};

afterEach(() => {
  search = new URLSearchParams();
});

describe("ProfilePanel", () => {
  it("shows the level, XP, and what's closest to unlocking", async () => {
    mockApi({ ...session, [`GET ${BASE}`]: json(PROFILE) });
    await renderSignedIn(<ProfilePanel />);

    expect(await screen.findByRole("heading", { level: 1, name: "Ada" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Progress to the next level" })).toHaveAttribute(
      "aria-valuenow",
      "15",
    );
    expect(screen.getByText("170 XP to level 3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Overview/ })).toHaveAttribute("aria-current", "page");
    const next = screen.getByRole("region", { name: "Closest to unlocking" });
    expect(within(next).getByRole("article", { name: "Warming up, locked" })).toBeInTheDocument();
    // Secrets stay out of "next up".
    expect(within(next).queryByText("Secret achievement")).not.toBeInTheDocument();
    expect(screen.getByText(/You can afford 1 item/)).toBeInTheDocument();
  });

  it("filters achievements by tier and status", async () => {
    search = new URLSearchParams("view=achievements");
    mockApi({ ...session, [`GET ${BASE}`]: json(PROFILE) });
    await renderSignedIn(<ProfilePanel />);

    expect(await screen.findByRole("heading", { level: 2, name: "Achievements" })).toBeVisible();
    expect(screen.getAllByRole("article")).toHaveLength(4);

    await userEvent.click(screen.getByRole("button", { name: "Hard" }));
    expect(screen.getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual([
      "Month of momentum, locked",
    ]);

    await userEvent.click(screen.getByRole("button", { name: "Unlocked" }));
    expect(screen.getByText("No achievements match these filters.")).toBeInTheDocument();
  });

  it("buys an item after confirming, then wears it", async () => {
    search = new URLSearchParams("view=store");
    const requests: MockRequest[] = [];
    const bought: AchievementProfile = {
      ...PROFILE,
      spent_xp: 60,
      balance: 70,
      store: PROFILE.store.map((i) => (i.key === "frame_sunrise" ? { ...i, owned: true } : i)),
    };
    const worn: AchievementProfile = {
      ...bought,
      equipped: { ...bought.equipped, frame: "frame_sunrise" },
      store: bought.store.map((i) => (i.key === "frame_sunrise" ? { ...i, equipped: true } : i)),
    };
    mockApi({
      ...session,
      [`GET ${BASE}`]: json(PROFILE),
      [`POST ${BASE}/store/purchases`]: (request) => {
        requests.push(request);
        return Response.json(bought);
      },
      [`PUT ${BASE}/store/equipped`]: (request) => {
        requests.push(request);
        return Response.json(worn);
      },
    });
    await renderSignedIn(<ProfilePanel />);

    const aurora = await screen.findByRole("article", { name: "Aurora" });
    expect(within(aurora).getByText("Reach level 4")).toBeInTheDocument();
    const dusk = screen.getByRole("article", { name: "Dusk" });
    expect(within(dusk).getByText("370 more XP needed")).toBeInTheDocument();

    const sunrise = screen.getByRole("article", { name: "Sunrise" });
    await userEvent.click(within(sunrise).getByRole("button", { name: "Buy" }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Buy for 60 XP" }));

    await userEvent.click(await within(sunrise).findByRole("button", { name: "Wear" }));
    expect(await within(sunrise).findByText("Wearing")).toBeInTheDocument();
    expect(requests.map((r) => r.body)).toEqual([
      { item_key: "frame_sunrise" },
      { item_key: "frame_sunrise" },
    ]);
  });

  it("shows a store error from the API", async () => {
    search = new URLSearchParams("view=store");
    mockApi({
      ...session,
      [`GET ${BASE}`]: json(PROFILE),
      [`POST ${BASE}/store/purchases`]: status(409, "You don't have enough XP yet."),
    });
    await renderSignedIn(<ProfilePanel />);

    const sunrise = await screen.findByRole("article", { name: "Sunrise" });
    await userEvent.click(within(sunrise).getByRole("button", { name: "Buy" }));
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: /Buy for/ }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("You don't have enough XP yet.");
  });

  it("invites a first purchase when the collection is empty", async () => {
    search = new URLSearchParams("view=collection");
    mockApi({ ...session, [`GET ${BASE}`]: json(PROFILE) });
    await renderSignedIn(<ProfilePanel />);

    expect(await screen.findByText("Nothing in your collection yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Visit the store" })).toHaveAttribute(
      "href",
      "/profile?view=store",
    );
  });

  it("offers a retry when loading fails", async () => {
    mockApi({ ...session, [`GET ${BASE}`]: status(500) });
    await renderSignedIn(<ProfilePanel />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/achievements/i);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
