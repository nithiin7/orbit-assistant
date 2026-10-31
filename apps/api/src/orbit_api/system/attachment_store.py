"""Note attachments stored as files on the API's machine.

Layout: `<root>/<workspace id>/<attachment id>`. File names come only from server-generated
UUIDs, never from uploads, so a request can't choose a path. New directories are `0700` and files
`0600`, like the SQLite database. Writes go to a temporary file first and are renamed into place,
so a crash never leaves a half-written attachment under its real name.

Blocking file I/O runs in a worker thread, so it never stalls the event loop.
"""

import logging
import os
import shutil
import uuid
from collections.abc import Sequence
from pathlib import Path

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
