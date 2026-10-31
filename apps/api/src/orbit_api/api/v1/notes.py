"""Notes, folders, tags, the journal, and attachments in a workspace. Every route authorizes the
workspace through `WorkspaceDep` first."""

import logging
import uuid
from datetime import UTC, date, datetime
from typing import Annotated, Any
from urllib.parse import quote
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Path, Query, Request, Response, status
from fastapi.responses import FileResponse

from orbit_api.api.auth import CurrentUserDep, WorkspaceDep
from orbit_api.api.dependencies import AttachmentServiceDep, NoteServiceDep, SettingsDep
from orbit_api.schemas.notes import (
    AddNoteTagRequest,
    AttachmentListResponse,
    AttachmentResponse,
    CreateFolderRequest,
    CreateNoteRequest,
    DeleteFolderParams,
    EmptyTrashResponse,
    FolderListResponse,
    FolderResponse,
    NoteConnectionsResponse,
    NoteCountsResponse,
    NoteListParams,
    NoteListResponse,
    NoteResponse,
    NoteSummaryResponse,
    NoteTagsResponse,
    TagListResponse,
    TagRef,
    TagRequest,
    TagResponse,
    UpdateFolderRequest,
    UpdateNoteRequest,
    UploadAttachmentParams,
)
from orbit_api.schemas.tasks import TaskListResponse, TaskResponse
from orbit_api.services.notes.models import (
    AttachmentNotFoundError,
    AttachmentRejectedError,
    FolderMoveError,
    FolderNotFoundError,
    FolderUsage,
    JournalChangeError,
    LinkedTaskNotFoundError,
    NoteNotFoundError,
    NoteNotTrashedError,
    RevisionConflictError,
    TagNameTakenError,
    TagNotFoundError,
    TagUsage,
    TooManyTagsError,
)
from orbit_api.utils.changes import UNSET

logger = logging.getLogger(__name__)

_NOT_FOUND: dict[int | str, dict[str, Any]] = {
    401: {"description": "Not signed in."},
    404: {"description": "The workspace or note does not exist or is not accessible."},
}

router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["notes"], responses=_NOT_FOUND)

NoteId = Annotated[uuid.UUID, Path(description="The note's ID.")]
FolderId = Annotated[uuid.UUID, Path(description="The folder's ID.")]
TagId = Annotated[uuid.UUID, Path(description="The tag's ID.")]


def _not_found(what: str) -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, f"{what} not found.")


def _folder_missing() -> HTTPException:
    return HTTPException(
        status.HTTP_422_UNPROCESSABLE_CONTENT, "That folder doesn't exist in this workspace."
    )


# Notes


@router.get("/notes", summary="List or search notes")
async def list_notes(
    params: Annotated[NoteListParams, Query()], workspace: WorkspaceDep, notes: NoteServiceDep
) -> NoteListResponse:
    """Filter by state, folder, tag, type, task, favorite, and pin; search words in titles, text,
    tags, and folder names; sort; and page through results."""
    page = await notes.find(workspace.id, params.to_query())
    return NoteListResponse(
        notes=[NoteSummaryResponse.of(item) for item in page.items], total=page.total
    )


@router.post(
    "/notes",
    status_code=status.HTTP_201_CREATED,
    summary="Create a note",
    responses={422: {"description": "Invalid content, or the folder doesn't exist."}},
)
async def create_note(
    body: CreateNoteRequest, workspace: WorkspaceDep, notes: NoteServiceDep
) -> NoteResponse:
    try:
        return NoteResponse.of(await notes.create(workspace.id, body.to_draft()))
    except FolderNotFoundError:
        raise _folder_missing() from None
    except TooManyTagsError:
        raise _too_many_tags() from None


@router.get("/notes/counts", summary="Count notes per view")
async def count_notes(workspace: WorkspaceDep, notes: NoteServiceDep) -> NoteCountsResponse:
    return NoteCountsResponse.of(await notes.counts(workspace.id))


@router.post("/notes/empty-trash", summary="Delete every note in the trash")
async def empty_trash(
    workspace: WorkspaceDep, notes: NoteServiceDep, attachments: AttachmentServiceDep
) -> EmptyTrashResponse:
    """Permanent: the notes, their links, and their attachments are deleted."""
    note_ids = await notes.trashed_ids(workspace.id)
    files = await attachments.ids_for_notes(workspace.id, note_ids)
    deleted = await notes.empty_trash(workspace.id, note_ids)
    await attachments.delete_files(workspace.id, files)
    return EmptyTrashResponse(deleted=deleted)


@router.get("/notes/journal/{entry_date}", summary="Get the journal entry for a day")
async def get_journal_entry(
    entry_date: date, workspace: WorkspaceDep, notes: NoteServiceDep
) -> NoteResponse:
    entry = await notes.journal_entry(workspace.id, entry_date)
    if entry is None:
        raise _not_found("Journal entry")
    return NoteResponse.of(await notes.detail(workspace.id, entry.id))


@router.put(
    "/notes/journal/today",
    summary="Open today's journal entry",
    responses={201: {"description": "Created."}, 200: {"description": "It already existed."}},
)
async def open_todays_journal(
    response: Response, user: CurrentUserDep, workspace: WorkspaceDep, notes: NoteServiceDep
) -> NoteResponse:
    """Today is the date in the user's time zone (Settings → Account), else in UTC."""
    zone = ZoneInfo(user.timezone) if user.timezone else UTC
    return await _open_journal(response, workspace.id, datetime.now(zone).date(), notes)


@router.put(
    "/notes/journal/{entry_date}",
    summary="Open the journal entry for a day",
    responses={201: {"description": "Created."}, 200: {"description": "It already existed."}},
)
async def open_journal_entry(
    entry_date: date, response: Response, workspace: WorkspaceDep, notes: NoteServiceDep
) -> NoteResponse:
    """There is one entry per day: this returns it, creating an empty one (201) the first time
    and restoring it if it was in the trash."""
    return await _open_journal(response, workspace.id, entry_date, notes)


async def _open_journal(
    response: Response, workspace_id: uuid.UUID, entry_date: date, notes: NoteServiceDep
) -> NoteResponse:
    if not 2000 <= entry_date.year <= 2200:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Journal dates are years 2000 to 2200."
        )
    detail, created = await notes.open_journal(workspace_id, entry_date)
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return NoteResponse.of(detail)


@router.get("/notes/{note_id}", summary="Get a note")
async def get_note(note_id: NoteId, workspace: WorkspaceDep, notes: NoteServiceDep) -> NoteResponse:
    try:
        return NoteResponse.of(await notes.detail(workspace.id, note_id))
    except NoteNotFoundError:
        raise _not_found("Note") from None


@router.patch(
    "/notes/{note_id}",
    summary="Update a note",
    responses={
        409: {"description": "The note changed since `expected_revision`; reload it first."},
        422: {"description": "Invalid content, or the folder doesn't exist."},
    },
)
async def update_note(
    note_id: NoteId, body: UpdateNoteRequest, workspace: WorkspaceDep, notes: NoteServiceDep
) -> NoteResponse:
    try:
        return NoteResponse.of(await notes.update(workspace.id, note_id, body.to_changes()))
    except NoteNotFoundError:
        raise _not_found("Note") from None
    except RevisionConflictError:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This note was changed somewhere else since you opened it.",
        ) from None
    except FolderNotFoundError:
        raise _folder_missing() from None
    except JournalChangeError:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "A journal entry's type can't change."
        ) from None


@router.post(
    "/notes/{note_id}/open",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Record that a note was opened",
)
async def open_note(note_id: NoteId, workspace: WorkspaceDep, notes: NoteServiceDep) -> Response:
    """For the Recent view. Doesn't change `updated_at` or `revision`."""
    try:
        await notes.mark_opened(workspace.id, note_id)
    except NoteNotFoundError:
        raise _not_found("Note") from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/notes/{note_id}/trash", summary="Move a note to the trash")
async def trash_note(
    note_id: NoteId, workspace: WorkspaceDep, notes: NoteServiceDep
) -> NoteResponse:
    try:
        return NoteResponse.of(await notes.trash(workspace.id, note_id))
    except NoteNotFoundError:
        raise _not_found("Note") from None


@router.post("/notes/{note_id}/restore", summary="Restore a note from the trash")
async def restore_note(
    note_id: NoteId, workspace: WorkspaceDep, notes: NoteServiceDep
) -> NoteResponse:
    try:
        return NoteResponse.of(await notes.restore(workspace.id, note_id))
    except NoteNotFoundError:
        raise _not_found("Note") from None


@router.post(
    "/notes/{note_id}/duplicate", status_code=status.HTTP_201_CREATED, summary="Duplicate a note"
)
async def duplicate_note(
    note_id: NoteId, workspace: WorkspaceDep, notes: NoteServiceDep
) -> NoteResponse:
    """A copy in the same folder, with the same content and tags."""
    try:
        return NoteResponse.of(await notes.duplicate(workspace.id, note_id))
    except NoteNotFoundError:
        raise _not_found("Note") from None


@router.delete(
    "/notes/{note_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a note permanently",
    responses={409: {"description": "The note isn't in the trash."}},
)
async def delete_note(
    note_id: NoteId,
    workspace: WorkspaceDep,
    notes: NoteServiceDep,
    attachments: AttachmentServiceDep,
) -> Response:
    """Only notes in the trash can be deleted; move a note to the trash first."""
    files = await attachments.ids_for_notes(workspace.id, [note_id])
    try:
        await notes.delete_permanently(workspace.id, note_id)
    except NoteNotFoundError:
        raise _not_found("Note") from None
    except NoteNotTrashedError:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Move the note to the trash before deleting it."
        ) from None
    await attachments.delete_files(workspace.id, files)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/notes/{note_id}/links", summary="Get a note's links and backlinks")
async def get_note_links(
    note_id: NoteId, workspace: WorkspaceDep, notes: NoteServiceDep
) -> NoteConnectionsResponse:
    try:
        return NoteConnectionsResponse.of(await notes.connections(workspace.id, note_id))
    except NoteNotFoundError:
        raise _not_found("Note") from None


# Tags on a note


@router.post("/notes/{note_id}/tags", summary="Tag a note")
async def add_note_tag(
    note_id: NoteId, body: AddNoteTagRequest, workspace: WorkspaceDep, notes: NoteServiceDep
) -> NoteTagsResponse:
    """Uses the workspace's tag with this name, ignoring case and spacing, or creates one."""
    try:
        tags = await notes.add_tag(workspace.id, note_id, body.name)
    except NoteNotFoundError:
        raise _not_found("Note") from None
    except TooManyTagsError:
        raise _too_many_tags() from None
    return NoteTagsResponse(tags=[TagRef.of(tag) for tag in tags])


@router.delete(
    "/notes/{note_id}/tags/{tag_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a tag from a note",
)
async def remove_note_tag(
    note_id: NoteId, tag_id: TagId, workspace: WorkspaceDep, notes: NoteServiceDep
) -> Response:
    """The tag itself stays, for other notes."""
    try:
        await notes.remove_tag(workspace.id, note_id, tag_id)
    except NoteNotFoundError:
        raise _not_found("Note") from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _too_many_tags() -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A note can have at most 50 tags.")


# Tasks on a note


@router.get("/notes/{note_id}/tasks", summary="List the tasks linked to a note")
async def list_note_tasks(
    note_id: NoteId, workspace: WorkspaceDep, notes: NoteServiceDep
) -> TaskListResponse:
    try:
        tasks = await notes.tasks(workspace.id, note_id)
    except NoteNotFoundError:
        raise _not_found("Note") from None
    return TaskListResponse(tasks=[TaskResponse.of(task) for task in tasks], total=len(tasks))


@router.put(
    "/notes/{note_id}/tasks/{task_id}",
    summary="Link a task to a note",
    responses={422: {"description": "The task doesn't exist in this workspace."}},
)
async def link_note_task(
    note_id: NoteId, task_id: uuid.UUID, workspace: WorkspaceDep, notes: NoteServiceDep
) -> TaskListResponse:
    """Idempotent. Returns the note's linked tasks."""
    try:
        tasks = await notes.link_task(workspace.id, note_id, task_id)
    except NoteNotFoundError:
        raise _not_found("Note") from None
    except LinkedTaskNotFoundError:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "That task doesn't exist in this workspace."
        ) from None
    return TaskListResponse(tasks=[TaskResponse.of(task) for task in tasks], total=len(tasks))


@router.delete(
    "/notes/{note_id}/tasks/{task_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Unlink a task from a note",
)
async def unlink_note_task(
    note_id: NoteId, task_id: uuid.UUID, workspace: WorkspaceDep, notes: NoteServiceDep
) -> Response:
    """The task itself is unchanged."""
    try:
        await notes.unlink_task(workspace.id, note_id, task_id)
    except NoteNotFoundError:
        raise _not_found("Note") from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Attachments


@router.get("/notes/{note_id}/attachments", summary="List a note's attachments")
async def list_attachments(
    note_id: NoteId,
    workspace: WorkspaceDep,
    attachments: AttachmentServiceDep,
    settings: SettingsDep,
) -> AttachmentListResponse:
    try:
        items = await attachments.for_note(workspace.id, note_id)
    except NoteNotFoundError:
        raise _not_found("Note") from None
    return AttachmentListResponse(
        attachments=[AttachmentResponse.of(item) for item in items],
        max_bytes=settings.attachment_max_bytes,
    )


@router.post(
    "/notes/{note_id}/attachments",
    status_code=status.HTTP_201_CREATED,
    summary="Attach a file to a note",
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"application/octet-stream": {"schema": {"type": "string"}}},
        }
    },
    responses={
        413: {"description": "The file is larger than the server accepts."},
        415: {"description": "The file type isn't accepted, or doesn't match its contents."},
    },
)
async def upload_attachment(
    note_id: NoteId,
    params: Annotated[UploadAttachmentParams, Query()],
    request: Request,
    workspace: WorkspaceDep,
    attachments: AttachmentServiceDep,
    settings: SettingsDep,
) -> AttachmentResponse:
    """The request body is the file itself. Its type is decided from the file name and checked
    against its contents; the declared content type is ignored."""
    data = await _read_body(request, limit=settings.attachment_max_bytes)
    try:
        attachment = await attachments.add(workspace.id, note_id, params.filename, data)
    except NoteNotFoundError:
        raise _not_found("Note") from None
    except AttachmentRejectedError as error:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, str(error)) from None
    return AttachmentResponse.of(attachment)


@router.get(
    "/notes/{note_id}/attachments/{attachment_id}",
    summary="Download an attachment",
    response_class=FileResponse,
    responses={200: {"content": {"application/octet-stream": {}}, "description": "The file."}},
)
async def download_attachment(
    note_id: NoteId,
    attachment_id: uuid.UUID,
    workspace: WorkspaceDep,
    attachments: AttachmentServiceDep,
) -> FileResponse:
    """Always a download (`Content-Disposition: attachment`), never rendered by the browser
    as a page, with the type Orbit detected."""
    try:
        attachment, path = await attachments.open(workspace.id, note_id, attachment_id)
    except AttachmentNotFoundError:
        raise _not_found("Attachment") from None
    return FileResponse(
        path,
        media_type=attachment.content_type,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(attachment.filename)}",
            "Cache-Control": "private, no-cache",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    )


@router.delete(
    "/notes/{note_id}/attachments/{attachment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove an attachment",
)
async def delete_attachment(
    note_id: NoteId,
    attachment_id: uuid.UUID,
    workspace: WorkspaceDep,
    attachments: AttachmentServiceDep,
) -> Response:
    try:
        await attachments.remove(workspace.id, note_id, attachment_id)
    except AttachmentNotFoundError:
        raise _not_found("Attachment") from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _read_body(request: Request, *, limit: int) -> bytes:
    """Read the body, stopping as soon as it exceeds `limit` rather than buffering it all."""
    too_large = HTTPException(
        status.HTTP_413_CONTENT_TOO_LARGE,
        f"Attachments must be at most {limit // (1024 * 1024)} MB.",
    )
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > limit:
        raise too_large
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > limit:
            raise too_large
    if not body:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "The file is empty.")
    return bytes(body)


# Folders


@router.get("/note-folders", summary="List note folders")
async def list_folders(workspace: WorkspaceDep, notes: NoteServiceDep) -> FolderListResponse:
    return FolderListResponse(
        folders=[FolderResponse.of(usage) for usage in await notes.folders(workspace.id)]
    )


@router.post(
    "/note-folders",
    status_code=status.HTTP_201_CREATED,
    summary="Create a folder",
    responses={422: {"description": "The parent doesn't exist, or it would nest too deeply."}},
)
async def create_folder(
    body: CreateFolderRequest, workspace: WorkspaceDep, notes: NoteServiceDep
) -> FolderResponse:
    try:
        folder = await notes.create_folder(workspace.id, body.name, body.parent_id)
    except FolderNotFoundError:
        raise _folder_missing() from None
    except FolderMoveError:
        raise _bad_move() from None
    return FolderResponse.of(FolderUsage(folder=folder, note_count=0))


@router.patch(
    "/note-folders/{folder_id}",
    summary="Rename or move a folder",
    responses={422: {"description": "The move would put the folder inside itself."}},
)
async def update_folder(
    folder_id: FolderId, body: UpdateFolderRequest, workspace: WorkspaceDep, notes: NoteServiceDep
) -> FolderResponse:
    try:
        folder = await notes.update_folder(
            workspace.id,
            folder_id,
            name=body.name,
            parent_id=body.parent_id if "parent_id" in body.model_fields_set else UNSET,
        )
    except FolderNotFoundError:
        # The folder itself, or the new parent.
        if not any(usage.folder.id == folder_id for usage in await notes.folders(workspace.id)):
            raise _not_found("Folder") from None
        raise _folder_missing() from None
    except FolderMoveError:
        raise _bad_move() from None
    usages = {usage.folder.id: usage for usage in await notes.folders(workspace.id)}
    return FolderResponse.of(usages.get(folder.id, FolderUsage(folder=folder, note_count=0)))


@router.delete(
    "/note-folders/{folder_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a folder",
)
async def delete_folder(
    folder_id: FolderId,
    params: Annotated[DeleteFolderParams, Query()],
    workspace: WorkspaceDep,
    notes: NoteServiceDep,
) -> Response:
    """Notes are never deleted with a folder; `notes` says where they go."""
    try:
        await notes.delete_folder(workspace.id, folder_id, params.notes)
    except FolderNotFoundError:
        raise _not_found("Folder") from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _bad_move() -> HTTPException:
    return HTTPException(
        status.HTTP_422_UNPROCESSABLE_CONTENT,
        "A folder can't go inside itself or one of its subfolders, or more than 8 levels deep.",
    )


# Tags


@router.get("/note-tags", summary="List note tags")
async def list_tags(workspace: WorkspaceDep, notes: NoteServiceDep) -> TagListResponse:
    """By name, with how many active notes use each."""
    return TagListResponse(tags=[TagResponse.of(usage) for usage in await notes.tags(workspace.id)])


@router.post(
    "/note-tags",
    status_code=status.HTTP_201_CREATED,
    summary="Create a tag",
    responses={409: {"description": "A tag with this name exists (ignoring case and spacing)."}},
)
async def create_tag(
    body: TagRequest, workspace: WorkspaceDep, notes: NoteServiceDep
) -> TagResponse:
    try:
        tag = await notes.create_tag(workspace.id, body.name)
    except TagNameTakenError:
        raise _tag_taken() from None
    return TagResponse.of(TagUsage(tag=tag, note_count=0))


@router.patch(
    "/note-tags/{tag_id}",
    summary="Rename a tag",
    responses={409: {"description": "Another tag has this name (ignoring case and spacing)."}},
)
async def rename_tag(
    tag_id: TagId, body: TagRequest, workspace: WorkspaceDep, notes: NoteServiceDep
) -> TagResponse:
    try:
        tag = await notes.rename_tag(workspace.id, tag_id, body.name)
    except TagNotFoundError:
        raise _not_found("Tag") from None
    except TagNameTakenError:
        raise _tag_taken() from None
    usages = {usage.tag.id: usage for usage in await notes.tags(workspace.id)}
    return TagResponse.of(usages.get(tag.id, TagUsage(tag=tag, note_count=0)))


@router.delete(
    "/note-tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a tag"
)
async def delete_tag(tag_id: TagId, workspace: WorkspaceDep, notes: NoteServiceDep) -> Response:
    """Removes the tag from every note; the notes stay."""
    try:
        await notes.delete_tag(workspace.id, tag_id)
    except TagNotFoundError:
        raise _not_found("Tag") from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _tag_taken() -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, "A tag with that name already exists.")
