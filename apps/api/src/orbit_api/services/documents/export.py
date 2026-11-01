"""The layout of a document export: which file goes where in the archive, and the metadata
that travels with it. Pure, so it's tested without files.

```text
Orbit documents/
├── metadata.json                        every document, folder, and category, with file paths
├── <folder>/<subfolder>/<original name>   each document's current file, in its folder
├── Unfiled/<original name>                documents without a folder
└── …/<stem> (versions)/v<n> <name>        earlier versions, when asked for
```

Original file names are kept; names that would collide in one folder get " (2)", " (3)", …
before the extension. Path segments come only from folder names and file names, cleaned so
they can't climb out of the archive or carry characters file systems reject.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from orbit_api.services.documents.models import Category, Document, DocumentVersion, Folder
from orbit_api.services.documents.service import ExportBundle

ROOT = "Orbit documents"
METADATA_NAME = "metadata.json"
FORMAT = "orbit-documents-v1"
_UNSAFE = set('<>:"/\\|?*')


@dataclass(frozen=True, slots=True)
class ArchiveEntry:
    name: str
    source: Path


def safe_segment(name: str) -> str:
    cleaned = "".join("_" if c in _UNSAFE or not c.isprintable() else c for c in name).strip()
    cleaned = cleaned.strip(". ")
    return cleaned[:120] or "_"


def _unique(name: str, taken: set[str]) -> str:
    if name.casefold() not in taken:
        taken.add(name.casefold())
        return name
    stem, dot, extension = name.rpartition(".")
    if not dot or not stem:
        stem, extension = name, ""
    counter = 2
    while True:
        candidate = f"{stem} ({counter}).{extension}" if extension else f"{stem} ({counter})"
        if candidate.casefold() not in taken:
            taken.add(candidate.casefold())
            return candidate
        counter += 1


def _folder_paths(folders: list[Folder]) -> dict[uuid.UUID, str]:
    by_id = {folder.id: folder for folder in folders}
    paths: dict[uuid.UUID, str] = {}

    def path(folder_id: uuid.UUID, seen: frozenset[uuid.UUID] = frozenset()) -> str:
        if folder_id in paths:
            return paths[folder_id]
        folder = by_id[folder_id]
        segment = safe_segment(folder.name)
        parent = folder.parent_id
        result = (
            segment
            if parent is None or parent not in by_id or parent in seen
            else f"{path(parent, seen | {folder_id})}/{segment}"
        )
        paths[folder_id] = result
        return result

    for folder in folders:
        path(folder.id)
    return paths


def _iso(value: datetime | Any) -> Any:
    return value.isoformat() if value is not None else None


def _version(version: DocumentVersion, archive_path: str | None) -> dict[str, Any]:
    return {
        "number": version.number,
        "filename": version.filename,
        "content_type": version.content_type,
        "size_bytes": version.size_bytes,
        "sha256": version.sha256,
        "uploaded_at": version.uploaded_at.isoformat(),
        "note": version.note,
        "restored_from": version.restored_from,
        "path": archive_path,
    }


def _document(
    document: Document,
    folder_path: str | None,
    category: Category | None,
    versions: list[dict[str, Any]],
) -> dict[str, Any]:
    details = document.details
    return {
        "id": str(document.id),
        "title": document.title,
        "folder": folder_path,
        "category": category.name if category else None,
        "tags": list(document.tags),
        "is_favorite": document.is_favorite,
        "archived_at": _iso(document.archived_at),
        "created_at": document.created_at.isoformat(),
        "updated_at": document.updated_at.isoformat(),
        "description": details.description,
        "reference_number": details.reference_number,
        "issuing_authority": details.issuing_authority,
        "provider": details.provider,
        "issue_date": _iso(details.issue_date),
        "effective_date": _iso(details.effective_date),
        "expiry_date": _iso(details.expiry_date),
        "renewal_date": _iso(details.renewal_date),
        "review_date": _iso(details.review_date),
        "amount_minor": details.amount,
        "currency": details.currency,
        "notes": details.notes,
        "custom_fields": [{"label": f.label, "value": f.value} for f in details.custom_fields],
        "reminder_days": list(document.reminders.days),
        "versions": versions,
    }


def plan_export(
    bundle: ExportBundle, exported_at: datetime
) -> tuple[list[ArchiveEntry], dict[str, Any]]:
    """The archive's files and its `metadata.json` content."""
    folder_paths = _folder_paths(bundle.folders)
    categories = {category.id: category for category in bundle.categories}
    taken: dict[str, set[str]] = {}
    entries: list[ArchiveEntry] = []
    documents: list[dict[str, Any]] = []
    used_folders: set[uuid.UUID] = set()
    for item in bundle.items:
        document = item.document
        folder_path = folder_paths.get(document.folder_id) if document.folder_id else None
        if document.folder_id is not None and folder_path is not None:
            used_folders.add(document.folder_id)
        directory = f"{ROOT}/{folder_path or 'Unfiled'}"
        versions: list[dict[str, Any]] = []
        for index, (version, source) in enumerate(item.files):
            if index == 0:
                folder = directory
                name = safe_segment(version.filename)
            else:
                current = item.files[0][0].filename
                stem = current.rsplit(".", 1)[0] if "." in current else current
                folder = f"{directory}/{safe_segment(stem)} (versions)"
                name = safe_segment(f"v{version.number} {version.filename}")
            name = _unique(name, taken.setdefault(folder.casefold(), set()))
            archive_path = f"{folder}/{name}"
            entries.append(ArchiveEntry(archive_path, source))
            versions.append(_version(version, archive_path.removeprefix(f"{ROOT}/")))
        category = categories.get(document.category_id) if document.category_id else None
        documents.append(_document(document, folder_path, category, versions))
    metadata: dict[str, Any] = {
        "format": FORMAT,
        "exported_at": exported_at.isoformat(),
        "documents": documents,
        "folders": [
            {"id": str(f.id), "name": f.name, "path": folder_paths[f.id]}
            for f in bundle.folders
            if f.id in used_folders
        ],
        "categories": sorted({d["category"] for d in documents if d["category"]}),
    }
    return entries, metadata
