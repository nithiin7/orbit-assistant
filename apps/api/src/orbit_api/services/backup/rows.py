"""Records as portable JSON, and back.

Every value keeps its exact meaning:

- IDs are canonical UUID strings, so relationships survive as they are.
- UTC timestamps are ISO 8601 with `+00:00`; local wall-clock times (calendar events) are ISO
  8601 without an offset, alongside the event's IANA time zone, exactly as stored.
- Money is already integer minor units with its currency beside it, so it's written as JSON
  integers: never floats, never rounded. Quantities stored as floats (habit amounts, body
  measurements) round-trip exactly, because Python writes the shortest repr that reads back to
  the same float.
- JSON columns (recurrence rules, note content metadata) are nested as they are.

Remapping replaces IDs that clash with existing records: every UUID column whose value is a
remapped ID, and every occurrence of a remapped ID inside text and JSON (links inside note
content such as `/notes?note=<id>`, a split series' `series_id`). IDs are random 128-bit values,
so matching one by accident is not a practical concern.
"""

import re
import uuid
from collections.abc import Mapping
from datetime import UTC, date, datetime, time
from typing import Any, cast

from orbit_api.services.backup.catalog import ColumnSpec, TableSpec
from orbit_api.services.backup.models import IncompatibleArchiveError, InvalidArchiveError

Row = dict[str, Any]

_UUID_TEXT = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)


def encode_row(spec: TableSpec, row: Mapping[str, Any]) -> Row:
    """A database row as JSON-ready values."""
    return {column.name: _encode(column, row.get(column.name)) for column in spec.columns}


def _encode(column: ColumnSpec, value: Any) -> Any:
    if value is None:
        return None
    match column.kind:
        case "uuid":
            return str(value)
        case "datetime":
            moment = cast(datetime, value)
            return moment.astimezone(UTC).isoformat()
        case "local_datetime" | "date" | "time":
            return cast(datetime | date | time, value).isoformat()
        case _:
            return value


def decode_row(spec: TableSpec, row: object) -> Row:
    """A JSON object from an archive as database values.

    A column absent from an older backup is left out, so its default applies, unless it's
    required and has none. A column this version doesn't have is refused rather than dropped:
    its data would be lost silently."""
    if not isinstance(row, dict):
        raise InvalidArchiveError(f"A record in {spec.name} isn't an object.")
    data = cast(dict[str, Any], row)
    unknown = set(data) - {column.name for column in spec.columns}
    if unknown:
        raise IncompatibleArchiveError(
            f"Records in {spec.name} have data this version of Orbit can't place "
            f"({', '.join(sorted(unknown)[:3])})."
        )
    decoded: Row = {}
    for column in spec.columns:
        if column.name not in data:
            if not column.nullable and not column.has_default:
                raise IncompatibleArchiveError(
                    f"Records in {spec.name} are missing {column.name}, which this version needs."
                )
            continue
        try:
            decoded[column.name] = _decode(column, data[column.name])
        except (TypeError, ValueError):
            raise InvalidArchiveError(
                f"A record in {spec.name} has an invalid {column.name}."
            ) from None
    return decoded


def _decode(column: ColumnSpec, value: Any) -> Any:
    if value is None:
        if not column.nullable:
            raise ValueError("missing")
        return None
    match column.kind:
        case "uuid":
            return uuid.UUID(_text(value))
        case "text":
            return _text(value)
        case "integer":
            if isinstance(value, bool) or not isinstance(value, int):
                raise TypeError("not an integer")
            return value
        case "float":
            if isinstance(value, bool) or not isinstance(value, int | float):
                raise TypeError("not a number")
            return float(value)
        case "boolean":
            if not isinstance(value, bool):
                raise TypeError("not a boolean")
            return value
        case "datetime":
            moment = datetime.fromisoformat(_text(value))
            if moment.tzinfo is None:
                raise ValueError("naive timestamp")
            return moment.astimezone(UTC)
        case "local_datetime":
            moment = datetime.fromisoformat(_text(value))
            if moment.tzinfo is not None:
                raise ValueError("local times have no offset")
            return moment
        case "date":
            return date.fromisoformat(_text(value))
        case "time":
            return time.fromisoformat(_text(value))
        case "json":
            return value


def _text(value: Any) -> str:
    if not isinstance(value, str):
        raise TypeError("not text")
    return value


def remap_row(spec: TableSpec, row: Row, mapping: Mapping[uuid.UUID, uuid.UUID]) -> Row:
    """`row` with every remapped ID replaced, in ID columns and inside text and JSON."""
    if not mapping:
        return row
    text_mapping = {str(old): str(new) for old, new in mapping.items()}
    result: Row = {}
    for name, value in row.items():
        column = spec.column(name)
        kind = column.kind if column is not None else "text"
        if value is None:
            result[name] = None
        elif kind == "uuid":
            result[name] = mapping.get(value, value)
        elif kind == "text":
            result[name] = _replace_text(cast(str, value), text_mapping)
        elif kind == "json":
            result[name] = _replace_json(value, text_mapping)
        else:
            result[name] = value
    return result


def _replace_text(value: str, mapping: Mapping[str, str]) -> str:
    if len(value) < 36:
        return value
    return _UUID_TEXT.sub(lambda match: mapping.get(match.group(0).lower(), match.group(0)), value)


def _replace_json(value: Any, mapping: Mapping[str, str]) -> Any:
    if isinstance(value, str):
        return _replace_text(value, mapping)
    if isinstance(value, list):
        return [_replace_json(item, mapping) for item in cast(list[Any], value)]
    if isinstance(value, dict):
        items = cast(dict[str, Any], value)
        return {
            _replace_text(key, mapping): _replace_json(item, mapping) for key, item in items.items()
        }
    return value


def parents_first(spec: TableSpec, rows: list[Row]) -> list[Row]:
    """Rows of a self-referencing table (folders) ordered so each parent precedes its
    children. A cycle can't be inserted, so it's reported as an invalid archive."""
    parent = spec.parent_column
    identity = spec.identity
    if parent is None or identity is None:
        return rows
    by_id = {row[identity]: row for row in rows if identity in row}
    ordered: list[Row] = []
    placed: set[uuid.UUID] = set()
    visiting: set[uuid.UUID] = set()

    def place(row: Row) -> None:
        key = row[identity]
        if key in placed:
            return
        if key in visiting:
            raise InvalidArchiveError(f"The folders in {spec.name} contain a cycle.")
        visiting.add(key)
        parent_id = row.get(parent)
        if parent_id is not None and parent_id in by_id:
            place(by_id[parent_id])
        visiting.discard(key)
        placed.add(key)
        ordered.append(row)

    for row in rows:
        place(row)
    return ordered
