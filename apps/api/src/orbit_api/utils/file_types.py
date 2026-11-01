"""Deciding an uploaded file's type from its name and contents, never from what the browser
claimed. Shared by note attachments and documents, which accept different sets of types.

A type is chosen by the file name's extension and must match the file's leading bytes where the
format has a signature; text formats must not contain NUL bytes. With `strict=True`, Office files
must also be ZIP archives containing their format's main part (read from the archive's directory
only, so nothing is decompressed).
"""

import io
import zipfile
from collections.abc import Collection
from dataclasses import dataclass
from pathlib import PurePath

_ZIP = (b"PK\x03\x04", b"PK\x05\x06")


class FileTypeError(ValueError):
    """The file's type isn't accepted, or its contents don't match its extension."""


@dataclass(frozen=True, slots=True)
class FileType:
    content_type: str
    # Accepted leading bytes; empty means a text format, which must not contain NUL bytes.
    signatures: tuple[bytes, ...] = ()
    # For ZIP-based formats: a part the archive must contain, checked when `strict`.
    required_part: str | None = None


# By lowercase extension. Office and OpenDocument files are ZIP archives.
FILE_TYPES: dict[str, FileType] = {
    "png": FileType("image/png", (b"\x89PNG\r\n\x1a\n",)),
    "jpg": FileType("image/jpeg", (b"\xff\xd8\xff",)),
    "jpeg": FileType("image/jpeg", (b"\xff\xd8\xff",)),
    "gif": FileType("image/gif", (b"GIF87a", b"GIF89a")),
    "webp": FileType("image/webp", (b"RIFF",)),
    "pdf": FileType("application/pdf", (b"%PDF-",)),
    "txt": FileType("text/plain"),
    "md": FileType("text/markdown"),
    "csv": FileType("text/csv"),
    "json": FileType("application/json"),
    "zip": FileType("application/zip", _ZIP),
    "docx": FileType(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        _ZIP,
        "word/document.xml",
    ),
    "xlsx": FileType(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        _ZIP,
        "xl/workbook.xml",
    ),
    "pptx": FileType(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        _ZIP,
        "ppt/presentation.xml",
    ),
    "odt": FileType("application/vnd.oasis.opendocument.text", _ZIP, "content.xml"),
    "ods": FileType("application/vnd.oasis.opendocument.spreadsheet", _ZIP, "content.xml"),
}


def extension_of(filename: str) -> str:
    """The lowercase extension without its dot, or `""`."""
    return PurePath(filename).suffix.lower().removeprefix(".")


def detect_file_type(
    filename: str, data: bytes, accepted: Collection[str], *, strict: bool = False
) -> FileType:
    """The type of an upload whose extension is one of `accepted`, or `FileTypeError`."""
    extension = extension_of(filename)
    file_type = FILE_TYPES.get(extension) if extension in accepted else None
    if file_type is None:
        raise FileTypeError(
            f"That type of file isn't accepted. Accepted: {', '.join(sorted(accepted))}."
        )
    mismatch = FileTypeError("The file's contents don't match its extension.")
    if file_type.signatures:
        if not data.startswith(file_type.signatures):
            raise mismatch
        if extension == "webp" and data[8:12] != b"WEBP":
            raise mismatch
        if (
            strict
            and file_type.required_part is not None
            and not _has_part(data, file_type.required_part)
        ):
            raise mismatch
    elif b"\x00" in data:
        raise mismatch
    return file_type


def _has_part(data: bytes, part: str) -> bool:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            return part in archive.namelist()
    except zipfile.BadZipFile:
        return False
