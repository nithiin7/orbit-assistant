import type { NoteContent } from "@orbit/contracts";
import { describe, expect, it } from "vitest";

import {
  documentText,
  documentToMarkdown,
  isAllowedHref,
  looksLikeMarkdown,
  markdownToDocument,
  noteHref,
  noteIdFromHref,
  titleFromMarkdown,
  withoutTitleHeading,
} from "./note-content";

const NOTE_ID = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";

const SAMPLE = `# Plan

Some **bold**, *italic*, ~~struck~~ and \`code\` text with a [link](https://example.com).

## Lists

- one
- two

1. first
2. second

- [ ] open item
- [x] done item

> A quote

\`\`\`ts
const answer = 42;
\`\`\`

| Name | Value |
| --- | --- |
| a | 1 |

---

See [the other note](${noteHref(NOTE_ID)}).
`;

function nodeTypes(content: unknown, found = new Set<string>()): Set<string> {
  if (typeof content !== "object" || content === null) return found;
  if ("type" in content && typeof content.type === "string") found.add(content.type);
  if ("marks" in content && Array.isArray(content.marks)) {
    for (const mark of content.marks) nodeTypes(mark, found);
  }
  if ("content" in content && Array.isArray(content.content)) {
    for (const child of content.content) nodeTypes(child, found);
  }
  return found;
}

describe("Markdown conversion", () => {
  it("imports every block and mark the editor supports", () => {
    const types = nodeTypes(markdownToDocument(SAMPLE));
    for (const type of [
      "heading",
      "paragraph",
      "bold",
      "italic",
      "strike",
      "code",
      "link",
      "bulletList",
      "orderedList",
      "taskList",
      "taskItem",
      "blockquote",
      "codeBlock",
      "table",
      "tableHeader",
      "tableCell",
      "horizontalRule",
    ]) {
      expect(types, type).toContain(type);
    }
  });

  it("keeps the content through an export and re-import", () => {
    const document = markdownToDocument(SAMPLE);
    const exported = documentToMarkdown(document);
    expect(exported).toContain("# Plan");
    expect(exported).toContain("**bold**");
    expect(exported).toContain("- [x] done item");
    expect(exported).toContain("```ts");
    expect(exported).toContain(`(${noteHref(NOTE_ID)})`);
    expect(markdownToDocument(exported)).toEqual(document);
  });

  it("exports a hand-built document", () => {
    const content: NoteContent = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Title" }] },
        {
          type: "paragraph",
          content: [{ type: "text", text: "hello", marks: [{ type: "italic" }] }],
        },
      ],
    };
    expect(documentToMarkdown(content)).toBe("## Title\n\n*hello*\n");
  });

  it("imports empty Markdown as an empty paragraph", () => {
    expect(markdownToDocument("   ")).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });
});

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

describe("helpers", () => {
  it("suggests a title from the first heading or line", () => {
    expect(titleFromMarkdown("\n# Groceries\nmilk")).toBe("Groceries");
    expect(titleFromMarkdown("plain first line\n")).toBe("plain first line");
    expect(titleFromMarkdown("", "Imported")).toBe("Imported");
    expect(withoutTitleHeading("# Groceries\nmilk")).toBe("milk");
    expect(withoutTitleHeading("## Sub\nmilk")).toBe("## Sub\nmilk");
  });

  it("recognizes Markdown worth converting on paste", () => {
    expect(looksLikeMarkdown("# Heading")).toBe(true);
    expect(looksLikeMarkdown("- item\n- item")).toBe(true);
    expect(looksLikeMarkdown("see [x](https://a.b)")).toBe(true);
    expect(looksLikeMarkdown("Just a sentence, nothing more.")).toBe(false);
  });

  it("reads a document's text one block per line", () => {
    expect(documentText(markdownToDocument("# A\n\nB *c*\n\n- d"))).toBe("A\nB c\nd");
  });
});
