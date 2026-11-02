"""Splitting records into chunks for embedding.

Structure first: a record arrives as sections (a note's headings, a PDF's pages, a document's
headings), and chunks never cross a section, so each keeps an accurate location. Within a
section, paragraphs are packed into chunks of up to `max_chars`; a paragraph longer than that is
split at sentence ends, and only a sentence longer than a whole chunk is split between words.
Consecutive chunks of a section share `overlap` characters, so a sentence cut at a boundary is
still found whole in one of them. Pure Python.
"""

import json
import re
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from typing import Final, cast

from orbit_api.services.ai.models import SourceSection

DEFAULT_CHUNK_CHARS: Final = 1200
DEFAULT_OVERLAP: Final = 150
# The most text indexed for one record. Longer records are indexed up to here.
MAX_SOURCE_CHARS: Final = 200_000

_PARAGRAPHS = re.compile(r"\n\s*\n|\n")
_SENTENCES = re.compile(r"(?<=[.!?])\s+")


@dataclass(frozen=True, slots=True)
class ChunkingOptions:
    max_chars: int = DEFAULT_CHUNK_CHARS
    overlap: int = DEFAULT_OVERLAP

    def __post_init__(self) -> None:
        if self.max_chars < 100:
            raise ValueError("max_chars must be at least 100")
        if not 0 <= self.overlap < self.max_chars // 2:
            raise ValueError("overlap must be between 0 and half of max_chars")


@dataclass(frozen=True, slots=True)
class TextChunk:
    location: str
    text: str


def chunk_sections(
    sections: Sequence[SourceSection], options: ChunkingOptions | None = None
) -> list[TextChunk]:
    """Chunks of every section, in order, within `MAX_SOURCE_CHARS` overall."""
    options = options or ChunkingOptions()
    chunks: list[TextChunk] = []
    budget = MAX_SOURCE_CHARS
    for section in sections:
        text = section.text.strip()
        if not text or budget <= 0:
            continue
        text = text[:budget]
        budget -= len(text)
        chunks.extend(
            TextChunk(location=section.location, text=piece) for piece in _chunk_text(text, options)
        )
    return chunks


def _chunk_text(text: str, options: ChunkingOptions) -> Iterator[str]:
    current = ""
    for unit in _units(text, options.max_chars):
        candidate = f"{current}\n{unit}" if current else unit
        if len(candidate) <= options.max_chars:
            current = candidate
            continue
        if current:
            yield current
            tail = _tail(current, options.overlap)
            current = f"{tail} {unit}".strip() if tail else unit
            if len(current) > options.max_chars:
                current = unit
        else:
            current = unit
    if current:
        yield current


def _units(text: str, max_chars: int) -> Iterator[str]:
    """Paragraphs, with oversized ones broken into sentences, and oversized sentences into
    word runs, so no unit is longer than `max_chars`."""
    for paragraph in _PARAGRAPHS.split(text):
        paragraph = " ".join(paragraph.split())
        if not paragraph:
            continue
        if len(paragraph) <= max_chars:
            yield paragraph
            continue
        for sentence in _SENTENCES.split(paragraph):
            if len(sentence) <= max_chars:
                yield sentence
            else:
                yield from _word_runs(sentence, max_chars)


def _word_runs(text: str, max_chars: int) -> Iterator[str]:
    current = ""
    for word in text.split(" "):
        word = word[:max_chars]
        candidate = f"{current} {word}" if current else word
        if len(candidate) > max_chars and current:
            yield current
            current = word
        else:
            current = candidate
    if current:
        yield current


def _tail(text: str, size: int) -> str:
    """The last `size` characters of `text`, starting at a word."""
    if size <= 0 or len(text) <= size:
        return "" if size <= 0 else text
    tail = text[-size:]
    space = tail.find(" ")
    return tail[space + 1 :] if space != -1 else tail


# Notes


def note_sections(title: str, content: str, plain_text: str) -> list[SourceSection]:
    """A note's text split at its headings. Falls back to the plain text if the stored document
    can't be read."""
    try:
        document: object = json.loads(content)
    except ValueError:
        document = None
    blocks = _top_level_blocks(document)
    if blocks is None:
        return [SourceSection(location=title or "Note", text=plain_text)]
    sections: list[SourceSection] = []
    heading = title or "Note"
    lines: list[str] = []
    for kind, text in blocks:
        if kind == "heading":
            if lines:
                sections.append(SourceSection(location=heading, text="\n".join(lines)))
            heading = text or heading
            lines = []
        elif text:
            lines.append(text)
    if lines:
        sections.append(SourceSection(location=heading, text="\n".join(lines)))
    return sections


def _top_level_blocks(document: object) -> list[tuple[str, str]] | None:
    if not isinstance(document, dict):
        return None
    content = cast(dict[str, object], document).get("content")
    if not isinstance(content, list):
        return None
    blocks: list[tuple[str, str]] = []
    for node in cast(list[object], content):
        if isinstance(node, dict):
            typed = cast(dict[str, object], node)
            kind = typed.get("type")
            blocks.append((kind if isinstance(kind, str) else "", _node_text(typed).strip()))
    return blocks


def _node_text(node: dict[str, object], depth: int = 0) -> str:
    if depth > 40:
        return ""
    if node.get("type") == "text":
        text = node.get("text")
        return text if isinstance(text, str) else ""
    if node.get("type") == "hardBreak":
        return "\n"
    children = node.get("content")
    if not isinstance(children, list):
        return ""
    parts = [
        _node_text(cast(dict[str, object], child), depth + 1)
        for child in cast(list[object], children)
        if isinstance(child, dict)
    ]
    inline = node.get("type") in {"paragraph", "heading", "codeBlock"}
    return ("" if inline else "\n").join(part for part in parts if part)
