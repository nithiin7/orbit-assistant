import type { NoteFolder } from "@orbit/contracts";
import { describe, expect, it } from "vitest";

import {
  buildFolderTree,
  exportFileName,
  flattenFolders,
  folderAncestors,
  folderPath,
  folderSubtree,
  formatJournalDate,
  highlightParts,
  journalToday,
  noteDisplayTitle,
  notesHref,
  parseNotesLocation,
  toNoteListQuery,
  visibleFolders,
} from "./notes";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";

function folder(id: string, name: string, parent: string | null = null): NoteFolder {
  return {
    id,
    name,
    parent_id: parent,
    note_count: 0,
    created_at: "2026-10-31T00:00:00Z",
    updated_at: "2026-10-31T00:00:00Z",
  };
}

describe("locations", () => {
  it("reads the view, folder, tag, note, and search from the URL", () => {
    const params = new URLSearchParams({ view: "trash", note: A, q: "milk" });
    expect(parseNotesLocation(params)).toEqual({
      view: "trash",
      folderId: null,
      tagId: null,
      noteId: A,
      search: "milk",
    });
    expect(parseNotesLocation(new URLSearchParams({ folder: B, view: "trash" }))).toMatchObject({
      view: "all",
      folderId: B,
    });
  });

  it("ignores unknown views and malformed IDs", () => {
    const location = parseNotesLocation(new URLSearchParams({ view: "nope", note: "x" }));
    expect(location.view).toBe("all");
    expect(location.noteId).toBeNull();
  });

  it("writes locations back as URLs", () => {
    expect(notesHref({ view: "all" })).toBe("/notes");
    expect(notesHref({ view: "journal", noteId: A })).toBe(`/notes?view=journal&note=${A}`);
    expect(notesHref({ folderId: B, view: "inbox", search: " x " })).toBe(`/notes?folder=${B}&q=x`);
    const round = parseNotesLocation(
      new URL(notesHref({ tagId: C }), "http://o.test").searchParams,
    );
    expect(round.tagId).toBe(C);
  });
});

describe("list queries", () => {
  const base = { folderId: null, tagId: null, noteId: null, search: "" };

  it("maps each view to its filters", () => {
    expect(toNoteListQuery({ ...base, view: "inbox" }, "updated_at", "")).toMatchObject({
      inbox: true,
      type: ["note", "quick"],
    });
    expect(toNoteListQuery({ ...base, view: "journal" }, "title", "")).toMatchObject({
      type: ["journal"],
      sort: "journal_date",
    });
    expect(toNoteListQuery({ ...base, view: "trash" }, "title", "")).toMatchObject({
      state: "trashed",
    });
    expect(toNoteListQuery({ ...base, view: "recent" }, "title", "").sort).toBe("recent");
    expect(toNoteListQuery({ ...base, view: "favorites" }, "title", "").favorite).toBe(true);
  });

  it("narrows to a folder or tag and adds the search", () => {
    const query = toNoteListQuery({ ...base, view: "all", folderId: A }, "title", " soup ");
    expect(query).toMatchObject({ folder_id: A, q: "soup", sort: "title" });
    expect(toNoteListQuery({ ...base, view: "all", tagId: B }, "title", "").tag_id).toBe(B);
  });
});

describe("folder tree", () => {
  const folders = [folder(B, "Work"), folder(C, "Projects", B), folder(A, "Archive")];

  it("nests folders under their parents, siblings by name", () => {
    const tree = buildFolderTree(folders);
    expect(tree.map((node) => node.folder.name)).toEqual(["Archive", "Work"]);
    expect(tree[1]?.children.map((node) => [node.folder.name, node.depth])).toEqual([
      ["Projects", 1],
    ]);
    expect(flattenFolders(tree).map((node) => node.folder.name)).toEqual([
      "Archive",
      "Work",
      "Projects",
    ]);
  });

  it("shows children only of expanded folders", () => {
    const tree = buildFolderTree(folders);
    expect(visibleFolders(tree, new Set()).length).toBe(2);
    expect(visibleFolders(tree, new Set([B])).length).toBe(3);
  });

  it("survives a cycle in the data", () => {
    const cyclic = [folder(A, "a", B), folder(B, "b", A)];
    expect(flattenFolders(buildFolderTree(cyclic))).toEqual([]);
    expect(folderAncestors(cyclic, A)).toEqual([B]);
  });

  it("finds subtrees, paths, and ancestors", () => {
    expect(folderSubtree(folders, B)).toEqual(new Set([B, C]));
    expect(folderPath(folders, C)).toEqual(["Work", "Projects"]);
    expect(folderAncestors(folders, C)).toEqual([B]);
    expect(folderPath(folders, null)).toEqual([]);
  });
});

describe("display", () => {
  it("names untitled notes and journal entries", () => {
    expect(noteDisplayTitle({ title: "Plan", journal_date: null, note_type: "note" })).toBe("Plan");
    expect(noteDisplayTitle({ title: " ", journal_date: null, note_type: "note" })).toBe(
      "Untitled",
    );
    expect(noteDisplayTitle({ title: "", journal_date: null, note_type: "quick" })).toBe(
      "Quick note",
    );
    expect(noteDisplayTitle({ title: "", journal_date: "2026-10-31", note_type: "journal" })).toBe(
      formatJournalDate("2026-10-31"),
    );
    expect(formatJournalDate("2026-10-31")).toContain("2026");
  });

  it("splits text into highlighted search matches", () => {
    expect(highlightParts("Buy milk and Milky bars", "milk")).toEqual([
      { text: "Buy ", match: false },
      { text: "milk", match: true },
      { text: " and ", match: false },
      { text: "Milk", match: true },
      { text: "y bars", match: false },
    ]);
    expect(highlightParts("a+b", "+")).toEqual([
      { text: "a", match: false },
      { text: "+", match: true },
      { text: "b", match: false },
    ]);
    expect(highlightParts("plain", "")).toEqual([{ text: "plain", match: false }]);
  });
});

describe("journal and export", () => {
  it("uses the user's time zone for today's date", () => {
    // 20:00 UTC on 31 October is already 1 November in Kiritimati (UTC+14).
    const instant = new Date("2026-10-31T20:00:00Z");
    expect(journalToday("Pacific/Kiritimati", instant)).toBe("2026-11-01");
    expect(journalToday("America/Los_Angeles", instant)).toBe("2026-10-31");
  });

  it("makes safe export file names", () => {
    expect(exportFileName("Plan: Q4/Q1?")).toBe("Plan Q4 Q1.md");
    expect(exportFileName("   ")).toBe("note.md");
  });
});
