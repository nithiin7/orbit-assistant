"""Note content (ProseMirror JSON) as Markdown, for the notes export.

Covers every node and mark the editor produces (`services.notes.content`): headings,
paragraphs, quotes, code blocks, bullet, numbered, and task lists, tables (GitHub-flavored),
rules, hard breaks, and bold, italic, strikethrough, code, and link marks. Underline has no
Markdown form and is written as plain text, as the web app's own Markdown export does. Links to
other notes keep their Orbit address (`/notes?note=<id>`).
"""

import json
import re
from typing import Any, cast

_ESCAPE = re.compile(r"([\\`*_\[\]<>|])")
_LINE_START = re.compile(r"^(\s*)([#>+-]|\d+[.)])(\s)")


def _children(node: dict[str, Any]) -> list[dict[str, Any]]:
    content = node.get("content")
    if not isinstance(content, list):
        return []
    return [
        cast(dict[str, Any], child)
        for child in cast(list[object], content)
        if isinstance(child, dict)
    ]


def _attrs(node: dict[str, Any]) -> dict[str, Any]:
    attrs = node.get("attrs")
    return cast(dict[str, Any], attrs) if isinstance(attrs, dict) else {}


def _text(node: dict[str, Any]) -> str:
    text = _ESCAPE.sub(r"\\\1", str(node.get("text", "")))
    marks = node.get("marks")
    if not isinstance(marks, list):
        return text
    href: str | None = None
    for mark in cast(list[object], marks):
        if not isinstance(mark, dict):
            continue
        kind = cast(dict[str, Any], mark).get("type")
        if kind == "bold":
            text = f"**{text}**"
        elif kind == "italic":
            text = f"*{text}*"
        elif kind == "strike":
            text = f"~~{text}~~"
        elif kind == "code":
            raw = str(node.get("text", ""))
            fence = "``" if "`" in raw else "`"
            text = f"{fence}{raw}{fence}"
        elif kind == "link":
            value = _attrs(cast(dict[str, Any], mark)).get("href")
            href = value if isinstance(value, str) else None
    if href:
        text = f"[{text}]({href.replace(')', '%29').replace(' ', '%20')})"
    return text


def _inline(node: dict[str, Any]) -> str:
    parts: list[str] = []
    for child in _children(node):
        if child.get("type") == "text":
            parts.append(_text(child))
        elif child.get("type") == "hardBreak":
            parts.append("\\\n")
        else:
            parts.append(_inline(child))
    return "".join(parts)


def _paragraph(node: dict[str, Any]) -> str:
    text = _inline(node)
    # Text that would read as a heading, quote, or list item at the start of a line.
    return "\n".join(_LINE_START.sub(r"\1\\\2\3", line) for line in text.split("\n"))


def _indent(text: str, prefix: str) -> str:
    pad = " " * len(prefix)
    lines = text.split("\n")
    return "\n".join([prefix + lines[0], *[(pad + line) if line else line for line in lines[1:]]])


def _list(node: dict[str, Any], ordered: bool) -> str:
    start = _attrs(node).get("start")
    number = start if isinstance(start, int) else 1
    items: list[str] = []
    for item in _children(node):
        if item.get("type") == "taskItem":
            prefix = "- [x] " if _attrs(item).get("checked") else "- [ ] "
        elif ordered:
            prefix = f"{number}. "
            number += 1
        else:
            prefix = "- "
        body = "\n\n".join(block for block in (_block(child) for child in _children(item)) if block)
        items.append(_indent(body or "", prefix))
    return "\n".join(items)


def _table(node: dict[str, Any]) -> str:
    rows: list[list[str]] = []
    for row in _children(node):
        cells = [
            " ".join(_inline(paragraph) for paragraph in _children(cell)).replace("\n", " ")
            for cell in _children(row)
        ]
        rows.append(cells)
    if not rows:
        return ""
    width = max(len(row) for row in rows)
    rows = [row + [""] * (width - len(row)) for row in rows]
    lines = ["| " + " | ".join(rows[0]) + " |", "| " + " | ".join(["---"] * width) + " |"]
    lines.extend("| " + " | ".join(row) + " |" for row in rows[1:])
    return "\n".join(lines)


def _block(node: dict[str, Any]) -> str:
    kind = node.get("type")
    if kind == "paragraph":
        return _paragraph(node)
    if kind == "heading":
        level = _attrs(node).get("level")
        hashes = "#" * (level if isinstance(level, int) and 1 <= level <= 6 else 1)
        return f"{hashes} {_inline(node)}"
    if kind == "blockquote":
        inner = "\n\n".join(_block(child) for child in _children(node))
        return "\n".join(f"> {line}" if line else ">" for line in inner.split("\n"))
    if kind == "codeBlock":
        language = _attrs(node).get("language")
        code = "".join(str(child.get("text", "")) for child in _children(node))
        fence = "````" if "```" in code else "```"
        return f"{fence}{language if isinstance(language, str) else ''}\n{code}\n{fence}"
    if kind == "bulletList" or kind == "taskList":
        return _list(node, ordered=False)
    if kind == "orderedList":
        return _list(node, ordered=True)
    if kind == "table":
        return _table(node)
    if kind == "horizontalRule":
        return "---"
    return _inline(node)


def to_markdown(content: str) -> str:
    """Markdown for a stored note document; empty for content that isn't a document."""
    try:
        document: object = json.loads(content)
    except ValueError:
        return ""
    if not isinstance(document, dict):
        return ""
    blocks = [_block(child) for child in _children(cast(dict[str, Any], document))]
    return "\n\n".join(block for block in blocks if block.strip()).strip() + "\n"
