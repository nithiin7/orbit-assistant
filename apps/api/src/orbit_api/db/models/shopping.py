"""Shopping lists and the items on them."""

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from orbit_api.db.base import Base
from orbit_api.db.columns import UTCDateTime, utc_now


class ShoppingListModel(Base):
    """A shopping list in one workspace. Each workspace has at most one default list, which
    cannot be deleted. Deleting the workspace deletes its lists."""

    __tablename__ = "shopping_lists"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 100", name="name_length"),
        # The target of `shopping_items`' composite foreign key, which keeps an item in the
        # same workspace as its list.
        UniqueConstraint("id", "workspace_id"),
        Index(
            "uq_shopping_lists_default_workspace",
            "workspace_id",
            unique=True,
            sqlite_where=text("is_default"),
            postgresql_where=text("is_default"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(100))
    is_default: Mapped[bool]
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)


class ShoppingItemModel(Base):
    """An item on a shopping list. Deleting the list deletes its items.

    `workspace_id` repeats the list's workspace so that every query can filter by workspace
    directly; the composite foreign key guarantees the two agree.
    """

    __tablename__ = "shopping_items"
    __table_args__ = (
        CheckConstraint("length(name) BETWEEN 1 AND 200", name="name_length"),
        CheckConstraint("length(quantity) <= 50", name="quantity_length"),
        CheckConstraint("length(url) <= 2048", name="url_length"),
        CheckConstraint("length(notes) <= 2000", name="notes_length"),
        CheckConstraint("status IN ('needed', 'purchased')", name="status"),
        CheckConstraint(
            "(status = 'purchased' AND purchased_at IS NOT NULL)"
            " OR (status = 'needed' AND purchased_at IS NULL)",
            name="purchased_at_matches_status",
        ),
        ForeignKeyConstraint(
            ["list_id", "workspace_id"],
            ["shopping_lists.id", "shopping_lists.workspace_id"],
            ondelete="CASCADE",
        ),
        # Items are always read one list at a time.
        Index("ix_shopping_items_workspace_list", "workspace_id", "list_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    workspace_id: Mapped[uuid.UUID]
    list_id: Mapped[uuid.UUID]
    name: Mapped[str] = mapped_column(String(200))
    quantity: Mapped[str | None] = mapped_column(String(50))
    url: Mapped[str | None] = mapped_column(String(2048))
    notes: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16))
    purchased_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now, onupdate=utc_now)
