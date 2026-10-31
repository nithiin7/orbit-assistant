import type { Note, NoteFolder, NoteSummary } from "@orbit/contracts";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { journalToday } from "@/lib/notes";
import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { NotesPanel } from "./notes-view";
import { QuickCaptureProvider } from "./quick-capture";

// The URL, as a tiny store: `router.push` changes it and the page re-renders, like Next.js.
const url = vi.hoisted(() => {
  let search = "";
  const listeners = new Set<() => void>();
  return {
    get: () => search,
    set: (next: unknown) => {
      if (typeof next !== "string") return;
      search = next.includes("?") ? next.slice(next.indexOf("?") + 1) : "";
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});
const push = vi.hoisted(() => vi.fn((href: string) => url.set(href)));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: push }),
  usePathname: () => "/notes",
  useSearchParams: () => new URLSearchParams(useSyncExternalStore(url.subscribe, url.get, url.get)),
}));

const WS = `/api/v1/workspaces/${personal.id}`;
const NOTES = `${WS}/notes`;

const work: NoteFolder = {
  id: "bbbbbbbb-0000-4000-8000-000000000001",
  parent_id: null,
  name: "Work",
  note_count: 1,
  created_at: "2026-10-01T09:00:00Z",
  updated_at: "2026-10-01T09:00:00Z",
};
const projects: NoteFolder = {
  ...work,
  id: "bbbbbbbb-0000-4000-8000-000000000002",
  parent_id: work.id,
  name: "Projects",
};

function summary(overrides: Partial<NoteSummary> & Pick<NoteSummary, "id" | "title">): NoteSummary {
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

function detail(note: NoteSummary, text = "Body text"): Note {
  const { excerpt: _excerpt, ...fields } = note;
  const paragraph = text
    ? { type: "paragraph", content: [{ type: "text", text }] }
    : { type: "paragraph" };
  return {
    ...fields,
    content: { type: "doc", content: [paragraph] },
    content_format: "prosemirror-v1",
    task_ids: [],
  };
}

const groceries = summary({
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  title: "Groceries",
  excerpt: "Basil and tomatoes",
  tags: [{ id: "cccccccc-0000-4000-8000-000000000001", name: "home" }],
  is_pinned: true,
});
const spec = summary({
  id: "aaaaaaaa-0000-4000-8000-000000000002",
  title: "Spec",
  folder_id: projects.id,
});

const counts = { all: 2, inbox: 1, favorites: 0, pinned: 1, journal: 0, archived: 0, trashed: 0 };

function routes(
  extra: Record<string, (request: MockRequest) => Response | Promise<Response>> = {},
) {
  return {
    "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
    "GET /api/v1/me": json(ada),
    "GET /api/v1/me/avatar": status(204),
    "GET /api/v1/workspaces": json({ workspaces: [personal] }),
    [`GET ${NOTES}`]: json({ notes: [groceries, spec], total: 2 }),
    [`GET ${NOTES}/counts`]: json(counts),
    [`GET ${WS}/note-folders`]: json({ folders: [work, projects] }),
    [`GET ${WS}/note-tags`]: json({
      tags: [
        {
          id: "cccccccc-0000-4000-8000-000000000001",
          name: "home",
          note_count: 1,
          created_at: "2026-10-01T09:00:00Z",
        },
      ],
    }),
    ...extra,
  };
}

/** Query strings of every note list request, in order. */
function listQueries(api: ReturnType<typeof mockApi>): URLSearchParams[] {
  return api.mock.calls
    .map(([input, init]) => ({ url: new URL(String(input)), method: init?.method ?? "GET" }))
    .filter(({ url: u, method }) => method === "GET" && u.pathname === NOTES)
    .map(({ url: u }) => u.searchParams);
}

async function renderNotes(search = "") {
  url.set(search);
  await renderSignedIn(
    <QuickCaptureProvider>
      <NotesPanel />
    </QuickCaptureProvider>,
  );
}

beforeEach(() => push.mockClear());

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("NotesPanel", () => {
  it("lists notes with their views, folders, and tags", async () => {
    mockApi(routes());
    await renderNotes();

    const list = await screen.findByRole("list", { name: "Notes" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Groceries");
    expect(items[0]).toHaveTextContent("Basil and tomatoes");
    expect(items[0]).toHaveTextContent("#home");
    // Notes outside the current folder show where they are.
    expect(items[1]).toHaveTextContent("Work / Projects");

    const rail = screen.getAllByRole("navigation", { name: "Notes" })[0];
    expect(rail).toBeDefined();
    expect(within(rail!).getByRole("button", { name: /Inbox, 1 note/ })).toBeInTheDocument();
    expect(within(rail!).getByRole("button", { name: /All notes/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // Subfolders show once their parent is expanded.
    expect(within(rail!).queryByRole("button", { name: /^Projects/ })).not.toBeInTheDocument();
    await userEvent.click(within(rail!).getByRole("button", { name: "Expand “Work”" }));
    expect(within(rail!).getByRole("button", { name: /^Projects/ })).toBeInTheDocument();
  });

  it("asks for each view's notes, and narrows to a folder", async () => {
    const user = userEvent.setup();
    const api = mockApi(routes());
    await renderNotes();
    await screen.findByRole("list", { name: "Notes" });
    expect(listQueries(api)[0]?.getAll("type")).toEqual(["note", "quick"]);

    const rail = screen.getAllByRole("navigation", { name: "Notes" })[0]!;
    await user.click(within(rail).getByRole("button", { name: /^Inbox/ }));
    await waitFor(() => expect(listQueries(api).at(-1)?.get("inbox")).toBe("true"));
    expect(push).toHaveBeenLastCalledWith("/notes?view=inbox", { scroll: false });

    await user.click(within(rail).getByRole("button", { name: /^Work/ }));
    await waitFor(() => expect(listQueries(api).at(-1)?.get("folder_id")).toBe(work.id));
    expect(screen.getByRole("heading", { name: "Work" })).toBeInTheDocument();
  });

  it("searches as you type and highlights matches", async () => {
    const user = userEvent.setup();
    const api = mockApi(routes());
    await renderNotes();
    await screen.findByRole("list", { name: "Notes" });

    await user.type(screen.getByRole("searchbox", { name: "Search notes" }), "basil");
    await waitFor(() => expect(listQueries(api).at(-1)?.get("q")).toBe("basil"));
    const marks = await screen.findAllByText("Basil", { selector: "mark" });
    expect(marks.length).toBeGreaterThan(0);
  });

  it("opens a note with its details", async () => {
    mockApi(
      routes({
        [`GET ${NOTES}/${groceries.id}`]: json(detail(groceries, "Buy basil")),
        [`GET ${NOTES}/${groceries.id}/links`]: json({
          outgoing: [],
          backlinks: [
            { id: spec.id, title: "Spec", note_type: "note", journal_date: null, archived: false },
          ],
        }),
        [`GET ${NOTES}/${groceries.id}/tasks`]: json({ tasks: [], total: 0 }),
        [`GET ${NOTES}/${groceries.id}/attachments`]: json({
          attachments: [],
          max_bytes: 10485760,
        }),
      }),
    );
    await renderNotes(`?note=${groceries.id}`);

    expect(await screen.findByRole("textbox", { name: "Title" })).toHaveValue("Groceries");
    const details = screen.getByRole("complementary", { name: "Details" });
    expect(await within(details).findByRole("button", { name: "Spec" })).toBeInTheDocument();
    expect(within(details).getByRole("list", { name: "Tags on this note" })).toHaveTextContent(
      "home",
    );
    expect(within(details).getByText("No linked tasks.")).toBeInTheDocument();
    expect(await screen.findByText("Buy basil")).toBeInTheDocument();
  });

  it("gives an open note the whole page, with the list in a panel", async () => {
    const user = userEvent.setup();
    const noteRoutes = (note: NoteSummary) => ({
      [`GET ${NOTES}/${note.id}`]: json(detail(note)),
      [`GET ${NOTES}/${note.id}/links`]: json({ outgoing: [], backlinks: [] }),
      [`GET ${NOTES}/${note.id}/tasks`]: json({ tasks: [], total: 0 }),
      [`GET ${NOTES}/${note.id}/attachments`]: json({ attachments: [], max_bytes: 1024 }),
    });
    mockApi(routes({ ...noteRoutes(groceries), ...noteRoutes(spec) }));
    await renderNotes(`?note=${groceries.id}`);

    expect(await screen.findByRole("textbox", { name: "Title" })).toHaveValue("Groceries");
    expect(screen.queryByRole("list", { name: "Notes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Notes", level: 1 })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show note list" }));
    const panel = await screen.findByRole("dialog", { name: "All notes" });
    expect(within(panel).getByRole("searchbox", { name: "Search notes" })).toHaveFocus();

    // Opening another note from the panel closes it.
    await user.click(within(panel).getByRole("button", { name: /^Spec/ }));
    await waitFor(() =>
      expect(push).toHaveBeenLastCalledWith(`/notes?note=${spec.id}`, { scroll: false }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByRole("textbox", { name: "Title" })).toHaveValue("Spec");

    // Back to browsing: the list returns to the page.
    await user.click(screen.getByRole("button", { name: "Notes" }));
    expect(await screen.findByRole("list", { name: "Notes" })).toBeInTheDocument();
  });

  it("remembers whether note details are shown", async () => {
    const user = userEvent.setup();
    mockApi(
      routes({
        [`GET ${NOTES}/${groceries.id}`]: json(detail(groceries)),
        [`GET ${NOTES}/${groceries.id}/links`]: json({ outgoing: [], backlinks: [] }),
        [`GET ${NOTES}/${groceries.id}/tasks`]: json({ tasks: [], total: 0 }),
        [`GET ${NOTES}/${groceries.id}/attachments`]: json({ attachments: [], max_bytes: 1024 }),
      }),
    );
    await renderNotes(`?note=${groceries.id}`);
    expect(await screen.findByRole("complementary", { name: "Details" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Hide details" }));
    expect(screen.queryByRole("complementary", { name: "Details" })).not.toBeInTheDocument();

    cleanup();
    await renderNotes(`?note=${groceries.id}`);
    expect(await screen.findByRole("button", { name: "Show details" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Details" })).not.toBeInTheDocument();
  });

  it("creates a note with N and opens it", async () => {
    const user = userEvent.setup();
    const created = summary({ id: "aaaaaaaa-0000-4000-8000-000000000009", title: "" });
    const api = mockApi(
      routes({
        [`POST ${NOTES}`]: json(detail(created, "x"), 201),
        [`GET ${NOTES}/${created.id}`]: json(detail(created, "x")),
        [`GET ${NOTES}/${created.id}/links`]: json({ outgoing: [], backlinks: [] }),
        [`GET ${NOTES}/${created.id}/tasks`]: json({ tasks: [], total: 0 }),
        [`GET ${NOTES}/${created.id}/attachments`]: json({ attachments: [], max_bytes: 1024 }),
      }),
    );
    await renderNotes(`?folder=${work.id}`);
    await screen.findByRole("list", { name: "Notes" });

    await user.keyboard("n");
    await waitFor(() =>
      expect(push).toHaveBeenLastCalledWith(`/notes?folder=${work.id}&note=${created.id}`, {
        scroll: false,
      }),
    );
    const post = api.mock.calls.find(([, init]) => init?.method === "POST");
    // A note created in a folder starts there.
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      title: "",
      note_type: "note",
      folder_id: work.id,
      tags: [],
    });
  });

  it("moves a note to the Trash from its menu", async () => {
    const user = userEvent.setup();
    const api = mockApi(
      routes({
        [`POST ${NOTES}/${spec.id}/trash`]: json(
          detail({ ...spec, trashed_at: "2026-10-31T00:00:00Z" }),
        ),
      }),
    );
    await renderNotes();
    await screen.findByRole("list", { name: "Notes" });

    await user.click(screen.getByRole("button", { name: "More actions for “Spec”" }));
    await user.click(screen.getByRole("menuitem", { name: "Move to Trash" }));
    await waitFor(() =>
      expect(
        api.mock.calls.some(
          ([input, init]) => init?.method === "POST" && String(input).endsWith("/trash"),
        ),
      ).toBe(true),
    );
    expect(await screen.findByText("Moved “Spec” to the Trash.")).toBeInTheDocument();
  });

  it("asks before deleting a note in the Trash forever", async () => {
    const user = userEvent.setup();
    const trashed = { ...spec, trashed_at: "2026-10-31T00:00:00Z" };
    const deletions: string[] = [];
    mockApi(
      routes({
        [`GET ${NOTES}`]: json({ notes: [trashed], total: 1 }),
        [`DELETE ${NOTES}/${spec.id}`]: () => {
          deletions.push(spec.id);
          return new Response(null, { status: 204 });
        },
      }),
    );
    await renderNotes("?view=trash");
    await screen.findByRole("list", { name: "Notes" });

    const deleteForever = async () => {
      await user.click(screen.getByRole("button", { name: "More actions for “Spec”" }));
      await user.click(screen.getByRole("menuitem", { name: /Delete forever/ }));
      return screen.findByRole("alertdialog", { name: "Delete “Spec” forever?" });
    };

    // Cancelling keeps the note.
    let dialog = await deleteForever();
    expect(dialog).toHaveAccessibleDescription("This can’t be undone.");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(deletions).toEqual([]);

    dialog = await deleteForever();
    await user.click(within(dialog).getByRole("button", { name: "Delete forever" }));
    expect(await screen.findByText("Deleted “Spec” forever.")).toBeInTheDocument();
    expect(deletions).toEqual([spec.id]);
  });

  it("asks before emptying the Trash", async () => {
    const user = userEvent.setup();
    const trashed = { ...spec, trashed_at: "2026-10-31T00:00:00Z" };
    mockApi(
      routes({
        [`GET ${NOTES}`]: json({ notes: [trashed], total: 1 }),
        [`POST ${NOTES}/empty-trash`]: json({ deleted: 1 }),
      }),
    );
    await renderNotes("?view=trash");
    await screen.findByRole("list", { name: "Notes" });

    await user.click(screen.getByRole("button", { name: "Empty Trash" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Empty the Trash?" });
    expect(dialog).toHaveAccessibleDescription(
      "1 note will be deleted forever. This can’t be undone.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Empty Trash" }));
    expect(await screen.findByText("Deleted 1 note forever.")).toBeInTheDocument();
  });

  it("asks where a deleted folder's notes go", async () => {
    const user = userEvent.setup();
    const deletions: string[] = [];
    mockApi(
      routes({
        [`DELETE ${WS}/note-folders/${work.id}`]: () => {
          deletions.push("deleted");
          return new Response(null, { status: 204 });
        },
      }),
    );
    const fetchSpy = vi.mocked(fetch);
    await renderNotes();
    const rail = (await screen.findAllByRole("navigation", { name: "Notes" }))[0]!;

    await user.click(await within(rail).findByRole("button", { name: "Actions for “Work”" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete…" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete “Work”?" });
    expect(dialog).toHaveTextContent("2 notes, counting subfolders");
    await user.click(within(dialog).getByRole("radio", { name: /Move its notes to the Inbox/ }));
    await user.click(within(dialog).getByRole("button", { name: "Delete folder" }));

    await waitFor(() => expect(deletions).toHaveLength(1));
    const call = fetchSpy.mock.calls.find(([, init]) => init?.method === "DELETE");
    expect(new URL(String(call?.[0])).searchParams.get("notes")).toBe("inbox");
  });

  it("shows a helpful empty state for each view", async () => {
    mockApi(routes({ [`GET ${NOTES}`]: json({ notes: [], total: 0 }) }));
    await renderNotes("?view=inbox");
    expect(await screen.findByText("Your Inbox is clear")).toBeInTheDocument();
  });

  it("opens today's journal entry from the journal view", async () => {
    const user = userEvent.setup();
    const today = journalToday(null);
    const entry = summary({
      id: "aaaaaaaa-0000-4000-8000-00000000000a",
      title: "",
      note_type: "journal",
      journal_date: today,
    });
    const api = mockApi(
      routes({
        [`GET ${NOTES}`]: json({ notes: [], total: 0 }),
        [`PUT ${NOTES}/journal/${today}`]: json(detail(entry, ""), 201),
        [`GET ${NOTES}/${entry.id}`]: json(detail(entry, "")),
        [`GET ${NOTES}/${entry.id}/links`]: json({ outgoing: [], backlinks: [] }),
        [`GET ${NOTES}/${entry.id}/tasks`]: json({ tasks: [], total: 0 }),
        [`GET ${NOTES}/${entry.id}/attachments`]: json({ attachments: [], max_bytes: 1024 }),
      }),
    );
    await renderNotes("?view=journal");
    expect(await screen.findByText("Start your journal")).toBeInTheDocument();
    expect(listQueries(api)[0]?.get("sort")).toBe("journal_date");

    await user.click(screen.getByRole("button", { name: "Today" }));
    await waitFor(() =>
      expect(push).toHaveBeenLastCalledWith(`/notes?view=journal&note=${entry.id}`, {
        scroll: false,
      }),
    );
  });

  it("shows an error with a retry when notes can't load", async () => {
    mockApi(routes({ [`GET ${NOTES}`]: status(503) }));
    await renderNotes();
    expect(await screen.findByText(/database is unavailable/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

describe("Quick capture", () => {
  it("saves a quick note to the Inbox without leaving the page", async () => {
    const user = userEvent.setup();
    const created = summary({
      id: "aaaaaaaa-0000-4000-8000-00000000000b",
      title: "Idea",
      note_type: "quick",
    });
    const api = mockApi(routes({ [`POST ${NOTES}`]: json(detail(created), 201) }));
    await renderNotes();
    await screen.findByRole("list", { name: "Notes" });

    await user.click(screen.getByRole("button", { name: "New" }));
    await user.click(screen.getByRole("menuitem", { name: /Quick note/ }));
    const dialog = await screen.findByRole("dialog", { name: "Quick note" });
    await user.type(within(dialog).getByRole("textbox", { name: "Title (optional)" }), "Idea");
    await user.type(within(dialog).getByRole("textbox", { name: "Note" }), "Call the bank");
    await user.click(within(dialog).getByRole("button", { name: "Save to Inbox" }));

    expect(await screen.findByText("Saved to your Inbox")).toBeInTheDocument();
    const post = api.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      title: "Idea",
      note_type: "quick",
      text: "Call the bank",
    });
    expect(push).not.toHaveBeenCalled();
  });
});
