"""Dashboard layouts: which widgets a user shows, in what order, and how wide.

A layout belongs to one user and holds no workspace data, only arrangement. Each widget loads
its own data through the workspace-scoped API.
"""

import uuid
from datetime import UTC, datetime
from typing import Protocol

from orbit_api.services.dashboard.models import (
    DashboardLayout,
    DashboardWidget,
    DuplicateWidgetError,
)
from orbit_api.services.transactions import Transaction


class DashboardRepository(Protocol):
    async def get(self, user_id: uuid.UUID) -> DashboardLayout | None: ...

    async def put(self, user_id: uuid.UUID, layout: DashboardLayout) -> None: ...

    async def delete(self, user_id: uuid.UUID) -> None: ...


class DashboardService:
    def __init__(self, layouts: DashboardRepository, transaction: Transaction) -> None:
        self._layouts = layouts
        self._transaction = transaction

    async def get(self, user_id: uuid.UUID) -> DashboardLayout | None:
        """The saved layout, or `None` when the user has not arranged their dashboard."""
        return await self._layouts.get(user_id)

    async def replace(
        self, user_id: uuid.UUID, widgets: tuple[DashboardWidget, ...]
    ) -> DashboardLayout:
        ids = [widget.id for widget in widgets]
        if len(set(ids)) != len(ids):
            raise DuplicateWidgetError
        layout = DashboardLayout(widgets=widgets, updated_at=datetime.now(UTC))
        await self._layouts.put(user_id, layout)
        await self._transaction.commit()
        return layout

    async def reset(self, user_id: uuid.UUID) -> None:
        await self._layouts.delete(user_id)
        await self._transaction.commit()
