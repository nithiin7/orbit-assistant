/**
 * Links to notes, and which links a note may contain. Kept apart from `@/lib/note-content`,
 * which loads the editor, so pages that only link to notes don't download it.
 */

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
