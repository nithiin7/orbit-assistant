"""Reading uploaded files and serving stored ones, shared by note attachments and documents."""

from pathlib import Path
from urllib.parse import quote

from fastapi import HTTPException, Request, status
from fastapi.responses import FileResponse

# A stored file is always a download, typed as Orbit detected it, and never interpreted by
# the browser as a page: `nosniff` and a sandboxing CSP stop active content from running even
# if it's opened directly.
_DOWNLOAD_HEADERS = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
}


async def read_body(request: Request, *, limit: int, what: str = "Files") -> bytes:
    """Read the body, stopping as soon as it exceeds `limit` rather than buffering it all.

    An upload interrupted mid-body raises here, before anything is stored."""
    too_large = HTTPException(
        status.HTTP_413_CONTENT_TOO_LARGE,
        f"{what} must be at most {limit // (1024 * 1024)} MB.",
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


def download_response(path: Path, content_type: str, filename: str) -> FileResponse:
    return FileResponse(
        path,
        media_type=content_type,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
            **_DOWNLOAD_HEADERS,
        },
    )
