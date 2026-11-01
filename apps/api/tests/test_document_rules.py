"""Pure document rules: expiry statuses, reminder alerts (offsets, time zones, DST, archived
documents), file names, file-type detection, and the export archive's layout."""

import io
import uuid
import zipfile
from dataclasses import replace
from datetime import UTC, date, datetime, time
from pathlib import Path

import pytest

from orbit_api.services.documents.expiry import expiry_status, next_alert, reminder_target
from orbit_api.services.documents.export import plan_export, safe_segment
from orbit_api.services.documents.models import (
    Document,
    DocumentDetails,
    DocumentVersion,
    FileRejectedError,
    Folder,
    ReminderSettings,
)
from orbit_api.services.documents.service import (
    ExportBundle,
    ExportItem,
    clean_filename,
    clean_tags,
    title_from_filename,
)
from orbit_api.utils.file_types import FILE_TYPES, FileTypeError, detect_file_type

NOW = datetime(2030, 1, 10, 12, 0, tzinfo=UTC)
WORKSPACE = uuid.uuid4()


def document(**details: object) -> Document:
    return Document(
        id=uuid.uuid4(),
        workspace_id=WORKSPACE,
        title="Passport",
        folder_id=None,
        category_id=None,
        details=DocumentDetails(**details),  # pyright: ignore[reportArgumentType]
        reminders=ReminderSettings(),
        is_favorite=False,
        archived_at=None,
        trashed_at=None,
        file=None,
        version_count=0,
        tags=(),
        created_at=NOW,
        updated_at=NOW,
        last_opened_at=None,
    )


class TestExpiry:
    @pytest.mark.parametrize(
        ("expiry", "status"),
        [
            (None, "none"),
            (date(2030, 1, 9), "expired"),
            (date(2030, 1, 10), "expiring"),
            (date(2030, 2, 9), "expiring"),
            (date(2030, 2, 10), "valid"),
        ],
    )
    def test_status(self, expiry: date | None, status: str) -> None:
        assert expiry_status(expiry, date(2030, 1, 10)) == status

    def test_next_alert_takes_the_earliest_future_offset(self) -> None:
        passport = document(expiry_date=date(2030, 3, 31))
        alert = next_alert(passport, NOW)
        assert alert is not None
        assert (alert.kind, alert.days_before) == ("expiry", 30)
        assert alert.at == datetime(2030, 3, 1, 9, 0, tzinfo=UTC)
        later = next_alert(passport, datetime(2030, 3, 1, 9, 0, tzinfo=UTC))
        assert later is not None and later.days_before == 7
        last = next_alert(passport, datetime(2030, 3, 31, 9, 0, tzinfo=UTC))
        assert last is None

    def test_several_dates_interleave(self) -> None:
        policy = replace(
            document(expiry_date=date(2030, 6, 30), renewal_date=date(2030, 2, 1)),
            reminders=ReminderSettings(days=(0,)),
        )
        alert = next_alert(policy, NOW)
        assert alert is not None and alert.kind == "renewal"
        target = reminder_target(policy, NOW)
        assert target is not None
        assert target.title == "Passport is due for renewal today"
        assert target.schedule.start_date == date(2030, 2, 1)
        assert "Renewal date: 2030-02-01" in target.description

    def test_local_time_across_daylight_saving(self) -> None:
        # New York moves from EST (UTC-5) to EDT (UTC-4) on 10 March 2030.
        lease = replace(
            document(expiry_date=date(2030, 4, 1)),
            reminders=ReminderSettings(days=(30, 0), timezone="America/New_York"),
        )
        first = next_alert(lease, NOW)
        assert first is not None and first.at == datetime(2030, 3, 2, 14, 0, tzinfo=UTC)
        second = next_alert(lease, first.at)
        assert second is not None and second.at == datetime(2030, 4, 1, 13, 0, tzinfo=UTC)

    def test_inactive_documents_and_empty_offsets_have_no_alerts(self) -> None:
        passport = document(expiry_date=date(2030, 3, 31))
        assert next_alert(replace(passport, archived_at=NOW), NOW) is None
        assert next_alert(replace(passport, trashed_at=NOW), NOW) is None
        assert next_alert(replace(passport, reminders=ReminderSettings(days=())), NOW) is None
        assert next_alert(document(), NOW) is None

    def test_long_titles_are_shortened(self) -> None:
        long = replace(document(expiry_date=date(2030, 3, 31)), title="x" * 200)
        target = reminder_target(long, NOW)
        assert target is not None
        assert len(target.title) == 200
        assert target.title.endswith("… expires in 30 days")
        assert target.schedule.time_of_day == time(9, 0)


class TestNames:
    @pytest.mark.parametrize(
        ("raw", "clean"),
        [
            ("passport.pdf", "passport.pdf"),
            ("../../etc/passwd.pdf", "passwd.pdf"),
            ("C:\\Users\\me\\scan.png", "scan.png"),
            (".hidden.pdf", "hidden.pdf"),
            ("tab\tname.pdf", "tabname.pdf"),
        ],
    )
    def test_clean_filename(self, raw: str, clean: str) -> None:
        assert clean_filename(raw) == clean

    def test_long_names_keep_their_extension(self) -> None:
        name = clean_filename("a" * 400 + ".pdf")
        assert len(name) == 255 and name.endswith(".pdf")

    def test_names_that_are_only_a_path_are_refused(self) -> None:
        for raw in ("../", "///", ".."):
            with pytest.raises(FileRejectedError):
                clean_filename(raw)

    def test_titles_and_tags(self) -> None:
        assert title_from_filename("salary_slip_march.pdf") == "salary slip march"
        assert clean_tags([" Tax ", "tax", "  ", "Two  words"]) == ("Tax", "Two words")


class TestFileTypes:
    def test_strict_office_check_reads_only_the_directory(self) -> None:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("word/document.xml", "<x/>")
        data = buffer.getvalue()
        assert detect_file_type("a.docx", data, {"docx"}, strict=True) == FILE_TYPES["docx"]
        with pytest.raises(FileTypeError):
            detect_file_type("a.xlsx", data, {"xlsx"}, strict=True)
        # Without `strict` (note attachments), any ZIP passes as before.
        assert detect_file_type("a.xlsx", data, {"xlsx"}) == FILE_TYPES["xlsx"]

    def test_only_accepted_extensions(self) -> None:
        with pytest.raises(FileTypeError, match="Accepted: pdf"):
            detect_file_type("a.png", b"\x89PNG\r\n\x1a\n", {"pdf"})


def version(document_id: uuid.UUID, number: int, filename: str) -> DocumentVersion:
    return DocumentVersion(
        id=uuid.uuid4(),
        workspace_id=WORKSPACE,
        document_id=document_id,
        number=number,
        blob_id=uuid.uuid4(),
        filename=filename,
        extension=filename.rsplit(".", 1)[-1],
        content_type="application/pdf",
        size_bytes=10,
        sha256="0" * 64,
        note="",
        restored_from=None,
        uploaded_at=NOW,
    )


class TestExportLayout:
    def test_paths_collisions_and_unsafe_names(self) -> None:
        parent = Folder(uuid.uuid4(), WORKSPACE, None, "Car: 2030", NOW, NOW)
        child = Folder(uuid.uuid4(), WORKSPACE, parent.id, "../Insurance", NOW, NOW)
        first = replace(document(), folder_id=child.id, title="A")
        second = replace(document(), folder_id=child.id, title="B")
        loose = replace(document(), title="C")
        source = Path("/files/blob")
        bundle = ExportBundle(
            items=[
                ExportItem(
                    first,
                    [
                        (version(first.id, 2, "scan.pdf"), source),
                        (version(first.id, 1, "old.pdf"), source),
                    ],
                ),
                ExportItem(second, [(version(second.id, 1, "SCAN.pdf"), source)]),
                ExportItem(loose, [(version(loose.id, 1, "x/y.pdf"), source)]),
            ],
            folders=[parent, child],
            categories=[],
        )
        entries, metadata = plan_export(bundle, NOW)
        names = [entry.name for entry in entries]
        assert names == [
            "Orbit documents/Car_ 2030/_Insurance/scan.pdf",
            "Orbit documents/Car_ 2030/_Insurance/scan (versions)/v1 old.pdf",
            "Orbit documents/Car_ 2030/_Insurance/SCAN (2).pdf",
            "Orbit documents/Unfiled/x_y.pdf",
        ]
        assert all(".." not in name.split("/") for name in names)
        assert [d["title"] for d in metadata["documents"]] == ["A", "B", "C"]
        assert metadata["documents"][0]["versions"][0]["path"] == "Car_ 2030/_Insurance/scan.pdf"

    def test_safe_segment(self) -> None:
        assert safe_segment("..") == "_"
        assert safe_segment("a/b\\c") == "a_b_c"
        assert safe_segment(" name. ") == "name"
