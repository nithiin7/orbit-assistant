"""User profiles and onboarding, shared by local and Supabase authentication."""

import uuid
from datetime import UTC, datetime
from typing import Protocol

from orbit_api.services.accounts.models import AuthProvider, ExternalIdentity, User
from orbit_api.services.tasks.models import UNSET, Change
from orbit_api.services.transactions import ConflictError, Transaction
from orbit_api.services.workspaces.service import (
    PERSONAL_WORKSPACE_NAME,
    WorkspaceRepository,
    new_workspace,
)

DISPLAY_NAME_MAX_LENGTH = 100


class AccountRepository(Protocol):
    async def get(self, user_id: uuid.UUID) -> User | None: ...

    async def find_by_identity(self, provider: AuthProvider, subject: str) -> User | None: ...

    async def add(self, user: User, *, auth_subject: str) -> None: ...

    async def update(
        self,
        user_id: uuid.UUID,
        *,
        email: str | None = None,
        display_name: str | None = None,
        timezone: Change[str | None] = UNSET,
    ) -> User:
        """Change the given fields; `None` (or `UNSET` for the time zone) keeps a field."""
        ...

    async def count(self, provider: AuthProvider) -> int: ...


class AccountService:
    def __init__(
        self,
        accounts: AccountRepository,
        workspaces: WorkspaceRepository,
        transaction: Transaction,
    ) -> None:
        self._accounts = accounts
        self._workspaces = workspaces
        self._transaction = transaction

    async def onboard(
        self, *, provider: AuthProvider, subject: str | None, email: str, display_name: str
    ) -> User:
        """Create a profile and its personal workspace, without committing.

        `subject` is the provider's user ID; local accounts pass `None` and use the profile ID.
        """
        user_id = uuid.uuid4()
        user = User(
            id=user_id,
            auth_provider=provider,
            email=email,
            display_name=display_name,
            created_at=datetime.now(UTC),
        )
        await self._accounts.add(user, auth_subject=subject or str(user_id))
        await self._workspaces.add(
            new_workspace(user_id, PERSONAL_WORKSPACE_NAME, is_personal=True)
        )
        return user

    async def resolve_external(self, identity: ExternalIdentity) -> User:
        """The profile for a verified Supabase identity, created on first sign-in."""
        user = await self._accounts.find_by_identity("supabase", identity.subject)
        if user is None:
            try:
                user = await self.onboard(
                    provider="supabase",
                    subject=identity.subject,
                    email=identity.email,
                    display_name=_initial_display_name(identity),
                )
                await self._transaction.commit()
                return user
            except ConflictError:
                # A concurrent request onboarded the same identity first; use its profile.
                await self._transaction.rollback()
                user = await self._accounts.find_by_identity("supabase", identity.subject)
                if user is None:
                    raise
        if user.email != identity.email:
            # Supabase owns the email address; keep the profile's copy current.
            user = await self._accounts.update(user.id, email=identity.email)
            await self._transaction.commit()
        return user

    async def update_profile(
        self,
        user_id: uuid.UUID,
        *,
        display_name: str | None = None,
        timezone: Change[str | None] = UNSET,
    ) -> User:
        """Change the display name and/or time zone; `timezone=None` clears the preference."""
        user = await self._accounts.update(user_id, display_name=display_name, timezone=timezone)
        await self._transaction.commit()
        return user


def _initial_display_name(identity: ExternalIdentity) -> str:
    """The name chosen at sign-up if usable, otherwise the email's local part."""
    name = (identity.display_name or "").strip()
    if not name or not name.isprintable():
        name = identity.email.split("@", 1)[0]
    return name[:DISPLAY_NAME_MAX_LENGTH] or "Orbit user"
