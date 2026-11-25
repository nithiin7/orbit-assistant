"""People and their dates.

- `people`: a person with a relationship, optional contact details and note, and when their
  date reminders fire (a time and an IANA zone).
- `person_dates`: yearly dates about a person (birthday, anniversary, or a named date), each with
  an optional year and an optional number of days before to remind. One birthday per person.
- `reminders` gains an optional, unique link to a person, whose managed reminder announces their
  next date. On SQLite this rebuilds `reminders` in batch mode (copy, drop, rename); migrations
  run with foreign keys off, so no occurrence or notification rows are lost.

On PostgreSQL the new tables have Row Level Security enabled with no policies, like the others;
the API enforces access itself.

Revision ID: 0048
Revises: 0047
Create Date: 2026-11-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0048"
down_revision: str | None = "0047"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PERSON_MANAGER = (
    "person_id IS NULL OR (finance_loan_id IS NULL AND finance_recurring_payment_id IS NULL"
    " AND finance_deposit_id IS NULL AND calendar_event_alert_id IS NULL"
    " AND habit_reminder_id IS NULL AND document_id IS NULL)"
)

_TABLES = ("people", "person_dates")


def upgrade() -> None:
    op.create_table(
        "people",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("relationship", sa.String(length=16), nullable=False),
        sa.Column("phone", sa.String(length=40), nullable=False),
        sa.Column("email", sa.String(length=254), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("favorite", sa.Boolean(), nullable=False),
        sa.Column("reminder_time", sa.Time(), nullable=False),
        sa.Column("timezone", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "relationship IN ('family', 'partner', 'friend', 'colleague', 'other')",
            name=op.f("ck_people_relationship"),
        ),
        sa.CheckConstraint("length(name) BETWEEN 1 AND 120", name=op.f("ck_people_name_length")),
        sa.CheckConstraint("length(phone) <= 40", name=op.f("ck_people_phone_length")),
        sa.CheckConstraint("length(email) <= 254", name=op.f("ck_people_email_length")),
        sa.CheckConstraint("length(note) <= 2000", name=op.f("ck_people_note_length")),
        sa.CheckConstraint(
            "length(timezone) BETWEEN 1 AND 64", name=op.f("ck_people_timezone_length")
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_people_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_people")),
        sa.UniqueConstraint("id", "workspace_id", name=op.f("uq_people_id")),
    )
    op.create_index("ix_people_workspace_name", "people", ["workspace_id", "name"])
    op.create_table(
        "person_dates",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("person_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("label", sa.String(length=60), nullable=False),
        sa.Column("month", sa.SmallInteger(), nullable=False),
        sa.Column("day", sa.SmallInteger(), nullable=False),
        sa.Column("year", sa.SmallInteger(), nullable=True),
        sa.Column("remind_days_before", sa.SmallInteger(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "kind IN ('birthday', 'anniversary', 'other')", name=op.f("ck_person_dates_kind")
        ),
        sa.CheckConstraint("month BETWEEN 1 AND 12", name=op.f("ck_person_dates_month_range")),
        sa.CheckConstraint("day BETWEEN 1 AND 31", name=op.f("ck_person_dates_day_range")),
        sa.CheckConstraint(
            "year IS NULL OR year BETWEEN 1900 AND 2100", name=op.f("ck_person_dates_year_range")
        ),
        sa.CheckConstraint(
            "remind_days_before IS NULL OR remind_days_before BETWEEN 0 AND 30",
            name=op.f("ck_person_dates_remind_days_before_range"),
        ),
        sa.CheckConstraint("length(label) <= 60", name=op.f("ck_person_dates_label_length")),
        sa.CheckConstraint(
            "kind <> 'other' OR length(label) >= 1", name=op.f("ck_person_dates_other_has_label")
        ),
        sa.ForeignKeyConstraint(
            ["person_id", "workspace_id"],
            ["people.id", "people.workspace_id"],
            name=op.f("fk_person_dates_person_id_people"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_person_dates_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_person_dates")),
    )
    op.create_index(
        "uq_person_dates_birthday",
        "person_dates",
        ["person_id"],
        unique=True,
        sqlite_where=sa.text("kind = 'birthday'"),
        postgresql_where=sa.text("kind = 'birthday'"),
    )
    op.create_index("ix_person_dates_person_position", "person_dates", ["person_id", "position"])

    with op.batch_alter_table("reminders", schema=None) as batch_op:
        batch_op.add_column(sa.Column("person_id", sa.Uuid(), nullable=True))
        batch_op.create_unique_constraint("uq_reminders_person_id", ["person_id"])
        batch_op.create_foreign_key(
            "fk_reminders_person",
            "people",
            ["person_id", "workspace_id"],
            ["id", "workspace_id"],
            ondelete="CASCADE",
        )
        batch_op.create_check_constraint(op.f("ck_reminders_one_person_manager"), PERSON_MANAGER)

    if op.get_bind().dialect.name == "postgresql":
        for table in _TABLES:
            op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    # People reminders can't survive without their link; their notifications stay.
    op.execute("DELETE FROM reminders WHERE person_id IS NOT NULL")
    with op.batch_alter_table("reminders", schema=None) as batch_op:
        batch_op.drop_constraint(op.f("ck_reminders_one_person_manager"), type_="check")
        batch_op.drop_constraint("fk_reminders_person", type_="foreignkey")
        batch_op.drop_constraint("uq_reminders_person_id", type_="unique")
        batch_op.drop_column("person_id")
    op.drop_index("ix_person_dates_person_position", table_name="person_dates")
    op.drop_index("uq_person_dates_birthday", table_name="person_dates")
    op.drop_table("person_dates")
    op.drop_index("ix_people_workspace_name", table_name="people")
    op.drop_table("people")
