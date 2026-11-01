"""Writing export archives on the API's machine.

The archive is built in a private temporary file (never in memory, so large exports don't
exhaust it), in a worker thread so the event loop isn't blocked. The caller streams the file and
deletes it afterwards.
"""

import json
import os
import tempfile
import zipfile
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import anyio.to_thread

from orbit_api.services.documents.export import METADATA_NAME, ROOT, ArchiveEntry

# Already-compressed formats gain nothing from deflating.
_STORED_SUFFIXES = frozenset({".pdf", ".jpg", ".jpeg", ".png", ".webp", ".docx", ".xlsx", ".pptx"})


async def write_archive(entries: Sequence[ArchiveEntry], metadata: dict[str, Any]) -> Path:
    """A ZIP file with `entries` and `metadata.json`; the caller deletes it."""
    return await anyio.to_thread.run_sync(_write, list(entries), metadata)


def _write(entries: list[ArchiveEntry], metadata: dict[str, Any]) -> Path:
    descriptor, name = tempfile.mkstemp(prefix="orbit-export-", suffix=".zip")
    os.close(descriptor)
    path = Path(name)
    try:
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr(
                f"{ROOT}/{METADATA_NAME}",
                json.dumps(metadata, ensure_ascii=False, indent=2),
            )
            for entry in entries:
                compression = (
                    zipfile.ZIP_STORED
                    if Path(entry.name).suffix.lower() in _STORED_SUFFIXES
                    else zipfile.ZIP_DEFLATED
                )
                archive.write(entry.source, entry.name, compress_type=compression)
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return path


def remove_file(path: Path) -> None:
    path.unlink(missing_ok=True)
