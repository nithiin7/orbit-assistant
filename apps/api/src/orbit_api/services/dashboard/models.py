"""Dashboard layout types: which widgets a user shows, in what order, and how wide."""

from dataclasses import dataclass
from datetime import datetime
from typing import Final, Literal, get_args

WidgetId = Literal[
    "workspace",
    "status",
    "tasks",
    "reminders",
    "shopping",
    "cash_flow",
    "upcoming_payments",
    "budget",
    "net_worth",
    "modules",
]
# `half` widgets sit side by side on wide screens.
WidgetSize = Literal["half", "full"]

WIDGET_IDS: Final[tuple[WidgetId, ...]] = get_args(WidgetId)
WIDGET_SIZES: Final[tuple[WidgetSize, ...]] = get_args(WidgetSize)


@dataclass(frozen=True, slots=True)
class DashboardWidget:
    id: WidgetId
    size: WidgetSize


@dataclass(frozen=True, slots=True)
class DashboardLayout:
    widgets: tuple[DashboardWidget, ...]
    updated_at: datetime


class DuplicateWidgetError(Exception):
    """A layout lists the same widget more than once."""
