"""Documents and the personal vault: documents, uploads and versions, downloads, renewals,
links to other modules, folders, categories, tags, the overview, and export. Every route
authorizes the workspace through `WorkspaceDep` first, so an ID from another workspace behaves
exactly like a missing one."""

import uuid
from collections.abc import Generator
from contextlib import contextmanager
from datetime import date, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Path, Query, Request, Response, status
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from orbit_api.api.auth import CurrentUserDep, WorkspaceDep
from orbit_api.api.dependencies import DocumentServiceDep, SettingsDep
from orbit_api.api.files import download_response, read_body
from orbit_api.schemas.documents import (
    CreateDocumentCategoryRequest,
    CreateDocumentFolderRequest,
    CreateDocumentRequest,
    DeleteDocumentFolderParams,
    DocumentCategoryListResponse,
    DocumentCategoryResponse,
    DocumentCountsResponse,
    DocumentDetailResponse,
    DocumentFolderListResponse,
    DocumentFolderResponse,
    DocumentLinkCandidatesParams,
    DocumentLinkCandidatesResponse,
    DocumentLinkResponse,
    DocumentListParams,
    DocumentListResponse,
    DocumentOverviewResponse,
    DocumentSettingsResponse,
    DocumentSummaryResponse,
    DocumentTagListResponse,
    DocumentTagResponse,
    EmptyDocumentTrashResponse,
    ExportDocumentsRequest,
    RenewDocumentRequest,
    UpdateDocumentCategoryRequest,
    UpdateDocumentFolderRequest,
    UpdateDocumentRequest,
    UploadDocumentParams,
    UploadVersionParams,
)
from orbit_api.services.accounts.models import User
from orbit_api.services.documents.expiry import today_in
from orbit_api.services.documents.export import plan_export
from orbit_api.services.documents.models import (
    ACCEPTED_EXTENSIONS,
    CategoryNameTakenError,
    CategoryNotFoundError,
    DateRange,
    DocumentDraft,
    DocumentNotFoundError,
    DocumentNotTrashedError,
    DocumentQuery,
    DocumentReadOnlyError,
    DocumentState,
    FileMissingError,
    FileRejectedError,
    FolderMoveError,
    FolderNotFoundError,
    InvalidDocumentError,
    LinkedRecordNotFoundError,
    LinkKind,
    LinkTarget,
    TooManyCategoriesError,
    VersionNotFoundError,
)
from orbit_api.services.documents.service import DocumentService, title_from_filename
from orbit_api.services.transactions import ConflictError
from orbit_api.system.archive import remove_file, write_archive
from orbit_api.utils.changes import UNSET
from orbit_api.utils.clock import utc_now

_RESPONSES: dict[int | str, dict[str, Any]] = {
    401: {"description": "Not signed in."},
    404: {"description": "The workspace or document does not exist or is not accessible."},
}
_UPLOAD_BODY = {
    "requestBody": {
        "required": True,
        "content": {"application/octet-stream": {"schema": {"type": "string"}}},
    }
}
_UPLOAD_ERRORS: dict[int | str, dict[str, Any]] = {
    413: {"description": "The file is larger than the server accepts."},
    415: {"description": "The file type isn't accepted, or doesn't match its contents."},
}
_FILE: dict[int | str, dict[str, Any]] = {
    200: {"content": {"application/octet-stream": {}}, "description": "The file."}
}

router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["documents"], responses=_RESPONSES)

DocumentId = Annotated[uuid.UUID, Path(description="The document's ID.")]
VersionId = Annotated[uuid.UUID, Path(description="The version's ID.")]
FolderId = Annotated[uuid.UUID, Path(description="The folder's ID.")]
CategoryId = Annotated[uuid.UUID, Path(description="The category's ID.")]


def _today(user: User) -> date:
    return today_in(user.timezone or "UTC", utc_now())


def _error(code: int, detail: str) -> HTTPException:
    return HTTPException(code, detail)


@contextmanager
def _errors() -> Generator[None]:
    """Map the service's errors to HTTP. Folders and categories here are references (in a body
    or query), so a missing one is a 422; routes about a folder or category in the path catch
    theirs first."""
    try:
        yield
    except DocumentNotFoundError:
        raise _error(status.HTTP_404_NOT_FOUND, "Document not found.") from None
    except VersionNotFoundError:
        raise _error(status.HTTP_404_NOT_FOUND, "Version not found.") from None
    except FileMissingError:
        raise _error(status.HTTP_404_NOT_FOUND, "The file is missing from storage.") from None
    except FolderNotFoundError:
        raise _error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "That folder doesn't exist in this workspace."
        ) from None
    except CategoryNotFoundError:
        raise _error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "That category doesn't exist in this workspace."
        ) from None
    except LinkedRecordNotFoundError:
        raise _error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "That record doesn't exist in this workspace."
        ) from None
    except FolderMoveError:
        raise _error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "A folder can't go inside itself or its subfolders, or nest more than 8 levels.",
        ) from None
    except InvalidDocumentError as error:
        raise _error(status.HTTP_422_UNPROCESSABLE_CONTENT, str(error)) from None
    except FileRejectedError as error:
        raise _error(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, str(error)) from None
    except DocumentReadOnlyError:
        raise _error(
            status.HTTP_409_CONFLICT, "Documents in the trash can't be changed. Restore it first."
        ) from None
    except DocumentNotTrashedError:
        raise _error(
            status.HTTP_409_CONFLICT, "Only documents in the trash can be deleted permanently."
        ) from None
    except CategoryNameTakenError:
        raise _error(status.HTTP_409_CONFLICT, "A category with that name exists.") from None
    except TooManyCategoriesError:
        raise _error(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "A workspace can have at most 50 categories."
        ) from None
    except ConflictError:
        raise _error(
            status.HTTP_409_CONFLICT, "The document changed at the same time. Try again."
        ) from None


async def _detail(
    documents: DocumentService, workspace_id: uuid.UUID, document_id: uuid.UUID, user: User
) -> DocumentDetailResponse:
    with _errors():
        detail = await documents.detail(workspace_id, document_id)
    return DocumentDetailResponse.of(detail, _today(user))


def _query(params: DocumentListParams, today: date) -> DocumentQuery:
    states: tuple[DocumentState, ...] = (
        ("active", "archived") if params.state == "any" else (params.state,)
    )
    expiry = DateRange(params.expires_from, params.expires_to)
    if params.expires_within is not None:
        expiry = DateRange(today, today + timedelta(days=params.expires_within))
    if params.expired:
        expiry = DateRange(expiry.start, today - timedelta(days=1))
    renewal = DateRange()
    if params.renewal_within is not None:
        renewal = DateRange(today, today + timedelta(days=params.renewal_within))
    default_order = "asc" if params.sort in ("title", "category", "expiry") else "desc"
    return DocumentQuery(
        states=states,
        folder_id=None if params.unfiled else params.folder_id or UNSET,
        include_subfolders=params.include_subfolders,
        category_id=None if params.unclassified else params.category_id or UNSET,
        tag=params.tag,
        file_kind=params.file_kind,
        favorite=params.favorite,
        created=DateRange(params.added_from, params.added_to),
        expiry=expiry,
        renewal=renewal,
        linked=(
            LinkTarget(params.linked_kind, params.linked_id)
            if params.linked_kind is not None and params.linked_id is not None
            else None
        ),
        search=params.q,
        sort=params.sort,
        order=params.order or default_order,
        limit=params.limit,
        offset=params.offset,
    )


# Collection routes (before `/documents/{document_id}`, which would otherwise match them)


@router.get("/documents", summary="List or search documents")
async def list_documents(
    params: Annotated[DocumentListParams, Query()],
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    documents: DocumentServiceDep,
) -> DocumentListResponse:
    today = _today(user)
    with _errors():
        items, total = await documents.find(workspace.id, _query(params, today))
    return DocumentListResponse(
        documents=[DocumentSummaryResponse.of(item, today) for item in items], total=total
    )


@router.post(
    "/documents",
    status_code=status.HTTP_201_CREATED,
    summary="Create a document without a file",
    responses={422: {"description": "Invalid fields, or the folder or category doesn't exist."}},
)
async def create_document(
    body: CreateDocumentRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    documents: DocumentServiceDep,
) -> DocumentDetailResponse:
    """Track a document you haven't uploaded; add its file later as the first version."""
    with _errors():
        document = await documents.create(
            workspace.id, body.to_draft(user.timezone), default_timezone=user.timezone
        )
    return await _detail(documents, workspace.id, document.id, user)


@router.post(
    "/documents/upload",
    status_code=status.HTTP_201_CREATED,
    summary="Upload a file as a new document",
    openapi_extra=_UPLOAD_BODY,
    responses=_UPLOAD_ERRORS,
)
async def upload_document(
    params: Annotated[UploadDocumentParams, Query()],
    request: Request,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    documents: DocumentServiceDep,
    settings: SettingsDep,
) -> DocumentDetailResponse:
    """The request body is the file itself. Its type is decided from the file name and checked
    against its contents; the declared content type is ignored. The file and its metadata are
    saved together: if either fails, neither is kept."""
    data = await read_body(request, limit=settings.document_max_bytes)
    draft = DocumentDraft(
        title=params.title or title_from_filename(params.filename),
        folder_id=params.folder_id,
        category_id=params.category_id,
    )
    with _errors():
        document = await documents.upload(
            workspace.id, params.filename, data, draft, default_timezone=user.timezone
        )
    return await _detail(documents, workspace.id, document.id, user)


@router.get("/documents/overview", summary="The documents overview")
async def documents_overview(
    workspace: WorkspaceDep, user: CurrentUserDep, documents: DocumentServiceDep
) -> DocumentOverviewResponse:
    """Counts, recent and favorite documents, what's expiring or expired, and categories."""
    today = _today(user)
    return DocumentOverviewResponse.of(await documents.overview(workspace.id, today), today)


@router.get("/documents/counts", summary="Document counts per view")
async def document_counts(
    workspace: WorkspaceDep, user: CurrentUserDep, documents: DocumentServiceDep
) -> DocumentCountsResponse:
    return DocumentCountsResponse.of(await documents.counts(workspace.id, _today(user)))


@router.get("/documents/settings", summary="Upload limits")
async def document_settings(
    workspace: WorkspaceDep, settings: SettingsDep
) -> DocumentSettingsResponse:
    del workspace  # Authorizes the request; the limits are the same for every workspace.
    return DocumentSettingsResponse(
        max_bytes=settings.document_max_bytes, accepted_extensions=sorted(ACCEPTED_EXTENSIONS)
    )


@router.get("/documents/tags", summary="Tags used on documents")
async def document_tags(
    workspace: WorkspaceDep, documents: DocumentServiceDep
) -> DocumentTagListResponse:
    return DocumentTagListResponse(
        tags=[
            DocumentTagResponse(name=name, document_count=count)
            for name, count in await documents.tags(workspace.id)
        ]
    )


@router.get("/documents/link-candidates", summary="Records a document can be linked to")
async def link_candidates(
    params: Annotated[DocumentLinkCandidatesParams, Query()],
    workspace: WorkspaceDep,
    documents: DocumentServiceDep,
) -> DocumentLinkCandidatesResponse:
    """Notes, tasks, events, or finance records of one kind, newest first, optionally searched
    by title."""
    records = await documents.candidates(workspace.id, params.kind, params.q, params.limit)
    return DocumentLinkCandidatesResponse(
        records=[DocumentLinkResponse.of(record) for record in records]
    )


@router.post(
    "/documents/export",
    summary="Export documents as a ZIP archive",
    response_class=FileResponse,
    responses={200: {"content": {"application/zip": {}}, "description": "The archive."}},
)
async def export_documents(
    body: ExportDocumentsRequest, workspace: WorkspaceDep, documents: DocumentServiceDep
) -> FileResponse:
    """Original files under their folders, with `metadata.json` describing every document
    (including reference numbers: an export is the owner's own backup)."""
    with _errors():
        bundle = await documents.export(workspace.id, body.to_selection())
    now = utc_now()
    entries, metadata = plan_export(bundle, now)
    path = await write_archive(entries, metadata)
    return FileResponse(
        path,
        media_type="application/zip",
        filename=f"orbit-documents-{now.date().isoformat()}.zip",
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
        background=BackgroundTask(remove_file, path),
    )


@router.post("/documents/empty-trash", summary="Delete every trashed document for good")
async def empty_document_trash(
    workspace: WorkspaceDep, documents: DocumentServiceDep
) -> EmptyDocumentTrashResponse:
    return EmptyDocumentTrashResponse(deleted=await documents.empty_trash(workspace.id))


# One document


@router.get("/documents/{document_id}", summary="Get a document with its history and links")
async def get_document(
    document_id: DocumentId,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    documents: DocumentServiceDep,
) -> DocumentDetailResponse:
    return await _detail(documents, workspace.id, document_id, user)


@router.patch(
    "/documents/{document_id}",
    summary="Update a document's details",
    responses={409: {"description": "The document is in the trash."}},
)
async def update_document(
    document_id: DocumentId,
    body: UpdateDocumentRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    documents: DocumentServiceDep,
) -> DocumentDetailResponse:
    """Rename, move, classify, tag, favorite, archive, edit metadata or reminder timing. The
    file is unaffected; replace it by uploading a new version."""
    with _errors():
        await documents.update(workspace.id, document_id, body.to_changes())
    return await _detail(documents, workspace.id, document_id, user)


@router.delete(
    "/documents/{document_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a trashed document permanently",
    responses={409: {"description": "The document isn't in the trash."}},
)
async def delete_document(
    document_id: DocumentId, workspace: WorkspaceDep, documents: DocumentServiceDep
) -> Response:
    """Deletes the document, every version, and their files."""
    with _errors():
        await documents.delete(workspace.id, document_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/documents/{document_id}/open",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Record that a document was opened",
)
async def open_document(
    document_id: DocumentId, workspace: WorkspaceDep, documents: DocumentServiceDep
) -> Response:
    with _errors():
        await documents.mark_opened(workspace.id, document_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/documents/{document_id}/trash", summary="Move a document to the trash")
async def trash_document(
    document_id: DocumentId,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    documents: DocumentServiceDep,
) -> DocumentDetailResponse:
    """Its reminders stop; its files are kept until it's deleted permanently."""
    with _errors():
        await documents.trash(workspace.id, document_id)
    return await _detail(documents, workspace.id, document_id, user)


@router.post("/documents/{document_id}/restore", summary="Restore a document from the trash")
async def restore_document(
    document_id: DocumentId,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    documents: DocumentServiceDep,
) -> DocumentDetailResponse:
    with _errors():
        await documents.restore(workspace.id, document_id)
    return await _detail(documents, workspace.id, document_id, user)


@router.post("/documents/{document_id}/renew", summary="Record a renewal")
async def renew_document(
    document_id: DocumentId,
    body: RenewDocumentRequest,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    documents: DocumentServiceDep,
) -> DocumentDetailResponse:
    """Replace the expiry (and optionally issue and renewal) dates, keeping the old ones in the
    renewal history; reminders move to the new dates. Upload the renewed copy as a new version."""
    with _errors():
        await documents.renew(workspace.id, document_id, body.to_draft())
    return await _detail(documents, workspace.id, document_id, user)


@router.get(
    "/documents/{document_id}/file",
    summary="Download the current file",
    response_class=FileResponse,
    responses=_FILE,
)
async def download_document(
    document_id: DocumentId, workspace: WorkspaceDep, documents: DocumentServiceDep
) -> FileResponse:
    """Always a download (`Content-Disposition: attachment`) with the type Orbit detected,
    `nosniff`, and a sandboxing CSP, so the browser never runs it as a page. There is no
    public or guessable URL: every request needs the bearer token."""
    with _errors():
        version, path = await documents.open_file(workspace.id, document_id, None)
    return download_response(path, version.content_type, version.filename)


@router.post(
    "/documents/{document_id}/versions",
    status_code=status.HTTP_201_CREATED,
    summary="Upload a new version",
    openapi_extra=_UPLOAD_BODY,
    responses={**_UPLOAD_ERRORS, 409: {"description": "The document is in the trash."}},
)
async def upload_version(
    document_id: DocumentId,
    params: Annotated[UploadVersionParams, Query()],
    request: Request,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    documents: DocumentServiceDep,
    settings: SettingsDep,
) -> DocumentDetailResponse:
    """Replace the file. Earlier versions are kept and can be restored."""
    data = await read_body(request, limit=settings.document_max_bytes)
    with _errors():
        await documents.add_version(workspace.id, document_id, params.filename, data, params.note)
    return await _detail(documents, workspace.id, document_id, user)


@router.get(
    "/documents/{document_id}/versions/{version_id}/file",
    summary="Download a version's file",
    response_class=FileResponse,
    responses=_FILE,
)
async def download_version(
    document_id: DocumentId,
    version_id: VersionId,
    workspace: WorkspaceDep,
    documents: DocumentServiceDep,
) -> FileResponse:
    with _errors():
        version, path = await documents.open_file(workspace.id, document_id, version_id)
    return download_response(path, version.content_type, version.filename)


@router.post(
    "/documents/{document_id}/versions/{version_id}/restore",
    summary="Restore an earlier version",
)
async def restore_version(
    document_id: DocumentId,
    version_id: VersionId,
    workspace: WorkspaceDep,
    user: CurrentUserDep,
    documents: DocumentServiceDep,
) -> DocumentDetailResponse:
    """Adds a new version with the earlier version's file, so no version is lost."""
    with _errors():
        await documents.restore_version(workspace.id, document_id, version_id)
    return await _detail(documents, workspace.id, document_id, user)


@router.delete(
    "/documents/{document_id}/versions/{version_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an earlier version",
    responses={422: {"description": "It's the current version."}},
)
async def delete_version(
    document_id: DocumentId,
    version_id: VersionId,
    workspace: WorkspaceDep,
    documents: DocumentServiceDep,
) -> Response:
    with _errors():
        await documents.delete_version(workspace.id, document_id, version_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put(
    "/documents/{document_id}/links/{kind}/{target_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Link a document to a record",
    responses={422: {"description": "The record doesn't exist in this workspace."}},
)
async def link_document(
    document_id: DocumentId,
    kind: LinkKind,
    target_id: uuid.UUID,
    workspace: WorkspaceDep,
    documents: DocumentServiceDep,
) -> Response:
    """Idempotent. The record must be in the same workspace."""
    with _errors():
        await documents.link(workspace.id, document_id, LinkTarget(kind, target_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/documents/{document_id}/links/{kind}/{target_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Unlink a document from a record",
)
async def unlink_document(
    document_id: DocumentId,
    kind: LinkKind,
    target_id: uuid.UUID,
    workspace: WorkspaceDep,
    documents: DocumentServiceDep,
) -> Response:
    with _errors():
        await documents.unlink(workspace.id, document_id, LinkTarget(kind, target_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Folders


@router.get("/document-folders", summary="List document folders")
async def list_document_folders(
    workspace: WorkspaceDep, documents: DocumentServiceDep
) -> DocumentFolderListResponse:
    return DocumentFolderListResponse(
        folders=[
            DocumentFolderResponse.of(usage) for usage in await documents.folders(workspace.id)
        ]
    )


@router.post(
    "/document-folders",
    status_code=status.HTTP_201_CREATED,
    summary="Create a document folder",
    responses={422: {"description": "The parent doesn't exist, or it would nest too deeply."}},
)
async def create_document_folder(
    body: CreateDocumentFolderRequest, workspace: WorkspaceDep, documents: DocumentServiceDep
) -> DocumentFolderResponse:
    with _errors():
        folder = await documents.create_folder(workspace.id, body.name, body.parent_id)
    return await _folder_response(documents, workspace.id, folder.id)


@router.patch(
    "/document-folders/{folder_id}",
    summary="Rename or move a document folder",
    responses={422: {"description": "The move would create a loop or nest too deeply."}},
)
async def update_document_folder(
    folder_id: FolderId,
    body: UpdateDocumentFolderRequest,
    workspace: WorkspaceDep,
    documents: DocumentServiceDep,
) -> DocumentFolderResponse:
    await _require_folder(documents, workspace.id, folder_id)
    with _errors():
        await documents.update_folder(
            workspace.id,
            folder_id,
            name=body.name,
            parent_id=body.parent_id if "parent_id" in body.model_fields_set else UNSET,
        )
    return await _folder_response(documents, workspace.id, folder_id)


@router.delete(
    "/document-folders/{folder_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a document folder",
)
async def delete_document_folder(
    folder_id: FolderId,
    params: Annotated[DeleteDocumentFolderParams, Query()],
    workspace: WorkspaceDep,
    documents: DocumentServiceDep,
) -> Response:
    """Never deletes documents: `documents` chooses where they go."""
    await _require_folder(documents, workspace.id, folder_id)
    with _errors():
        await documents.delete_folder(workspace.id, folder_id, params.documents, params.target_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _require_folder(
    documents: DocumentService, workspace_id: uuid.UUID, folder_id: uuid.UUID
) -> None:
    if not any(usage.folder.id == folder_id for usage in await documents.folders(workspace_id)):
        raise _error(status.HTTP_404_NOT_FOUND, "Folder not found.")


async def _folder_response(
    documents: DocumentService, workspace_id: uuid.UUID, folder_id: uuid.UUID
) -> DocumentFolderResponse:
    usage = next(u for u in await documents.folders(workspace_id) if u.folder.id == folder_id)
    return DocumentFolderResponse.of(usage)


# Categories


@router.get("/document-categories", summary="List document categories")
async def list_document_categories(
    workspace: WorkspaceDep, documents: DocumentServiceDep
) -> DocumentCategoryListResponse:
    """Creates the default categories the first time."""
    return DocumentCategoryListResponse(
        categories=[
            DocumentCategoryResponse.of(usage) for usage in await documents.categories(workspace.id)
        ]
    )


@router.post(
    "/document-categories",
    status_code=status.HTTP_201_CREATED,
    summary="Create a document category",
    responses={409: {"description": "A category with that name exists."}},
)
async def create_document_category(
    body: CreateDocumentCategoryRequest, workspace: WorkspaceDep, documents: DocumentServiceDep
) -> DocumentCategoryResponse:
    with _errors():
        category = await documents.create_category(workspace.id, body.name, body.icon)
    return await _category_response(documents, workspace.id, category.id)


@router.patch(
    "/document-categories/{category_id}",
    summary="Rename a document category or change its icon",
    responses={409: {"description": "A category with that name exists."}},
)
async def update_document_category(
    category_id: CategoryId,
    body: UpdateDocumentCategoryRequest,
    workspace: WorkspaceDep,
    documents: DocumentServiceDep,
) -> DocumentCategoryResponse:
    try:
        await documents.update_category(workspace.id, category_id, name=body.name, icon=body.icon)
    except CategoryNotFoundError:
        raise _error(status.HTTP_404_NOT_FOUND, "Category not found.") from None
    except CategoryNameTakenError:
        raise _error(status.HTTP_409_CONFLICT, "A category with that name exists.") from None
    return await _category_response(documents, workspace.id, category_id)


@router.delete(
    "/document-categories/{category_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a document category",
)
async def delete_document_category(
    category_id: CategoryId, workspace: WorkspaceDep, documents: DocumentServiceDep
) -> Response:
    """Its documents stay, unclassified."""
    try:
        await documents.delete_category(workspace.id, category_id)
    except CategoryNotFoundError:
        raise _error(status.HTTP_404_NOT_FOUND, "Category not found.") from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _category_response(
    documents: DocumentService, workspace_id: uuid.UUID, category_id: uuid.UUID
) -> DocumentCategoryResponse:
    usage = next(
        u for u in await documents.categories(workspace_id) if u.category.id == category_id
    )
    return DocumentCategoryResponse.of(usage)
