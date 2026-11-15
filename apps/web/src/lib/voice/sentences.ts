/**
 * Turning a streamed Markdown answer into sentences to speak, in order, as they complete.
 *
 * Speaking sentence by sentence starts audio while the answer is still being written, keeps each
 * speech request short (browsers cut long utterances; providers take a while for long text), and
 * lets an interruption drop what hasn't been said yet.
 */

/** Longest chunk sent to a speech engine; longer sentences are split at a pause or a space. */
export const MAX_CHUNK_CHARS = 280;
/** Very short sentences ("Sure.") are joined to the next one so speech doesn't stutter. */
const MIN_CHUNK_CHARS = 24;

/** Markdown and citation markers removed, so they aren't read aloud. */
export function speakableText(markdown: string): string {
  return (
    markdown
      // Code is shown, not read.
      .replace(/```[\s\S]*?(```|$)/g, " ")
      .replace(/`([^`]*)`/g, "$1")
      // Citation markers like [S1] or [S1, S2].
      .replace(/\[S\d+(?:\s*,\s*S\d+)*\]/g, "")
      // Links keep their text; bare URLs aren't read character by character.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/https?:\/\/\S+/g, "")
      // Emphasis, headings, quotes, list markers, tables.
      .replace(/(\*\*|__|\*|_|~~)(?=\S)([^\n]*?\S)\1/g, "$2")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s{0,3}>\s?/gm, "")
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
      .replace(/\|/g, " ")
      .replace(/[ \t]+/g, " ")
  );
}

// A sentence ends at ., !, ?, or the Devanagari danda, followed by a space; or at a line break.
const BOUNDARY = /([.!?।]+["')\]]*)\s+|\n+/g;

/** Split finished text into chunks no longer than `MAX_CHUNK_CHARS`. */
function limit(sentence: string): string[] {
  const out: string[] = [];
  let rest = sentence.trim();
  while (rest.length > MAX_CHUNK_CHARS) {
    const window = rest.slice(0, MAX_CHUNK_CHARS);
    const pause = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "));
    const cut = pause > MAX_CHUNK_CHARS / 2 ? pause + 1 : window.lastIndexOf(" ");
    const at = cut > 0 ? cut : MAX_CHUNK_CHARS;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Collects streamed text and hands back whole sentences. Text is cleaned only once a sentence is
 * complete, since Markdown markers can span deltas.
 */
export class SentenceSplitter {
  private buffer = "";
  private carry = "";

  /** Add streamed text; returns the chunks it completed. */
  push(delta: string): string[] {
    this.buffer += delta;
    const out: string[] = [];
    let start = 0;
    BOUNDARY.lastIndex = 0;
    for (let match = BOUNDARY.exec(this.buffer); match; match = BOUNDARY.exec(this.buffer)) {
      const end = match.index + (match[1]?.length ?? 0);
      out.push(...this.emit(this.buffer.slice(start, end)));
      start = match.index + match[0].length;
    }
    this.buffer = this.buffer.slice(start);
    return out;
  }

  /** The answer finished: return whatever is left. */
  flush(): string[] {
    const out = this.emit(this.buffer, true);
    this.buffer = "";
    return out;
  }

  private emit(raw: string, final = false): string[] {
    const text = speakableText(raw).trim();
    const joined = [this.carry, text].filter(Boolean).join(" ");
    if (!joined) return [];
    if (!final && joined.length < MIN_CHUNK_CHARS) {
      this.carry = joined;
      return [];
    }
    this.carry = "";
    return limit(joined);
  }
}
