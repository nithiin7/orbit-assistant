"""Backup building blocks without the API: the table catalog, record encoding and remapping,
encryption, the archive reader's limits, the iCalendar and Markdown writers, and scheduling."""

import io
import json
import uuid
import zipfile
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from typing import Any

import pytest

from orbit_api.db.base import Base
from orbit_api.repositories.backup import table_specs
from orbit_api.services.backup import encryption
from orbit_api.services.backup.archive import (
    ArchiveLimits,
    ArchiveReader,
    ArchiveWriter,
    manifest_document,
)
from orbit_api.services.backup.catalog import (
    EXCLUDED_TABLES,
    FILE_COLUMNS,
    MATCH_KEYS,
    ColumnSpec,
    TableSpec,
    module_of,
)
from orbit_api.services.backup.ics import calendar_ics, rrule, vtimezone
from orbit_api.services.backup.markdown import to_markdown
from orbit_api.services.backup.models import (
    IncompatibleArchiveError,
    InvalidArchiveError,
    WrongPasswordError,
)
from orbit_api.services.backup.rows import decode_row, encode_row, parents_first, remap_row
from orbit_api.services.backup.schedule import next_run, retry_at
from orbit_api.services.calendar.recurrence import EventRecurrence

FAST = encryption.KdfParams(time_cost=1, memory_kib=8, parallelism=1)


class TestCatalog:
    def test_every_table_is_backed_up_or_deliberately_left_out(self) -> None:
        for table in Base.metadata.tables:
            assert (module_of(table) is not None) != (table in EXCLUDED_TABLES), table

    def test_secrets_are_never_backed_up(self) -> None:
        names = {spec.name for spec in table_specs()}
        for secret in (
            "local_credentials",
            "local_sessions",
            "ai_providers",
            "integration_connections",
        ):
            assert secret not in names

    def test_tables_are_in_insertion_order_and_scoped(self) -> None:
        seen: set[str] = set()
        for spec in table_specs():
            for reference in spec.references:
                assert reference.table in seen or reference.table == spec.name, (
                    spec.name,
                    reference,
                )
            # Every table is reachable by its workspace, directly or through its parent.
            assert spec.scoped or any(ref.table in seen for ref in spec.references), spec.name
            seen.add(spec.name)

    def test_file_columns_and_match_keys_name_real_columns(self) -> None:
        specs = {spec.name: spec for spec in table_specs()}
        for table, column in FILE_COLUMNS.items():
            assert specs[table].column(column) is not None
        for table, keys in MATCH_KEYS.items():
            assert specs[table].identity is not None
            for key in keys:
                assert all(specs[table].column(name) for name in key)
        # Any new file-carrying column must be declared, or its files would be left out.
        for spec in specs.values():
            for column in spec.columns:
                if column.name == "blob_id":
                    assert FILE_COLUMNS.get(spec.name) == "blob_id", spec.name


def _spec() -> TableSpec:
    return TableSpec(
        name="things",
        module="tasks",
        columns=(
            ColumnSpec("id", "uuid", False, False),
            ColumnSpec("parent_id", "uuid", True, False),
            ColumnSpec("title", "text", False, False),
            ColumnSpec("amount", "integer", False, False),
            ColumnSpec("ratio", "float", True, False),
            ColumnSpec("done", "boolean", False, True),
            ColumnSpec("at", "datetime", False, False),
            ColumnSpec("local", "local_datetime", True, False),
            ColumnSpec("day", "date", True, False),
            ColumnSpec("clock", "time", True, False),
            ColumnSpec("data", "json", True, False),
        ),
        primary_key=("id",),
        identity="id",
        references=(),
        user_columns=(),
        scoped=False,
        parent_column="parent_id",
    )


class TestRows:
    def test_values_round_trip_exactly(self) -> None:
        spec = _spec()
        row: dict[str, Any] = {
            "id": uuid.uuid4(),
            "parent_id": None,
            "title": "Café",
            "amount": 123_456_789_012,
            "ratio": 0.1 + 0.2,
            "done": True,
            "at": datetime(2026, 3, 29, 1, 30, tzinfo=UTC),
            "local": datetime(2026, 3, 29, 2, 30),
            "day": date(2024, 2, 29),
            "clock": time(9, 0),
            "data": {"frequency": "weekly", "weekdays": ["mon"]},
        }
        encoded = json.loads(json.dumps(encode_row(spec, row)))
        assert encoded["at"] == "2026-03-29T01:30:00+00:00"
        assert encoded["local"] == "2026-03-29T02:30:00"
        assert decode_row(spec, encoded) == row

    def test_decoding_refuses_wrong_types_and_unknown_columns(self) -> None:
        spec = _spec()
        base = encode_row(
            spec,
            {"id": uuid.uuid4(), "title": "x", "amount": 1, "done": False, "at": datetime.now(UTC)},
        )
        for change in (
            {"amount": "1"},
            {"amount": 1.5},
            {"done": 1},
            {"at": "2026-01-01T00:00:00"},
            {"id": "nope"},
            {"title": None},
        ):
            with pytest.raises(InvalidArchiveError):
                decode_row(spec, {**base, **change})
        with pytest.raises(IncompatibleArchiveError):
            decode_row(spec, {**base, "surprise": 1})
        missing = {key: value for key, value in base.items() if key != "title"}
        with pytest.raises(IncompatibleArchiveError):
            decode_row(spec, missing)
        # A defaulted column may be absent (an older backup).
        assert "done" not in decode_row(spec, {k: v for k, v in base.items() if k != "done"})

    def test_remapping_rewrites_ids_everywhere(self) -> None:
        spec = _spec()
        old, new, other = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        row = {
            "id": old,
            "parent_id": other,
            "title": f"See /notes?note={old} and {str(old).upper()}",
            "data": {"links": [f"/notes?note={old}"], str(old): True},
        }
        remapped = remap_row(spec, row, {old: new})
        assert remapped["id"] == new and remapped["parent_id"] == other
        assert remapped["title"] == f"See /notes?note={new} and {new}"
        assert remapped["data"] == {"links": [f"/notes?note={new}"], str(new): True}

    def test_parents_come_first(self) -> None:
        spec = _spec()
        a, b, c = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        rows = [{"id": c, "parent_id": b}, {"id": b, "parent_id": a}, {"id": a, "parent_id": None}]
        assert [row["id"] for row in parents_first(spec, rows)] == [a, b, c]
        with pytest.raises(InvalidArchiveError):
            parents_first(spec, [{"id": a, "parent_id": b}, {"id": b, "parent_id": a}])


class TestEncryption:
    @pytest.mark.parametrize(
        "size",
        [0, 1, encryption.CHUNK_SIZE - 1, encryption.CHUNK_SIZE, 3 * encryption.CHUNK_SIZE + 7],
    )
    def test_round_trip_at_chunk_boundaries(self, tmp_path: Path, size: int) -> None:
        plain, sealed, opened = tmp_path / "p", tmp_path / "s", tmp_path / "o"
        data = bytes(range(256)) * (size // 256 + 1)
        plain.write_bytes(data[:size])
        key = encryption.create_key("correct horse", FAST)
        encryption.encrypt_file(plain, sealed, key)
        assert encryption.is_encrypted(sealed)
        encryption.decrypt_file(sealed, opened, "correct horse", max_bytes=10**9)
        assert opened.read_bytes() == data[:size]

    def test_wrong_password_tampering_truncation_and_size_limits(self, tmp_path: Path) -> None:
        plain, sealed, opened = tmp_path / "p", tmp_path / "s", tmp_path / "o"
        plain.write_bytes(b"secret records " * 10_000)
        key = encryption.create_key("correct horse", FAST)
        encryption.encrypt_file(plain, sealed, key)
        assert b"secret records" not in sealed.read_bytes()
        with pytest.raises(WrongPasswordError):
            encryption.decrypt_file(sealed, opened, "wrong horse", max_bytes=10**9)
        data = sealed.read_bytes()
        for damaged in (data[:-1], data[:-20], data + b"x", data[: len(data) // 2]):
            sealed.write_bytes(damaged)
            with pytest.raises(InvalidArchiveError):
                encryption.decrypt_file(sealed, opened, "correct horse", max_bytes=10**9)
        flipped = bytearray(data)
        flipped[len(data) // 2] ^= 1
        sealed.write_bytes(bytes(flipped))
        with pytest.raises(InvalidArchiveError):
            encryption.decrypt_file(sealed, opened, "correct horse", max_bytes=10**9)
        sealed.write_bytes(data)
        with pytest.raises(InvalidArchiveError):
            encryption.decrypt_file(sealed, opened, "correct horse", max_bytes=1000)

    def test_each_archive_gets_its_own_file_key_and_nonces(self, tmp_path: Path) -> None:
        plain = tmp_path / "p"
        plain.write_bytes(b"same content")
        key = encryption.create_key("correct horse", FAST)
        encryption.encrypt_file(plain, tmp_path / "a", key)
        encryption.encrypt_file(plain, tmp_path / "b", key)
        assert (tmp_path / "a").read_bytes() != (tmp_path / "b").read_bytes()

    def test_hostile_kdf_parameters_are_refused(self, tmp_path: Path) -> None:
        key = encryption.create_key("correct horse", FAST)
        heavy = encryption.BackupKey(
            key.public_key, {**key.sealed_private_key, "memory_kib": 2**30}
        )
        with pytest.raises(InvalidArchiveError):
            encryption.unseal(heavy, "correct horse")
        assert encryption.unseal(key, "correct horse") is not None


def _archive(tmp_path: Path, rows: list[dict[str, Any]]) -> Path:
    path = tmp_path / "a.zip"
    writer = ArchiveWriter(path)
    writer.begin_table("tasks")
    writer.write_rows(rows)
    writer.end_table("tasks", len(rows))
    writer.finish(
        manifest_document(
            kind="manual",
            app_version="0",
            schema_revision="0021",
            created_at=datetime.now(UTC),
            storage_mode="local",
            workspace_id=uuid.uuid4(),
            workspace_name="Home",
            owner_id=uuid.uuid4(),
            include_files=False,
            modules=["tasks"],
            tables=writer.tables,
            files=[],
            missing_files=[],
        )
    )
    return path


class TestArchiveReader:
    def test_reads_what_the_writer_wrote(self, tmp_path: Path) -> None:
        path = _archive(tmp_path, [{"id": "1"}, {"id": "2"}])
        with ArchiveReader(path, ArchiveLimits(10**9)) as reader:
            reader.verify()
            assert list(reader.iter_rows("tasks")) == [{"id": "1"}, {"id": "2"}]

    def test_the_extracted_size_is_bounded_before_anything_is_read(self, tmp_path: Path) -> None:
        path = _archive(tmp_path, [{"id": "x" * 10_000}])
        with pytest.raises(InvalidArchiveError, match="larger"):
            ArchiveReader(path, ArchiveLimits(1000))

    def test_a_row_count_that_doesnt_match_is_refused(self, tmp_path: Path) -> None:
        path = _archive(tmp_path, [{"id": "1"}])
        source = zipfile.ZipFile(path)
        manifest = json.loads(source.read("orbit-backup/manifest.json"))
        manifest["tables"]["tasks"]["rows"] = 2
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w") as target:
            for info in source.infolist():
                content = source.read(info)
                if info.filename.endswith("manifest.json"):
                    content = json.dumps(manifest).encode()
                target.writestr(info.filename, content)
        path.write_bytes(output.getvalue())
        with (
            ArchiveReader(path, ArchiveLimits(10**9)) as reader,
            pytest.raises(InvalidArchiveError),
        ):
            list(reader.iter_rows("tasks"))


def _event(**fields: Any) -> dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "title": "Standup",
        "description": "",
        "location": "",
        "all_day": False,
        "timezone": "Europe/London",
        "start_local": "2030-01-14T09:00:00",
        "end_local": "2030-01-14T09:30:00",
        "recurrence": None,
        "status": "confirmed",
        "category_id": None,
        "created_at": "2026-01-01T00:00:00+00:00",
        "updated_at": "2026-01-01T00:00:00+00:00",
        **fields,
    }


class TestIcs:
    def test_rules_match_orbits_expansion(self) -> None:
        start = datetime(2030, 1, 31, 10)
        assert rrule(EventRecurrence("monthly"), start, "UTC", False) == (
            "RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1"
        )
        leap = datetime(2028, 2, 29, 10)
        assert "BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1" in rrule(
            EventRecurrence("yearly"), leap, "UTC", False
        )
        weekly = EventRecurrence("weekly", interval=2, weekdays=frozenset({"mon", "wed"}), count=10)
        assert (
            rrule(weekly, datetime(2030, 1, 14, 9), "UTC", False)
            == "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10"
        )
        until = EventRecurrence("daily", until=date(2030, 6, 30))
        # The end of the last local day (23:59:59 BST) in UTC.
        assert rrule(until, datetime(2030, 1, 1, 9), "Europe/London", False).endswith(
            "UNTIL=20300630T225959Z"
        )
        assert rrule(until, datetime(2030, 1, 1), "UTC", True).endswith("UNTIL=20300630")

    def test_vtimezone_lists_real_transitions(self) -> None:
        lines = vtimezone("Europe/London", 2030, 2030)
        assert "BEGIN:DAYLIGHT" in lines and "DTSTART:20300331T010000" in lines
        assert "DTSTART:20301027T020000" in lines
        assert "TZOFFSETFROM:+0000" in lines and "TZOFFSETTO:+0100" in lines
        kolkata = vtimezone("Asia/Kolkata", 2030, 2031)
        assert "BEGIN:DAYLIGHT" not in kolkata and "TZOFFSETTO:+0530" in kolkata

    def test_events_dates_escaping_and_folding(self) -> None:
        series = _event(recurrence={"version": 1, "frequency": "daily"})
        ics = calendar_ics(
            {
                "calendar_events": [
                    series,
                    _event(
                        title="Birthday, party; fun",
                        description="Line one\nLine two " + "é" * 60,
                        all_day=True,
                        start_local="2030-03-01T00:00:00",
                        end_local="2030-03-02T00:00:00",
                        status="cancelled",
                    ),
                ],
                "calendar_event_exceptions": [
                    {
                        "event_id": series["id"],
                        "original_start": "2030-01-15T09:00:00",
                        "kind": "skipped",
                    }
                ],
            },
            name="Home",
            now=datetime(2030, 1, 1, tzinfo=UTC),
        )
        assert "EXDATE;TZID=Europe/London:20300115T090000" in ics
        assert "DTSTART;VALUE=DATE:20300301\r\nDTEND;VALUE=DATE:20300302" in ics
        assert "SUMMARY:Birthday\\, party\\; fun" in ics and "STATUS:CANCELLED" in ics
        for line in ics.split("\r\n"):
            assert len(line.encode()) <= 75
        unfolded = ics.replace("\r\n ", "")
        assert "DESCRIPTION:Line one\\nLine two " + "é" * 60 in unfolded


def text(value: str, *marks: str | dict[str, Any]) -> dict[str, Any]:
    node: dict[str, Any] = {"type": "text", "text": value}
    if marks:
        node["marks"] = [{"type": mark} if isinstance(mark, str) else mark for mark in marks]
    return node


class TestMarkdown:
    def test_every_node_and_mark(self) -> None:
        document: dict[str, Any] = {
            "type": "doc",
            "content": [
                {"type": "heading", "attrs": {"level": 2}, "content": [text("Title")]},
                {
                    "type": "paragraph",
                    "content": [
                        text("bold", "bold"),
                        text(" and "),
                        text("it", "italic"),
                        text(" "),
                        text("x*y", "code"),
                        text(" "),
                        text("site", {"type": "link", "attrs": {"href": "https://e.com"}}),
                    ],
                },
                {"type": "paragraph", "content": [text("# not a heading")]},
                {
                    "type": "bulletList",
                    "content": [
                        {
                            "type": "listItem",
                            "content": [
                                {"type": "paragraph", "content": [text("one")]},
                                {
                                    "type": "bulletList",
                                    "content": [
                                        {
                                            "type": "listItem",
                                            "content": [
                                                {"type": "paragraph", "content": [text("nested")]}
                                            ],
                                        }
                                    ],
                                },
                            ],
                        }
                    ],
                },
                {
                    "type": "orderedList",
                    "attrs": {"start": 3},
                    "content": [
                        {
                            "type": "listItem",
                            "content": [{"type": "paragraph", "content": [text("three")]}],
                        }
                    ],
                },
                {
                    "type": "taskList",
                    "content": [
                        {
                            "type": "taskItem",
                            "attrs": {"checked": True},
                            "content": [{"type": "paragraph", "content": [text("done")]}],
                        }
                    ],
                },
                {
                    "type": "blockquote",
                    "content": [{"type": "paragraph", "content": [text("quoted")]}],
                },
                {"type": "codeBlock", "attrs": {"language": "py"}, "content": [text("print(1)")]},
                {"type": "horizontalRule"},
                {
                    "type": "table",
                    "content": [
                        {
                            "type": "tableRow",
                            "content": [
                                {
                                    "type": "tableHeader",
                                    "content": [{"type": "paragraph", "content": [text("A")]}],
                                },
                                {
                                    "type": "tableHeader",
                                    "content": [{"type": "paragraph", "content": [text("B")]}],
                                },
                            ],
                        },
                        {
                            "type": "tableRow",
                            "content": [
                                {
                                    "type": "tableCell",
                                    "content": [{"type": "paragraph", "content": [text("1")]}],
                                },
                                {
                                    "type": "tableCell",
                                    "content": [{"type": "paragraph", "content": [text("2")]}],
                                },
                            ],
                        },
                    ],
                },
            ],
        }
        assert to_markdown(json.dumps(document)) == (
            "## Title\n\n**bold** and *it* `x*y` [site](https://e.com)\n\n\\# not a heading\n\n"
            "- one\n\n  - nested\n\n3. three\n\n- [x] done\n\n> quoted\n\n"
            "```py\nprint(1)\n```\n\n---\n\n"
            "| A | B |\n| --- | --- |\n| 1 | 2 |\n"
        )
        assert to_markdown("not json") == ""


class TestSchedule:
    def test_next_runs_keep_their_rhythm_and_skip_missed_ones(self) -> None:
        start = datetime(2026, 1, 1, 2, tzinfo=UTC)
        assert next_run("daily", start, start) == start + timedelta(days=1)
        assert next_run("daily", start, start + timedelta(days=9, hours=1)) == start + timedelta(
            days=10
        )
        assert next_run(
            "monthly", datetime(2026, 1, 31, tzinfo=UTC), datetime(2026, 2, 1, tzinfo=UTC)
        ) == datetime(2026, 2, 28, tzinfo=UTC)
        assert next_run("manual", start, start) is None
        assert retry_at(start + timedelta(minutes=10), start) == start + timedelta(minutes=10)
        assert retry_at(None, start) == start + timedelta(hours=1)
