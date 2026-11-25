import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import {
  aiSettings,
  BRIEFING_AT,
  BRIEFING_DAY,
  briefingContent,
  briefingFixture,
  withOverdueTask,
} from "@/test/briefing";
import { renderSignedIn } from "@/test/session";

import { TodayWidget } from "./today-widget";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

const WS = `/api/v1/workspaces/${personal.id}`;
const BR = `${WS}/briefings`;

const overview = {
  date: BRIEFING_DAY,
  timezone: "UTC",
  generated_at: BRIEFING_AT,
  tasks: { open: 2, overdue: 1, due_today: 1, overdue_items: [], due_today_items: [] },
  events: { today: [], next: null },
  reminders: { pending: 0, items: [] },
  habits: { remaining: 2, done: 1, total: 3 },
  documents: { expired: 0, expiring: 0, items: [] },
  payments: { overdue: 0, due_soon: 0, items: [] },
  unavailable: [],
};

const narrative = {
  headline: "Taxes first, then a calm afternoon",
  summary: "One task is overdue. Nothing else is pressing.",
  priorities: [{ key: "task:t1", title: "File taxes", reason: "It’s two days late." }],
  modules: ["tasks", "calendar"] as ("tasks" | "calendar")[],
  provider_name: "Ollama",
  model: "llama3",
  processing: "local",
  generated_at: BRIEFING_AT,
};

const content = briefingContent({
  ...withOverdueTask(),
  summary: { ...briefingContent().summary, tasks_overdue: 1, events: 2, conflicts: 1 },
});

function routes(ai: boolean) {
  return {
    "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
    "GET /api/v1/me": json(ada),
    "GET /api/v1/me/avatar": status(204),
    "GET /api/v1/workspaces": json({ workspaces: [personal] }),
    "GET /api/v1/me/ai/settings": json(aiSettings(ai)),
    [`GET ${WS}/dashboard/today`]: json(overview),
  };
}

const posted = (api: ReturnType<typeof mockApi>, suffix: string) =>
  api.mock.calls.filter(
    ([input, init]) => init?.method === "POST" && new URL(String(input)).pathname.endsWith(suffix),
  ).length;

describe("TodayWidget summary", () => {
  it("with AI off, shows today's details and never prepares a briefing", async () => {
    const api = mockApi(routes(false));

    await renderSignedIn(<TodayWidget />);

    expect(await screen.findByRole("link", { name: /Tasks due/ })).toBeInTheDocument();
    expect(screen.queryByText("Summarizing your day…")).toBeNull();
    const paths = api.mock.calls.map(([input]) => new URL(String(input)).pathname);
    expect(paths.some((path) => path.startsWith(BR))).toBe(false);
  });

  it("summarizes the day once, keeping the details below", async () => {
    let release: () => void = () => undefined;
    const written = new Promise<void>((resolve) => {
      release = resolve;
    });
    const api = mockApi({
      ...routes(true),
      [`GET ${BR}/today`]: json(briefingFixture({ content })),
      [`POST ${BR}/${BRIEFING_DAY}/narrative`]: async () => {
        await written;
        return Response.json(briefingFixture({ content, narrative }));
      },
    });

    await renderSignedIn(<TodayWidget />);

    expect(await screen.findByRole("status")).toHaveTextContent("Summarizing your day…");
    // The details don't wait for the summary.
    expect(await screen.findByRole("link", { name: /Tasks due/ })).toBeInTheDocument();
    release();

    const summary = await screen.findByRole("region", { name: "Your day, summarized" });
    expect(within(summary).getByText(narrative.headline)).toBeInTheDocument();
    expect(within(summary).getByText(narrative.summary)).toBeInTheDocument();
    expect(within(summary).getByRole("link", { name: /File taxes/ })).toHaveAttribute(
      "href",
      "/tasks?task=t1",
    );
    const glance = within(summary).getByRole("list", { name: "At a glance" });
    expect(within(glance).getByRole("link", { name: /1 overdue/ })).toHaveAttribute(
      "href",
      "/tasks",
    );
    expect(within(glance).getByRole("link", { name: /2 events, 1 overlapping/ })).toBeVisible();
    expect(within(summary).getByText(/by Ollama on your server/)).toBeInTheDocument();
    expect(screen.queryByText("Summarizing your day…")).toBeNull();
    expect(screen.getByRole("link", { name: /Tasks due/ })).toBeInTheDocument();
    expect(posted(api, "/narrative")).toBe(1);
  });

  it("shows a kept summary without writing it again, and refreshes on request", async () => {
    const user = userEvent.setup();
    const sent: MockRequest[] = [];
    const api = mockApi({
      ...routes(true),
      [`GET ${BR}/today`]: json(briefingFixture({ content, narrative })),
      [`POST ${BR}/today/regenerate`]: (request) => {
        sent.push(request);
        return Response.json(briefingFixture({ content, revision: 2 }));
      },
      [`POST ${BR}/${BRIEFING_DAY}/narrative`]: json(
        briefingFixture({
          content,
          revision: 2,
          narrative: { ...narrative, headline: "A fresh look at your day" },
        }),
      ),
    });

    await renderSignedIn(<TodayWidget />);
    expect(await screen.findByText(narrative.headline)).toBeInTheDocument();
    expect(posted(api, "/narrative")).toBe(0);

    await user.click(screen.getByRole("button", { name: "Summary options" }));
    await user.click(await screen.findByRole("menuitem", { name: /Refresh summary/ }));

    expect(await screen.findByText("A fresh look at your day")).toBeInTheDocument();
    expect(sent).toHaveLength(1);
    expect(posted(api, "/narrative")).toBe(1);
  });

  it("explains a failed summary quietly and lets the person try again", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    mockApi({
      ...routes(true),
      [`GET ${BR}/today`]: json(briefingFixture({ content })),
      [`POST ${BR}/${BRIEFING_DAY}/narrative`]: () => {
        attempts += 1;
        return attempts === 1
          ? Response.json(
              { detail: "This month's AI token limit has been reached." },
              { status: 429 },
            )
          : Response.json(briefingFixture({ content, narrative }));
      },
    });

    await renderSignedIn(<TodayWidget />);

    expect(await screen.findByText(/token limit has been reached/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Tasks due/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(narrative.headline)).toBeInTheDocument();
    await waitFor(() => expect(attempts).toBe(2));
  });
});
