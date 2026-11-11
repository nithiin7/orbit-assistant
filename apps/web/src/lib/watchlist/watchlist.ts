/** Watchlist grouping, labels, episode progress, the "tonight" picker, and form schemas. */

import type { WatchItem, WatchKind, WatchProgress, WatchStatus } from "@orbit/contracts";
import { object, string } from "yup";

import type { Cheer } from "@/lib/habits";
import { multiLineText, singleLineText } from "@/utils/validation";

export const TITLE_MAX_LENGTH = 300;
export const PLATFORM_MAX_LENGTH = 60;
export const RECOMMENDED_BY_MAX_LENGTH = 100;
export const NOTES_MAX_LENGTH = 2000;

export const STATUSES: readonly WatchStatus[] = ["want", "watching", "watched", "dropped"];

export const STATUS_LABELS: Record<WatchStatus, string> = {
  want: "Want to watch",
  watching: "Watching",
  watched: "Watched",
  dropped: "Dropped",
};

export const KIND_LABELS: Record<WatchKind, string> = { movie: "Movie", series: "Series" };

export type KindFilter = WatchKind | "all";

/** Search narrowing in the Add dialog: a kind, and the language a title was made in. */
export type TitleSearchFilters = { kind: KindFilter; language: string | null };

/** Original languages offered when searching (ISO 639-1), common ones on TMDB. */
const SEARCH_LANGUAGE_CODES = [
  "ar",
  "bn",
  "da",
  "de",
  "en",
  "es",
  "fa",
  "fr",
  "he",
  "hi",
  "id",
  "it",
  "ja",
  "kn",
  "ko",
  "ml",
  "mr",
  "nl",
  "no",
  "pa",
  "pl",
  "pt",
  "ru",
  "sv",
  "ta",
  "te",
  "th",
  "tl",
  "tr",
  "zh",
] as const;

const languageNames = new Intl.DisplayNames(["en"], { type: "language" });

/** "Korean" for `ko`; the code itself if the browser doesn't know it. */
export function languageName(code: string): string {
  try {
    return languageNames.of(code) ?? code;
  } catch {
    return code;
  }
}

export const ANY_LANGUAGE = "any";

export const SEARCH_LANGUAGES: readonly { value: string; label: string }[] = [
  { value: ANY_LANGUAGE, label: "Any language" },
  ...SEARCH_LANGUAGE_CODES.map((code) => ({ value: code, label: languageName(code) })).sort(
    (a, b) => a.label.localeCompare(b.label),
  ),
];

/** The Watchlist's sections: an overview, suggestions, then one per status. */
export type WatchView = "overview" | "suggestions" | WatchStatus;

export const WATCH_VIEWS: readonly { value: WatchView; label: string }[] = [
  { value: "overview", label: "Up next" },
  { value: "suggestions", label: "For you" },
  { value: "want", label: STATUS_LABELS.want },
  { value: "watching", label: STATUS_LABELS.watching },
  { value: "watched", label: STATUS_LABELS.watched },
  { value: "dropped", label: STATUS_LABELS.dropped },
];

export function parseWatchView(params: URLSearchParams): WatchView {
  const view = params.get("view");
  return WATCH_VIEWS.find((option) => option.value === view)?.value ?? "overview";
}

export function isStatusView(view: WatchView): view is WatchStatus {
  return (STATUSES as readonly string[]).includes(view);
}

export function watchlistHref(view: WatchView): string {
  return view === "overview" ? "/watchlist" : `/watchlist?view=${view}`;
}

/** The Watchlist with one title's sheet open, for links from search. */
export function watchTitleHref(itemId: string): string {
  return `/watchlist?title=${encodeURIComponent(itemId)}`;
}

/** "default" is the status's own order: queue order, or most recently finished for Watched. */
export type TitleSort = "default" | "title";

export function sortOptions(status: WatchStatus): readonly { value: TitleSort; label: string }[] {
  return [
    { value: "default", label: status === "watched" ? "Recently finished" : "Queue order" },
    { value: "title", label: "Name (A–Z)" },
  ];
}

const byName = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** Whether a title is of the chosen kind. */
export function matchesKind(item: { kind: WatchKind }, kind: KindFilter): boolean {
  return kind === "all" || item.kind === kind;
}

/**
 * The titles in one status, filtered by kind and platform. By default watched titles come most
 * recently finished first and the rest keep the queue order the API returns; `sort: "title"`
 * orders them by name instead (ignoring case and accents, "Alien 3" before "Alien 10").
 */
export function titlesIn(
  items: readonly WatchItem[],
  status: WatchStatus,
  {
    kind = "all",
    platform = null,
    sort = "default",
  }: { kind?: KindFilter; platform?: string | null; sort?: TitleSort } = {},
): WatchItem[] {
  const matching = items.filter(
    (item) =>
      item.status === status &&
      matchesKind(item, kind) &&
      (platform === null || item.platform === platform),
  );
  if (sort === "title") {
    matching.sort(
      (a, b) => byName.compare(a.title, b.title) || (a.release_year ?? 0) - (b.release_year ?? 0),
    );
  } else if (status === "watched") {
    matching.sort((a, b) => (b.finished_at ?? "").localeCompare(a.finished_at ?? ""));
  }
  return matching;
}

export function countByStatus(items: readonly WatchItem[]): Record<WatchStatus, number> {
  const counts: Record<WatchStatus, number> = { want: 0, watching: 0, watched: 0, dropped: 0 };
  for (const item of items) counts[item.status] += 1;
  return counts;
}

/** The platforms in use, most used first, for filter chips. */
export function platformsOf(items: readonly WatchItem[]): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.platform) counts.set(item.platform, (counts.get(item.platform) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([platform]) => platform);
}

/** The genres in use, alphabetically. */
export function genresOf(items: readonly WatchItem[]): string[] {
  return [...new Set(items.flatMap((item) => item.genres))].sort((a, b) => a.localeCompare(b));
}

/** "2h 35m", "48m". */
export function formatRuntime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** "Similar to “Dune” and “Saga”", from the titles a suggestion was recommended from. */
export function becauseLine(titles: readonly string[]): string | null {
  if (titles.length === 0) return null;
  const quoted = titles.map((title) => `“${title}”`);
  const list =
    quoted.length === 1
      ? quoted[0]
      : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1) ?? ""}`;
  return `Similar to ${list}`;
}

/** "S2 · E5". */
export function episodeLabel(progress: WatchProgress): string {
  return `S${progress.season} · E${progress.episode}`;
}

/** A short line under a title: year, then runtime or seasons. */
export function metaLine(item: WatchItem): string {
  const parts: string[] = [];
  if (item.release_year) parts.push(String(item.release_year));
  if (item.kind === "series") {
    const seasons = item.season_episodes?.length;
    parts.push(seasons ? `${seasons} season${seasons === 1 ? "" : "s"}` : "Series");
  } else if (item.runtime_minutes) {
    parts.push(formatRuntime(item.runtime_minutes));
  } else {
    parts.push("Movie");
  }
  return parts.join(" · ");
}

export type SeriesProgress = {
  /** Episodes watched, when the seasons are known. */
  watched: number | null;
  total: number | null;
  /** The episode to watch next, or `null` once the last known one is done. */
  next: WatchProgress | null;
};

/** Where a series stands: how far through it is, and what's next. */
export function seriesProgress(item: WatchItem): SeriesProgress {
  const seasons = item.season_episodes ?? null;
  const current = item.progress;
  const total = seasons ? seasons.reduce((sum, count) => sum + count, 0) : null;
  let watched: number | null = null;
  if (seasons) {
    watched = current
      ? seasons.slice(0, current.season - 1).reduce((sum, count) => sum + count, 0) +
        current.episode
      : 0;
    watched = Math.min(watched, total ?? watched);
  }
  return { watched, total, next: nextEpisode(current ?? null, seasons) };
}

/** The episode after `current`, mirroring the API's rule. */
export function nextEpisode(
  current: WatchProgress | null,
  seasons: readonly number[] | null,
): WatchProgress | null {
  if (current === null) return { season: 1, episode: 1 };
  if (!seasons || current.season > seasons.length) {
    return { season: current.season, episode: current.episode + 1 };
  }
  if (current.episode < (seasons[current.season - 1] ?? 0)) {
    return { season: current.season, episode: current.episode + 1 };
  }
  if (current.season < seasons.length) return { season: current.season + 1, episode: 1 };
  return null;
}

/** Ratings are half stars out of five, stored as 1 to 10. */
export function ratingLabel(rating: number): string {
  const stars = rating / 2;
  return `${stars} star${stars === 1 ? "" : "s"}`;
}

/** A cheer for finishing a title. */
export function finishedCheer(item: WatchItem): Cheer {
  return item.kind === "series"
    ? {
        icon: "popcorn",
        title: `Finished ${item.title}`,
        message: "Every episode, done. Give it a rating while it's fresh.",
        big: true,
      }
    : {
        icon: "film",
        title: `Watched ${item.title}`,
        message: "Give it a rating while it's fresh.",
        big: false,
      };
}

// "What should I watch tonight?"

export type TimeBudget = "any" | "short" | "evening" | "episode";

export const TIME_BUDGETS: readonly { value: TimeBudget; label: string; hint: string }[] = [
  { value: "any", label: "Any length", hint: "No limit" },
  { value: "episode", label: "An episode", hint: "A series to continue or start" },
  { value: "short", label: "Under 100 min", hint: "A shorter movie" },
  { value: "evening", label: "Up to 2½ hours", hint: "A full movie night" },
];

export type TonightFilters = { time: TimeBudget; genre: string | null };

/**
 * Titles that fit tonight: anything wanted, plus series in progress. A movie with an unknown
 * length fits any time limit, since it might.
 */
export function tonightCandidates(
  items: readonly WatchItem[],
  { time, genre }: TonightFilters,
): WatchItem[] {
  return items.filter((item) => {
    const active = item.status === "want" || (item.status === "watching" && item.kind === "series");
    if (!active) return false;
    if (genre !== null && !item.genres.includes(genre)) return false;
    switch (time) {
      case "any":
        return true;
      case "episode":
        return item.kind === "series";
      case "short":
        return item.kind === "movie" && (item.runtime_minutes ?? 0) < 100;
      case "evening":
        return item.kind === "movie" && (item.runtime_minutes ?? 0) <= 150;
    }
  });
}

/**
 * One title from `candidates`, skipping those already suggested until every one has been. Titles
 * nearer the front of the queue are a little likelier, so "up next" means something.
 */
export function pickTonight(
  candidates: readonly WatchItem[],
  skipped: ReadonlySet<string>,
  random: () => number = Math.random,
): WatchItem | null {
  const fresh = candidates.filter((item) => !skipped.has(item.id));
  const pool = fresh.length > 0 ? fresh : candidates;
  if (pool.length === 0) return null;
  const weights = pool.map((_, index) => 1 / (1 + index * 0.15));
  let roll = random() * weights.reduce((sum, weight) => sum + weight, 0);
  for (const [index, item] of pool.entries()) {
    roll -= weights[index] ?? 0;
    if (roll <= 0) return item;
  }
  return pool.at(-1) ?? null;
}

// Forms

const yearField = string()
  .trim()
  .defined()
  .test("year", "Enter a year such as 2021.", (value) => {
    if (!value) return true;
    const year = Number(value);
    return /^\d{4}$/.test(value) && year >= 1870 && year <= 2200;
  });

const runtimeField = string()
  .trim()
  .defined()
  .test("runtime", "Enter the length in minutes.", (value) => {
    if (!value) return true;
    const minutes = Number(value);
    return /^\d{1,4}$/.test(value) && minutes >= 1 && minutes <= 6000;
  });

/** A title entered by hand. */
export const manualTitleSchema = object({
  title: singleLineText(TITLE_MAX_LENGTH).required("Enter a title."),
  year: yearField,
  platform: singleLineText(PLATFORM_MAX_LENGTH),
});

/** The details a person edits on any title. */
export const titleDetailsSchema = object({
  title: singleLineText(TITLE_MAX_LENGTH).required("Enter a title."),
  year: yearField,
  runtime: runtimeField,
  platform: singleLineText(PLATFORM_MAX_LENGTH),
  recommendedBy: singleLineText(RECOMMENDED_BY_MAX_LENGTH),
  notes: multiLineText(NOTES_MAX_LENGTH),
});

export function optionalNumber(value: string): number | null {
  return value.trim() ? Number(value) : null;
}
