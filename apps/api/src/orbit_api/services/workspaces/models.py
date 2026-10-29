"""Workspace types."""

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

# Only owners exist until shared workspaces are designed.
WorkspaceRole = Literal["owner"]


@dataclass(frozen=True, slots=True)
class Workspace:
    id: uuid.UUID
    owner_id: uuid.UUID
    name: str
    is_personal: bool
    created_at: datetime
    updated_at: datetime


class WorkspaceNotFoundError(Exception):
    """The workspace does not exist or the user may not access it. The two are deliberately
    indistinguishable, so responses never reveal other users' workspaces."""


class PersonalWorkspaceError(Exception):
    """The personal workspace cannot be deleted; every user keeps exactly one."""
