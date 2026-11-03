"""Files stored on the API's machine: note attachments and document versions.

Layout: `<root>/<workspace id>/<blob id>`, where a blob ID is a note attachment's ID or a
document version's blob ID. File names come only from server-generated
UUIDs, never from uploads, so a request can't choose a path. New directories are `0700` and files
`0600`, like the SQLite database. Writes go to a temporary file first and are renamed into place,
so a crash never leaves a half-written attachment under its real name.

Blocking file I/O runs in a worker thread, so it never stalls the event loop.
"""

import hashlib
import logging
import os
import shutil
import uuid
from collections.abc import Callable, Collection, Sequence
from datetime import datetime
from pathlib import Path
from typing import IO

import anyio.to_thread

logger = logging.getLogger(__name__)


class FileAttachmentStore:
    def __init__(self, root: Path) -> None:
        self._root = root

    def _directory(self, workspace_id: uuid.UUID) -> Path:
        return self._root / str(workspace_id)

    def _path(self, workspace_id: uuid.UUID, attachment_id: uuid.UUID) -> Path:
        return self._directory(workspace_id) / str(attachment_id)

    async def write(self, workspace_id: uuid.UUID, attachment_id: uuid.UUID, data: bytes) -> None:
        await anyio.to_thread.run_sync(self._write, workspace_id, attachment_id, data)

    def _write(self, workspace_id: uuid.UUID, attachment_id: uuid.UUID, data: bytes) -> None:
        directory = self._directory(workspace_id)
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        target = self._path(workspace_id, attachment_id)
        partial = target.with_name(f"{attachment_id}.partial")
        descriptor = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "wb") as file:
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
        partial.replace(target)

    async def write_stream(
        self,
        workspace_id: uuid.UUID,
        blob_id: uuid.UUID,
        copy: Callable[[Callable[[IO[bytes]], str]], str],
    ) -> str:
        """Write a file streamed from elsewhere (a backup being restored) without holding it in
        memory: `copy` hands the source stream to the writer it's given. Returns the SHA-256 of
        what was written, for the caller to check."""
        return await anyio.to_thread.run_sync(
            lambda: copy(lambda source: self._write_from(workspace_id, blob_id, source))
        )

    def _write_from(self, workspace_id: uuid.UUID, blob_id: uuid.UUID, source: IO[bytes]) -> str:
        directory = self._directory(workspace_id)
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        target = self._path(workspace_id, blob_id)
        partial = target.with_name(f"{blob_id}.partial")
        digest = hashlib.sha256()
        descriptor = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        try:
            with os.fdopen(descriptor, "wb") as file:
                while chunk := source.read(1024 * 1024):
                    digest.update(chunk)
                    file.write(chunk)
                file.flush()
                os.fsync(file.fileno())
            partial.replace(target)
        except BaseException:
            partial.unlink(missing_ok=True)
            raise
        return digest.hexdigest()

    async def checksum(self, workspace_id: uuid.UUID, blob_id: uuid.UUID) -> str | None:
        """The SHA-256 of a stored file, or `None` if there's none."""
        return await anyio.to_thread.run_sync(self._checksum, workspace_id, blob_id)

    def _checksum(self, workspace_id: uuid.UUID, blob_id: uuid.UUID) -> str | None:
        digest = hashlib.sha256()
        try:
            with self._path(workspace_id, blob_id).open("rb") as file:
                while chunk := file.read(1024 * 1024):
                    digest.update(chunk)
        except FileNotFoundError:
            return None
        return digest.hexdigest()

    async def locate(self, workspace_id: uuid.UUID, attachment_id: uuid.UUID) -> Path | None:
        path = self._path(workspace_id, attachment_id)
        return path if await anyio.to_thread.run_sync(path.is_file) else None

    async def delete(self, workspace_id: uuid.UUID, attachment_ids: Sequence[uuid.UUID]) -> None:
        await anyio.to_thread.run_sync(self._delete, workspace_id, list(attachment_ids))

    def _delete(self, workspace_id: uuid.UUID, attachment_ids: list[uuid.UUID]) -> None:
        for attachment_id in attachment_ids:
            try:
                self._path(workspace_id, attachment_id).unlink(missing_ok=True)
            except OSError:
                # The metadata is already gone, so the file is unreachable; log and move on
                # rather than failing a deletion the user asked for.
                logger.warning("Couldn't delete an attachment file.", exc_info=True)

    async def delete_workspace(self, workspace_id: uuid.UUID) -> None:
        """Remove every attachment of a deleted workspace."""
        await anyio.to_thread.run_sync(self._delete_workspace, workspace_id)

    def _delete_workspace(self, workspace_id: uuid.UUID) -> None:
        directory = self._directory(workspace_id)
        if directory.is_dir():
            shutil.rmtree(directory, ignore_errors=True)

    async def sweep(self, referenced: Collection[uuid.UUID], older_than: datetime) -> int:
        """Delete files no metadata references, and partial writes, last modified before
        `older_than`; return how many were deleted.

        The age limit protects uploads in progress: their file is written before their
        metadata commits, so a fresh unreferenced file is expected. Names that aren't Orbit's
        are left alone.
        """
        return await anyio.to_thread.run_sync(self._sweep, set(referenced), older_than)

    def _sweep(self, referenced: set[uuid.UUID], older_than: datetime) -> int:
        if not self._root.is_dir():
            return 0
        cutoff = older_than.timestamp()
        removed = 0
        for directory in self._root.iterdir():
            if not directory.is_dir() or _as_uuid(directory.name) is None:
                continue
            for path in directory.iterdir():
                name = path.name.removesuffix(".partial")
                blob_id = _as_uuid(name)
                if blob_id is None or not path.is_file():
                    continue
                partial = path.name.endswith(".partial")
                if not partial and blob_id in referenced:
                    continue
                try:
                    if path.stat().st_mtime < cutoff:
                        path.unlink()
                        removed += 1
                except OSError:
                    logger.warning("Couldn't remove an unreferenced file.", exc_info=True)
        return removed


def _as_uuid(name: str) -> uuid.UUID | None:
    try:
        value = uuid.UUID(name)
    except ValueError:
        return None
    # Only the canonical spelling the store writes.
    return value if str(value) == name else None
