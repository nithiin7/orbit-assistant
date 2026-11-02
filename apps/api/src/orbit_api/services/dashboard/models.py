"""Dashboard layout types: which widgets a user shows, in what order, how wide, and how the
dashboard is shown."""

from dataclasses import dataclass
from datetime import datetime
from typing import Final, Literal, get_args

WidgetId = Literal[
    "today",
    "quick_actions",
    "attention",
    "workspace",
    "status",
    "tasks",
    "reminders",
    "calendar",
    "habits",
    "notes",
    "documents",
    "shopping",
    "cash_flow",
    "upcoming_payments",
    "budget",
    "net_worth",
    "savings_goals",
    "workouts",
    "water",
    "nutrition",
    "weight",
    "fitness_goals",
    "modules",
]
# `half` widgets sit side by side on wide screens.
WidgetSize = Literal["half", "full"]

# `compact` tightens spacing so more fits on screen.
Density = Literal["comfortable", "compact"]

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
    density: Density = "comfortable"
    # Hide money amounts on the dashboard (shown as dots), for screens others can see.
    hide_amounts: bool = False


class DuplicateWidgetError(Exception):
    """A layout lists the same widget more than once."""
