import { describe, expect, it } from "vitest";

import { isAllowedHref, looksLikeMarkdown, noteHref, noteIdFromHref } from "./note-links";

const NOTE_ID = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";

describe("note links", () => {
  it("round-trips a note's ID through its link", () => {
    expect(noteIdFromHref(noteHref(NOTE_ID))).toBe(NOTE_ID);
    expect(noteIdFromHref("https://example.com/notes?note=" + NOTE_ID)).toBeNull();
    expect(noteIdFromHref("/notes?note=nope")).toBeNull();
  });

  it("allows only web, email, and note links", () => {
    expect(isAllowedHref("https://example.com")).toBe(true);
    expect(isAllowedHref("mailto:ada@example.com")).toBe(true);
    expect(isAllowedHref(noteHref(NOTE_ID))).toBe(true);
    expect(isAllowedHref("javascript:alert(1)")).toBe(false);
    expect(isAllowedHref("/settings")).toBe(false);
  });
});

describe("looksLikeMarkdown", () => {
  it("recognizes Markdown worth converting on paste", () => {
    expect(looksLikeMarkdown("# Heading")).toBe(true);
    expect(looksLikeMarkdown("- item\n- item")).toBe(true);
    expect(looksLikeMarkdown("see [x](https://a.b)")).toBe(true);
    expect(looksLikeMarkdown("Just a sentence, nothing more.")).toBe(false);
  });
});
