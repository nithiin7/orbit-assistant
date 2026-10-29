"""Dashboard layout models."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from orbit_api.services.dashboard.models import (
    WIDGET_IDS,
    DashboardLayout,
    DashboardWidget,
    WidgetId,
    WidgetSize,
)


class DashboardWidgetModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: WidgetId
    size: WidgetSize = Field(description="`half` widgets sit side by side on wide screens.")

    def to_widget(self) -> DashboardWidget:
        return DashboardWidget(id=self.id, size=self.size)


class DashboardLayoutRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    widgets: list[DashboardWidgetModel] = Field(
        max_length=len(WIDGET_IDS),
        description="The widgets to show, in order. Each widget may appear once; an empty list "
        "is an empty dashboard.",
    )


class DashboardLayoutResponse(BaseModel):
    widgets: list[DashboardWidgetModel]
    updated_at: datetime

    @classmethod
    def of(cls, layout: DashboardLayout) -> "DashboardLayoutResponse":
        return cls(
            widgets=[
                DashboardWidgetModel(id=widget.id, size=widget.size) for widget in layout.widgets
            ],
            updated_at=layout.updated_at,
        )
