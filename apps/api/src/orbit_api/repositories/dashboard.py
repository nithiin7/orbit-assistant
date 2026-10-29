"""Dashboard layouts, always addressed by the owning user's ID."""

import uuid
from typing import Any, cast

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.models import DashboardLayoutModel
from orbit_api.repositories.transaction import flush
from orbit_api.services.dashboard.models import (
    WIDGET_IDS,
    WIDGET_SIZES,
    DashboardLayout,
    DashboardWidget,
)


def _decode(stored: object) -> tuple[DashboardWidget, ...]:
    """Widgets from the stored JSON. Entries this version doesn't know (a widget retired since
    the layout was saved) and repeats are skipped rather than failing the whole layout."""
    if not isinstance(stored, list):
        return ()
    widgets: list[DashboardWidget] = []
    seen: set[object] = set()
    for entry in cast(list[object], stored):
        if not isinstance(entry, dict):
            continue
        fields = cast(dict[str, object], entry)
        widget_id, size = fields.get("id"), fields.get("size")
        if widget_id in WIDGET_IDS and size in WIDGET_SIZES and widget_id not in seen:
            widgets.append(DashboardWidget(id=widget_id, size=size))
            seen.add(widget_id)
    return tuple(widgets)


def _encode(widgets: tuple[DashboardWidget, ...]) -> list[dict[str, Any]]:
    return [{"id": widget.id, "size": widget.size} for widget in widgets]


class SqlDashboardRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, user_id: uuid.UUID) -> DashboardLayout | None:
        model = await self._session.get(DashboardLayoutModel, user_id)
        if model is None:
            return None
        return DashboardLayout(widgets=_decode(model.widgets), updated_at=model.updated_at)

    async def put(self, user_id: uuid.UUID, layout: DashboardLayout) -> None:
        model = await self._session.get(DashboardLayoutModel, user_id)
        if model is None:
            self._session.add(
                DashboardLayoutModel(
                    user_id=user_id, widgets=_encode(layout.widgets), updated_at=layout.updated_at
                )
            )
        else:
            model.widgets = _encode(layout.widgets)
            model.updated_at = layout.updated_at
        await flush(self._session)

    async def delete(self, user_id: uuid.UUID) -> None:
        await self._session.execute(
            delete(DashboardLayoutModel).where(DashboardLayoutModel.user_id == user_id)
        )
