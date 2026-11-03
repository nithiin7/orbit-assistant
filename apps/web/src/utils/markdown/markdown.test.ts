import { describe, expect, it } from "vitest";

import { isSafeLink, parseInline, parseMarkdown } from "./markdown";

describe("parseMarkdown", () => {
  it("reads headings, lists, quotes, code, and paragraphs", () => {
    const blocks = parseMarkdown(
      "# Title\nSome *text* and **bold**.\n\n- one\n- two\n\n1. first\n2. second\n\n> quoted\n\n```py\nprint(1)\n```\n\n---",
    );
    expect(blocks.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "list",
      "list",
      "quote",
      "code",
      "rule",
    ]);
    expect(blocks[2]).toMatchObject({ type: "list", ordered: false });
    expect(blocks[3]).toMatchObject({ type: "list", ordered: true });
    expect(blocks[5]).toEqual({ type: "code", language: "py", text: "print(1)" });
  });

  it("parses inline emphasis, code, and links", () => {
    expect(parseInline("a **b** _c_ `d`")).toEqual([
      { type: "text", text: "a " },
      { type: "strong", children: [{ type: "text", text: "b" }] },
      { type: "text", text: " " },
      { type: "em", children: [{ type: "text", text: "c" }] },
      { type: "text", text: " " },
      { type: "code", text: "d" },
    ]);
  });

  it("drops unsafe links but keeps their text", () => {
    expect(parseInline("[x](javascript:void)")).toEqual([{ type: "text", text: "x" }]);
    expect(parseInline("[x](https://example.com)")[0]).toMatchObject({ type: "link" });
    expect(isSafeLink("/tasks")).toBe(true);
    expect(isSafeLink("//evil.com")).toBe(false);
    expect(isSafeLink("/\\evil.com")).toBe(false);
    expect(isSafeLink("/\t/evil.com")).toBe(false);
    expect(isSafeLink("/notes?note=1#top")).toBe(true);
    expect(isSafeLink("data:text/html,x")).toBe(false);
  });

  it("treats HTML as plain text", () => {
    expect(parseMarkdown("<img src=x onerror=alert(1)>")).toEqual([
      { type: "paragraph", children: [{ type: "text", text: "<img src=x onerror=alert(1)>" }] },
    ]);
  });
});
