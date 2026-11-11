import type { AchievementProfile } from "@orbit/contracts";
import { useMutation } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { AchievementWatcher } from "./achievement-watcher";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const session = {
  "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
  "GET /api/v1/me": json(ada),
  "GET /api/v1/me/avatar": status(204),
  "GET /api/v1/workspaces": json({ workspaces: [personal] }),
};

function profile(newUnlocks: string[]): AchievementProfile {
  return {
    earned_xp: 15,
    spent_xp: 0,
    balance: 15,
    level: { level: 1, floor_xp: 0, next_xp: 100 },
    achievements: [
      {
        key: "first_task",
        title: "First step",
        description: "Complete your first task.",
        area: "tasks",
        tier: "easy",
        xp: 15,
        current: 1,
        target: 1,
        secret: false,
        unlocked_at: "2026-11-11T09:00:00Z",
        earned_xp: 15,
      },
    ],
    store: [],
    equipped: { frame: null, banner: null, title: null, confetti: null },
    new_unlocks: newUnlocks,
  };
}

/** Some other part of the app saving a change. */
function SaveButton() {
  const save = useMutation({ mutationFn: () => Promise.resolve("ok") });
  return (
    <button type="button" onClick={() => save.mutate()}>
      Save
    </button>
  );
}

describe("AchievementWatcher", () => {
  it("checks on sign-in and celebrates what unlocked", async () => {
    mockApi({ ...session, "POST /api/v1/me/achievements/check": json(profile(["first_task"])) });
    await renderSignedIn(<AchievementWatcher />);

    expect(await screen.findByText("Achievement unlocked: First step")).toBeInTheDocument();
    expect(screen.getByText("+15 XP")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View" })).toHaveAttribute(
      "href",
      "/profile?view=achievements",
    );

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Achievement unlocked: First step")).not.toBeInTheDocument();
  });

  it("checks again shortly after another change succeeds", async () => {
    let checks = 0;
    mockApi({
      ...session,
      "POST /api/v1/me/achievements/check": () => {
        checks += 1;
        return Response.json(profile(checks === 2 ? ["first_task"] : []));
      },
    });
    await renderSignedIn(
      <>
        <SaveButton />
        <AchievementWatcher />
      </>,
    );
    await waitFor(() => expect(checks).toBe(1));
    expect(screen.queryByText(/Achievement unlocked/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("Achievement unlocked: First step", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(checks).toBe(2);
  });

  it("stays quiet when a check fails", async () => {
    mockApi({ ...session, "POST /api/v1/me/achievements/check": status(500) });
    await renderSignedIn(<AchievementWatcher />);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});
