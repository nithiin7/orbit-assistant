"""Domain types for the installation's status and update notices."""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from orbit_api.config import StorageMode

DatabaseState = Literal["ok", "outdated"]
WorkerState = Literal["ok", "behind"]


@dataclass(frozen=True, slots=True)
class Release:
    """A published release: its version without the `v`, e.g. `1.2.0`."""

    version: str
    published_at: datetime | None


class ReleaseFeedError(Exception):
    """The release feed couldn't be reached or answered with something unexpected."""


@dataclass(frozen=True, slots=True)
class UpdateCheckState:
    """What the server stores about update checks."""

    enabled: bool
    latest_version: str | None
    latest_published_at: datetime | None
    checked_at: datetime | None
    check_failed: bool


@dataclass(frozen=True, slots=True)
class UpdateStatus:
    enabled: bool
    repository: str
    current_version: str
    latest_version: str | None
    latest_published_at: datetime | None
    update_available: bool
    release_url: str | None
    checked_at: datetime | None
    check_failed: bool


@dataclass(frozen=True, slots=True)
class ServerFeatures:
    """Which optional parts the server's configuration turns on. Never secrets or addresses."""

    ai: bool
    agent: bool
    web_push: bool
    google: bool
    microsoft: bool
    online_maps: bool


@dataclass(frozen=True, slots=True)
class DatabaseStatus:
    state: DatabaseState
    revision: str | None
    expected_revision: str | None


@dataclass(frozen=True, slots=True)
class WorkerStatus:
    runs_in_api: bool
    state: WorkerState


@dataclass(frozen=True, slots=True)
class SystemStatus:
    version: str
    storage_mode: StorageMode
    started_at: datetime
    database: DatabaseStatus
    worker: WorkerStatus
    features: ServerFeatures
