"""The backup archive: a ZIP file with a manifest, one JSON Lines file per table, and the files.

```text
orbit-backup/
├── manifest.json            format and schema versions, workspace, modules, and for every
│                            table and file its size and SHA-256
├── README.txt               what this is, for someone who finds the file
├── database/<table>.jsonl   one record per line, as `rows.encode_row` writes it
└── files/<id>               attachment, document, and photo files, named by their ID
```

Reading treats the archive as untrusted. Only those exact names are accepted (anything else,
including `..`, absolute paths, and encrypted ZIP entries, refuses the whole archive), and names
are never used as paths on disk: files are copied into the attachment store under their
validated UUID. Sizes are bounded before anything is decompressed: the total the entries
declare, the compression ratio of each, the number of entries, and every entry's size must
match the manifest. Content is then checked against the manifest's SHA-256 as it streams, so a
damaged or altered archive is refused before it's restored.

Blocking file I/O; callers run these in a worker thread.
"""

import hashlib
import json
import re
import uuid
import zipfile
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import IO, Any, Final, cast

from orbit_api.services.backup.models import (
    FileEntry,
    IncompatibleArchiveError,
    InvalidArchiveError,
    Manifest,
    TableEntry,
)

FORMAT: Final = "orbit-backup"
FORMAT_VERSION: Final = 1
ROOT: Final = "orbit-backup"
MANIFEST_NAME: Final = f"{ROOT}/manifest.json"
README_NAME: Final = f"{ROOT}/README.txt"
MAX_MANIFEST_BYTES: Final = 64 * 1024 * 1024
MAX_LINE_BYTES: Final = 16 * 1024 * 1024
MAX_ENTRIES: Final = 500_000
# JSON compresses well, but not a thousandfold; a higher ratio is a decompression bomb.
MAX_RATIO: Final = 1000
_COPY_CHUNK: Final = 1024 * 1024

_TABLE_NAME = re.compile(r"^[a-z][a-z0-9_]{0,62}$")
_TABLE_ENTRY = re.compile(rf"^{ROOT}/database/([a-z][a-z0-9_]{{0,62}})\.jsonl$")
_FILE_ENTRY = re.compile(
    rf"^{ROOT}/files/([0-9a-f]{{8}}-[0-9a-f]{{4}}-[0-9a-f]{{4}}-[0-9a-f]{{4}}-[0-9a-f]{{12}})$"
)
_SHA256 = re.compile(r"^[0-9a-f]{64}$")

README: Final = """This is an Orbit backup: one workspace's records and files.

manifest.json describes what it holds, with a SHA-256 checksum for every part. Records are in
database/, one JSON object per line, one file per table; files are in files/, named by the ID of
the record they belong to. Restore it in Orbit under Settings -> Backup & restore.

It contains personal data and is not encrypted. Keep it as safe as the data itself.
"""


def table_entry(table: str) -> str:
    return f"{ROOT}/database/{table}.jsonl"


def file_entry(blob_id: uuid.UUID) -> str:
    return f"{ROOT}/files/{blob_id}"


class _Hashing:
    def __init__(self) -> None:
        self.sha = hashlib.sha256()
        self.size = 0

    def update(self, data: bytes) -> None:
        self.sha.update(data)
        self.size += len(data)


class ArchiveWriter:
    """Writes a backup archive to `path`, one table at a time, then the files and manifest."""

    def __init__(self, path: Path) -> None:
        self._zip = zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True)
        self._table: tuple[str, IO[bytes], _Hashing] | None = None
        self.tables: dict[str, TableEntry] = {}
        self.files: list[FileEntry] = []

    def begin_table(self, table: str) -> None:
        handle = self._zip.open(table_entry(table), "w", force_zip64=True)
        self._table = (table, handle, _Hashing())

    def write_rows(self, rows: list[dict[str, Any]]) -> None:
        assert self._table is not None
        _, handle, hashing = self._table
        data = "".join(
            json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in rows
        ).encode()
        hashing.update(data)
        handle.write(data)

    def end_table(self, module: str, rows: int) -> None:
        assert self._table is not None
        table, handle, hashing = self._table
        handle.close()
        self._table = None
        self.tables[table] = TableEntry(
            module=module, rows=rows, size=hashing.size, sha256=hashing.sha.hexdigest()
        )

    def add_file(self, blob_id: uuid.UUID, source: Path) -> None:
        hashing = _Hashing()
        info = zipfile.ZipInfo(file_entry(blob_id))
        # Attachments are mostly already compressed (images, PDFs, Office files).
        info.compress_type = zipfile.ZIP_STORED
        with source.open("rb") as file, self._zip.open(info, "w", force_zip64=True) as out:
            while chunk := file.read(_COPY_CHUNK):
                hashing.update(chunk)
                out.write(chunk)
        self.files.append(FileEntry(id=blob_id, size=hashing.size, sha256=hashing.sha.hexdigest()))

    def finish(self, manifest: dict[str, Any]) -> None:
        self._zip.writestr(README_NAME, README)
        self._zip.writestr(
            MANIFEST_NAME, json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True)
        )
        self._zip.close()

    def close(self) -> None:
        self._zip.close()


def manifest_document(
    *,
    kind: str,
    app_version: str,
    schema_revision: str,
    created_at: datetime,
    storage_mode: str,
    workspace_id: uuid.UUID,
    workspace_name: str,
    owner_id: uuid.UUID,
    include_files: bool,
    modules: list[str],
    tables: dict[str, TableEntry],
    files: list[FileEntry],
    missing_files: list[uuid.UUID],
) -> dict[str, Any]:
    return {
        "format": FORMAT,
        "format_version": FORMAT_VERSION,
        "app_version": app_version,
        "schema_revision": schema_revision,
        "created_at": created_at.isoformat(),
        "kind": kind,
        "storage_mode": storage_mode,
        "workspace": {"id": str(workspace_id), "name": workspace_name},
        "owner_id": str(owner_id),
        "include_files": include_files,
        "modules": modules,
        "tables": {
            name: {
                "module": entry.module,
                "rows": entry.rows,
                "size": entry.size,
                "sha256": entry.sha256,
            }
            for name, entry in tables.items()
        },
        "files": [
            {"id": str(entry.id), "size": entry.size, "sha256": entry.sha256} for entry in files
        ],
        "missing_files": [str(blob_id) for blob_id in missing_files],
    }


def _bad(message: str = "The manifest is damaged.") -> InvalidArchiveError:
    return InvalidArchiveError(message)


def _get(data: dict[str, Any], key: str, kind: type) -> Any:
    value = data.get(key)
    if not isinstance(value, kind) or (kind is int and isinstance(value, bool)):
        raise _bad()
    return value


def _uuid(value: object) -> uuid.UUID:
    if not isinstance(value, str):
        raise _bad()
    try:
        return uuid.UUID(value)
    except ValueError:
        raise _bad() from None


def parse_manifest(raw: object, *, expected_format: str = FORMAT) -> dict[str, Any]:
    """The manifest's common header, checked for format and version."""
    if not isinstance(raw, dict):
        raise _bad()
    data = cast(dict[str, Any], raw)
    if data.get("format") != expected_format:
        raise InvalidArchiveError("This isn't an Orbit backup or export.")
    version = _get(data, "format_version", int)
    if version > FORMAT_VERSION:
        raise IncompatibleArchiveError(
            "This file was made by a newer version of Orbit. Update Orbit to restore it."
        )
    if version < 1:
        raise _bad()
    return data


def read_header(data: dict[str, Any]) -> tuple[uuid.UUID, str, uuid.UUID, datetime]:
    workspace = _get(data, "workspace", dict)
    name = _get(workspace, "name", str)
    if not 1 <= len(name) <= 100:
        raise _bad()
    try:
        created_at = datetime.fromisoformat(_get(data, "created_at", str))
    except ValueError:
        raise _bad() from None
    if created_at.tzinfo is None:
        raise _bad()
    return _uuid(workspace.get("id")), name, _uuid(data.get("owner_id")), created_at


def build_manifest(data: dict[str, Any]) -> Manifest:
    workspace_id, workspace_name, owner_id, created_at = read_header(data)
    tables: dict[str, TableEntry] = {}
    for name, value in _get(data, "tables", dict).items():
        if not isinstance(name, str) or not _TABLE_NAME.match(name) or not isinstance(value, dict):
            raise _bad()
        entry = cast(dict[str, Any], value)
        sha = _get(entry, "sha256", str)
        rows, size = _get(entry, "rows", int), _get(entry, "size", int)
        if not _SHA256.match(sha) or rows < 0 or size < 0:
            raise _bad()
        tables[name] = TableEntry(
            module=_get(entry, "module", str), rows=rows, size=size, sha256=sha
        )
    files: list[FileEntry] = []
    seen: set[uuid.UUID] = set()
    for value in _get(data, "files", list):
        if not isinstance(value, dict):
            raise _bad()
        entry = cast(dict[str, Any], value)
        blob_id = _uuid(entry.get("id"))
        sha, size = _get(entry, "sha256", str), _get(entry, "size", int)
        if blob_id in seen or not _SHA256.match(sha) or size < 0:
            raise _bad()
        seen.add(blob_id)
        files.append(FileEntry(id=blob_id, size=size, sha256=sha))
    modules = _get(data, "modules", list)
    if not all(isinstance(module, str) for module in modules):
        raise _bad()
    return Manifest(
        format_version=_get(data, "format_version", int),
        kind=_get(data, "kind", str),
        app_version=_get(data, "app_version", str)[:32],
        schema_revision=_get(data, "schema_revision", str)[:32],
        created_at=created_at,
        workspace_id=workspace_id,
        workspace_name=workspace_name,
        owner_id=owner_id,
        include_files=_get(data, "include_files", bool),
        modules=tuple(cast(list[str], modules)),
        tables=tables,
        files=tuple(files),
        missing_files=tuple(_uuid(value) for value in _get(data, "missing_files", list)),
    )


@dataclass(frozen=True, slots=True)
class ArchiveLimits:
    max_extracted_bytes: int


class ArchiveReader:
    """Opens and validates a plaintext backup archive. Use as a context manager."""

    def __init__(self, path: Path, limits: ArchiveLimits) -> None:
        try:
            self._zip = zipfile.ZipFile(path)
        except (zipfile.BadZipFile, OSError):
            raise InvalidArchiveError("This isn't a valid backup archive.") from None
        try:
            self.manifest = self._validate(limits)
        except BaseException:
            self._zip.close()
            raise

    def __enter__(self) -> "ArchiveReader":
        return self

    def __exit__(self, *_: object) -> None:
        self._zip.close()

    def _validate(self, limits: ArchiveLimits) -> Manifest:
        infos = self._zip.infolist()
        if len(infos) > MAX_ENTRIES:
            raise InvalidArchiveError("The archive has too many entries.")
        names: dict[str, zipfile.ZipInfo] = {}
        total = 0
        for info in infos:
            name = info.filename
            if name in names:
                raise InvalidArchiveError("The archive contains duplicate entries.")
            if info.flag_bits & 0x1:
                raise InvalidArchiveError("The archive contains encrypted ZIP entries.")
            if info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise InvalidArchiveError("The archive uses an unsupported compression method.")
            if name not in (MANIFEST_NAME, README_NAME) and not (
                _TABLE_ENTRY.match(name) or _FILE_ENTRY.match(name)
            ):
                raise InvalidArchiveError("The archive contains unexpected files.")
            if info.compress_size and info.file_size / info.compress_size > MAX_RATIO:
                raise InvalidArchiveError("The archive's contents are suspiciously compressed.")
            total += info.file_size
            names[name] = info
        if total > limits.max_extracted_bytes:
            raise InvalidArchiveError("The backup is larger than this server accepts.")
        manifest_info = names.get(MANIFEST_NAME)
        if manifest_info is None:
            raise InvalidArchiveError("This archive isn't an Orbit backup: it has no manifest.")
        if manifest_info.file_size > MAX_MANIFEST_BYTES:
            raise _bad()
        try:
            raw: object = json.loads(self._read_bounded(manifest_info, MAX_MANIFEST_BYTES))
        except ValueError:
            raise _bad() from None
        manifest = build_manifest(parse_manifest(raw))
        expected = {table_entry(name): entry.size for name, entry in manifest.tables.items()}
        expected |= {file_entry(entry.id): entry.size for entry in manifest.files}
        for name, size in expected.items():
            info = names.get(name)
            if info is None:
                raise InvalidArchiveError(
                    "The backup is incomplete: a part listed in its manifest is missing."
                )
            if info.file_size != size:
                raise InvalidArchiveError(
                    "The backup is damaged: a part's size doesn't match its manifest."
                )
        extra = set(names) - set(expected) - {MANIFEST_NAME, README_NAME}
        if extra:
            raise InvalidArchiveError("The archive contains parts its manifest doesn't list.")
        self._infos = names
        return manifest

    def _read_bounded(self, info: zipfile.ZipInfo, limit: int) -> bytes:
        with self._zip.open(info) as handle:
            data = handle.read(limit + 1)
        if len(data) > limit:
            raise _bad()
        return data

    def verify(self) -> None:
        """Check every part against the manifest's checksum (streaming)."""
        for name, entry in self.manifest.tables.items():
            self._check(table_entry(name), entry.size, entry.sha256)
        for entry in self.manifest.files:
            self._check(file_entry(entry.id), entry.size, entry.sha256)

    def _check(self, name: str, size: int, sha256: str) -> None:
        hashing = _Hashing()
        try:
            with self._zip.open(self._infos[name]) as handle:
                while chunk := handle.read(_COPY_CHUNK):
                    hashing.update(chunk)
                    if hashing.size > size:
                        break
        except (zipfile.BadZipFile, OSError, EOFError):
            # zipfile raises BadZipFile on a CRC mismatch.
            raise InvalidArchiveError("The backup is damaged.") from None
        if hashing.size != size or hashing.sha.hexdigest() != sha256:
            raise InvalidArchiveError(
                "The backup is damaged or was changed after it was made: a checksum doesn't match."
            )

    def iter_rows(self, table: str) -> Iterator[object]:
        """Each record of `table`, parsed but not yet decoded."""
        entry = self.manifest.tables.get(table)
        if entry is None:
            return
        count = 0
        with self._zip.open(self._infos[table_entry(table)]) as handle:
            while line := handle.readline(MAX_LINE_BYTES + 1):
                if len(line) > MAX_LINE_BYTES:
                    raise InvalidArchiveError(f"A record in {table} is too large.")
                if not line.strip():
                    continue
                try:
                    yield json.loads(line)
                except ValueError:
                    raise InvalidArchiveError(f"A record in {table} is damaged.") from None
                count += 1
        if count != entry.rows:
            raise InvalidArchiveError(
                f"The backup is damaged: {table} has the wrong number of records."
            )

    def has_file(self, blob_id: uuid.UUID) -> bool:
        return file_entry(blob_id) in self._infos

    def copy_file(self, blob_id: uuid.UUID, write: Callable[[IO[bytes]], str]) -> str:
        """Hand the file's stream to `write`, which returns the SHA-256 it read."""
        with self._zip.open(self._infos[file_entry(blob_id)]) as handle:
            return write(handle)
