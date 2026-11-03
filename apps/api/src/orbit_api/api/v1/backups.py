"""Backups, restores, imports, and exports of a workspace. Every route authorizes the workspace
through `WorkspaceDep` first, so an ID from another workspace behaves like a missing one.

Archives are never reachable by URL on their own: downloads need the bearer token, are always
attachments, and are never cached. Passwords arrive in request bodies only (never in URLs, which
end up in logs) and are never stored.
"""

import uuid
from collections.abc import Generator
from contextlib import contextmanager
from typing import Annotated, Any
from urllib.parse import quote

import anyio
from fastapi import APIRouter, HTTPException, Path, Query, Request, Response, status
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from orbit_api.api.auth import CurrentUserDep, WorkspaceDep
from orbit_api.api.dependencies import ArchiveStoreDep, BackupServiceDep, SettingsDep
from orbit_api.schemas.backup import (
    ArchivePasswordRequest,
    BackupOverviewResponse,
    BackupResponse,
    BackupSettingsResponse,
    BackupUploadResponse,
    CreateBackupRequest,
    ExportArchiveRequest,
    ExportModuleRequest,
    InspectionResponse,
    RestoreReportResponse,
    RestoreUploadRequest,
    UpdateBackupSettingsRequest,
    UploadParams,
    VerificationResponse,
)
from orbit_api.services.backup.models import (
    BackupError,
    BackupFailedError,
    BackupFileMissingError,
    BackupNotFoundError,
    BackupRunningError,
    RestoreFailedError,
    RestoreRejectedError,
    UploadNotFoundError,
)
from orbit_api.services.backup.service import ApplyRequest, ExportFile, SettingsChanges
from orbit_api.system.archive import remove_file

_RESPONSES: dict[int | str, dict[str, Any]] = {
    401: {"description": "Not signed in."},
    404: {"description": "The workspace, backup, or upload does not exist or is not accessible."},
}
_ARCHIVE: dict[int | str, dict[str, Any]] = {
    200: {"content": {"application/octet-stream": {}}, "description": "The file."}
}
_UPLOAD_BODY = {
    "requestBody": {
        "required": True,
        "content": {"application/octet-stream": {"schema": {"type": "string"}}},
    }
}
_HEADERS = {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"}

router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["backups"], responses=_RESPONSES)

BackupId = Annotated[uuid.UUID, Path(description="The backup's ID.")]
UploadId = Annotated[uuid.UUID, Path(description="The upload's ID.")]


@contextmanager
def _errors() -> Generator[None]:
    """Map the service's errors to HTTP; every message is written for the person."""
    try:
        yield
    except (BackupNotFoundError, UploadNotFoundError, BackupFileMissingError) as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, exc.message) from None
    except (BackupRunningError, RestoreRejectedError, RestoreFailedError) as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, exc.message) from None
    except BackupFailedError as exc:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, exc.message) from None
    except BackupError as exc:
        # Invalid or incompatible archives, missing or wrong passwords. Never 401: that status
        # means "signed out" to the web app.
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, exc.message) from None


def _attachment(export: ExportFile) -> FileResponse:
    return FileResponse(
        export.path,
        media_type=export.media_type,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(export.filename)}",
            **_HEADERS,
        },
        background=BackgroundTask(remove_file, export.path),
    )


@router.get("/backups", summary="Backups, automatic backup settings, and recent uploads")
async def backup_overview(
    workspace: WorkspaceDep, backups: BackupServiceDep
) -> BackupOverviewResponse:
    return BackupOverviewResponse.of(await backups.overview(workspace.id))


@router.post(
    "/backups",
    status_code=status.HTTP_201_CREATED,
    summary="Create a backup",
    responses={
        409: {"description": "A backup of this workspace is already running."},
        500: {"description": "The backup failed; the failure is recorded in the history."},
    },
)
async def create_backup(
    body: CreateBackupRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    backups: BackupServiceDep,
) -> BackupResponse:
    """Back up every module's records and, optionally, the workspace's files. The archive is
    kept on the server until it's deleted; download it to keep a copy elsewhere."""
    with _errors():
        backup = await backups.create_backup(
            workspace,
            user.id,
            kind="manual",
            include_files=body.include_files,
            encryption_mode=body.encryption,
            password=body.secret(),
        )
    return BackupResponse.of(backup)


@router.put("/backups/settings", summary="Change automatic backups")
async def update_backup_settings(
    body: UpdateBackupSettingsRequest, workspace: WorkspaceDep, backups: BackupServiceDep
) -> BackupSettingsResponse:
    """Frequency, how many automatic backups to keep, whether they include files, and whether
    they're encrypted with the backup password (set or change it with `password`)."""
    with _errors():
        settings = await backups.update_settings(
            workspace.id,
            SettingsChanges(
                frequency=body.frequency,
                retention_count=body.retention_count,
                include_files=body.include_files,
                encrypt=body.encrypt,
                password=body.secret(),
            ),
        )
    return BackupSettingsResponse.of(settings)


@router.get("/backups/{backup_id}", summary="A backup")
async def get_backup(
    backup_id: BackupId, workspace: WorkspaceDep, backups: BackupServiceDep
) -> BackupResponse:
    with _errors():
        return BackupResponse.of(await backups.get_backup(workspace.id, backup_id))


@router.get(
    "/backups/{backup_id}/download",
    summary="Download a backup",
    response_class=FileResponse,
    responses=_ARCHIVE,
)
async def download_backup(
    backup_id: BackupId, workspace: WorkspaceDep, backups: BackupServiceDep
) -> FileResponse:
    with _errors():
        backup, path = await backups.open_backup(workspace.id, backup_id)
    stamp = backup.created_at.strftime("%Y-%m-%d-%H%M")
    suffix = ".orbit-backup" if backup.encrypted else ".zip"
    filename = f"orbit-backup-{stamp}{suffix}"
    return FileResponse(
        path,
        media_type="application/octet-stream" if backup.encrypted else "application/zip",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
            **_HEADERS,
        },
    )


@router.post("/backups/{backup_id}/verify", summary="Check a backup's integrity")
async def verify_backup(
    backup_id: BackupId,
    body: ArchivePasswordRequest,
    workspace: WorkspaceDep,
    backups: BackupServiceDep,
) -> VerificationResponse:
    """Compare the archive with the checksum recorded when it was made, then (for unencrypted
    backups, or with the password) every record and file with the manifest's checksums."""
    with _errors():
        return VerificationResponse.of(
            await backups.verify_backup(workspace.id, backup_id, body.secret())
        )


@router.delete(
    "/backups/{backup_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a backup"
)
async def delete_backup(
    backup_id: BackupId, workspace: WorkspaceDep, backups: BackupServiceDep
) -> Response:
    with _errors():
        await backups.delete_backup(workspace.id, backup_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/exports/archive",
    summary="Download a backup archive without keeping it",
    response_class=FileResponse,
    responses=_ARCHIVE,
)
async def export_archive(
    body: ExportArchiveRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    backups: BackupServiceDep,
) -> FileResponse:
    """The same archive as a backup, built for this download and deleted from the server once
    it's sent. With a password, it's encrypted."""
    with _errors():
        export = await backups.export_archive(
            workspace, user.id, include_files=body.include_files, password=body.secret()
        )
    return _attachment(export)


@router.post(
    "/exports",
    summary="Export a module, or the whole workspace as JSON",
    response_class=FileResponse,
    responses=_ARCHIVE,
)
async def export_module(
    body: ExportModuleRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    backups: BackupServiceDep,
) -> FileResponse:
    """JSON for any module (or every module), CSV for tables, iCalendar for the calendar, and
    Markdown for notes. JSON exports can be imported back into a workspace."""
    with _errors():
        export = await backups.export_module(workspace, user.id, body.module, body.format)
    return _attachment(export)


async def _receive(request: Request, target: anyio.Path, limit: int) -> None:
    """Write the body to `target`, stopping as soon as it exceeds `limit`."""
    too_large = HTTPException(
        status.HTTP_413_CONTENT_TOO_LARGE,
        f"Uploads must be at most {limit // (1024 * 1024)} MB.",
    )
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > limit:
        raise too_large
    size = 0
    async with await target.open("wb") as file:
        async for chunk in request.stream():
            size += len(chunk)
            if size > limit:
                raise too_large
            await file.write(chunk)
    if size == 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "The file is empty.")


@router.post(
    "/backup-uploads",
    status_code=status.HTTP_201_CREATED,
    summary="Upload a backup or export to restore or import",
    openapi_extra=_UPLOAD_BODY,
    responses={413: {"description": "The file is larger than the server accepts."}},
)
async def upload_backup(
    params: Annotated[UploadParams, Query()],
    request: Request,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    backups: BackupServiceDep,
    archives: ArchiveStoreDep,
    settings: SettingsDep,
) -> BackupUploadResponse:
    """The body is the file. It's staged on the server for 24 hours; nothing is restored until
    it's inspected and a restore is confirmed."""
    path = await archives.temporary(".upload")
    try:
        await _receive(request, anyio.Path(path), settings.backup_upload_max_bytes)
    except BaseException:
        await archives.remove(path)
        raise
    with _errors():
        upload = await backups.receive_upload(workspace.id, user.id, path, params.filename)
    return BackupUploadResponse.of(upload)


@router.get("/backup-uploads", summary="Recent uploads, restores, and imports")
async def list_uploads(
    workspace: WorkspaceDep, backups: BackupServiceDep
) -> list[BackupUploadResponse]:
    return [BackupUploadResponse.of(upload) for upload in await backups.list_uploads(workspace.id)]


@router.post("/backup-uploads/{upload_id}/inspect", summary="Inspect an upload before restoring")
async def inspect_upload(
    upload_id: UploadId,
    body: ArchivePasswordRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    backups: BackupServiceDep,
) -> InspectionResponse:
    """Validate the archive's structure, checksums, and compatibility, list what it contains,
    and dry-run the restore or import (nothing is changed)."""
    with _errors():
        return InspectionResponse.of(
            await backups.inspect(workspace, user.id, upload_id, body.secret())
        )


@router.post(
    "/backup-uploads/{upload_id}/restore",
    summary="Restore a backup or import an export",
    responses={
        409: {"description": "The restore can't go ahead as asked, or failed; nothing changed."}
    },
)
async def restore_upload(
    upload_id: UploadId,
    body: RestoreUploadRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    backups: BackupServiceDep,
) -> RestoreReportResponse:
    """Backups restore into a new workspace, into this workspace if it's empty, or replace this
    workspace's data (after a pre-restore backup; type the workspace's name to confirm). Exports
    are added to this workspace. With `dry_run`, nothing is changed."""
    with _errors():
        report = await backups.apply(
            workspace,
            user.id,
            upload_id,
            ApplyRequest(
                strategy=body.strategy,
                password=body.secret(),
                workspace_name=body.workspace_name,
                confirm_name=body.confirm_name,
                allow_repeat=body.allow_repeat,
                dry_run=body.dry_run,
            ),
        )
    return RestoreReportResponse.of(report)


@router.delete(
    "/backup-uploads/{upload_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Discard an upload",
)
async def discard_upload(
    upload_id: UploadId, workspace: WorkspaceDep, backups: BackupServiceDep
) -> Response:
    with _errors():
        await backups.discard_upload(workspace.id, upload_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
