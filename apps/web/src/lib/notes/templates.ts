/**
 * Ready-made notes, offered from the Notes empty view. Using one creates a note with the
 * template's title and Markdown body, then opens it for editing.
 */

import { CalendarCheck, Lightbulb, type LucideIcon, NotebookPen, Users } from "lucide-react";

export type NoteTemplate = {
  id: string;
  name: string;
  blurb: string;
  icon: LucideIcon;
  /** The new note's title. */
  title: string;
  /** The note's body, as Markdown. */
  markdown: string;
};

export const NOTE_TEMPLATES: readonly NoteTemplate[] = [
  {
    id: "meeting",
    name: "Meeting notes",
    blurb: "Who was there, what was decided, and what happens next.",
    icon: Users,
    title: "Meeting notes",
    markdown: [
      "## Attendees",
      "",
      "- ",
      "",
      "## Agenda",
      "",
      "1. ",
      "",
      "## Decisions",
      "",
      "- ",
      "",
      "## Action items",
      "",
      "- [ ] ",
    ].join("\n"),
  },
  {
    id: "weekly-review",
    name: "Weekly review",
    blurb: "Look back on the week and set up the next one.",
    icon: CalendarCheck,
    title: "Weekly review",
    markdown: [
      "## What went well",
      "",
      "- ",
      "",
      "## What was hard",
      "",
      "- ",
      "",
      "## Next week’s focus",
      "",
      "- [ ] ",
    ].join("\n"),
  },
  {
    id: "project-brief",
    name: "Project brief",
    blurb: "A one-page plan: the goal, the scope, and the first steps.",
    icon: Lightbulb,
    title: "Project brief",
    markdown: [
      "## Goal",
      "",
      "",
      "## Why it matters",
      "",
      "",
      "## In scope",
      "",
      "- ",
      "",
      "## Out of scope",
      "",
      "- ",
      "",
      "## First steps",
      "",
      "- [ ] ",
    ].join("\n"),
  },
  {
    id: "reading-notes",
    name: "Reading notes",
    blurb: "Key ideas and quotes from a book or article.",
    icon: NotebookPen,
    title: "Reading notes",
    markdown: [
      "## Source",
      "",
      "",
      "## Key ideas",
      "",
      "- ",
      "",
      "## Quotes",
      "",
      "> ",
      "",
      "## What I’ll do with it",
      "",
      "- ",
    ].join("\n"),
  },
];

/** A preview of the template: its section headings. */
export function noteTemplateSections(template: NoteTemplate): string[] {
  return template.markdown
    .split("\n")
    .filter((line) => line.startsWith("## "))
    .map((line) => line.slice(3));
}
