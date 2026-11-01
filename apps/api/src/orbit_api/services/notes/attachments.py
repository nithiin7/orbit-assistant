"""Files attached to notes.

The database keeps each attachment's metadata (`note_attachments`); the bytes go to an
`AttachmentStore`, never into a database column. The file type is decided here from the file
name's extension and checked against the file's leading bytes where the format has a signature,
so the type the browser claimed is never trusted, and downloads are served with this type only.
"""

import uuid
from collections.abc import Callable, Sequence
from datetime import datetime
from pathlib import Path
from typing import Protocol

from orbit_api.services.notes.models import (
    Attachment,
    AttachmentNotFoundError,
    AttachmentRejectedError,
    NoteNotFoundError,
)
from orbit_api.services.transactions import Transaction
from orbit_api.utils.clock import utc_now
from orbit_api.utils.file_types import FILE_TYPES, FileType, FileTypeError
from orbit_api.utils.file_types import detect_file_type as detect

MAX_ATTACHMENTS_PER_NOTE = 50


def detect_file_type(filename: str, data: bytes) -> FileType:
    """The type of an upload, or `AttachmentRejectedError` if notes don't accept it."""
    try:
        return detect(filename, data, FILE_TYPES)
    except FileTypeError as error:
        raise AttachmentRejectedError(str(error)) from None


class AttachmentRepository(Protocol):
    async def add(self, attachment: Attachment) -> None: ...

    async def get(
        self, workspace_id: uuid.UUID, note_id: uuid.UUID, attachment_id: uuid.UUID
    ) -> Attachment | None: ...

    async def for_note(self, workspace_id: uuid.UUID, note_id: uuid.UUID) -> list[Attachment]: ...

    async def delete(
        self, workspace_id: uuid.UUID, note_id: uuid.UUID, attachment_id: uuid.UUID
    ) -> bool: ...

    async def ids_for_notes(
        self, workspace_id: uuid.UUID, note_ids: Sequence[uuid.UUID]
    ) -> list[uuid.UUID]: ...


class NoteLookup(Protocol):
    async def exists(self, workspace_id: uuid.UUID, note_id: uuid.UUID) -> bool: ...


class AttachmentStore(Protocol):
    """Where attachment bytes live, by workspace and attachment ID."""

    async def write(
        self, workspace_id: uuid.UUID, attachment_id: uuid.UUID, data: bytes
    ) -> None: ...

    async def locate(self, workspace_id: uuid.UUID, attachment_id: uuid.UUID) -> Path | None:
        """The stored file, if it exists."""
        ...

    async def delete(self, workspace_id: uuid.UUID, attachment_ids: Sequence[uuid.UUID]) -> None:
        """Delete these files; missing ones are skipped."""
        ...


class AttachmentService:
    def __init__(
        self,
        attachments: AttachmentRepository,
        notes: NoteLookup,
        store: AttachmentStore,
        transaction: Transaction,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._attachments = attachments
        self._notes = notes
        self._store = store
        self._transaction = transaction
        self._clock = clock

    async def for_note(self, workspace_id: uuid.UUID, note_id: uuid.UUID) -> list[Attachment]:
        await self._require_note(workspace_id, note_id)
        return await self._attachments.for_note(workspace_id, note_id)

    async def add(
        self, workspace_id: uuid.UUID, note_id: uuid.UUID, filename: str, data: bytes
    ) -> Attachment:
        """Store the file, then its metadata. If the metadata can't be saved, the file is
        removed again, so the store never holds a file nobody can reach."""
        await self._require_note(workspace_id, note_id)
        if len(await self._attachments.for_note(workspace_id, note_id)) >= MAX_ATTACHMENTS_PER_NOTE:
            raise AttachmentRejectedError(
                f"A note can have at most {MAX_ATTACHMENTS_PER_NOTE} attachments."
            )
        file_type = detect_file_type(filename, data)
        attachment = Attachment(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            note_id=note_id,
            filename=filename,
            content_type=file_type.content_type,
            size_bytes=len(data),
            created_at=self._clock(),
        )
        await self._store.write(workspace_id, attachment.id, data)
        try:
            await self._attachments.add(attachment)
            await self._transaction.commit()
        except BaseException:
            await self._store.delete(workspace_id, [attachment.id])
            raise
        return attachment

    async def open(
        self, workspace_id: uuid.UUID, note_id: uuid.UUID, attachment_id: uuid.UUID
    ) -> tuple[Attachment, Path]:
        attachment = await self._attachments.get(workspace_id, note_id, attachment_id)
        if attachment is None:
            raise AttachmentNotFoundError
        path = await self._store.locate(workspace_id, attachment_id)
        if path is None:
            raise AttachmentNotFoundError
        return attachment, path

    async def remove(
        self, workspace_id: uuid.UUID, note_id: uuid.UUID, attachment_id: uuid.UUID
    ) -> None:
        if not await self._attachments.delete(workspace_id, note_id, attachment_id):
            raise AttachmentNotFoundError
        await self._transaction.commit()
        await self._store.delete(workspace_id, [attachment_id])

    async def ids_for_notes(
        self, workspace_id: uuid.UUID, note_ids: Sequence[uuid.UUID]
    ) -> list[uuid.UUID]:
        """Attachments of these notes, to delete their files after the notes are deleted."""
        return await self._attachments.ids_for_notes(workspace_id, note_ids)

    async def delete_files(
        self, workspace_id: uuid.UUID, attachment_ids: Sequence[uuid.UUID]
    ) -> None:
        await self._store.delete(workspace_id, attachment_ids)

    async def _require_note(self, workspace_id: uuid.UUID, note_id: uuid.UUID) -> None:
        if not await self._notes.exists(workspace_id, note_id):
            raise NoteNotFoundError
