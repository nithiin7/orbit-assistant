import type { Bookmark } from "@orbit/contracts";
import { describe, expect, it } from "vitest";

import {
  bookmarkSchema,
  bookmarksIn,
  bookmarkValues,
  changesOf,
  countViews,
  createRequestOf,
  hostOf,
  isWebUrl,
  newBookmarkValues,
  parseSavedView,
  parseTags,
  pinnedOf,
  savedHref,
  tagsOf,
} from "./bookmarks";

function bookmark(overrides: Partial<Bookmark> & Pick<Bookmark, "id">): Bookmark {
  return {
    collection_id: null,
    url: `https://example.com/${overrides.id}`,
    title: overrides.id,
    note: "",
    kind: "link",
    status: "reference",
    tags: [],
    pinned: false,
    open_count: 0,
    last_opened_at: null,
    created_at: "2026-11-01T09:00:00Z",
    updated_at: "2026-11-01T09:00:00Z",
    ...overrides,
  };
}

describe("isWebUrl", () => {
  it.each([
    ["https://example.com", true],
    ["  http://example.com/a?b=c  ", true],
    ["javascript:alert(1)", false],
    ["ftp://example.com", false],
    ["example.com", false],
    ["https://exa mple.com", false],
    ["", false],
    [`https://example.com/${"a".repeat(2048)}`, false],
  ])("%s → %s", (text, expected) => {
    expect(isWebUrl(text)).toBe(expected);
  });
});

it("shows hosts without www", () => {
  expect(hostOf("https://www.instagram.com/reel/abc")).toBe("instagram.com");
  expect(hostOf("not a url")).toBe("not a url");
});

it("parses comma-separated tags once each", () => {
  expect(parseTags(" recipes, Weekend ,, recipes ,RECIPES")).toEqual(["recipes", "Weekend"]);
  expect(parseTags("")).toEqual([]);
});

describe("views", () => {
  it("reads and writes the view in the address", () => {
    expect(parseSavedView(new URLSearchParams(""))).toEqual({ kind: "all" });
    expect(parseSavedView(new URLSearchParams("view=later"))).toEqual({ kind: "later" });
    expect(parseSavedView(new URLSearchParams("view=nope"))).toEqual({ kind: "all" });
    expect(parseSavedView(new URLSearchParams("collection=c1"))).toEqual({
      kind: "collection",
      id: "c1",
    });
    expect(savedHref({ kind: "all" })).toBe("/saved");
    expect(savedHref({ kind: "watch" })).toBe("/saved?view=watch");
    expect(savedHref({ kind: "collection", id: "c 1" })).toBe("/saved?collection=c%201");
  });

  it("counts each fixed view", () => {
    const all = [
      bookmark({ id: "a", pinned: true, collection_id: "c1" }),
      bookmark({ id: "b", kind: "reel", status: "later" }),
      bookmark({ id: "c", kind: "video", status: "done" }),
    ];
    expect(countViews(all)).toEqual({ all: 3, pinned: 1, later: 1, watch: 2, unfiled: 2 });
  });

  it("filters by text, tag, and collection, and sorts", () => {
    const all = [
      bookmark({ id: "grafana", title: "Grafana", note: "Prod dashboards", open_count: 9 }),
      bookmark({ id: "pasta", title: "Pasta", tags: ["Recipes"], collection_id: "c1" }),
      bookmark({
        id: "bread",
        title: "bread",
        tags: ["recipes"],
        collection_id: "c1",
        open_count: 2,
      }),
    ];
    const ids = (list: Bookmark[]) => list.map((entry) => entry.id);

    expect(ids(bookmarksIn(all, { kind: "all" }, { text: "prod DASH" }))).toEqual(["grafana"]);
    expect(ids(bookmarksIn(all, { kind: "all" }, { text: "example.com/pasta" }))).toEqual([
      "pasta",
    ]);
    expect(ids(bookmarksIn(all, { kind: "all" }, { tag: "RECIPES" }))).toEqual(["pasta", "bread"]);
    expect(ids(bookmarksIn(all, { kind: "collection", id: "c1" }, { sort: "title" }))).toEqual([
      "bread",
      "pasta",
    ]);
    expect(ids(bookmarksIn(all, { kind: "all" }, { sort: "used" }))).toEqual([
      "grafana",
      "bread",
      "pasta",
    ]);
    expect(tagsOf(all)).toEqual(["Recipes"]);
  });

  it("puts the most used pinned links first", () => {
    const all = [
      bookmark({ id: "a", pinned: true, open_count: 1 }),
      bookmark({ id: "b", pinned: true, open_count: 5 }),
      bookmark({ id: "c", open_count: 50 }),
    ];
    expect(pinnedOf(all).map((entry) => entry.id)).toEqual(["b", "a"]);
  });
});

describe("forms", () => {
  it("leaves a new link's title, kind, and status to the server", () => {
    const values = { ...newBookmarkValues("https://youtu.be/x", "c1"), tags: "a, b" };
    expect(createRequestOf(values)).toEqual({
      url: "https://youtu.be/x",
      title: null,
      note: "",
      kind: null,
      status: null,
      tags: ["a", "b"],
      pinned: false,
      collection_id: "c1",
    });
  });

  it("sends only changed fields", () => {
    const saved = bookmark({ id: "a", tags: ["x"], collection_id: "c1" });
    expect(changesOf(saved, bookmarkValues(saved))).toBeNull();
    expect(
      changesOf(saved, {
        ...bookmarkValues(saved),
        title: " New ",
        tags: "x, y",
        collectionId: "none",
        pinned: true,
      }),
    ).toEqual({ title: "New", tags: ["x", "y"], collection_id: null, pinned: true });
  });

  it("validates links and tags", async () => {
    const valid = newBookmarkValues("https://example.com");
    await expect(bookmarkSchema.isValid(valid)).resolves.toBe(true);
    await expect(bookmarkSchema.isValid({ ...valid, url: "javascript:alert(1)" })).resolves.toBe(
      false,
    );
    await expect(bookmarkSchema.isValid({ ...valid, url: "" })).resolves.toBe(false);
    await expect(
      bookmarkSchema.isValid({ ...valid, tags: Array.from({ length: 11 }, (_, i) => i).join(",") }),
    ).resolves.toBe(false);
    await expect(bookmarkSchema.isValid({ ...valid, tags: "a".repeat(31) })).resolves.toBe(false);
  });
});
