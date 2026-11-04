import type { NoteSummary, UniversalSearchHit, UniversalSearchResults } from "@orbit/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuickCaptureProvider } from "@/components/notes/quick-capture";
import { QuickActionsProvider } from "@/components/quick-actions/quick-actions";
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
const SEARCH = `/api/v1/workspaces/${personal.id}/search`;

const MODULES = [
  "tasks",
  "notes",
  "calendar",
  "reminders",
  "finance",
  "habits",
  "documents",
  "health",
] as const;

function hit(
  overrides: Partial<UniversalSearchHit> &
    Pick<UniversalSearchHit, "id" | "title" | "module" | "entity_type">,
): UniversalSearchHit {
  return {
    snippet: "",
    matched_fields: ["title"],
    match: "title_phrase",
    score: 600,
    active: true,
    status: "",
    details: [],
    day: null,
    starts_at: null,
    all_day: false,
    parent_id: null,
    updated_at: "2030-01-01T00:00:00Z",
    ...overrides,
  };
}

function results(hits: UniversalSearchHit[]): UniversalSearchResults {
  return {
    query: "",
    sort: "relevance",
    offset: 0,
    limit: 8,
    total: hits.length,
    has_more: false,
    hits,
    facets: MODULES.map((module) => ({
      module,
      total: hits.filter((h) => h.module === module).length,
      unavailable: false,
    })),
    unavailable: [],
  };
}

function note(overrides: Partial<NoteSummary> & Pick<NoteSummary, "id" | "title">): NoteSummary {
  return {
    workspace_id: personal.id,
    folder_id: null,
    note_type: "note",
    journal_date: null,
    is_pinned: false,
    is_favorite: false,
    is_locked: false,
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
    [`GET ${SEARCH}/results`]: json(results([])),
    [`GET ${SEARCH}/recent`]: json({ searches: [] }),
    [`POST ${SEARCH}/recent`]: json({ id: "r1", query: "", used_at: "2030-01-01T00:00:00Z" }, 201),
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
      <QuickActionsProvider>
        <CommandPaletteProvider>
          <CommandPaletteTrigger />
        </CommandPaletteProvider>
      </QuickActionsProvider>
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
    expect(screen.getByRole("combobox", { name: "Search Orbit and run actions" })).toHaveFocus();

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
    // The page comes first, then calendar actions, then searching notes and documents, then
    // asking the assistant.
    expect(options[0]).toContain("Plan events, meetings");
    expect(options.at(-3)).toContain("Search notes for “calendar”");
    expect(options.at(-2)).toContain("Search documents for “calendar”");
    expect(options.at(-1)).toContain("Ask Orbit: “calendar”");
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
    // Only the offers to see all results, search notes and documents for it, and ask.
    expect(screen.getAllByRole("option")).toHaveLength(4);
    expect(screen.getByRole("option", { name: /See all results for “zzz”/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Search notes for “zzz”/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Search documents for “zzz”/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Ask Orbit: “zzz”/ })).toBeInTheDocument();
  });

  it("hands a question to the assistant", async () => {
    const user = userEvent.setup();
    await renderPalette();
    await user.click(screen.getByRole("button", { name: "Search" }));

    await user.keyboard("what is overdue");
    await user.click(screen.getByRole("option", { name: /Ask Orbit: “what is overdue”/ }));
    expect(push).toHaveBeenCalledWith("/assistant?q=what%20is%20overdue");
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

  it("searches every module at once and groups matches by module", async () => {
    const user = userEvent.setup();
    const { api } = await renderPalette({
      [`GET ${SEARCH}/results`]: json(
        results([
          hit({
            id: matchingNote.id,
            module: "notes",
            entity_type: "note",
            title: "Garden ideas",
            snippet: "Tomatoes by the fence",
          }),
          hit({
            id: "task-1",
            module: "tasks",
            entity_type: "task",
            title: "Water the garden",
            status: "open",
            day: "2030-05-01",
          }),
          hit({
            id: "tx-1",
            module: "finance",
            entity_type: "transaction",
            title: "Garden centre",
            status: "expense",
            day: "2030-04-01",
          }),
        ]),
      ),
    });
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.keyboard("garden");

    const note = await screen.findByRole("option", { name: /Garden ideas/ });
    expect(note).toHaveTextContent("Tomatoes by the fence");
    expect(screen.getByRole("group", { name: "Matching tasks" })).toHaveTextContent(
      "Water the garden",
    );
    expect(screen.getByRole("group", { name: "Matching finance records" })).toHaveTextContent(
      "Expense",
    );
    // Results come grouped, tasks first, in the order the groups are listed.
    const groups = screen.getAllByRole("group").map((group) => group.getAttribute("aria-label"));
    expect(groups.indexOf("Matching tasks")).toBeLessThan(groups.indexOf("Matching notes"));

    await user.click(note);
    expect(push).toHaveBeenCalledWith(`/notes?note=${matchingNote.id}`);
    // Opening a result remembers the search.
    await waitFor(() =>
      expect(
        api.mock.calls.some(
          ([url, init]) => String(url).endsWith("/search/recent") && init?.method === "POST",
        ),
      ).toBe(true),
    );
    // One search request covers every module; no module is searched separately.
    const searches = api.mock.calls.filter(([url]) => String(url).includes("/search/results"));
    expect(searches.length).toBeGreaterThan(0);
    expect(api.mock.calls.some(([url]) => /\/notes\?.*q=/.test(String(url)))).toBe(false);
    expect(String(searches.at(-1)?.[0])).toContain("q=garden");
  });

  it("offers recent searches, and every result on the search page", async () => {
    const user = userEvent.setup();
    const { api } = await renderPalette({
      [`GET ${SEARCH}/recent`]: json({
        searches: [{ id: "r1", query: "passport", used_at: "2030-01-01T00:00:00Z" }],
      }),
    });
    await user.click(screen.getByRole("button", { name: "Search" }));

    const recent = await screen.findByRole("group", { name: "Recent searches" });
    expect(recent).toHaveTextContent("passport");
    await user.keyboard("garden");
    await user.click(await screen.findByRole("option", { name: /See all results for “garden”/ }));

    expect(push).toHaveBeenCalledWith("/search?q=garden");
    await waitFor(() =>
      expect(
        api.mock.calls.some(
          ([url, init]) => String(url).endsWith("/search/recent") && init?.method === "POST",
        ),
      ).toBe(true),
    );
  });

  it("opens the search page with Ctrl+Shift+F", async () => {
    const user = userEvent.setup();
    await renderPalette();

    await user.keyboard("{Control>}{Shift>}F{/Shift}{/Control}");

    expect(push).toHaveBeenCalledWith("/search");
  });

  it("keeps pages and actions working when search fails", async () => {
    const user = userEvent.setup();
    await renderPalette({ [`GET ${SEARCH}/results`]: status(500) });
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.keyboard("calendar");

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t search your records");
    expect(screen.getAllByRole("option")[0]).toHaveTextContent("Plan events, meetings");
  });

  it("creates a task in place from a create command", async () => {
    const user = userEvent.setup();
    await renderPalette({ [`GET ${NOTES}`]: json({ notes: [], total: 0 }) });
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.keyboard("create task{Enter}");

    expect(await screen.findByRole("dialog", { name: "New task" })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
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
      [`GET ${SEARCH}/results`]: json(
        results([
          hit({
            id: standup.event_id,
            module: "calendar",
            entity_type: "event",
            title: "Standup",
            status: "confirmed",
            day: "2030-02-01",
            starts_at: "2030-02-01T10:00:00",
          }),
        ]),
      ),
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
    expect(match.closest("[role=group]")).toHaveAttribute("aria-label", "Matching events");

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
