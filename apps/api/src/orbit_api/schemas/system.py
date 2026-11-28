"""The installation's status page and update notices."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from orbit_api.config import StorageMode


class SystemDatabaseStatus(BaseModel):
    status: Literal["ok", "outdated"] = Field(
        description="`outdated` when the schema isn't at this version's revision: run "
        "`pnpm db:migrate`."
    )
    revision: str | None = Field(description="The database's schema revision.")
    expected_revision: str | None = Field(description="The revision this version expects.")


class SystemWorkerStatus(BaseModel):
    runs_in_api: bool = Field(
        description="Whether the API process runs the worker; otherwise `orbit-worker` must."
    )
    status: Literal["ok", "behind"] = Field(
        description="`behind` when reminders that were due minutes ago are still waiting, "
        "which usually means no worker is running."
    )


class SystemFeatures(BaseModel):
    """Optional parts the server's configuration turns on. Never secrets or addresses."""

    ai: bool
    agent: bool
    web_push: bool
    google: bool
    microsoft: bool
    online_maps: bool


class SystemStatusResponse(BaseModel):
    """Health of this installation, for whoever runs it. Reveals no paths or secrets."""

    version: str = Field(description="Version of the running API.")
    storage_mode: StorageMode
    started_at: datetime = Field(description="When the API process started.")
    database: SystemDatabaseStatus
    worker: SystemWorkerStatus
    features: SystemFeatures


class UpdateStatusResponse(BaseModel):
    """Whether a newer Orbit release is out. Empty until update checks are turned on."""

    enabled: bool = Field(description="Whether this server checks for new releases.")
    repository: str = Field(description="The GitHub repository whose releases it follows.")
    current_version: str
    latest_version: str | None = Field(description="The newest release found, e.g. `1.2.0`.")
    latest_published_at: datetime | None
    update_available: bool
    release_url: str | None = Field(description="The newest release's page on GitHub.")
    checked_at: datetime | None = Field(description="When the server last asked.")
    check_failed: bool = Field(
        description="Whether the last attempt failed; the release shown is from an earlier one."
    )


class SystemSettingsRequest(BaseModel):
    update_check_enabled: bool = Field(
        description="Ask GitHub for the latest release about once a day. GitHub sees the "
        "server's address; nothing else is sent."
    )
