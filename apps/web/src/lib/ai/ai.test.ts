import { describe, expect, it } from "vitest";

import {
  canAlwaysAdd,
  chatModelOptions,
  conversationTitleSchema,
  parseChatModelValue,
  quickAddTemplates,
  recordHref,
  splitCitations,
  suggestedQuestions,
} from "./ai";

const ref = (kind: string, id: string | null = "1b6f6b2e-0000-4000-8000-000000000001") => ({
  kind,
  id,
  title: "x",
  day: "2026-11-03",
  detail: "",
});

describe("recordHref", () => {
  it("links captured records to the module that keeps them", () => {
    expect(recordHref(ref("shopping_item"))).toBe("/shopping");
    expect(recordHref(ref("place"))).toBe("/places");
    expect(recordHref(ref("bookmark"))).toBe("/saved");
    expect(recordHref(ref("watch_item"))).toBe("/watchlist");
    expect(recordHref(ref("water"))).toBe("/health");
    expect(recordHref(ref("measurement"))).toBe("/health");
    expect(recordHref(ref("activity"))).toBe("/health");
  });

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

describe("chatModelOptions", () => {
  const model = (id: string, chat = true) => ({ id, chat, embeddings: !chat });

  it("lists one provider's chat models flat, keeping the current one first", () => {
    const options = chatModelOptions(
      [{ id: "p1", name: "Ollama", models: [model("llama3"), model("nomic-embed", false)] }],
      { providerId: "p1", model: "custom" },
    );
    expect(options).toEqual([
      { value: "p1|custom", label: "custom" },
      { value: "p1|llama3", label: "llama3" },
    ]);
  });

  it("groups several providers and skips ones with no models", () => {
    const options = chatModelOptions(
      [
        { id: "p1", name: "Ollama", models: [model("llama3")] },
        { id: "p2", name: "Empty", models: [] },
        { id: "p3", name: "OpenAI", models: [model("gpt")] },
      ],
      null,
    );
    expect(options).toEqual([
      { label: "Ollama", options: [{ value: "p1|llama3", label: "llama3" }] },
      { label: "OpenAI", options: [{ value: "p3|gpt", label: "gpt" }] },
    ]);
  });

  it("round-trips values whose model names contain the separator", () => {
    expect(parseChatModelValue("p1|org/model|v2")).toEqual({
      providerId: "p1",
      model: "org/model|v2",
    });
    expect(parseChatModelValue("bad")).toBeNull();
  });
});

describe("quick add", () => {
  it("offers templates only for modules AI may read", () => {
    const ids = (modules: Parameters<typeof quickAddTemplates>[0]) =>
      quickAddTemplates(modules).map((template) => template.id);
    expect(ids([])).toEqual([
      "task",
      "reminder",
      "event",
      "note",
      "shopping",
      "place",
      "birthday",
      "link",
    ]);
    expect(ids(["finance"])).toContain("expense");
    expect(ids(["health"])).toEqual(expect.arrayContaining(["water", "weight", "activity"]));
    expect(ids(["health"])).not.toContain("expense");
  });

  it("never offers to skip approval for money or events", () => {
    expect(canAlwaysAdd("add_shopping_item")).toBe(true);
    expect(canAlwaysAdd("add_transaction")).toBe(false);
    expect(canAlwaysAdd("create_event")).toBe(false);
    expect(canAlwaysAdd("append_to_note")).toBe(false);
    // A model could invent a birthday, so a new person is always a card.
    expect(canAlwaysAdd("add_person")).toBe(false);
  });
});
