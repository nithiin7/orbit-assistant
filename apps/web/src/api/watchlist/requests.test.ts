import { afterEach, describe, expect, it, vi } from "vitest";

import { searchTitles } from "./requests";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchTitles", () => {
  it("sends the kind and language only when chosen", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(Response.json({ results: [] })));
    vi.stubGlobal("fetch", fetchMock);

    await searchTitles("token", "w1", "dark");
    await searchTitles("token", "w1", "dark", { kind: "series", language: "de" });

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toEqual([
      "http://localhost:8000/api/v1/workspaces/w1/watchlist/search?q=dark",
      "http://localhost:8000/api/v1/workspaces/w1/watchlist/search?q=dark&kind=series&language=de",
    ]);
  });
});
