"""Where restored or imported records come from: a backup archive or an Orbit JSON export.

A JSON export (`orbit-export`) is one document with the same records as a backup, for one module
or the whole workspace, without files:

```json
{"format": "orbit-export", "format_version": 1, "app_version": "…", "schema_revision": "0021",
 "created_at": "…", "workspace": {"id": "…", "name": "…"}, "owner_id": "…",
 "modules": ["tasks"], "tables": {"tasks": [{"id": "…", "title": "…", …}]}}
```
"""

import json
import uuid
from collections.abc import Callable, Iterator
from datetime import datetime
from pathlib import Path
from typing import IO, Any, Final, Protocol, cast

from orbit_api.services.backup.archive import (
    FORMAT_VERSION,
    ArchiveLimits,
    ArchiveReader,
    parse_manifest,
    read_header,
)
from orbit_api.services.backup.catalog import module_of
from orbit_api.services.backup.models import InvalidArchiveError, Manifest, TableEntry

EXPORT_FORMAT: Final = "orbit-export"
# A JSON export is parsed whole, so it's bounded more tightly than an archive.
MAX_EXPORT_BYTES: Final = 256 * 1024 * 1024


class RowSource(Protocol):
    manifest: Manifest

    def verify(self) -> None: ...

    def iter_rows(self, table: str) -> Iterator[object]: ...

    def has_file(self, blob_id: uuid.UUID) -> bool: ...

    def copy_file(self, blob_id: uuid.UUID, write: Callable[[IO[bytes]], str]) -> str: ...

    def close(self) -> None: ...


class ArchiveSource:
    def __init__(self, path: Path, limits: ArchiveLimits) -> None:
        self._reader = ArchiveReader(path, limits)
        self.manifest = self._reader.manifest

    def verify(self) -> None:
        self._reader.verify()

    def iter_rows(self, table: str) -> Iterator[object]:
        return self._reader.iter_rows(table)

    def has_file(self, blob_id: uuid.UUID) -> bool:
        return self._reader.has_file(blob_id)

    def copy_file(self, blob_id: uuid.UUID, write: Callable[[IO[bytes]], str]) -> str:
        return self._reader.copy_file(blob_id, write)

    def close(self) -> None:
        self._reader.__exit__()


class ExportSource:
    def __init__(self, path: Path) -> None:
        if path.stat().st_size > MAX_EXPORT_BYTES:
            raise InvalidArchiveError(
                "This export is too large to import. Restore a backup instead."
            )
        try:
            raw: object = json.loads(path.read_bytes())
        except (ValueError, UnicodeDecodeError):
            raise InvalidArchiveError("This file isn't valid JSON.") from None
        data = parse_manifest(raw, expected_format=EXPORT_FORMAT)
        workspace_id, workspace_name, owner_id, created_at = read_header(data)
        tables = data.get("tables")
        if not isinstance(tables, dict):
            raise InvalidArchiveError("The export has no records.")
        self._tables: dict[str, list[object]] = {}
        entries: dict[str, TableEntry] = {}
        for name, rows in cast(dict[str, Any], tables).items():
            if not isinstance(rows, list):
                raise InvalidArchiveError("The export is damaged.")
            items = cast(list[object], rows)
            self._tables[name] = items
            module = module_of(name)
            entries[name] = TableEntry(
                module=module or "unknown", rows=len(items), size=0, sha256=""
            )
        modules = data.get("modules")
        self.manifest = Manifest(
            format_version=FORMAT_VERSION,
            kind="export",
            app_version=str(data.get("app_version", ""))[:32],
            schema_revision=str(data.get("schema_revision", ""))[:32],
            created_at=created_at,
            workspace_id=workspace_id,
            workspace_name=workspace_name,
            owner_id=owner_id,
            include_files=False,
            modules=tuple(m for m in cast(list[object], modules) if isinstance(m, str))
            if isinstance(modules, list)
            else (),
            tables=entries,
            files=(),
            missing_files=(),
        )

    def verify(self) -> None:
        """A JSON export carries no checksums; its records are validated as they're decoded."""

    def iter_rows(self, table: str) -> Iterator[object]:
        return iter(self._tables.get(table, []))

    def has_file(self, blob_id: uuid.UUID) -> bool:
        return False

    def copy_file(self, blob_id: uuid.UUID, write: Callable[[IO[bytes]], str]) -> str:
        raise InvalidArchiveError("Exports don't contain files.")

    def close(self) -> None:
        self._tables.clear()


def export_document(
    *,
    app_version: str,
    schema_revision: str,
    created_at: datetime,
    workspace_id: uuid.UUID,
    workspace_name: str,
    owner_id: uuid.UUID,
    modules: list[str],
    tables: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    return {
        "format": EXPORT_FORMAT,
        "format_version": FORMAT_VERSION,
        "app_version": app_version,
        "schema_revision": schema_revision,
        "created_at": created_at.isoformat(),
        "workspace": {"id": str(workspace_id), "name": workspace_name},
        "owner_id": str(owner_id),
        "modules": modules,
        "tables": tables,
    }
