import type { WatchItem } from "@orbit/contracts";
import { describe, expect, it } from "vitest";

import {
  becauseLine,
  countByStatus,
  formatRuntime,
  metaLine,
  nextEpisode,
  pickTonight,
  platformsOf,
  seriesProgress,
  titlesIn,
  tonightCandidates,
} from "./watchlist";

function title(id: string, overrides: Partial<WatchItem> = {}): WatchItem {
  return {
    id,
    workspace_id: "w1",
    kind: "movie",
    title: id,
    release_year: null,
    overview: "",
    genres: [],
    runtime_minutes: null,
    season_episodes: null,
    status: "want",
    progress: null,
    rating: null,
    notes: "",
    platform: null,
    recommended_by: null,
    looked_up: false,
    has_poster: false,
    position: 0,
    started_at: null,
    finished_at: null,
    created_at: "2026-11-01T09:00:00Z",
    updated_at: "2026-11-01T09:00:00Z",
    ...overrides,
  } satisfies WatchItem;
}

describe("titlesIn", () => {
  it("filters by status, kind, and platform, keeping queue order", () => {
    const items = [
      title("a", { platform: "Netflix" }),
      title("b", { kind: "series" }),
      title("c", { status: "watching" }),
      title("d", { platform: "Netflix" }),
    ];

    expect(titlesIn(items, "want").map((item) => item.id)).toEqual(["a", "b", "d"]);
    expect(titlesIn(items, "want", { kind: "series" }).map((item) => item.id)).toEqual(["b"]);
    expect(titlesIn(items, "want", { platform: "Netflix" }).map((item) => item.id)).toEqual([
      "a",
      "d",
    ]);
    expect(countByStatus(items)).toEqual({ want: 3, watching: 1, watched: 0, dropped: 0 });
  });

  it("lists watched titles most recently finished first", () => {
    const items = [
      title("old", { status: "watched", finished_at: "2026-10-01T00:00:00Z" }),
      title("new", { status: "watched", finished_at: "2026-11-01T00:00:00Z" }),
    ];

    expect(titlesIn(items, "watched").map((item) => item.id)).toEqual(["new", "old"]);
  });

  it("orders by name when asked, ignoring case and comparing numbers", () => {
    const items = [
      title("1", { title: "alien 10" }),
      title("2", { title: "Zodiac", kind: "series" }),
      title("3", { title: "Alien 3" }),
      title("4", { title: "Élite", kind: "series" }),
      title("5", { title: "Brazil", status: "watched", finished_at: "2026-11-01T00:00:00Z" }),
      title("6", { title: "Amélie", status: "watched", finished_at: "2026-10-01T00:00:00Z" }),
    ];
    const names = (list: WatchItem[]) => list.map((item) => item.title);

    expect(names(titlesIn(items, "want", { sort: "title" }))).toEqual([
      "Alien 3",
      "alien 10",
      "Élite",
      "Zodiac",
    ]);
    expect(names(titlesIn(items, "want", { sort: "title", kind: "series" }))).toEqual([
      "Élite",
      "Zodiac",
    ]);
    expect(names(titlesIn(items, "watched"))).toEqual(["Brazil", "Amélie"]);
    expect(names(titlesIn(items, "watched", { sort: "title" }))).toEqual(["Amélie", "Brazil"]);
  });
});

describe("becauseLine", () => {
  it("names the titles a suggestion came from", () => {
    expect(becauseLine([])).toBeNull();
    expect(becauseLine(["Dune"])).toBe("Similar to “Dune”");
    expect(becauseLine(["Dune", "Saga", "Dark"])).toBe("Similar to “Dune”, “Saga” and “Dark”");
  });
});

describe("labels", () => {
  it("formats runtimes and meta lines", () => {
    expect(formatRuntime(155)).toBe("2h 35m");
    expect(formatRuntime(48)).toBe("48m");
    expect(formatRuntime(120)).toBe("2h");
    expect(metaLine(title("m", { release_year: 2021, runtime_minutes: 155 }))).toBe(
      "2021 · 2h 35m",
    );
    expect(metaLine(title("s", { kind: "series", season_episodes: [8, 10] }))).toBe("2 seasons");
  });

  it("orders platforms by use", () => {
    const items = [
      title("a", { platform: "Prime" }),
      title("b", { platform: "Netflix" }),
      title("c", { platform: "Netflix" }),
    ];
    expect(platformsOf(items)).toEqual(["Netflix", "Prime"]);
  });
});

describe("series progress", () => {
  it("counts episodes and finds the next one", () => {
    const series = title("s", {
      kind: "series",
      season_episodes: [2, 3],
      progress: { season: 1, episode: 2 },
    });

    expect(seriesProgress(series)).toEqual({
      watched: 2,
      total: 5,
      next: { season: 2, episode: 1 },
    });
    expect(nextEpisode({ season: 2, episode: 3 }, [2, 3])).toBeNull();
    expect(nextEpisode(null, null)).toEqual({ season: 1, episode: 1 });
    expect(nextEpisode({ season: 4, episode: 9 }, null)).toEqual({ season: 4, episode: 10 });
  });
});

describe("tonight", () => {
  const items = [
    title("short", { runtime_minutes: 90, genres: ["Comedy"] }),
    title("long", { runtime_minutes: 170 }),
    title("unknown"),
    title("show", { kind: "series", status: "watching" }),
    title("done", { status: "watched", runtime_minutes: 80 }),
  ];

  it("keeps titles that fit the time and mood", () => {
    const ids = (time: "any" | "short" | "evening" | "episode", genre: string | null = null) =>
      tonightCandidates(items, { time, genre }).map((item) => item.id);

    expect(ids("any")).toEqual(["short", "long", "unknown", "show"]);
    expect(ids("short")).toEqual(["short", "unknown"]);
    expect(ids("evening")).toEqual(["short", "unknown"]);
    expect(ids("episode")).toEqual(["show"]);
    expect(ids("any", "Comedy")).toEqual(["short"]);
  });

  it("doesn't repeat a pick until every title has had a turn", () => {
    const candidates = tonightCandidates(items, { time: "any", genre: null });

    expect(pickTonight(candidates, new Set(), () => 0)?.id).toBe("short");
    expect(pickTonight(candidates, new Set(["short"]), () => 0)?.id).toBe("long");
    expect(pickTonight(candidates, new Set(candidates.map((item) => item.id)), () => 0)?.id).toBe(
      "short",
    );
    expect(pickTonight([], new Set())).toBeNull();
  });
});
