"""Places: where you've been and where you want to go.

- `places`: a named place with its country (ISO 3166-1 alpha-2), an optional map position, and
  whether it was visited (with an optional date) or is wished for.
- `place_settings`: whether a workspace uses online maps and place search. No row means off, so
  existing workspaces start with them off.

Only new tables; no existing table is rebuilt or changed. On PostgreSQL the new tables have Row
Level Security enabled with no policies, like the others; the API enforces access itself.

Revision ID: 0033
Revises: 0032
Create Date: 2026-11-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0033"
down_revision: str | None = "0032"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "places",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("locality", sa.String(length=120), nullable=False),
        sa.Column("country_code", sa.String(length=2), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("visited_on", sa.Date(), nullable=True),
        sa.Column("favorite", sa.Boolean(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status IN ('visited', 'want_to_visit')", name=op.f("ck_places_status")),
        sa.CheckConstraint("length(name) BETWEEN 1 AND 120", name=op.f("ck_places_name_length")),
        sa.CheckConstraint("length(locality) <= 120", name=op.f("ck_places_locality_length")),
        sa.CheckConstraint("length(country_code) = 2", name=op.f("ck_places_country_code_length")),
        sa.CheckConstraint("length(note) <= 1000", name=op.f("ck_places_note_length")),
        sa.CheckConstraint(
            "(latitude IS NULL AND longitude IS NULL)"
            " OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)",
            name=op.f("ck_places_location"),
        ),
        sa.CheckConstraint(
            "status = 'visited' OR visited_on IS NULL", name=op.f("ck_places_visited_on_status")
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_places_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_places")),
    )
    op.create_index("ix_places_workspace_created", "places", ["workspace_id", "created_at"])
    op.create_table(
        "place_settings",
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("online_maps", sa.Boolean(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_place_settings_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("workspace_id", name=op.f("pk_place_settings")),
    )

    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE places ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE place_settings ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("place_settings")
    op.drop_index("ix_places_workspace_created", table_name="places")
    op.drop_table("places")
