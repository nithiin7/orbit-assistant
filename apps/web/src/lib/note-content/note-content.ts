import type { NoteContent } from "@orbit/contracts";
import type { AnyExtension, JSONContent } from "@tiptap/core";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Markdown, MarkdownManager } from "@tiptap/markdown";
import { StarterKit } from "@tiptap/starter-kit";
import { common, createLowlight } from "lowlight";

/**
 * A note's content is the editor's document (ProseMirror JSON), the only stored copy of the text.
 * Markdown is never stored: it is converted to and from that document at the edges (import,
 * export, paste, copy) by the same extensions the editor uses, so the two can't drift apart.
 *
 * The API accepts exactly the nodes and marks these extensions produce (see
 * `apps/api/src/orbit_api/services/notes/content.py`). Add an extension there and here together.
 */

const lowlight = createLowlight(common);

const NOTE_HREF = /^\/notes\?note=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const SAFE_SCHEMES = ["http://", "https://", "mailto:"];

/** The URL a link to another note uses. Links name notes by ID, so renaming never breaks them. */
export function noteHref(noteId: string): string {
  return `/notes?note=${noteId}`;
}

/** The note a link points to, or `null` for any other link. */
export function noteIdFromHref(href: string): string | null {
  return NOTE_HREF.exec(href)?.[1]?.toLowerCase() ?? null;
}

/** Links a note may contain: web, email, and other notes. Mirrors the API's check. */
export function isAllowedHref(href: string): boolean {
  const lower = href.trim().toLowerCase();
  return noteIdFromHref(href) !== null || SAFE_SCHEMES.some((scheme) => lower.startsWith(scheme));
}

/** The editor's extensions, without anything that needs a browser view. */
export function noteExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      // Replaced by the highlighting code block below.
      codeBlock: false,
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: "https",
        isAllowedUri: (url) => isAllowedHref(url),
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: null },
      },
    }),
    CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    Markdown,
  ];
}

let manager: MarkdownManager | null = null;

function markdown(): MarkdownManager {
  manager ??= new MarkdownManager({ extensions: noteExtensions() });
  return manager;
}

export function emptyDocument(): NoteContent {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

/** Markdown as a note document. Anything the editor can't represent becomes plain text. */
export function markdownToDocument(text: string): NoteContent {
  const parsed = markdown().parse(text);
  if (!parsed.content?.length) return emptyDocument();
  return toNoteContent(parsed);
}

/** A note document as Markdown. Underline has no Markdown form and is left as plain text. */
export function documentToMarkdown(content: NoteContent): string {
  return markdown().serialize(asJsonContent(content)).trim() + "\n";
}

/** The document's first heading or line, as a suggested title for an imported note. */
export function titleFromMarkdown(text: string, fallback = ""): string {
  for (const line of text.split(/\r?\n/)) {
    const cleaned = line.replace(/^#{1,6}\s+/, "").trim();
    if (cleaned) return cleaned.slice(0, 200);
  }
  return fallback;
}

/** Markdown without its first line when that line is a level-one heading (used as the title). */
export function withoutTitleHeading(text: string): string {
  const lines = text.split(/\r?\n/);
  const first = lines.findIndex((line) => line.trim() !== "");
  if (first >= 0 && /^#\s+/.test(lines[first] ?? "")) lines.splice(first, 1);
  return lines.join("\n");
}

const MARKDOWN_HINTS = [
  /^#{1,6}\s/m, // headings
  /^\s*[-*+]\s+\[[ xX]\]\s/m, // checklists
  /^\s*([-*+]|\d+\.)\s+\S/m, // lists
  /^>\s/m, // quotes
  /^```/m, // code fences
  /^\|.+\|\s*$/m, // tables
  /\*\*[^*\n]+\*\*/, // bold
  /\[[^\]\n]+\]\([^)\s]+\)/, // links
];

/** Whether pasted plain text is probably Markdown, so it should be converted on paste. */
export function looksLikeMarkdown(text: string): boolean {
  return MARKDOWN_HINTS.some((hint) => hint.test(text));
}

/** The document's text, one block per line, for a quick preview or a character count. */
export function documentText(content: NoteContent): string {
  const blocks: string[] = [];
  const walk = (node: JSONContent, line: string[]): void => {
    if (node.type === "text") {
      line.push(node.text ?? "");
      return;
    }
    if (node.type === "hardBreak") {
      line.push("\n");
      return;
    }
    const own: string[] = [];
    for (const child of node.content ?? []) walk(child, own);
    if (own.length) blocks.push(own.join(""));
  };
  walk(asJsonContent(content), []);
  return blocks.filter((block) => block.trim()).join("\n");
}

/** A document's JSON as Tiptap's type. Both describe the same JSON; the API validated it. */
export function asJsonContent(content: NoteContent): JSONContent {
  return content as JSONContent;
}

/** Tiptap's JSON as the contract's type: a round trip through JSON drops `undefined` fields. */
export function toNoteContent(content: JSONContent): NoteContent {
  const json: unknown = JSON.parse(JSON.stringify(content));
  if (typeof json !== "object" || json === null || Array.isArray(json)) return emptyDocument();
  return json as NoteContent;
}
