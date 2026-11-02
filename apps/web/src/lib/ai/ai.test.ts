import { describe, expect, it } from "vitest";

import { conversationTitleSchema, recordHref, splitCitations, suggestedQuestions } from "./ai";

const ref = (kind: string, id: string | null = "1b6f6b2e-0000-4000-8000-000000000001") => ({
  kind,
  id,
  title: "x",
  day: "2026-11-03",
  detail: "",
});

describe("recordHref", () => {
  it("opens each record in its own module", () => {
    expect(recordHref(ref("task"))).toBe("/tasks?task=1b6f6b2e-0000-4000-8000-000000000001");
    expect(recordHref(ref("note"))).toContain("note=1b6f6b2e");
    expect(recordHref(ref("event"))).toContain("2026-11-03");
    expect(recordHref(ref("finance_summary", null))).toContain("/finance");
    expect(recordHref(ref("budget", null))).toContain("budgets");
    expect(recordHref(ref("unknown"))).toBeNull();
  });
});

describe("splitCitations", () => {
  it("separates citation markers from text", () => {
    expect(splitCitations("Due Friday [S1]. See [S2, S3].")).toEqual([
      { type: "text", text: "Due Friday " },
      { type: "cite", numbers: [1] },
      { type: "text", text: ". See " },
      { type: "cite", numbers: [2, 3] },
      { type: "text", text: "." },
    ]);
  });
});

describe("suggestedQuestions", () => {
  it("only suggests questions about allowed modules", () => {
    const questions = suggestedQuestions(["tasks"]);
    expect(questions).toEqual(["What tasks are overdue?", "What have I been working on recently?"]);
    expect(suggestedQuestions([])).toEqual([]);
  });
});

describe("conversationTitleSchema", () => {
  it("requires a single-line title within the limit", async () => {
    await expect(conversationTitleSchema.validate({ title: "" })).rejects.toThrow("Enter a title.");
    await expect(conversationTitleSchema.validate({ title: "x".repeat(201) })).rejects.toThrow();
    await expect(conversationTitleSchema.validate({ title: "Plans" })).resolves.toEqual({
      title: "Plans",
    });
  });
});
