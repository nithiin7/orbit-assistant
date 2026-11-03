import type { UniversalSearchHit, UniversalSearchResults } from "@orbit/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ada, json, mockApi, type MockRequest, personal, status } from "@/test/api-mock";
import { renderSignedIn } from "@/test/session";

import { SearchView } from "./search-view";

// The URL, as a tiny store: `router.replace` changes it and the page re-renders, like Next.js.
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
const replace = vi.hoisted(() => vi.fn((href: string) => url.set(href)));
const push = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => "/search",
  useSearchParams: () => new URLSearchParams(useSyncExternalStore(url.subscribe, url.get, url.get)),
}));

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

function hit(overrides: Partial<UniversalSearchHit> & Pick<UniversalSearchHit, "id" | "title">) {
  const base: UniversalSearchHit = {
    module: "tasks",
    entity_type: "task",
    id: overrides.id,
    title: overrides.title,
    snippet: "",
    matched_fields: ["title"],
    match: "title_phrase",
    score: 600,
    active: true,
    status: "open",
    details: [],
    day: null,
    starts_at: null,
    all_day: false,
    parent_id: null,
    updated_at: "2030-01-01T00:00:00Z",
  };
  return { ...base, ...overrides };
}

function page(
  hits: UniversalSearchHit[],
  { total = hits.length, offset = 0, hasMore = false, unavailable = [] as string[] } = {},
): UniversalSearchResults {
  return {
    query: "garden",
    sort: "relevance",
    offset,
    limit: 20,
    total,
    has_more: hasMore,
    hits,
    facets: MODULES.map((module) => ({
      module,
      total: hits.filter((h) => h.module === module).length,
      unavailable: unavailable.includes(module),
    })),
    unavailable: unavailable as UniversalSearchResults["unavailable"],
  };
}

const task = hit({ id: "t1", title: "Water the garden", day: "2030-05-01" });
const note = hit({
  id: "n1",
  module: "notes",
  entity_type: "note",
  title: "Plans",
  snippet: "Tomatoes by the garden fence",
  matched_fields: ["content"],
  match: "content",
  status: "note",
});

type Handler = (request: MockRequest) => Response | Promise<Response>;

function routes(extra: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    "GET /api/v1/auth/config": json({ provider: "local", registration_open: false }),
    "GET /api/v1/me": json(ada),
    "GET /api/v1/me/avatar": status(204),
    "GET /api/v1/workspaces": json({ workspaces: [personal] }),
    [`GET ${SEARCH}/results`]: json(page([task, note])),
    [`GET ${SEARCH}/recent`]: json({ searches: [] }),
    [`GET ${SEARCH}/saved`]: json({ searches: [] }),
    [`POST ${SEARCH}/recent`]: json({ id: "r", query: "garden", used_at: "2030-01-01T00:00:00Z" }),
    ...extra,
  };
}

function searchUrls(api: ReturnType<typeof mockApi>): URL[] {
  return api.mock.calls
    .map(([input]) => new URL(String(input)))
    .filter((requested) => requested.pathname === `${SEARCH}/results`);
}

async function renderSearch(extra?: Record<string, Handler>) {
  const api = mockApi(routes(extra));
  await renderSignedIn(<SearchView />);
  return { api, field: screen.getByRole("combobox", { name: "Search everything" }) };
}

beforeEach(() => {
  url.set("/search");
  replace.mockClear();
  push.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("SearchView", () => {
  it("searches as you type, with highlighted matches and counts per module", async () => {
    const user = userEvent.setup();
    const { api, field } = await renderSearch();

    await user.type(field, "garden");

    const results = await screen.findByRole("listbox", { name: "Search results" });
    const options = within(results).getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent("Water the garden");
    expect(options[0]).toHaveTextContent("in Tasks");
    expect(within(options[0]!).getByText("garden", { selector: "mark" })).toBeInTheDocument();
    expect(options[1]).toHaveTextContent("Tomatoes by the garden fence");
    expect(options[1]).toHaveTextContent("Matched in text");
    expect(screen.getByRole("button", { name: "Tasks 1" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "All 2" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("2 results");
    // The query reaches the address, so the search can be shared.
    await waitFor(() => expect(url.get()).toBe("q=garden"));
    // Typing is debounced: no request for each keystroke.
    expect(searchUrls(api).every((requested) => requested.searchParams.get("q") === "garden")).toBe(
      true,
    );
  });

  it("opens the highlighted result with the keyboard and remembers the search", async () => {
    const user = userEvent.setup();
    const { api, field } = await renderSearch();
    await user.type(field, "garden");
    await screen.findByRole("listbox", { name: "Search results" });

    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(screen.getByRole("option", { name: /Plans/ })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowUp}");
    expect(field).toHaveAttribute("aria-activedescendant", expect.stringContaining("task-t1"));
    await user.keyboard("{Enter}");

    expect(push).toHaveBeenCalledWith("/tasks?task=t1");
    await waitFor(() => {
      const posted = api.mock.calls.find(
        ([input, init]) => String(input).endsWith("/search/recent") && init?.method === "POST",
      );
      expect(JSON.parse(String(posted?.[1]?.body))).toEqual({ query: "garden" });
    });
  });

  it("clears the field with Escape", async () => {
    const user = userEvent.setup();
    const { field } = await renderSearch();
    await user.type(field, "garden");
    await screen.findByRole("listbox", { name: "Search results" });

    await user.keyboard("{Escape}");

    expect(field).toHaveValue("");
    await waitFor(() => expect(url.get()).toBe(""));
  });

  it("narrows to a module and shows only the filters that module has", async () => {
    const user = userEvent.setup();
    url.set("/search?q=garden");
    const { api } = await renderSearch();
    await screen.findByRole("listbox", { name: "Search results" });

    await user.click(screen.getByRole("button", { name: /^Filters/ }));
    expect(screen.queryByRole("group", { name: "Priority" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tasks 1" }));

    expect(url.get()).toBe("q=garden&module=tasks");
    await user.click(within(screen.getByRole("group", { name: "Priority" })).getByText("High"));
    expect(url.get()).toBe("q=garden&module=tasks&priority=high");
    await waitFor(() => {
      const last = searchUrls(api).at(-1);
      expect(last?.searchParams.getAll("module")).toEqual(["tasks"]);
      expect(last?.searchParams.getAll("task_priority")).toEqual(["high"]);
    });

    await user.click(screen.getByRole("button", { name: /^Notes/ }));
    expect(url.get()).toBe("q=garden&module=notes");
    expect(screen.queryByRole("group", { name: "Priority" })).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Include archived" })).toBeInTheDocument();
  });

  it("loads more results on request", async () => {
    const user = userEvent.setup();
    const first = Array.from({ length: 20 }, (_, index) =>
      hit({ id: `a${index}`, title: `Garden ${index}` }),
    );
    let calls = 0;
    url.set("/search?q=garden");
    const { api } = await renderSearch({
      [`GET ${SEARCH}/results`]: () => {
        calls += 1;
        return Response.json(
          calls === 1
            ? page(first, { total: 21, hasMore: true })
            : page([hit({ id: "last", title: "Garden last" })], { total: 21, offset: 20 }),
        );
      },
    });

    expect(await screen.findByText("Showing 20 of 21")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByRole("option", { name: /last/ })).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(21);
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    expect(searchUrls(api).at(-1)?.searchParams.get("offset")).toBe("20");
  });

  it("shows an empty state, and errors with a retry", async () => {
    const user = userEvent.setup();
    let fail = true;
    url.set("/search?q=nothing");
    await renderSearch({
      [`GET ${SEARCH}/results`]: () =>
        fail ? Response.json({ detail: "boom" }, { status: 500 }) : Response.json(page([])),
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t search just now.");
    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("No results for “nothing”")).toBeInTheDocument();
  });

  it("says when a module couldn't be searched and shows the rest", async () => {
    url.set("/search?q=garden");
    await renderSearch({
      [`GET ${SEARCH}/results`]: json(page([task], { unavailable: ["finance"] })),
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Some modules couldn’t be searched just now (Finance)",
    );
    expect(screen.getByRole("option", { name: /Water the\s*garden/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finance –" })).toBeInTheDocument();
  });

  it("lists recent searches before typing, runs one, and clears the history", async () => {
    const user = userEvent.setup();
    let recent = [{ id: "r1", query: "garden", used_at: "2030-01-01T00:00:00Z" }];
    const { api } = await renderSearch({
      [`GET ${SEARCH}/recent`]: () => Response.json({ searches: recent }),
      [`DELETE ${SEARCH}/recent`]: () => {
        recent = [];
        return new Response(null, { status: 204 });
      },
    });

    await user.click(await screen.findByRole("button", { name: "garden" }));
    expect(screen.getByRole("combobox", { name: "Search everything" })).toHaveValue("garden");
    expect(await screen.findByRole("listbox", { name: "Search results" })).toBeInTheDocument();

    await user.clear(screen.getByRole("combobox", { name: "Search everything" }));
    await user.click(await screen.findByRole("button", { name: "Clear history" }));
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Recent searches" })).not.toBeInTheDocument(),
    );
    expect(api.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
  });

  it("saves the search with its filters and reopens saved searches", async () => {
    const user = userEvent.setup();
    const saved = {
      id: "s1",
      name: "Open tasks",
      query: "launch",
      filters: {
        module: ["tasks"],
        type: [],
        date_from: null,
        date_to: null,
        updated_from: null,
        updated_to: null,
        created_from: null,
        created_to: null,
        task_status: "open",
        task_priority: [],
        document_category: null,
        transaction_type: [],
        habit_kind: [],
        include_archived: false,
        sort: "relevance",
      },
      created_at: "2030-01-01T00:00:00Z",
      updated_at: "2030-01-01T00:00:00Z",
    };
    url.set("/search?q=garden&module=tasks&status=open");
    const { api } = await renderSearch({
      [`POST ${SEARCH}/saved`]: json(saved, 201),
      [`GET ${SEARCH}/saved`]: json({ searches: [saved] }),
    });
    await screen.findByRole("listbox", { name: "Search results" });

    await user.click(screen.getByRole("button", { name: "Save search" }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Open tasks{Enter}");

    await waitFor(() => {
      const posted = api.mock.calls.find(
        ([input, init]) => String(input).endsWith("/search/saved") && init?.method === "POST",
      );
      const body = JSON.parse(String(posted?.[1]?.body)) as { name: string; filters: object };
      expect(body.name).toBe("Open tasks");
      expect(body.filters).toMatchObject({ module: ["tasks"], task_status: "open" });
    });
    await waitFor(() =>
      expect(screen.queryByRole("form", { name: "Save search" })).not.toBeInTheDocument(),
    );

    await user.clear(screen.getByRole("combobox", { name: "Search everything" }));
    await user.click(await screen.findByRole("button", { name: /^Open tasks/ }));
    expect(url.get()).toBe("q=launch&module=tasks&status=open");
    expect(screen.getByRole("combobox", { name: "Search everything" })).toHaveValue("launch");
  });
});
