"""Cloud files (Google Drive, OneDrive) into Documents, one file at a time, by choice.

Browsing and searching read from the provider; nothing is downloaded until the person imports a
file. An imported file becomes an ordinary document (validated by content like any upload,
with versions, folders, and reminders); its link records the provider's version. A periodic
check marks a link `update_available` when the file changed, and `missing` when it was deleted
or Orbit lost access. The document itself is never changed or removed by a check: updating
adds a new version, so earlier ones are kept.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Final

from orbit_api.services.documents.models import Document, DocumentDraft, DocumentNotFoundError
from orbit_api.services.documents.service import DocumentService
from orbit_api.services.integrations.connectors import (
    ConnectorRegistry,
    FilePage,
    FilesConnector,
    RemoteFile,
    RemoteNotFoundError,
)
from orbit_api.services.integrations.models import (
    AlreadyImportedError,
    CapabilityNotGrantedError,
    Connection,
    Link,
    LinkNotFoundError,
    ProviderNotConfiguredError,
    RunCounts,
    SyncRun,
)
from orbit_api.services.integrations.store import IntegrationStore
from orbit_api.services.integrations.tokens import TokenManager
from orbit_api.services.transactions import Transaction
from orbit_api.utils.clock import utc_now

# Imported files checked per run.
MAX_CHECKS_PER_RUN: Final = 200


class FolderNotImportableError(Exception):
    """Folders are browsed, not imported."""


@dataclass(frozen=True, slots=True)
class FileListing:
    page: FilePage
    # The link of each listed file already imported, by external ID.
    imported: dict[str, Link]


class FileService:
    def __init__(
        self,
        store: IntegrationStore,
        tokens: TokenManager,
        connectors: ConnectorRegistry,
        documents: DocumentService,
        transaction: Transaction,
        *,
        max_bytes: int,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._store = store
        self._tokens = tokens
        self._connectors = connectors
        self._documents = documents
        self._transaction = transaction
        self._max_bytes = max_bytes
        self._clock = clock

    async def list(
        self,
        connection: Connection,
        folder_id: str | None,
        search: str | None,
        page: str | None,
    ) -> FileListing:
        files = self._files(connection)
        result = await self._tokens.call(
            connection, lambda token: files.list(token, folder_id, search, page)
        )
        imported: dict[str, Link] = {}
        for item in result.files:
            link = await self._store.find_link(connection.id, "file", item.external_id)
            if link is not None:
                imported[item.external_id] = link
        return FileListing(result, imported)

    async def import_file(
        self,
        connection: Connection,
        file_id: str,
        *,
        folder_id: uuid.UUID | None,
        category_id: uuid.UUID | None,
        default_timezone: str | None,
    ) -> tuple[Document, Link]:
        files = self._files(connection)
        existing = await self._store.find_link(connection.id, "file", file_id)
        if existing is not None:
            raise AlreadyImportedError(existing.entity_id)
        remote = await self._tokens.call(connection, lambda token: files.metadata(token, file_id))
        if remote.folder:
            raise FolderNotImportableError
        data = await self._tokens.call(
            connection, lambda token: files.download(token, remote, self._max_bytes)
        )
        filename = remote.export_name or remote.name
        document = await self._documents.upload(
            connection.workspace_id,
            filename,
            data,
            DocumentDraft(title=_title(remote.name), folder_id=folder_id, category_id=category_id),
            default_timezone=default_timezone,
        )
        now = self._clock()
        link = Link(
            id=uuid.uuid4(),
            workspace_id=connection.workspace_id,
            connection_id=connection.id,
            resource_id=None,
            external_kind="file",
            external_id=remote.external_id,
            external_parent_id=remote.parent_id,
            entity_type="document",
            entity_id=document.id,
            original_start=None,
            origin="external",
            title=remote.name[:300],
            external_url=remote.url,
            remote_version=remote.version,
            remote_snapshot=_snapshot(remote),
            local_hash=None,
            remote_start_at=None,
            status="synced",
            conflict_kind=None,
            conflict_detected_at=None,
            last_seen_run_id=None,
            last_synced_at=now,
            created_at=now,
            updated_at=now,
        )
        await self._store.add_link(link)
        # The document and its link commit together; a racing import of the same file loses
        # on the link's unique key and rolls back its document.
        await self._transaction.commit()
        return document, link

    async def update_file(
        self, connection: Connection, link_id: uuid.UUID
    ) -> tuple[Document, Link]:
        """Import the external file's current content as a new version of its document."""
        files = self._files(connection)
        link = await self._store.get_link(connection.workspace_id, link_id)
        if link is None or link.connection_id != connection.id or link.external_kind != "file":
            raise LinkNotFoundError
        try:
            remote = await self._tokens.call(
                connection, lambda token: files.metadata(token, link.external_id)
            )
        except RemoteNotFoundError:
            await self._store.save_link(replace(link, status="missing", updated_at=self._clock()))
            await self._transaction.commit()
            raise
        data = await self._tokens.call(
            connection, lambda token: files.download(token, remote, self._max_bytes)
        )
        try:
            document = await self._documents.add_version(
                connection.workspace_id,
                link.entity_id,
                remote.export_name or remote.name,
                data,
                note="Updated from the connected account",
            )
        except DocumentNotFoundError:
            await self._store.save_link(replace(link, status="deleted_locally"))
            await self._transaction.commit()
            raise
        now = self._clock()
        updated = replace(
            link,
            title=remote.name[:300],
            remote_version=remote.version,
            remote_snapshot=_snapshot(remote),
            status="synced",
            last_synced_at=now,
            updated_at=now,
        )
        await self._store.save_link(updated)
        await self._transaction.commit()
        return document, updated

    async def check(self, run: SyncRun, connection: Connection) -> SyncRun:
        """Look at each imported file's metadata (never its content) for changes and
        deletions."""
        files = self._files(connection)
        now = self._clock()
        run = replace(run, status="running", started_at=run.started_at or now)
        counts = RunCounts()
        links = await self._store.connection_links(connection.id, "file")
        for link in links[:MAX_CHECKS_PER_RUN]:
            if link.status == "deleted_locally":
                counts += RunCounts(skipped=1)
                continue
            try:
                await self._documents.get(link.workspace_id, link.entity_id)
            except DocumentNotFoundError:
                await self._store.save_link(replace(link, status="deleted_locally"))
                counts += RunCounts(updated=1)
                continue
            try:
                remote = await self._tokens.call(
                    connection,
                    lambda token, external_id=link.external_id: files.metadata(token, external_id),
                )
            except RemoteNotFoundError:
                if link.status != "missing":
                    await self._store.save_link(replace(link, status="missing", updated_at=now))
                    counts += RunCounts(updated=1)
                else:
                    counts += RunCounts(skipped=1)
                continue
            status = "synced" if remote.version == link.remote_version else "update_available"
            if status != link.status:
                await self._store.save_link(
                    replace(link, status=status, remote_snapshot=_snapshot(remote), updated_at=now)
                )
                counts += RunCounts(updated=1)
            else:
                counts += RunCounts(skipped=1)
        finished = replace(
            run,
            status="succeeded",
            counts=run.counts + counts,
            finished_at=self._clock(),
            lease_until=None,
            claim_token=None,
            error=None,
        )
        await self._store.save_run(finished)
        await self._transaction.commit()
        return finished

    def _files(self, connection: Connection) -> FilesConnector:
        if "files" not in connection.capabilities:
            raise CapabilityNotGrantedError
        provider = self._connectors.get(connection.provider)
        if provider is None or provider.files is None:
            raise ProviderNotConfiguredError
        return provider.files


def _title(name: str) -> str:
    stem = name.rsplit(".", 1)[0] if "." in name else name
    return (stem.strip() or "Untitled")[:200]


def _snapshot(remote: RemoteFile) -> dict[str, object]:
    return {
        "version": remote.version,
        "name": remote.name,
        "size": remote.size,
        "modified_at": remote.modified_at.isoformat() if remote.modified_at else None,
    }
