"""Bank statement imports into a finance account. Every route authorizes the workspace through
`WorkspaceDep` first.

Statements are personal data: routes log nothing about them, and never store the file or the
PDF password. The password arrives base64-encoded in a header so it never appears in a URL.
"""

import base64
import binascii
import uuid
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Path, Query, Request, status

from orbit_api.api.auth import WorkspaceDep
from orbit_api.api.dependencies import StatementServiceDep
from orbit_api.api.files import read_body
from orbit_api.schemas.statements import (
    ImportStatementRequest,
    ImportStatementResponse,
    StatementPreviewParams,
    StatementPreviewResponse,
    UndoStatementImportResponse,
)
from orbit_api.services.finance.models import AccountNotFoundError
from orbit_api.services.statements.readers import MAX_STATEMENT_BYTES
from orbit_api.services.statements.service import ImportNotFoundError, InvalidImportError

router = APIRouter(
    prefix="/workspaces/{workspace_id}/finance/statements",
    tags=["finance"],
    responses={
        401: {"description": "Not signed in."},
        404: {"description": "The workspace, account, or import does not exist."},
    },
)

_STATEMENT_BODY = {
    "requestBody": {
        "required": True,
        "description": "The statement file: PDF, Excel (`.xlsx` or `.xls`), or CSV.",
        "content": {"application/octet-stream": {"schema": {"type": "string"}}},
    }
}


def _password(encoded: str | None) -> str | None:
    if not encoded:
        return None
    try:
        return base64.b64decode(encoded, validate=True).decode()
    except (binascii.Error, UnicodeDecodeError):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "The password must be base64-encoded UTF-8."
        ) from None


def _invalid(error: InvalidImportError) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, error.message)


def _account_not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Account not found.")


@router.post(
    "/preview",
    summary="Preview a bank statement",
    openapi_extra=_STATEMENT_BODY,
    responses={
        413: {"description": "The file is larger than 5 MB."},
        422: {"description": "The file can't be read, or the chosen columns don't fit it."},
    },
)
async def preview_statement(
    params: Annotated[StatementPreviewParams, Query()],
    request: Request,
    workspace: WorkspaceDep,
    statements: StatementServiceDep,
    x_statement_password: Annotated[
        str | None,
        Header(description="The PDF's password, base64-encoded. Never stored or logged."),
    ] = None,
) -> StatementPreviewResponse:
    """Read the statement and propose what to do with each row. Nothing is saved."""
    password = _password(x_statement_password)
    data = await read_body(request, limit=MAX_STATEMENT_BYTES, what="Statements")
    try:
        preview = await statements.preview(
            workspace.id, params.account_id, data, params.to_options(password), params.today
        )
    except AccountNotFoundError:
        raise _account_not_found() from None
    except InvalidImportError as error:
        raise _invalid(error) from None
    return StatementPreviewResponse.of(preview)


@router.post(
    "/imports",
    status_code=status.HTTP_201_CREATED,
    summary="Import reviewed statement rows",
    responses={422: {"description": "A row breaks a rule; nothing was imported."}},
)
async def import_statement(
    body: ImportStatementRequest, workspace: WorkspaceDep, statements: StatementServiceDep
) -> ImportStatementResponse:
    """All or nothing. Rows imported before are skipped, so repeating a request is safe."""
    try:
        result = await statements.import_rows(
            workspace.id, body.account_id, [row.to_row() for row in body.rows], body.today
        )
    except AccountNotFoundError:
        raise _account_not_found() from None
    except InvalidImportError as error:
        raise _invalid(error) from None
    return ImportStatementResponse.of(result)


@router.delete("/imports/{batch_id}", summary="Undo a statement import")
async def undo_statement_import(
    batch_id: Annotated[uuid.UUID, Path(description="The import's ID.")],
    workspace: WorkspaceDep,
    statements: StatementServiceDep,
) -> UndoStatementImportResponse:
    """Delete the import's transactions, except ones a payment or goal now uses."""
    try:
        return UndoStatementImportResponse.of(await statements.undo(workspace.id, batch_id))
    except ImportNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Import not found.") from None
