"""Module exports in everyday formats, alongside the JSON every module exports.

| Module                | Formats                                               |
| --------------------- | ----------------------------------------------------- |
| Tasks, shopping,      | CSV (one table), JSON                                 |
| watchlist             |                                                       |
| Reminders, habits,    | CSV (a ZIP with one CSV per table), JSON              |
| health and fitness    |                                                       |
| Notes                 | Markdown (a ZIP of `.md` files in their folders), JSON |
| Calendar              | iCalendar (`.ics`), JSON                              |
| Finance, documents    | JSON here; finance's transaction CSV and the document |
|                       | vault's ZIP of original files have their own exports  |
| Assistant, search     | JSON                                                  |

CSV columns are the stored columns, with IDs kept so rows relate across files. Values are as a
backup writes them: amounts in integer minor units with the currency beside them (never
floats), UTC timestamps in ISO 8601, JSON as compact text. Text that a spreadsheet would run as
a formula is prefixed with an apostrophe.
"""

import csv
import io
import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Final, cast

from orbit_api.services.backup.catalog import Module, TableSpec
from orbit_api.services.backup.ics import calendar_ics
from orbit_api.services.backup.markdown import to_markdown
from orbit_api.services.backup.models import ExportFormat
from orbit_api.utils.spreadsheet import safe_cell

EXPORT_FORMATS: Final[dict[Module, tuple[ExportFormat, ...]]] = {
    "tasks": ("json", "csv"),
    "shopping": ("json", "csv"),
    "reminders": ("json", "csv"),
    "finance": ("json",),
    "notes": ("json", "markdown"),
    "calendar": ("json", "ics"),
    "habits": ("json", "csv"),
    "documents": ("json",),
    "fitness": ("json", "csv"),
    "assistant": ("json",),
    "search": ("json",),
    "watchlist": ("json", "csv"),
}

_UNSAFE_NAME = re.compile(r'[\x00-\x1f\x7f/\\:*?"<>|]')


@dataclass(frozen=True, slots=True)
class ExportOutput:
    filename: str
    media_type: str
    # A single document, or the files of a ZIP archive.
    text: str | None = None
    entries: list[tuple[str, str]] = field(default_factory=list[tuple[str, str]])


def _cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return safe_cell(value)
    if isinstance(value, dict | list):
        return safe_cell(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
    return str(value)


def table_csv(spec: TableSpec, rows: Sequence[Mapping[str, Any]]) -> str:
    columns = [column.name for column in spec.columns if column.name != "workspace_id"]
    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\r\n")
    writer.writerow(columns)
    for row in rows:
        writer.writerow([_cell(row.get(column)) for column in columns])
    return output.getvalue()


def module_csv(
    module: Module,
    specs: Sequence[TableSpec],
    tables: Mapping[str, Sequence[Mapping[str, Any]]],
    stem: str,
) -> ExportOutput:
    selected = [spec for spec in specs if spec.module == module]
    if len(selected) == 1:
        spec = selected[0]
        return ExportOutput(
            filename=f"{stem}.csv",
            media_type="text/csv; charset=utf-8",
            text=table_csv(spec, tables.get(spec.name, [])),
        )
    return ExportOutput(
        filename=f"{stem}.zip",
        media_type="application/zip",
        entries=[
            (f"{stem}/{spec.name}.csv", table_csv(spec, tables.get(spec.name, [])))
            for spec in selected
        ],
    )


def safe_name(value: str, fallback: str) -> str:
    """A file or folder name that can't escape its folder or confuse a file system."""
    name = _UNSAFE_NAME.sub(" ", value).strip().strip(".").strip()
    return name[:100].strip() or fallback


def _yaml(value: str) -> str:
    # A JSON string is a valid YAML scalar, with quotes and escapes handled.
    return json.dumps(value, ensure_ascii=False)


def notes_markdown(tables: Mapping[str, Sequence[Mapping[str, Any]]], stem: str) -> ExportOutput:
    """Every note as a Markdown file with front matter, in its folder; archived notes under
    `Archive/` and trashed ones under `Trash/`."""
    folders = {cast(str, row["id"]): row for row in tables.get("note_folders", [])}
    tag_names = {
        cast(str, row["id"]): cast(str, row["name"]) for row in tables.get("note_tags", [])
    }
    tags: dict[str, list[str]] = {}
    for row in tables.get("note_tag_assignments", []):
        name = tag_names.get(cast(str, row["tag_id"]))
        if name:
            tags.setdefault(cast(str, row["note_id"]), []).append(name)

    def folder_path(folder_id: object) -> list[str]:
        parts: list[str] = []
        seen: set[str] = set()
        current = folder_id
        while isinstance(current, str) and current in folders and current not in seen:
            seen.add(current)
            parts.append(safe_name(cast(str, folders[current]["name"]), "Folder"))
            current = folders[current].get("parent_id")
        return list(reversed(parts))

    used: set[str] = set()
    entries: list[tuple[str, str]] = []
    for note in tables.get("notes", []):
        parts = [stem]
        if note.get("trashed_at"):
            parts.append("Trash")
        elif note.get("archived_at"):
            parts.append("Archive")
        parts.extend(folder_path(note.get("folder_id")))
        base = safe_name(cast(str, note.get("title") or ""), "Untitled")
        name = f"{'/'.join([*parts, base])}.md"
        counter = 2
        while name.lower() in used:
            name = f"{'/'.join([*parts, base])} ({counter}).md"
            counter += 1
        used.add(name.lower())
        front = [
            "---",
            f"title: {_yaml(cast(str, note.get('title') or ''))}",
            f"id: {note['id']}",
            f"created: {note['created_at']}",
            f"updated: {note['updated_at']}",
        ]
        folder = "/".join(folder_path(note.get("folder_id")))
        if folder:
            front.append(f"folder: {_yaml(folder)}")
        note_tags = sorted(tags.get(cast(str, note["id"]), []))
        if note_tags:
            front.append("tags: [" + ", ".join(_yaml(tag) for tag in note_tags) + "]")
        if note.get("journal_date"):
            front.append(f"journal_date: {note['journal_date']}")
        if note.get("is_pinned"):
            front.append("pinned: true")
        if note.get("is_favorite"):
            front.append("favorite: true")
        front.append("---")
        body = to_markdown(cast(str, note.get("content") or ""))
        entries.append((name, "\n".join(front) + "\n\n" + body))
    return ExportOutput(filename=f"{stem}.zip", media_type="application/zip", entries=entries)


def calendar_file(
    tables: Mapping[str, Sequence[Mapping[str, Any]]], stem: str, name: str, now: datetime
) -> ExportOutput:
    return ExportOutput(
        filename=f"{stem}.ics",
        media_type="text/calendar; charset=utf-8",
        text=calendar_ics(tables, name=name, now=now),
    )
