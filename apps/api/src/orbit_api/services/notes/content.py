"""The note document: validation, plain text, and links to other notes.

A note's content is the editor's document as ProseMirror JSON (`{"type": "doc", "content": […]}`),
the only stored copy of the text. Everything else is derived from it here, on every save:

- `plain_text`, for search and list previews;
- the IDs of notes it links to, which become `note_links` rows (and so backlinks).

Only the node and mark types the web editor uses are accepted, so a stored document always loads
in the editor, and link targets are limited to web, mail, and internal note links, so a document
can't carry a `javascript:` URL. Pure Python, so it is unit-tested without a database.
"""

import json
import re
import uuid
from dataclasses import dataclass
from typing import cast

CONTENT_FORMAT = "prosemirror-v1"
MAX_CONTENT_LENGTH = 1_000_000
MAX_DEPTH = 40

# Leaf and container nodes the editor (Tiptap's starter kit, task lists, and tables) produces.
_BLOCK_NODES = frozenset(
    {
        "paragraph",
        "heading",
        "blockquote",
        "codeBlock",
        "bulletList",
        "orderedList",
        "listItem",
        "taskList",
        "taskItem",
        "table",
        "tableRow",
        "tableCell",
        "tableHeader",
        "horizontalRule",
    }
)
_INLINE_NODES = frozenset({"text", "hardBreak"})
_NODES = _BLOCK_NODES | _INLINE_NODES | {"doc"}
_MARKS = frozenset({"bold", "italic", "underline", "strike", "code", "link"})

# Notes link to each other with an app-relative URL, so the link also works when the Markdown is
# exported, and the target is a stable ID rather than a title.
_NOTE_HREF = re.compile(
    r"^/notes\?note=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$", re.IGNORECASE
)
_SAFE_SCHEMES = ("http://", "https://", "mailto:")


class InvalidDocumentError(ValueError):
    """The content isn't a document the editor can load."""


@dataclass(frozen=True, slots=True)
class NoteDocument:
    """Validated content and what is derived from it."""

    # Compact JSON, as stored.
    json: str
    plain_text: str
    linked_note_ids: frozenset[uuid.UUID]


def note_href(note_id: uuid.UUID) -> str:
    """The URL a link to `note_id` uses inside note content."""
    return f"/notes?note={note_id}"


def linked_note_id(href: str) -> uuid.UUID | None:
    match = _NOTE_HREF.match(href)
    return uuid.UUID(match.group(1)) if match else None


def build_document(value: object) -> NoteDocument:
    """Validate an editor document and derive its plain text and note links.

    Raises `InvalidDocumentError` with a message safe to show to the user.
    """
    root = _as_object(value)
    if root is None or root.get("type") != "doc":
        raise InvalidDocumentError("must be an editor document with type 'doc'")
    blocks: list[str] = []
    links: set[uuid.UUID] = set()
    _walk(root, 0, blocks, [], links)
    text = json.dumps(root, ensure_ascii=False, separators=(",", ":"))
    if len(text) > MAX_CONTENT_LENGTH:
        raise InvalidDocumentError("is too long; split it into several notes")
    plain = "\n".join(block for block in blocks if block)
    return NoteDocument(json=text, plain_text=plain, linked_note_ids=frozenset(links))


def load_document(text: str) -> NoteDocument:
    """A stored document, re-derived. Stored content was validated when it was saved."""
    return build_document(json.loads(text))


def document_from_text(text: str) -> NoteDocument:
    """A document of plain paragraphs, one per line, such as a quick capture typed as text."""
    paragraphs: list[dict[str, object]] = []
    for line in text.splitlines():
        paragraph: dict[str, object] = {"type": "paragraph"}
        if line.strip():
            paragraph["content"] = [{"type": "text", "text": line}]
        paragraphs.append(paragraph)
    return build_document({"type": "doc", "content": paragraphs or [{"type": "paragraph"}]})


def _as_object(value: object) -> dict[str, object] | None:
    """`value` as a JSON object, or `None` if it isn't one."""
    if not isinstance(value, dict):
        return None
    items = cast(dict[object, object], value)
    if not all(isinstance(key, str) for key in items):
        return None
    return cast(dict[str, object], items)


def _as_array(value: object) -> list[object] | None:
    return cast(list[object], value) if isinstance(value, list) else None


def _walk(
    node: dict[str, object],
    depth: int,
    blocks: list[str],
    line: list[str],
    links: set[uuid.UUID],
) -> None:
    """Check `node` and its children, collecting text into `line` and finished lines into
    `blocks`. A block's text is its own line; nested blocks start new lines."""
    if depth > MAX_DEPTH:
        raise InvalidDocumentError("is nested too deeply")
    kind = node.get("type")
    if not isinstance(kind, str) or kind not in _NODES:
        raise InvalidDocumentError(f"contains an unsupported element: {_describe(kind)}")
    if "attrs" in node and node["attrs"] is not None and _as_object(node["attrs"]) is None:
        raise InvalidDocumentError("has an element with invalid attributes")

    if kind == "text":
        text = node.get("text")
        if not isinstance(text, str) or not text:
            raise InvalidDocumentError("has a text element without text")
        _check_marks(node.get("marks"), links)
        line.append(text)
        return
    if kind == "hardBreak":
        line.append("\n")
        return
    if node.get("marks") is not None:
        raise InvalidDocumentError("has marks on an element that can't have them")

    children = _as_array(node.get("content", []))
    if children is None:
        raise InvalidDocumentError("has an element with invalid content")
    is_block = kind in _BLOCK_NODES
    if is_block:
        _flush(blocks, line)
    for child in children:
        child_node = _as_object(child)
        if child_node is None:
            raise InvalidDocumentError("has an element that isn't an object")
        _walk(child_node, depth + 1, blocks, line, links)
    if is_block:
        _flush(blocks, line)


def _flush(blocks: list[str], line: list[str]) -> None:
    if line:
        blocks.append("".join(line).strip())
        line.clear()


def _check_marks(marks: object, links: set[uuid.UUID]) -> None:
    if marks is None:
        return
    items = _as_array(marks)
    if items is None:
        raise InvalidDocumentError("has invalid text formatting")
    for item in items:
        mark = _as_object(item)
        if mark is None:
            raise InvalidDocumentError("has invalid text formatting")
        kind = mark.get("type")
        if not isinstance(kind, str) or kind not in _MARKS:
            raise InvalidDocumentError(f"contains unsupported formatting: {_describe(kind)}")
        if kind == "link":
            attrs = _as_object(mark.get("attrs"))
            href = attrs.get("href") if attrs is not None else None
            if not isinstance(href, str):
                raise InvalidDocumentError("has a link without an address")
            target = linked_note_id(href)
            if target is not None:
                links.add(target)
            elif not href.lower().startswith(_SAFE_SCHEMES):
                raise InvalidDocumentError("has a link that isn't a web, email, or note link")


def _describe(kind: object) -> str:
    return repr(kind)[:40] if isinstance(kind, str) else "an element without a type"


EMPTY_DOCUMENT = build_document({"type": "doc", "content": [{"type": "paragraph"}]})
