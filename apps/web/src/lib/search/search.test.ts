import type { UniversalSearchHit } from "@orbit/contracts";
import { describe, expect, it } from "vitest";

import {
  activeFilterCount,
  clearFilters,
  describeHit,
  EMPTY_SEARCH,
  fromFilters,
  hitTitle,
  matchedIn,
  moduleFilters,
  parseSearchState,
  searchHref,
  searchResultHref,
  toFilters,
  toSearchQuery,
  withModule,
} from "./search";

function hit(overrides: Partial<UniversalSearchHit>): UniversalSearchHit {
  return {
    module: "tasks",
    entity_type: "task",
    id: "11111111-0000-4000-8000-000000000001",
    title: "Title",
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
    ...overrides,
  };
}

const CATEGORY = "22222222-0000-4000-8000-000000000002";

describe("searchResultHref", () => {
  it("opens each record in its own module", () => {
    const id = "11111111-0000-4000-8000-000000000001";
    expect(searchResultHref(hit({ entity_type: "task" }))).toBe(`/tasks?task=${id}`);
    expect(searchResultHref(hit({ entity_type: "note" }))).toBe(`/notes?note=${id}`);
    expect(searchResultHref(hit({ entity_type: "event", day: "2030-02-01" }))).toContain(
      "date=2030-02-01",
    );
    expect(searchResultHref(hit({ entity_type: "reminder" }))).toBe(`/reminders?reminder=${id}`);
    expect(searchResultHref(hit({ entity_type: "transaction" }))).toBe(
      `/finance?view=transactions&transaction=${id}`,
    );
    expect(searchResultHref(hit({ entity_type: "subscription" }))).toBe(
      "/finance?view=subscriptions",
    );
    expect(searchResultHref(hit({ entity_type: "holding" }))).toBe("/finance?view=investments");
    expect(searchResultHref(hit({ entity_type: "routine" }))).toBe(`/habits?routine=${id}`);
    expect(searchResultHref(hit({ entity_type: "document" }))).toContain(`document=${id}`);
    expect(searchResultHref(hit({ entity_type: "workout" }))).toBe(`/health?workout=${id}`);
    expect(searchResultHref(hit({ entity_type: "measurement" }))).toBe("/health?view=body");
  });
});

describe("describing hits", () => {
  it("gives titles to records without one", () => {
    expect(hitTitle(hit({ title: "", entity_type: "note" }))).toBe("Untitled note");
    expect(hitTitle(hit({ title: "", entity_type: "measurement" }))).toBe("Body measurement");
  });

  it("lists the kind, state, date, and details", () => {
    expect(
      describeHit(
        hit({
          active: false,
          status: "completed",
          day: "2030-04-10",
          details: [{ key: "priority", value: "high" }],
        }),
      ),
    ).toEqual(["Task", "Completed", expect.stringMatching(/^Due /), "High priority"]);
    expect(
      describeHit(
        hit({
          entity_type: "transaction",
          module: "finance",
          status: "expense",
          details: [{ key: "account", value: "Wallet" }],
        }),
      ),
    ).toEqual(["Transaction", "Expense", "Account: Wallet"]);
  });

  it("says where a match was, besides the title", () => {
    expect(matchedIn(["title"])).toBe("");
    expect(matchedIn(["tags"])).toBe("Matched in tags");
    expect(matchedIn(["title", "tags", "notes", "content"])).toBe(
      "Matched in tags, notes and text",
    );
  });
});

describe("search state in the URL", () => {
  it("round-trips the query, tab, and filters", () => {
    const state = {
      ...EMPTY_SEARCH,
      q: "garden",
      module: "tasks" as const,
      dateFrom: "2030-01-01",
      taskStatus: "open" as const,
      taskPriority: ["high" as const, "low" as const],
      includeArchived: true,
      sort: "recent" as const,
    };
    const href = searchHref(state);

    expect(href).toBe(
      "/search?q=garden&module=tasks&from=2030-01-01&status=open&priority=high&priority=low&archived=1&sort=recent",
    );
    expect(parseSearchState(new URL(href, "http://x").searchParams)).toEqual(state);
    expect(searchHref(EMPTY_SEARCH)).toBe("/search");
  });

  it("ignores malformed values and filters the tab doesn't offer", () => {
    const params = new URLSearchParams(
      "q=x&module=notes&from=yesterday&status=open&priority=high&category=nope&sort=random",
    );
    const state = parseSearchState(params);

    expect(state.module).toBe("notes");
    expect(state.dateFrom).toBe("");
    expect(state.taskStatus).toBeNull();
    expect(state.taskPriority).toEqual([]);
    expect(state.sort).toBe("relevance");
    expect(parseSearchState(new URLSearchParams("module=planets")).module).toBeNull();
  });

  it("offers filters only where records have them", () => {
    expect(moduleFilters(null)).toEqual([]);
    expect(moduleFilters("tasks")).toEqual(["taskStatus", "taskPriority"]);
    expect(moduleFilters("documents")).toEqual(["documentCategory"]);
    expect(moduleFilters("health")).toEqual([]);
  });

  it("switching tabs drops filters the new tab doesn't offer", () => {
    const tasks = {
      ...EMPTY_SEARCH,
      q: "x",
      module: "tasks" as const,
      taskStatus: "open" as const,
      dateFrom: "2030-01-01",
    };

    const notes = withModule(tasks, "notes");

    expect(notes.taskStatus).toBeNull();
    expect(notes.dateFrom).toBe("2030-01-01");
    expect(activeFilterCount(tasks)).toBe(2);
    expect(clearFilters(tasks)).toEqual({ ...EMPTY_SEARCH, q: "x", module: "tasks" });
  });

  it("converts to the API's filters and back", () => {
    const state = {
      ...EMPTY_SEARCH,
      q: "deed",
      module: "documents" as const,
      documentCategory: CATEGORY,
    };

    const filters = toFilters(state);

    expect(filters.module).toEqual(["documents"]);
    expect(filters.document_category).toBe(CATEGORY);
    expect(fromFilters("deed", filters)).toEqual(state);
    expect(toSearchQuery({ ...state, q: "  deed " }).q).toBe("deed");
  });
});
