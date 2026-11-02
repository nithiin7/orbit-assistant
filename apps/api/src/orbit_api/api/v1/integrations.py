"""External integrations: providers, connecting accounts (OAuth), calendars, synchronization
history, conflicts, mail, files, and provider push notifications.

Everything about a connection lives under `/workspaces/{workspace_id}/integrations`, authorized by
`WorkspaceDep`, and every connection is also scoped to the signed-in person. Two routes are
outside it: completing an authorization (`CurrentUserDep`: the OAuth state proves the rest) and
the webhooks, which authenticate each notification by the secret Orbit gave its channel.
Tokens and client secrets never appear in a response. Synchronization runs in the worker; these
routes only queue it.
"""

import json
import logging
import uuid
from collections.abc import Generator
from contextlib import contextmanager
from typing import Annotated, Final

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from fastapi.responses import PlainTextResponse

from orbit_api.api.auth import CurrentUserDep, WorkspaceDep
from orbit_api.api.dependencies import IntegrationsDep, SettingsDep
from orbit_api.providers.integrations.http import items, obj
from orbit_api.schemas.integrations import (
    AuthorizeIntegrationRequest,
    AuthorizeIntegrationResponse,
    CompleteAuthorizationRequest,
    DisconnectIntegrationResponse,
    ExportEventRequest,
    FileParams,
    ImportedFileResponse,
    ImportFileRequest,
    IntegrationCalendarListResponse,
    IntegrationCalendarResponse,
    IntegrationConflictListResponse,
    IntegrationConflictResponse,
    IntegrationConflictVersion,
    IntegrationConnectionDetailResponse,
    IntegrationConnectionListResponse,
    IntegrationConnectionResponse,
    IntegrationLinkResponse,
    IntegrationOriginListResponse,
    IntegrationOriginResponse,
    IntegrationProviderListResponse,
    IntegrationProviderResponse,
    IntegrationRecordResponse,
    IntegrationSyncRequest,
    IntegrationSyncRunListResponse,
    IntegrationSyncRunResponse,
    MailLabelListResponse,
    MailLabelResponse,
    MessageDetailResponse,
    MessageListResponse,
    MessageParams,
    MessageSummaryResponse,
    OriginParams,
    RemoteFileListResponse,
    RemoteFileResponse,
    ResolveIntegrationConflictRequest,
    ResolveIntegrationConflictResponse,
    SelectLabelsRequest,
    UpdateIntegrationCalendarRequest,
    UpdateIntegrationConnectionRequest,
)
from orbit_api.schemas.notes import CreateNoteRequest
from orbit_api.schemas.reminders import CreateReminderRequest
from orbit_api.schemas.tasks import CreateTaskRequest
from orbit_api.services.calendar.models import (
    EventNotFoundError,
    InvalidEventTimesError,
    OccurrenceNotFoundError,
)
from orbit_api.services.calendar.recurrence import InvalidEventRecurrenceError
from orbit_api.services.documents.models import (
    CategoryNotFoundError as DocumentCategoryNotFoundError,
)
from orbit_api.services.documents.models import (
    DocumentNotFoundError,
    DocumentReadOnlyError,
    FileRejectedError,
)
from orbit_api.services.documents.models import (
    FolderNotFoundError as DocumentFolderNotFoundError,
)
from orbit_api.services.integrations.connectors import (
    AccessDeniedError,
    FileTooLargeError,
    ProviderError,
    ProviderUnavailableError,
    RateLimitedError,
    ReauthRequiredError,
    RemoteNotFoundError,
)
from orbit_api.services.integrations.files import FolderNotImportableError
from orbit_api.services.integrations.mapping import from_snapshot
from orbit_api.services.integrations.models import (
    AlreadyImportedError,
    AlreadyLinkedError,
    AuthorizationDeniedError,
    CapabilityNotGrantedError,
    Connection,
    ConnectionNotFoundError,
    IntegrationError,
    IntegrationsDisabledError,
    InvalidOAuthStateError,
    LinkNotFoundError,
    MissingScopesError,
    NotConflictedError,
    NotExportableError,
    OutOfScopeError,
    ProviderNotConfiguredError,
    ResourceNotFoundError,
    RunNotCancellableError,
    RunNotFoundError,
    TokenStorageUnavailableError,
)
from orbit_api.services.integrations.service import InvalidSettingError, ResourceChanges
from orbit_api.services.notes.models import FolderNotFoundError as NoteFolderNotFoundError
from orbit_api.services.reminders.models import ReminderInPastError, ReminderTaskNotFoundError
from orbit_api.services.tasks.models import InvalidTaskScheduleError
from orbit_api.utils.changes import UNSET

logger = logging.getLogger(__name__)

_RESPONSES: dict[int | str, dict[str, str]] = {401: {"description": "Not signed in."}}
router = APIRouter(
    prefix="/workspaces/{workspace_id}/integrations",
    tags=["integrations"],
    responses={
        **_RESPONSES,
        404: {"description": "The workspace (or connection) does not exist or is not accessible."},
    },
)
oauth_router = APIRouter(prefix="/integrations", tags=["integrations"], responses=_RESPONSES)
webhook_router = APIRouter(prefix="/integrations/webhooks", tags=["integrations"])

MAX_VALIDATION_TOKEN: Final = 1024
MAX_WEBHOOK_BODY: Final = 256 * 1024


def _http(code: int, detail: str) -> HTTPException:
    return HTTPException(code, detail)


@contextmanager
def _errors() -> Generator[None]:
    """Map integration, provider, and module errors to safe HTTP errors. Messages never contain
    tokens or the provider's response bodies."""
    try:
        yield
    except (
        ConnectionNotFoundError,
        ResourceNotFoundError,
        LinkNotFoundError,
        RunNotFoundError,
    ) as e:
        raise _http(status.HTTP_404_NOT_FOUND, e.message) from None
    except (InvalidOAuthStateError, AuthorizationDeniedError, MissingScopesError) as e:
        raise _http(status.HTTP_400_BAD_REQUEST, e.message) from None
    except OutOfScopeError as e:
        raise _http(status.HTTP_403_FORBIDDEN, e.message) from None
    except AlreadyImportedError as e:
        # The file listing shows which document it is (`imported`).
        raise _http(status.HTTP_409_CONFLICT, e.message) from None
    except InvalidSettingError as e:
        raise _http(status.HTTP_422_UNPROCESSABLE_CONTENT, e.message) from None
    except (
        IntegrationsDisabledError,
        ProviderNotConfiguredError,
        TokenStorageUnavailableError,
        CapabilityNotGrantedError,
        NotConflictedError,
        AlreadyLinkedError,
        NotExportableError,
        RunNotCancellableError,
    ) as e:
        raise _http(status.HTTP_409_CONFLICT, e.message) from None
    except IntegrationError as e:
        raise _http(status.HTTP_409_CONFLICT, e.message) from None
    except ReauthRequiredError:
        raise _http(
            status.HTTP_409_CONFLICT,
            "Orbit lost access to this account. Reconnect it in Settings → Integrations.",
        ) from None
    except AccessDeniedError as e:
        raise _http(status.HTTP_409_CONFLICT, e.message) from None
    except RemoteNotFoundError as e:
        raise _http(status.HTTP_404_NOT_FOUND, e.message) from None
    except FileTooLargeError as e:
        raise _http(status.HTTP_413_CONTENT_TOO_LARGE, e.message) from None
    except RateLimitedError as e:
        raise _http(status.HTTP_429_TOO_MANY_REQUESTS, e.message) from None
    except ProviderUnavailableError as e:
        raise _http(status.HTTP_503_SERVICE_UNAVAILABLE, e.message) from None
    except ProviderError as e:
        raise _http(status.HTTP_502_BAD_GATEWAY, e.message) from None
    except EventNotFoundError:
        raise _http(status.HTTP_404_NOT_FOUND, "Event not found.") from None
    except (OccurrenceNotFoundError, InvalidEventTimesError, InvalidEventRecurrenceError):
        raise _http(
            status.HTTP_409_CONFLICT,
            "That version no longer fits this event in Orbit. Choose the other one.",
        ) from None
    except DocumentNotFoundError:
        raise _http(status.HTTP_404_NOT_FOUND, "Document not found.") from None
    except DocumentReadOnlyError:
        raise _http(
            status.HTTP_409_CONFLICT, "The document is in the trash. Restore it first."
        ) from None
    except (DocumentFolderNotFoundError, NoteFolderNotFoundError):
        raise _http(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "That folder doesn't exist in this workspace."
        ) from None
    except DocumentCategoryNotFoundError:
        raise _http(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "That category doesn't exist in this workspace."
        ) from None
    except FolderNotImportableError:
        raise _http(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Folders can't be imported; open one instead."
        ) from None
    except FileRejectedError as e:
        raise _http(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, str(e)) from None
    except InvalidTaskScheduleError as e:
        raise _http(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from None
    except ReminderTaskNotFoundError:
        raise _http(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "That task doesn't exist in this workspace."
        ) from None
    except ReminderInPastError:
        raise _http(status.HTTP_422_UNPROCESSABLE_CONTENT, "Choose a time in the future.") from None


async def _connection(
    integrations: IntegrationsDep,
    workspace: WorkspaceDep,
    user_id: uuid.UUID,
    connection_id: uuid.UUID,
) -> Connection:
    with _errors():
        return await integrations.service.get(workspace.id, user_id, connection_id)


# Providers and authorization


@router.get("/providers", summary="List the providers this server can connect to")
async def list_providers(
    workspace: WorkspaceDep, integrations: IntegrationsDep, settings: SettingsDep
) -> IntegrationProviderListResponse:
    return IntegrationProviderListResponse(
        providers=[IntegrationProviderResponse.of(p) for p in integrations.service.providers()],
        webhooks=settings.integrations_webhook_url is not None,
    )


@router.post("/authorize", summary="Start connecting an account")
async def authorize(
    body: AuthorizeIntegrationRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    integrations: IntegrationsDep,
) -> AuthorizeIntegrationResponse:
    """Returns the provider's consent page. After consent, the provider sends the browser to
    Orbit's callback page, which completes the connection."""
    with _errors():
        url = await integrations.service.start_authorization(
            user.id, workspace.id, body.provider, body.capabilities, body.connection_id
        )
    return AuthorizeIntegrationResponse(authorization_url=url)


@oauth_router.post("/oauth/complete", summary="Finish connecting an account")
async def complete_authorization(
    body: CompleteAuthorizationRequest, user: CurrentUserDep, integrations: IntegrationsDep
) -> IntegrationConnectionResponse:
    with _errors():
        connection = await integrations.service.complete_authorization(
            user.id, body.state, body.code, body.error
        )
    return IntegrationConnectionResponse.of(connection)


# Connections


@router.get("/connections", summary="List connected accounts")
async def list_connections(
    workspace: WorkspaceDep, user: CurrentUserDep, integrations: IntegrationsDep
) -> IntegrationConnectionListResponse:
    connections = await integrations.service.connections(workspace.id, user.id)
    return IntegrationConnectionListResponse(
        connections=[IntegrationConnectionResponse.of(c) for c in connections]
    )


@router.get(
    "/connections/{connection_id}", summary="Get a connection with its calendars and history"
)
async def get_connection(
    connection_id: uuid.UUID,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    integrations: IntegrationsDep,
) -> IntegrationConnectionDetailResponse:
    connection = await _connection(integrations, workspace, user.id, connection_id)
    return IntegrationConnectionDetailResponse.of(await integrations.service.detail(connection))


@router.patch("/connections/{connection_id}", summary="Change a connection's settings")
async def update_connection(
    connection_id: uuid.UUID,
    body: UpdateIntegrationConnectionRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    integrations: IntegrationsDep,
) -> IntegrationConnectionResponse:
    connection = await _connection(integrations, workspace, user.id, connection_id)
    with _errors():
        updated = await integrations.service.update(connection, mail_days=body.mail_days)
    return IntegrationConnectionResponse.of(updated)


@router.post("/connections/{connection_id}/check", summary="Check that a connection still works")
async def check_connection(
    connection_id: uuid.UUID,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    integrations: IntegrationsDep,
) -> IntegrationConnectionResponse:
    connection = await _connection(integrations, workspace, user.id, connection_id)
    with _errors():
        return IntegrationConnectionResponse.of(await integrations.service.check(connection))


@router.delete("/connections/{connection_id}", summary="Disconnect an account")
async def disconnect(
    connection_id: uuid.UUID,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    integrations: IntegrationsDep,
    remove_imported: Annotated[bool, Query()] = False,
) -> DisconnectIntegrationResponse:
    """Revokes Orbit's access where the provider supports it and deletes the tokens. Imported
    records are kept as ordinary Orbit records unless `remove_imported` (events are deleted,
    documents go to the trash)."""
    connection = await _connection(integrations, workspace, user.id, connection_id)
    with _errors():
        result = await integrations.service.disconnect(connection, remove_imported=remove_imported)
    return DisconnectIntegrationResponse(
        revoked=result.revoked,
        removed_events=result.removed_events,
        trashed_documents=result.trashed_documents,
    )


# Calendars and synchronization


@router.post(
    "/connections/{connection_id}/calendars/refresh", summary="List the account's calendars again"
)
async def refresh_calendars(
    connection_id: uuid.UUID,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    integrations: IntegrationsDep,
) -> IntegrationCalendarListResponse:
    connection = await _connection(integrations, workspace, user.id, connection_id)
    with _errors():
        resources = await integrations.service.refresh_calendars(connection)
    return IntegrationCalendarListResponse(
        resources=[IntegrationCalendarResponse.of(r) for r in resources if r.kind == "calendar"]
    )


@router.patch(
    "/connections/{connection_id}/calendars/{resource_id}", summary="Change a calendar's settings"
)
async def update_calendar(
    connection_id: uuid.UUID,
    resource_id: uuid.UUID,
    body: UpdateIntegrationCalendarRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    integrations: IntegrationsDep,
) -> IntegrationCalendarResponse:
    """Selecting a calendar (`enabled`) queues its first synchronization."""
    connection = await _connection(integrations, workspace, user.id, connection_id)
    changes = ResourceChanges(
        enabled=UNSET if body.enabled is None else body.enabled,
        direction=UNSET if body.direction is None else body.direction,
        sync_interval_minutes=(
            UNSET if body.sync_interval_minutes is None else body.sync_interval_minutes
        ),
        category_id=None
        if body.clear_category
        else (UNSET if body.category_id is None else body.category_id),
    )
    with _errors():
        resource = await integrations.service.update_resource(connection, resource_id, changes)
    return IntegrationCalendarResponse.of(resource)


@router.post(
    "/connections/{connection_id}/calendars/{resource_id}/events",
    status_code=status.HTTP_201_CREATED,
    summary="Add an Orbit event to an external calendar",
)
async def export_event(
    connection_id: uuid.UUID,
    resource_id: uuid.UUID,
    body: ExportEventRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    integrations: IntegrationsDep,
) -> IntegrationLinkResponse:
    connection = await _connection(integrations, workspace, user.id, connection_id)
    with _errors():
        link = await integrations.service.export_event(connection, resource_id, body.event_id)
    return IntegrationLinkResponse.of(link)


@router.post(
    "/connections/{connection_id}/sync",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Synchronize now",
)
async def sync_now(
    connection_id: uuid.UUID,
    body: IntegrationSyncRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    integrations: IntegrationsDep,
) -> IntegrationSyncRunListResponse:
    """Queues synchronization (one calendar, or everything); the worker runs it shortly."""
    connection = await _connection(integrations, workspace, user.id, connection_id)
    with _errors():
        runs = await integrations.service.request_sync(connection, body.resource_id)
    return IntegrationSyncRunListResponse(runs=[IntegrationSyncRunResponse.of(r) for r in runs])


@router.get("/connections/{connection_id}/runs", summary="Synchronization history")
async def list_runs(
    connection_id: uuid.UUID,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    integrations: IntegrationsDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> IntegrationSyncRunListResponse:
    connection = await _connection(integrations, workspace, user.id, connection_id)
    runs = await integrations.service.runs(connection, limit)
    return IntegrationSyncRunListResponse(runs=[IntegrationSyncRunResponse.of(r) for r in runs])


@router.post(
    "/connections/{connection_id}/runs/{run_id}/cancel", summary="Cancel a synchronization"
)
async def cancel_run(
    connection_id: uuid.UUID,
    run_id: uuid.UUID,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    integrations: IntegrationsDep,
) -> IntegrationSyncRunResponse:
    connection = await _connection(integrations, workspace, user.id, connection_id)
    with _errors():
        return IntegrationSyncRunResponse.of(
            await integrations.service.cancel_run(connection, run_id)
        )


@router.post(
    "/connections/{connection_id}/runs/{run_id}/retry",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Retry a synchronization",
)
async def retry_run(
    connection_id: uuid.UUID,
    run_id: uuid.UUID,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    integrations: IntegrationsDep,
) -> IntegrationSyncRunResponse:
    connection = await _connection(integrations, workspace, user.id, connection_id)
    with _errors():
        return IntegrationSyncRunResponse.of(
            await integrations.service.retry_run(connection, run_id)
        )


# Conflicts and origins


@router.get("/conflicts", summary="Events changed in both places")
async def list_conflicts(
    workspace: WorkspaceDep, user: CurrentUserDep, integrations: IntegrationsDep
) -> IntegrationConflictListResponse:
    conflicts: list[IntegrationConflictResponse] = []
    for link, connection in await integrations.service.conflicts(workspace.id, user.id):
        external: IntegrationConflictVersion | None = None
        if link.conflict_kind == "both_changed" and link.remote_snapshot:
            try:
                remote = from_snapshot(link.remote_snapshot)
            except ValueError:
                remote = None
            if remote is not None:
                external = IntegrationConflictVersion(
                    title=remote.title,
                    start=remote.start.isoformat(timespec="minutes"),
                    end=remote.end.isoformat(timespec="minutes"),
                    all_day=remote.all_day,
                    location=remote.location,
                )
        conflicts.append(
            IntegrationConflictResponse(
                link=IntegrationLinkResponse.of(link),
                provider=connection.provider,
                account_email=connection.account_email,
                external=external,
            )
        )
    return IntegrationConflictListResponse(conflicts=conflicts)


@router.post("/conflicts/{link_id}/resolve", summary="Resolve a conflict")
async def resolve_conflict(
    link_id: uuid.UUID,
    body: ResolveIntegrationConflictRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    integrations: IntegrationsDep,
) -> ResolveIntegrationConflictResponse:
    """`keep_external` applies the provider's version (or, for a deletion, deletes the Orbit
    event); `keep_orbit` keeps Orbit's version, sending it back on two-way calendars (or, for a
    deletion, keeps the event as an Orbit-only event)."""
    with _errors():
        link = await integrations.service.resolve(workspace.id, user.id, link_id, body.resolution)
    return ResolveIntegrationConflictResponse(
        link=IntegrationLinkResponse.of(link) if link else None
    )


@router.get("/origins", summary="Where an Orbit record came from")
async def list_origins(
    params: Annotated[OriginParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    integrations: IntegrationsDep,
) -> IntegrationOriginListResponse:
    origins = await integrations.service.origins(
        workspace.id, user.id, params.entity_type, params.entity_id
    )
    return IntegrationOriginListResponse(origins=[IntegrationOriginResponse.of(o) for o in origins])


# Mail


@router.get("/connections/{connection_id}/mail/labels", summary="List mail labels or folders")
async def list_labels(
    connection_id: uuid.UUID,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    integrations: IntegrationsDep,
) -> MailLabelListResponse:
    connection = await _connection(integrations, workspace, user.id, connection_id)
    with _errors():
        labels = await integrations.mail.labels(connection)
    return MailLabelListResponse(labels=[MailLabelResponse.of(label) for label in labels])


@router.put(
    "/connections/{connection_id}/mail/labels", summary="Choose which labels Orbit may show"
)
async def select_labels(
    connection_id: uuid.UUID,
    body: SelectLabelsRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    integrations: IntegrationsDep,
) -> MailLabelListResponse:
    connection = await _connection(integrations, workspace, user.id, connection_id)
    with _errors():
        labels = await integrations.mail.select_labels(connection, body.label_ids)
    return MailLabelListResponse(labels=[MailLabelResponse.of(label) for label in labels])


@router.get("/connections/{connection_id}/mail/messages", summary="List or search messages")
async def list_messages(
    connection_id: uuid.UUID,
    params: Annotated[MessageParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    integrations: IntegrationsDep,
) -> MessageListResponse:
    """Metadata only (sender, subject, date, a snippet), from a selected label, within the
    connection's mail period."""
    connection = await _connection(integrations, workspace, user.id, connection_id)
    with _errors():
        page = await integrations.mail.messages(connection, params.label_id, params.q, params.page)
    return MessageListResponse(
        messages=[MessageSummaryResponse.of(m) for m in page.messages], next_page=page.next_page
    )


@router.get("/connections/{connection_id}/mail/messages/{message_id}", summary="Read a message")
async def get_message(
    connection_id: uuid.UUID,
    message_id: str,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    integrations: IntegrationsDep,
) -> MessageDetailResponse:
    connection = await _connection(integrations, workspace, user.id, connection_id)
    with _errors():
        detail, links = await integrations.mail.message(connection, _external(message_id))
    return MessageDetailResponse.of(detail, links)


@router.post(
    "/connections/{connection_id}/mail/messages/{message_id}/task",
    status_code=status.HTTP_201_CREATED,
    summary="Create a task from a message",
)
async def task_from_message(
    connection_id: uuid.UUID,
    message_id: str,
    body: CreateTaskRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    integrations: IntegrationsDep,
) -> IntegrationRecordResponse:
    connection = await _connection(integrations, workspace, user.id, connection_id)
    with _errors():
        task = await integrations.mail.create_task(
            connection, _external(message_id), body.to_draft()
        )
    return IntegrationRecordResponse(kind="task", id=task.id, title=task.title)


@router.post(
    "/connections/{connection_id}/mail/messages/{message_id}/note",
    status_code=status.HTTP_201_CREATED,
    summary="Create a note from a message",
)
async def note_from_message(
    connection_id: uuid.UUID,
    message_id: str,
    body: CreateNoteRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    integrations: IntegrationsDep,
) -> IntegrationRecordResponse:
    connection = await _connection(integrations, workspace, user.id, connection_id)
    with _errors():
        note = await integrations.mail.create_note(
            connection, _external(message_id), body.to_draft()
        )
    return IntegrationRecordResponse(
        kind="note", id=note.note.id, title=note.note.title or "Untitled note"
    )


@router.post(
    "/connections/{connection_id}/mail/messages/{message_id}/reminder",
    status_code=status.HTTP_201_CREATED,
    summary="Create a reminder from a message",
)
async def reminder_from_message(
    connection_id: uuid.UUID,
    message_id: str,
    body: CreateReminderRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    integrations: IntegrationsDep,
) -> IntegrationRecordResponse:
    connection = await _connection(integrations, workspace, user.id, connection_id)
    with _errors():
        view = await integrations.mail.create_reminder(
            connection, _external(message_id), body.to_draft(), user.timezone
        )
    return IntegrationRecordResponse(
        kind="reminder", id=view.reminder.id, title=view.reminder.title
    )


@router.delete(
    "/connections/{connection_id}/links/{link_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a link to a message",
)
async def unlink_message(
    connection_id: uuid.UUID,
    link_id: uuid.UUID,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    integrations: IntegrationsDep,
) -> Response:
    connection = await _connection(integrations, workspace, user.id, connection_id)
    with _errors():
        await integrations.mail.unlink(connection, link_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Files


@router.get("/connections/{connection_id}/files", summary="Browse or search files")
async def list_files(
    connection_id: uuid.UUID,
    params: Annotated[FileParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    integrations: IntegrationsDep,
) -> RemoteFileListResponse:
    connection = await _connection(integrations, workspace, user.id, connection_id)
    with _errors():
        listing = await integrations.files.list(connection, params.folder_id, params.q, params.page)
    return RemoteFileListResponse(
        files=[
            RemoteFileResponse.of(f, listing.imported.get(f.external_id))
            for f in listing.page.files
        ],
        next_page=listing.page.next_page,
    )


@router.post(
    "/connections/{connection_id}/files/{file_id}/import",
    status_code=status.HTTP_201_CREATED,
    summary="Import a file into Documents",
)
async def import_file(
    connection_id: uuid.UUID,
    file_id: str,
    body: ImportFileRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    integrations: IntegrationsDep,
) -> ImportedFileResponse:
    connection = await _connection(integrations, workspace, user.id, connection_id)
    with _errors():
        document, link = await integrations.files.import_file(
            connection,
            _external(file_id),
            folder_id=body.folder_id,
            category_id=body.category_id,
            default_timezone=user.timezone,
        )
    return ImportedFileResponse(
        document_id=document.id, title=document.title, link=IntegrationLinkResponse.of(link)
    )


@router.post(
    "/connections/{connection_id}/files/links/{link_id}/update",
    summary="Import an external file's new version",
)
async def update_file(
    connection_id: uuid.UUID,
    link_id: uuid.UUID,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    integrations: IntegrationsDep,
) -> ImportedFileResponse:
    connection = await _connection(integrations, workspace, user.id, connection_id)
    with _errors():
        document, link = await integrations.files.update_file(connection, link_id)
    return ImportedFileResponse(
        document_id=document.id, title=document.title, link=IntegrationLinkResponse.of(link)
    )


def _external(value: str) -> str:
    """External IDs in paths: bounded, without whitespace or separators."""
    if not 1 <= len(value) <= 500 or any(c.isspace() or c in "/\\" for c in value):
        raise _http(status.HTTP_404_NOT_FOUND, "Not found.")
    return value


# Webhooks: authenticated by the secret Orbit gave each channel, never by the payload.


@webhook_router.post(
    "/google", status_code=status.HTTP_204_NO_CONTENT, summary="Google Calendar push channel"
)
async def google_webhook(request: Request, integrations: IntegrationsDep) -> Response:
    channel = request.headers.get("x-goog-channel-id", "")
    token = request.headers.get("x-goog-channel-token", "")
    if not channel or not token or len(channel) > 200 or len(token) > 300:
        return Response(status_code=status.HTTP_404_NOT_FOUND)
    if not await integrations.service.notify_channel(channel, token):
        return Response(status_code=status.HTTP_404_NOT_FOUND)
    # Every message, including the first ("sync") that announces a channel, is verified and
    # answered by synchronizing; the payload says nothing Orbit relies on.
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@webhook_router.post("/microsoft", summary="Microsoft Graph change notifications")
async def microsoft_webhook(request: Request, integrations: IntegrationsDep) -> Response:
    validation = request.query_params.get("validationToken")
    if validation is not None:
        # Subscription validation: echo the token as plain text, as Graph requires.
        if len(validation) > MAX_VALIDATION_TOKEN:
            return Response(status_code=status.HTTP_400_BAD_REQUEST)
        return PlainTextResponse(validation, headers={"X-Content-Type-Options": "nosniff"})
    raw = await request.body()
    if len(raw) > MAX_WEBHOOK_BODY:
        return Response(status_code=status.HTTP_413_CONTENT_TOO_LARGE)
    try:
        payload: object = json.loads(raw or b"{}")
    except ValueError:
        return Response(status_code=status.HTTP_400_BAD_REQUEST)
    for item in items(obj(payload).get("value"))[:100]:
        entry = obj(item)
        subscription, secret = entry.get("subscriptionId"), entry.get("clientState")
        if isinstance(subscription, str) and isinstance(secret, str) and len(secret) <= 300:
            await integrations.service.notify_channel(subscription[:200], secret)
    # Accepted whether or not each notification verified, so callers learn nothing.
    return Response(status_code=status.HTTP_202_ACCEPTED)
