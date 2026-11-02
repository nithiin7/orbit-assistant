"""Reading text out of document files, for indexing and document summaries.

Supported: PDF (with `pypdf`, page by page), Word (`.docx`, split at headings), PowerPoint
(`.pptx`, slide by slide), Excel (`.xlsx`, its shared strings), and plain text, Markdown, and
CSV. There is no OCR: scanned PDFs and images yield no text, and say so. Files are only read;
originals are never modified.

Office files are ZIP archives; each part is size-checked from the archive's directory before it
is decompressed, so a small file can't expand into gigabytes. XML is parsed with the standard
library's expat parser, which doesn't fetch external entities.
"""

import io
import re
import zipfile
from collections.abc import Callable
from typing import Final
from xml.etree import ElementTree

from orbit_api.services.ai.chunking import MAX_SOURCE_CHARS
from orbit_api.services.ai.models import SourceSection

EXTRACTABLE: Final = frozenset({"pdf", "docx", "pptx", "xlsx", "txt", "csv", "md"})
# Files larger than this aren't read.
MAX_FILE_BYTES: Final = 25 * 1024 * 1024
# The largest decompressed XML part read from an Office file.
MAX_PART_BYTES: Final = 20 * 1024 * 1024
MAX_PDF_PAGES: Final = 500

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
_S = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_SLIDE = re.compile(r"^ppt/slides/slide(\d+)\.xml$")
_MD_HEADING = re.compile(r"^#{1,6}\s+(.+?)\s*#*\s*$")


class ExtractionError(Exception):
    """The file couldn't be read. The message is safe to show."""


def can_extract(extension: str) -> bool:
    return extension.lower() in EXTRACTABLE


def extract_sections(extension: str, data: bytes) -> list[SourceSection]:
    """The file's text as located sections; empty if the file has no readable text (such as a
    scanned PDF). Raises `ExtractionError` for unsupported, oversized, or unreadable files."""
    extension = extension.lower()
    reader = _READERS.get(extension)
    if reader is None:
        raise ExtractionError("Text can't be read from this type of file.")
    if len(data) > MAX_FILE_BYTES:
        raise ExtractionError("The file is too large to read.")
    try:
        sections = reader(data)
    except ExtractionError:
        raise
    # A deliberate boundary: parsers raise many kinds of errors on damaged files; all of them
    # mean the same thing to the person, and none should take the indexer down.
    except Exception as exc:
        raise ExtractionError("The file couldn't be read.") from exc
    return _within_budget(sections)


def _within_budget(sections: list[SourceSection]) -> list[SourceSection]:
    result: list[SourceSection] = []
    budget = MAX_SOURCE_CHARS
    for section in sections:
        text = section.text.strip()
        if not text:
            continue
        if budget <= 0:
            break
        result.append(SourceSection(location=section.location, text=text[:budget]))
        budget -= len(text)
    return result


def _text(data: bytes) -> list[SourceSection]:
    return [SourceSection(location="Text", text=_decode(data))]


def _markdown(data: bytes) -> list[SourceSection]:
    sections: list[SourceSection] = []
    heading = "Text"
    lines: list[str] = []
    for line in _decode(data).splitlines():
        match = _MD_HEADING.match(line)
        if match:
            if lines:
                sections.append(SourceSection(location=heading, text="\n".join(lines)))
            heading, lines = match.group(1), []
        else:
            lines.append(line)
    if lines:
        sections.append(SourceSection(location=heading, text="\n".join(lines)))
    return sections


def _decode(data: bytes) -> str:
    if b"\x00" in data:
        raise ExtractionError("The file isn't text.")
    return data.decode("utf-8-sig", errors="replace")


def _pdf(data: bytes) -> list[SourceSection]:
    # Imported here: only document indexing needs it.
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError

    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted and not reader.decrypt(""):
            raise ExtractionError("The PDF is password-protected.")
        sections: list[SourceSection] = []
        for number, page in enumerate(reader.pages[:MAX_PDF_PAGES], start=1):
            sections.append(SourceSection(location=f"Page {number}", text=page.extract_text()))
    except PdfReadError as exc:
        raise ExtractionError("The PDF couldn't be read.") from exc
    return sections


def _read_part(archive: zipfile.ZipFile, name: str) -> ElementTree.Element | None:
    try:
        info = archive.getinfo(name)
    except KeyError:
        return None
    if info.file_size > MAX_PART_BYTES:
        raise ExtractionError("The file is too large to read.")
    return ElementTree.fromstring(archive.read(info))


def _docx(data: bytes) -> list[SourceSection]:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        root = _read_part(archive, "word/document.xml")
    if root is None:
        raise ExtractionError("The file isn't a Word document.")
    sections: list[SourceSection] = []
    heading = "Document"
    lines: list[str] = []
    for paragraph in root.iter(f"{_W}p"):
        text = "".join(node.text or "" for node in paragraph.iter(f"{_W}t")).strip()
        style = paragraph.find(f"{_W}pPr/{_W}pStyle")
        style_name = style.get(f"{_W}val", "") if style is not None else ""
        if style_name.lower().startswith(("heading", "title")) and text:
            if lines:
                sections.append(SourceSection(location=heading, text="\n".join(lines)))
            heading, lines = text, []
        elif text:
            lines.append(text)
    if lines:
        sections.append(SourceSection(location=heading, text="\n".join(lines)))
    return sections


def _pptx(data: bytes) -> list[SourceSection]:
    sections: list[SourceSection] = []
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        slides = sorted(
            (int(match.group(1)), name)
            for name in archive.namelist()
            if (match := _SLIDE.match(name)) is not None
        )
        for number, name in slides:
            root = _read_part(archive, name)
            if root is None:
                continue
            texts = [node.text.strip() for node in root.iter(f"{_A}t") if node.text]
            sections.append(SourceSection(location=f"Slide {number}", text="\n".join(texts)))
    return sections


def _xlsx(data: bytes) -> list[SourceSection]:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        root = _read_part(archive, "xl/sharedStrings.xml")
    if root is None:
        return []
    texts = [
        "".join(node.text or "" for node in item.iter(f"{_S}t")).strip()
        for item in root.iter(f"{_S}si")
    ]
    return [SourceSection(location="Spreadsheet", text="\n".join(t for t in texts if t))]


_READERS: Final[dict[str, Callable[[bytes], list[SourceSection]]]] = {
    "pdf": _pdf,
    "docx": _docx,
    "pptx": _pptx,
    "xlsx": _xlsx,
    "txt": _text,
    "csv": _text,
    "md": _markdown,
}
