"""Backup archives and staged uploads on the API's machine.

Layout under `ORBIT_BACKUPS_PATH`:

```text
<workspace id>/<backup id>.orbit-backup     stored backups (plain ZIP or encrypted)
uploads/<workspace id>/<upload id>          uploaded archives waiting to be restored
tmp/                                        archives being built or decrypted
```

Names come only from server-generated UUIDs. Directories are `0700` and files `0600`, like the
database and the attachments. Archives are built in `tmp/` and renamed into place, so a crash
never leaves a half-written backup under a real name; `tmp/` is emptied of old leftovers by the
worker. Nothing here is ever served by URL: archives are streamed only to their workspace's
owner through authorized routes.
"""

import logging
import os
import shutil
import tempfile
import time
import uuid
from pathlib import Path

import anyio.to_thread

logger = logging.getLogger(__name__)

SUFFIX = ".orbit-backup"


class FileArchiveStore:
    def __init__(self, root: Path) -> None:
        self._root = root

    def _directory(self, *parts: str) -> Path:
        directory = self._root.joinpath(*parts)
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        return directory

    def _backup(self, workspace_id: uuid.UUID, backup_id: uuid.UUID) -> Path:
        return self._root / str(workspace_id) / f"{backup_id}{SUFFIX}"

    def _upload(self, workspace_id: uuid.UUID, upload_id: uuid.UUID) -> Path:
        return self._root / "uploads" / str(workspace_id) / str(upload_id)

    async def temporary(self, suffix: str) -> Path:
        return await anyio.to_thread.run_sync(self._temporary, suffix)

    def _temporary(self, suffix: str) -> Path:
        directory = self._directory("tmp")
        descriptor, name = tempfile.mkstemp(prefix="orbit-", suffix=suffix, dir=directory)
        os.close(descriptor)
        return Path(name)

    async def keep_backup(
        self, workspace_id: uuid.UUID, backup_id: uuid.UUID, source: Path
    ) -> None:
        await anyio.to_thread.run_sync(self._move, source, self._backup(workspace_id, backup_id))

    async def keep_upload(
        self, workspace_id: uuid.UUID, upload_id: uuid.UUID, source: Path
    ) -> None:
        await anyio.to_thread.run_sync(self._move, source, self._upload(workspace_id, upload_id))

    def _move(self, source: Path, target: Path) -> None:
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        source.chmod(0o600)
        source.replace(target)

    async def backup_path(self, workspace_id: uuid.UUID, backup_id: uuid.UUID) -> Path | None:
        path = self._backup(workspace_id, backup_id)
        return path if await anyio.to_thread.run_sync(path.is_file) else None

    async def upload_path(self, workspace_id: uuid.UUID, upload_id: uuid.UUID) -> Path | None:
        path = self._upload(workspace_id, upload_id)
        return path if await anyio.to_thread.run_sync(path.is_file) else None

    async def delete_backup(self, workspace_id: uuid.UUID, backup_id: uuid.UUID) -> None:
        await self.remove(self._backup(workspace_id, backup_id))

    async def delete_upload(self, workspace_id: uuid.UUID, upload_id: uuid.UUID) -> None:
        await self.remove(self._upload(workspace_id, upload_id))

    async def remove(self, path: Path) -> None:
        await anyio.to_thread.run_sync(self._remove, path)

    def _remove(self, path: Path) -> None:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            # The record is already gone or going; an unreachable file is swept with `tmp/`
            # or the workspace, so log and carry on.
            logger.warning("Couldn't delete a backup file.", exc_info=True)

    async def delete_workspace(self, workspace_id: uuid.UUID) -> None:
        """Remove every backup and upload of a deleted workspace."""
        await anyio.to_thread.run_sync(self._delete_workspace, workspace_id)

    def _delete_workspace(self, workspace_id: uuid.UUID) -> None:
        for directory in (
            self._root / str(workspace_id),
            self._root / "uploads" / str(workspace_id),
        ):
            if directory.is_dir():
                shutil.rmtree(directory, ignore_errors=True)

    async def sweep_temporary(self, older_than_seconds: float) -> int:
        """Delete leftovers in `tmp/` (from a crash mid-backup) older than the given age."""
        return await anyio.to_thread.run_sync(self._sweep, older_than_seconds)

    def _sweep(self, older_than_seconds: float) -> int:
        directory = self._root / "tmp"
        if not directory.is_dir():
            return 0
        cutoff = time.time() - older_than_seconds
        removed = 0
        for path in directory.iterdir():
            try:
                if (
                    path.is_file()
                    and path.name.startswith("orbit-")
                    and path.stat().st_mtime < cutoff
                ):
                    path.unlink()
                    removed += 1
            except OSError:
                logger.warning("Couldn't remove a temporary backup file.", exc_info=True)
        return removed
