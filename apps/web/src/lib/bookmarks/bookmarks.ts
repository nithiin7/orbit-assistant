/** Saved links ("bookmarks" in the API): views, filtering, labels, URLs, and form schemas. */

import type {
  Bookmark,
  BookmarkCollection,
  BookmarkCollectionColor,
  BookmarkKind,
  BookmarkStatus,
  CreateBookmarkRequest,
  UpdateBookmarkRequest,
} from "@orbit/contracts";
import { boolean, type InferType, mixed, object, string } from "yup";

import { TASK_LIST_COLORS } from "@/lib/tasks";
import { multiLineText, singleLineText } from "@/utils/validation";

export const SAVED_PATH = "/saved";
export const URL_MAX_LENGTH = 2048;
export const TITLE_MAX_LENGTH = 200;
export const NOTE_MAX_LENGTH = 1000;
export const TAG_MAX_LENGTH = 30;
export const MAX_TAGS = 10;
export const COLLECTION_NAME_MAX_LENGTH = 50;

export const KINDS: readonly BookmarkKind[] = ["link", "article", "video", "reel", "repo", "tool"];

export const KIND_LABELS: Record<BookmarkKind, string> = {
  link: "Link",
  article: "Article",
  video: "Video",
  reel: "Reel",
  repo: "Repository",
  tool: "Tool",
};

export const STATUSES: readonly BookmarkStatus[] = ["reference", "later", "done"];

export const STATUS_LABELS: Record<BookmarkStatus, string> = {
  reference: "Keep for reference",
  later: "Read or watch later",
  done: "Done",
};

/** Collections share the task lists' palette. */
export const COLLECTION_COLORS: readonly { value: BookmarkCollectionColor; label: string }[] =
  TASK_LIST_COLORS;

// Views

/** The fixed sections of the Saved page; collections come after them. */
export type FixedView = "all" | "pinned" | "later" | "watch" | "unfiled";

export type SavedView = { kind: FixedView } | { kind: "collection"; id: string };

export const FIXED_VIEWS: readonly { value: FixedView; label: string }[] = [
  { value: "all", label: "All links" },
  { value: "pinned", label: "Pinned" },
  { value: "later", label: "Read & watch later" },
  { value: "watch", label: "Reels & videos" },
  { value: "unfiled", label: "Not in a collection" },
];

/** The view in the address: `?view=` for a fixed one, `?collection=` for a collection. */
export function parseSavedView(params: URLSearchParams): SavedView {
  const collection = params.get("collection");
  if (collection) return { kind: "collection", id: collection };
  const view = params.get("view");
  return { kind: FIXED_VIEWS.find((option) => option.value === view)?.value ?? "all" };
}

export function savedHref(view: SavedView): string {
  if (view.kind === "collection") return `${SAVED_PATH}?collection=${encodeURIComponent(view.id)}`;
  return view.kind === "all" ? SAVED_PATH : `${SAVED_PATH}?view=${view.kind}`;
}

/** The Saved page with one bookmark open for editing, for links from search. */
export function bookmarkHref(bookmarkId: string): string {
  return `${SAVED_PATH}?bookmark=${encodeURIComponent(bookmarkId)}`;
}

/** The Saved page with "Save link" open and the URL filled in, for the command palette. */
export function saveLinkHref(url: string): string {
  return `${SAVED_PATH}?add=${encodeURIComponent(url)}`;
}

export function sameView(a: SavedView, b: SavedView): boolean {
  return (
    a.kind === b.kind && (a.kind !== "collection" || (b.kind === "collection" && a.id === b.id))
  );
}

export function inView(bookmark: Bookmark, view: SavedView): boolean {
  switch (view.kind) {
    case "all":
      return true;
    case "pinned":
      return bookmark.pinned;
    case "later":
      return bookmark.status === "later";
    case "watch":
      return bookmark.kind === "reel" || bookmark.kind === "video";
    case "unfiled":
      return bookmark.collection_id === null;
    case "collection":
      return bookmark.collection_id === view.id;
  }
}

export type FixedCounts = Record<FixedView, number>;

export function countViews(bookmarks: readonly Bookmark[]): FixedCounts {
  const counts: FixedCounts = { all: 0, pinned: 0, later: 0, watch: 0, unfiled: 0 };
  for (const bookmark of bookmarks) {
    for (const { value } of FIXED_VIEWS) {
      if (inView(bookmark, { kind: value })) counts[value] += 1;
    }
  }
  return counts;
}

export type SavedSort = "recent" | "used" | "title";

export const SORTS: readonly { value: SavedSort; label: string }[] = [
  { value: "recent", label: "Newest" },
  { value: "used", label: "Most used" },
  { value: "title", label: "A–Z" },
];

/** Whether a bookmark matches typed text: in its title, address, note, or tags. */
export function matchesText(bookmark: Bookmark, text: string): boolean {
  const words = text.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [bookmark.title, bookmark.url, bookmark.note, ...bookmark.tags]
    .join(" ")
    .toLocaleLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** The bookmarks in a view that match `text`, in `sort` order. The API lists newest first. */
export function bookmarksIn(
  bookmarks: readonly Bookmark[],
  view: SavedView,
  {
    text = "",
    sort = "recent",
    tag = null,
  }: { text?: string; sort?: SavedSort; tag?: string | null } = {},
): Bookmark[] {
  const shown = bookmarks.filter(
    (bookmark) =>
      inView(bookmark, view) &&
      matchesText(bookmark, text) &&
      (tag === null || bookmark.tags.some((entry) => sameTag(entry, tag))),
  );
  if (sort === "used") {
    return shown.sort(
      (a, b) =>
        b.open_count - a.open_count ||
        (b.last_opened_at ?? "").localeCompare(a.last_opened_at ?? ""),
    );
  }
  if (sort === "title") {
    return shown.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  }
  return shown;
}

/** Pinned bookmarks for the launcher: the most used first. */
export function pinnedOf(bookmarks: readonly Bookmark[]): Bookmark[] {
  return bookmarksIn(bookmarks, { kind: "pinned" }, { sort: "used" });
}

function sameTag(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;
}

/** Every tag used in `bookmarks`, once each (ignoring case), alphabetically. */
export function tagsOf(bookmarks: readonly Bookmark[]): string[] {
  const tags: string[] = [];
  for (const bookmark of bookmarks) {
    for (const tag of bookmark.tags) {
      if (!tags.some((entry) => sameTag(entry, tag))) tags.push(tag);
    }
  }
  return tags.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function viewTitle(view: SavedView, collections: readonly BookmarkCollection[]): string {
  if (view.kind === "collection") {
    return collections.find((entry) => entry.id === view.id)?.name ?? "Collection";
  }
  return FIXED_VIEWS.find((option) => option.value === view.kind)?.label ?? "All links";
}

// URLs

/** Whether `text` is a single web address Orbit accepts: `http` or `https`, with a host. */
export function isWebUrl(text: string): boolean {
  const value = text.trim();
  if (!value || /\s/.test(value) || value.length > URL_MAX_LENGTH) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
  } catch {
    return false;
  }
}

/** The site a link is on, without `www.`, for showing beside its title. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** The first letter of the site, for a link's placeholder icon. */
export function initialOf(bookmark: Pick<Bookmark, "url" | "title">): string {
  const host = hostOf(bookmark.url).replace(/^m\./, "");
  return (host.charAt(0) || bookmark.title.charAt(0) || "?").toLocaleUpperCase();
}

/** Tags typed as a comma-separated list: trimmed, blanks dropped, duplicates (ignoring case) once. */
export function parseTags(text: string): string[] {
  const tags: string[] = [];
  for (const raw of text.split(",")) {
    const tag = raw.trim();
    if (tag && !tags.some((entry) => sameTag(entry, tag))) tags.push(tag);
  }
  return tags;
}

// Forms

export const AUTO = "auto";
export const NO_COLLECTION = "none";

export const bookmarkSchema = object({
  url: string()
    .trim()
    .defined()
    .required("Paste or type a link.")
    .max(URL_MAX_LENGTH, `Use at most ${URL_MAX_LENGTH} characters.`)
    .test("web-url", "Use a web address starting with http:// or https://.", (value) =>
      isWebUrl(value),
    ),
  title: singleLineText(TITLE_MAX_LENGTH),
  note: multiLineText(NOTE_MAX_LENGTH),
  kind: mixed<BookmarkKind | typeof AUTO>()
    .oneOf([AUTO, ...KINDS])
    .defined(),
  status: mixed<BookmarkStatus | typeof AUTO>()
    .oneOf([AUTO, ...STATUSES])
    .defined(),
  collectionId: string().defined(),
  tags: string()
    .defined()
    .test(
      "tag-count",
      `Use at most ${MAX_TAGS} tags.`,
      (value) => parseTags(value).length <= MAX_TAGS,
    )
    .test("tag-length", `Keep each tag to ${TAG_MAX_LENGTH} characters.`, (value) =>
      parseTags(value).every((tag) => tag.length <= TAG_MAX_LENGTH),
    ),
  pinned: boolean().defined(),
});

export const collectionSchema = object({
  name: singleLineText(COLLECTION_NAME_MAX_LENGTH).required("Enter a name."),
  color: mixed<BookmarkCollectionColor>()
    .oneOf(COLLECTION_COLORS.map((item) => item.value))
    .defined(),
});

export type BookmarkValues = InferType<typeof bookmarkSchema>;

/** A new link's form: kind and status worked out from the address unless chosen. */
export function newBookmarkValues(url = "", collectionId: string | null = null): BookmarkValues {
  return {
    url,
    title: "",
    note: "",
    kind: AUTO,
    status: AUTO,
    collectionId: collectionId ?? NO_COLLECTION,
    tags: "",
    pinned: false,
  };
}

export function bookmarkValues(bookmark: Bookmark): BookmarkValues {
  return {
    url: bookmark.url,
    title: bookmark.title,
    note: bookmark.note,
    kind: bookmark.kind,
    status: bookmark.status,
    collectionId: bookmark.collection_id ?? NO_COLLECTION,
    tags: bookmark.tags.join(", "),
    pinned: bookmark.pinned,
  };
}

export function createRequestOf(values: BookmarkValues): CreateBookmarkRequest {
  return {
    url: values.url.trim(),
    title: values.title.trim() || null,
    note: values.note.trim(),
    kind: values.kind === AUTO ? null : values.kind,
    status: values.status === AUTO ? null : values.status,
    tags: parseTags(values.tags),
    pinned: values.pinned,
    collection_id: values.collectionId === NO_COLLECTION ? null : values.collectionId,
  };
}

/** Only the fields the form changed, or `null` when nothing did. */
export function changesOf(
  bookmark: Bookmark,
  values: BookmarkValues,
): UpdateBookmarkRequest | null {
  const changes: UpdateBookmarkRequest = {};
  const url = values.url.trim();
  const title = values.title.trim();
  const note = values.note.trim();
  const tags = parseTags(values.tags);
  const collectionId = values.collectionId === NO_COLLECTION ? null : values.collectionId;
  if (url !== bookmark.url) changes.url = url;
  if (title && title !== bookmark.title) changes.title = title;
  if (note !== bookmark.note) changes.note = note;
  if (values.kind !== AUTO && values.kind !== bookmark.kind) changes.kind = values.kind;
  if (values.status !== AUTO && values.status !== bookmark.status) changes.status = values.status;
  if (tags.join("\u0000") !== bookmark.tags.join("\u0000")) changes.tags = tags;
  if (values.pinned !== bookmark.pinned) changes.pinned = values.pinned;
  if (collectionId !== bookmark.collection_id) changes.collection_id = collectionId;
  return Object.keys(changes).length > 0 ? changes : null;
}
