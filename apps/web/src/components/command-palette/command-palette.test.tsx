import type { NoteSummary } from "@orbit/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuickCaptureProvider } from "@/components/notes/quick-capture";
import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { CommandPaletteProvider } from "./command-palette";
import { CommandPaletteTrigger } from "./command-palette-trigger";

const push = vi.hoisted(() => vi.fn());
const setTheme = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push }),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "system", setTheme }),
}));

const NOTES = `/api/v1/workspaces/${personal.id}/notes`;

function note(overrides: Partial<NoteSummary> & Pick<NoteSummary, "id" | "title">): NoteSummary {
  return {
    workspace_id: personal.id,
    folder_id: null,
    note_type: "note",
    journal_date: null,
    is_pinned: false,
    is_favorite: false,
    archived_at: null,
    trashed_at: null,
    revision: 1,
    created_at: "2026-10-01T09:00:00Z",
    updated_at: "2026-10-01T09:00:00Z",
    last_opened_at: null,
    tags: [],
    excerpt: "",
    ...overrides,
  };
}

const recentNote = note({ id: "aaaaaaaa-0000-4000-8000-000000000001", title: "Trip plan" });
const matchingNote = note({
  id: "aaaaaaaa-0000-4000-8000-000000000002",
  title: "Garden ideas",
  excerpt: "Tomatoes by the fence",
});

function routes(
  extra: Record<string, (request: MockRequest) => Response | Promise<Response>> = {},
) {
  return {
    "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
    "GET /api/v1/me": json(ada),
    "GET /api/v1/me/avatar": status(204),
    "GET /api/v1/workspaces": json({ workspaces: [personal] }),
    [`GET ${NOTES}`]: ({ path }: MockRequest) => {
      void path;
      return Response.json({ notes: [recentNote], total: 1 });
    },
    [`GET /api/v1/workspaces/${personal.id}/note-folders`]: json({
      folders: [
        {
          id: "bbbbbbbb-0000-4000-8000-000000000001",
          parent_id: null,
          name: "Recipes",
          note_count: 2,
          created_at: "2026-10-01T09:00:00Z",
          updated_at: "2026-10-01T09:00:00Z",
        },
      ],
    }),
    [`GET /api/v1/workspaces/${personal.id}/calendar/agenda`]: json({
      items: [{ kind: "event", start_at: "2030-01-14T09:00:00Z", occurrence: standup, task: null }],
      next_cursor: null,
    }),
    [`GET /api/v1/workspaces/${personal.id}/calendar/events`]: json({ events: [], total: 0 }),
    ...extra,
  };
}

const standup = {
  id: "e1:2030-01-14T09:00",
  event_id: "eeeeeeee-0000-4000-8000-000000000001",
  original_start: "2030-01-14T09:00:00",
  title: "Standup",
  description: "",
  location: "",
  category_id: null,
  status: "confirmed",
  all_day: false,
  timezone: "UTC",
  start: "2030-01-14T09:00:00",
  end: "2030-01-14T09:30:00",
  start_at: "2030-01-14T09:00:00Z",
  end_at: "2030-01-14T09:30:00Z",
  recurring: false,
  modified: false,
};

beforeEach(() => {
  push.mockClear();
  setTheme.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function renderPalette(
  extra?: Record<string, (request: MockRequest) => Response | Promise<Response>>,
) {
  const api = mockApi(routes(extra));
  await renderSignedIn(
    <QuickCaptureProvider>
      <CommandPaletteProvider>
        <CommandPaletteTrigger />
      </CommandPaletteProvider>
    </QuickCaptureProvider>,
  );
  return { dialog: screen.getByLabelText("Command palette", { selector: "dialog" }), api };
}

describe("CommandPalette", () => {
  it("opens with Ctrl+K, focuses the search field, and toggles closed", async () => {
    const user = userEvent.setup();
    const { dialog } = await renderPalette();
    expect(dialog).not.toHaveAttribute("open");

    await user.keyboard("{Control>}k{/Control}");
    expect(dialog).toHaveAttribute("open");
    expect(
      screen.getByRole("combobox", { name: "Search pages, notes, and actions" }),
    ).toHaveFocus();

    await user.keyboard("{Control>}k{/Control}");
    expect(dialog).not.toHaveAttribute("open");
  });

  it("opens from the trigger and restores focus to it on close", async () => {
    const user = userEvent.setup();
    const { dialog } = await renderPalette();
    const trigger = screen.getByRole("button", { name: "Search" });

    await user.click(trigger);
    expect(dialog).toHaveAttribute("open");

    await user.keyboard("{Control>}k{/Control}");
    expect(trigger).toHaveFocus();
  });

  it("filters destinations and navigates to the chosen one with Enter", async () => {
    const user = userEvent.setup();
    await renderPalette();
    await user.click(screen.getByRole("button", { name: "Search" }));

    await user.keyboard("calendar");
    const options = screen.getAllByRole("option").map((option) => option.textContent);
    // The page comes first, then calendar actions, then searching notes.
    expect(options[0]).toContain("Plan events, meetings");
    expect(options.at(-1)).toContain("Search notes for “calendar”");
    expect(options).toContain("Open week view");

    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/calendar");
    expect(screen.getByLabelText("Command palette", { selector: "dialog" })).not.toHaveAttribute(
      "open",
    );
  });

  it("moves the active option with the arrow keys", async () => {
    const user = userEvent.setup();
    await renderPalette();
    await user.click(screen.getByRole("button", { name: "Search" }));
    const input = screen.getByRole("combobox");

    const [first, second] = screen.getAllByRole("option");
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", first?.id);

    await user.keyboard("{ArrowDown}");
    expect(second).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", second?.id);

    await user.keyboard("{ArrowUp}{ArrowUp}");
    const options = screen.getAllByRole("option");
    expect(options.at(-1)).toHaveAttribute("aria-selected", "true");
  });

  it("switches theme from a theme command", async () => {
    const user = userEvent.setup();
    await renderPalette();
    await user.click(screen.getByRole("button", { name: "Search" }));

    await user.keyboard("dark");
    await user.click(screen.getByRole("option", { name: /Dark theme/ }));
    expect(setTheme).toHaveBeenCalledWith("dark");
  });

  it("shows an empty state when nothing matches", async () => {
    const user = userEvent.setup();
    await renderPalette();
    await user.click(screen.getByRole("button", { name: "Search" }));

    await user.keyboard("zzz");
    // Only the offer to search notes for it.
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: /Search notes for “zzz”/ })).toBeInTheDocument();
  });

  it("lists recent notes and folders, and opens them", async () => {
    const user = userEvent.setup();
    await renderPalette();
    await user.click(screen.getByRole("button", { name: "Search" }));

    await user.click(await screen.findByRole("option", { name: /Trip plan/ }));
    expect(push).toHaveBeenCalledWith(`/notes?note=${recentNote.id}`);

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.keyboard("recipes");
    await user.click(await screen.findByRole("option", { name: /Recipes/ }));
    expect(push).toHaveBeenCalledWith("/notes?folder=bbbbbbbb-0000-4000-8000-000000000001");
  });

  it("searches notes as you type", async () => {
    const user = userEvent.setup();
    await renderPalette({
      [`GET ${NOTES}`]: ({ path }) => {
        void path;
        return Response.json({ notes: [matchingNote], total: 1 });
      },
    });
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.keyboard("garden");

    const match = await screen.findByRole("option", { name: /Garden ideas/ });
    expect(match).toHaveTextContent("Tomatoes by the fence");
    await user.click(match);
    expect(push).toHaveBeenCalledWith(`/notes?note=${matchingNote.id}`);
  });

  it("creates a note and opens it", async () => {
    const user = userEvent.setup();
    const created = {
      ...matchingNote,
      id: "aaaaaaaa-0000-4000-8000-000000000009",
      content: {},
      content_format: "prosemirror-v1",
      task_ids: [],
    };
    const { api } = await renderPalette({
      [`GET ${NOTES}`]: json({ notes: [], total: 0 }),
      [`POST ${NOTES}`]: json(created, 201),
    });
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.keyboard("new note{Enter}");

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/notes?view=inbox&note=${created.id}`));
    const post = api.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ title: "", note_type: "note" });
  });

  it("opens quick capture without leaving the page", async () => {
    const user = userEvent.setup();
    await renderPalette({ [`GET ${NOTES}`]: json({ notes: [], total: 0 }) });
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.keyboard("quick{Enter}");
    expect(await screen.findByRole("dialog", { name: "Quick note" })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("offers calendar actions, event search, and meeting notes for the next event", async () => {
    const user = userEvent.setup();
    const eventsPath = `/api/v1/workspaces/${personal.id}/calendar/events`;
    const notePath = `${eventsPath}/${standup.event_id}/notes`;
    const { api } = await renderPalette({
      [`GET ${eventsPath}`]: json({
        events: [{ ...standup, id: standup.event_id, start: "2030-02-01T10:00:00" }],
        total: 1,
      }),
      [`POST ${notePath}`]: json(
        {
          id: "note-1",
          title: "Standup · 14 Jan 2030",
          note_type: "note",
          trashed: false,
          updated_at: "2030-01-14T00:00:00Z",
        },
        201,
      ),
    });
    await user.click(screen.getByRole("button", { name: "Search" }));

    await user.keyboard("standup");
    const match = await screen.findByRole("option", { name: /^Standup/ });
    expect(match).toHaveTextContent("Feb 1, 2030");

    await user.clear(screen.getByRole("combobox"));
    await user.keyboard("meeting notes");
    await user.click(
      await screen.findByRole("option", { name: /Create meeting notes for “Standup”/ }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/notes?note=note-1"));
    const created = api.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(created?.[1]?.body))).toEqual({
      occurrence_start: "2030-01-14T09:00",
    });
  });
});
