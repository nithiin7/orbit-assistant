import type { NoteFolder, NoteListQuery, NoteSort, NoteSummary } from "@orbit/contracts";

import type { Option } from "@/utils/common";
import { browserTimeZone, localParts } from "@/utils/time-zones";

/** The Notes page's fixed views. Folders and tags are views too, chosen by ID. */
export type NoteView =
  "inbox" | "all" | "recent" | "favorites" | "pinned" | "journal" | "archive" | "trash";

export const NOTE_VIEWS: readonly { id: NoteView; label: string }[] = [
  { id: "inbox", label: "Inbox" },
  { id: "all", label: "All notes" },
  { id: "recent", label: "Recent" },
  { id: "favorites", label: "Favorites" },
  { id: "pinned", label: "Pinned" },
  { id: "journal", label: "Journal" },
  { id: "archive", label: "Archive" },
  { id: "trash", label: "Trash" },
];

const VIEW_IDS = new Set<string>(NOTE_VIEWS.map((view) => view.id));
export const DEFAULT_NOTE_VIEW: NoteView = "all";

/** What the Notes page shows, as kept in its URL. */
export type NotesLocation = {
  view: NoteView;
  /** A folder or tag narrows the "all" view to it. */
  folderId: string | null;
  tagId: string | null;
  /** The open note. */
  noteId: string | null;
  /** The search, as typed. */
  search: string;
};

export const NOTES_PATH = "/notes";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idParam(value: string | null): string | null {
  return value && UUID.test(value) ? value.toLowerCase() : null;
}

export function parseNotesLocation(params: Pick<URLSearchParams, "get">): NotesLocation {
  const view = params.get("view");
  const folderId = idParam(params.get("folder"));
  const tagId = folderId ? null : idParam(params.get("tag"));
  return {
    view:
      folderId || tagId
        ? "all"
        : view && VIEW_IDS.has(view)
          ? (view as NoteView)
          : DEFAULT_NOTE_VIEW,
    folderId,
    tagId,
    noteId: idParam(params.get("note")),
    search: (params.get("q") ?? "").slice(0, 200),
  };
}

export function notesHref(location: Partial<NotesLocation>): string {
  const params = new URLSearchParams();
  if (location.folderId) params.set("folder", location.folderId);
  else if (location.tagId) params.set("tag", location.tagId);
  else if (location.view && location.view !== DEFAULT_NOTE_VIEW) params.set("view", location.view);
  if (location.search?.trim()) params.set("q", location.search.trim());
  if (location.noteId) params.set("note", location.noteId);
  const query = params.toString();
  return query ? `${NOTES_PATH}?${query}` : NOTES_PATH;
}

export const NOTE_SORTS: readonly Option<NoteSort>[] = [
  { value: "updated_at", label: "Last edited" },
  { value: "created_at", label: "Date created" },
  { value: "title", label: "Title" },
];

export const NOTES_PAGE_SIZE = 50;

/** The list query for a location. Search and sort apply to every view. */
export function toNoteListQuery(
  location: NotesLocation,
  sort: NoteSort,
  search: string,
  limit = NOTES_PAGE_SIZE,
): NoteListQuery {
  const query: NoteListQuery = { sort, limit, pinned_first: true };
  const q = search.trim();
  if (q) query.q = q;
  if (location.folderId) return { ...query, folder_id: location.folderId };
  if (location.tagId) return { ...query, tag_id: location.tagId };
  switch (location.view) {
    case "inbox":
      return { ...query, inbox: true, type: ["note", "quick"] };
    case "all":
      return { ...query, type: ["note", "quick"] };
    case "recent":
      // Most recently opened or edited, of every type; a search keeps that order too.
      return { ...query, sort: "recent", pinned_first: false, limit: Math.min(limit, 30) };
    case "favorites":
      return { ...query, favorite: true };
    case "pinned":
      return { ...query, pinned: true, pinned_first: false };
    case "journal":
      return { ...query, type: ["journal"], sort: "journal_date", pinned_first: false };
    case "archive":
      return { ...query, state: "archived", pinned_first: false };
    case "trash":
      return { ...query, state: "trashed", pinned_first: false };
  }
}

/** Whether a view's notes can be edited; archived and trashed ones are read-only. */
export function isReadOnly(note: Pick<NoteSummary, "archived_at" | "trashed_at">): boolean {
  return note.archived_at !== null || note.trashed_at !== null;
}

const journalDateFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** A calendar date (`YYYY-MM-DD`) as "Saturday, 31 October 2026", whatever the time zone. */
export function formatJournalDate(date: string): string {
  return journalDateFormat.format(new Date(`${date}T00:00:00Z`));
}

/** The name to show for a note: its title, its day for a journal entry, or "Untitled". */
export function noteDisplayTitle(
  note: Pick<NoteSummary, "title" | "journal_date" | "note_type">,
): string {
  if (note.title.trim()) return note.title;
  if (note.journal_date) return formatJournalDate(note.journal_date);
  return note.note_type === "quick" ? "Quick note" : "Untitled";
}

/** Tags compare without case or extra spaces, like the API. */
export function normalizeTagName(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export type FolderNode = {
  folder: NoteFolder;
  depth: number;
  children: FolderNode[];
};

/** Folders as a tree, siblings by name. Folders whose parent is missing sit at the top. */
export function buildFolderTree(folders: readonly NoteFolder[]): FolderNode[] {
  const ids = new Set(folders.map((folder) => folder.id));
  const byParent = new Map<string | null, NoteFolder[]>();
  for (const folder of folders) {
    const parent = folder.parent_id && ids.has(folder.parent_id) ? folder.parent_id : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), folder]);
  }
  const seen = new Set<string>();
  const build = (parent: string | null, depth: number): FolderNode[] =>
    (byParent.get(parent) ?? [])
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .filter((folder) => !seen.has(folder.id) && seen.add(folder.id))
      .map((folder) => ({ folder, depth, children: build(folder.id, depth + 1) }));
  return build(null, 0);
}

/** The tree in reading order, keeping only nodes whose ancestors are all expanded. */
export function visibleFolders(
  tree: readonly FolderNode[],
  expanded: ReadonlySet<string>,
): FolderNode[] {
  return tree.flatMap((node) => [
    node,
    ...(expanded.has(node.folder.id) ? visibleFolders(node.children, expanded) : []),
  ]);
}

/** Every folder in reading order, for pickers. */
export function flattenFolders(tree: readonly FolderNode[]): FolderNode[] {
  return tree.flatMap((node) => [node, ...flattenFolders(node.children)]);
}

/** The folder and all folders inside it: where it can't be moved. */
export function folderSubtree(folders: readonly NoteFolder[], folderId: string): Set<string> {
  const found = new Set([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parent_id && found.has(folder.parent_id) && !found.has(folder.id)) {
        found.add(folder.id);
        grew = true;
      }
    }
  }
  return found;
}

/** The folder's ancestors' names and its own, top first: "Work / Projects". */
export function folderPath(folders: readonly NoteFolder[], folderId: string | null): string[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: string[] = [];
  let current = folderId ? byId.get(folderId) : undefined;
  while (current && path.length < 20) {
    path.unshift(current.name);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return path;
}

/** The folder's ancestors, nearest last, so they can be expanded to reveal it. */
export function folderAncestors(folders: readonly NoteFolder[], folderId: string): string[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const ancestors: string[] = [];
  let parent = byId.get(folderId)?.parent_id;
  while (parent && parent !== folderId && !ancestors.includes(parent)) {
    ancestors.unshift(parent);
    parent = byId.get(parent)?.parent_id;
  }
  return ancestors;
}

export type TextPart = { text: string; match: boolean };

/** `text` split into runs that match one of `search`'s words (case-insensitive) and runs that
 *  don't, for highlighting results. */
export function highlightParts(text: string, search: string): TextPart[] {
  const terms = search
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (terms.length === 0 || !text) return [{ text, match: false }];
  const pattern = new RegExp(`(${terms.join("|")})`, "gi");
  return text
    .split(pattern)
    .filter((part) => part !== "")
    .map((part) => ({
      text: part,
      match: terms.some((term) => new RegExp(`^${term}$`, "i").test(part)),
    }));
}

/** Today's journal date (`YYYY-MM-DD`) in the user's time zone, else the browser's. */
export function journalToday(timeZone: string | null | undefined, now = new Date()): string {
  return localParts(now, timeZone || browserTimeZone()).date;
}

/** A file name for an exported note: its title, made safe for file systems. */
export function exportFileName(title: string): string {
  const base = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${base || "note"}.md`;
}
