import { describe, expect, it } from "vitest";

import { asJsonContent, markdownToDocument } from "@/lib/note-content";

import { NOTE_TEMPLATES, noteTemplateSections } from "./templates";

describe("note templates", () => {
  it.each(NOTE_TEMPLATES.map((template) => [template.name, template] as const))(
    "%s becomes a document with a heading per section",
    (_name, template) => {
      const document = asJsonContent(markdownToDocument(template.markdown));
      const headings = (document.content ?? []).filter((node) => node.type === "heading");

      expect(headings).toHaveLength(noteTemplateSections(template).length);
      expect(noteTemplateSections(template).length).toBeGreaterThan(2);
    },
  );

  it("previews a template by its section headings", () => {
    const meeting = NOTE_TEMPLATES.find((template) => template.id === "meeting");
    expect(meeting && noteTemplateSections(meeting)).toEqual([
      "Attendees",
      "Agenda",
      "Decisions",
      "Action items",
    ]);
  });
});
