/**
 * A small Markdown parser for rendering model output safely. It produces plain data (blocks of
 * inline runs) that components render as React elements, so no HTML from the text is ever
 * interpreted. Supported: headings, paragraphs, bullet and numbered lists, block quotes, fenced
 * code, horizontal rules, and inline bold, italic, code, and links (http, https, mailto, and
 * in-app paths only).
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: Inline[] };

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "quote"; children: Inline[] }
  | { type: "code"; language: string; text: string }
  | { type: "rule" };

const SAFE_LINK = /^(https?:\/\/|mailto:|\/)/i;
// Browsers read `/\host` as `//host` and drop tabs and newlines inside URLs, so a relative link
// with either could leave the app. Real in-app paths have neither.
const UNSAFE_IN_PATH = /[\\\s\p{Cc}]/u;

export function isSafeLink(href: string): boolean {
  const link = href.trim();
  if (!SAFE_LINK.test(link)) return false;
  return !link.startsWith("/") || (!link.startsWith("//") && !UNSAFE_IN_PATH.test(link));
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length) {
      blocks.push({ type: "paragraph", children: parseInline(paragraph.join(" ")) });
      paragraph = [];
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    const fence = /^```\s*([\w-]*)/.exec(trimmed);
    if (fence) {
      flush();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      blocks.push({ type: "code", language: fence[1] ?? "", text: body.join("\n") });
      continue;
    }
    if (!trimmed) {
      flush();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flush();
      const level = Math.min(3, (heading[1] ?? "#").length);
      blocks.push({
        type: "heading",
        level: level === 1 ? 1 : level === 2 ? 2 : 3,
        children: parseInline(heading[2] ?? ""),
      });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flush();
      blocks.push({ type: "rule" });
      continue;
    }
    if (trimmed.startsWith(">")) {
      flush();
      const quoted: string[] = [];
      while (index < lines.length && (lines[index] ?? "").trim().startsWith(">")) {
        quoted.push((lines[index] ?? "").trim().replace(/^>\s?/, ""));
        index += 1;
      }
      index -= 1;
      blocks.push({ type: "quote", children: parseInline(quoted.join(" ")) });
      continue;
    }
    const item = /^([-*+]|\d{1,3}[.)])\s+(.*)$/.exec(trimmed);
    if (item) {
      flush();
      const ordered = /\d/.test(item[1] ?? "");
      const items: Inline[][] = [];
      while (index < lines.length) {
        const current = /^([-*+]|\d{1,3}[.)])\s+(.*)$/.exec((lines[index] ?? "").trim());
        if (!current || /\d/.test(current[1] ?? "") !== ordered) break;
        items.push(parseInline(current[2] ?? ""));
        index += 1;
      }
      index -= 1;
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    paragraph.push(trimmed);
  }
  flush();
  return blocks;
}

export function parseInline(text: string): Inline[] {
  const result: Inline[] = [];
  let buffer = "";
  const pushText = () => {
    if (buffer) {
      result.push({ type: "text", text: buffer });
      buffer = "";
    }
  };

  let index = 0;
  while (index < text.length) {
    const rest = text.slice(index);
    const code = /^`([^`]+)`/.exec(rest);
    if (code) {
      pushText();
      result.push({ type: "code", text: code[1] ?? "" });
      index += code[0].length;
      continue;
    }
    const strong = /^(\*\*|__)(.+?)\1/.exec(rest);
    if (strong) {
      pushText();
      result.push({ type: "strong", children: parseInline(strong[2] ?? "") });
      index += strong[0].length;
      continue;
    }
    const em = /^(\*|_)(?!\s)(.+?)(?<!\s)\1(?![*_\w])/.exec(rest);
    if (em) {
      pushText();
      result.push({ type: "em", children: parseInline(em[2] ?? "") });
      index += em[0].length;
      continue;
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest);
    if (link) {
      pushText();
      const label = parseInline(link[1] ?? "");
      const href = link[2] ?? "";
      if (isSafeLink(href)) result.push({ type: "link", href, children: label });
      else result.push(...label);
      index += link[0].length;
      continue;
    }
    buffer += text[index];
    index += 1;
  }
  pushText();
  return result;
}
