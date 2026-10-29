"""Unit tests for account and workspace services, using in-memory repositories."""

import uuid
from dataclasses import replace
from datetime import UTC, datetime

import pytest

from orbit_api.services.accounts.models import AuthProvider, ExternalIdentity, User
from orbit_api.services.accounts.service import AccountService
from orbit_api.services.tasks.models import UNSET, Change
from orbit_api.services.transactions import ConflictError
from orbit_api.services.workspaces.models import Workspace, WorkspaceNotFoundError
from orbit_api.services.workspaces.service import WorkspaceService

pytestmark = pytest.mark.anyio


class FakeTransaction:
    def __init__(self) -> None:
        self.commits = 0
        self.rollbacks = 0

    async def commit(self) -> None:
        self.commits += 1

    async def rollback(self) -> None:
        self.rollbacks += 1


class FakeAccounts:
    def __init__(self) -> None:
        self.users: dict[tuple[AuthProvider, str], User] = {}
        # Simulates another request onboarding the same identity between our read and write.
        self.concurrent_user: User | None = None

    async def get(self, user_id: uuid.UUID) -> User | None:
        return next((u for u in self.users.values() if u.id == user_id), None)

    async def find_by_identity(self, provider: AuthProvider, subject: str) -> User | None:
        return self.users.get((provider, subject))

    async def add(self, user: User, *, auth_subject: str) -> None:
        if self.concurrent_user is not None:
            self.users[(user.auth_provider, auth_subject)] = self.concurrent_user
            raise ConflictError
        self.users[(user.auth_provider, auth_subject)] = user

    async def update(
        self,
        user_id: uuid.UUID,
        *,
        email: str | None = None,
        display_name: str | None = None,
        timezone: Change[str | None] = UNSET,
    ) -> User:
        key, user = next((k, u) for k, u in self.users.items() if u.id == user_id)
        user = replace(
            user,
            email=email or user.email,
            display_name=display_name or user.display_name,
            timezone=user.timezone if timezone is UNSET else timezone,
        )
        self.users[key] = user
        return user

    async def count(self, provider: AuthProvider) -> int:
        return sum(1 for p, _ in self.users if p == provider)


class FakeWorkspaces:
    def __init__(self) -> None:
        self.items: list[Workspace] = []

    async def add(self, workspace: Workspace) -> None:
        self.items.append(workspace)

    async def list_owned(self, owner_id: uuid.UUID) -> list[Workspace]:
        return [w for w in self.items if w.owner_id == owner_id]

    async def get_owned(self, owner_id: uuid.UUID, workspace_id: uuid.UUID) -> Workspace | None:
        return next(
            (w for w in self.items if w.id == workspace_id and w.owner_id == owner_id), None
        )

    async def rename(self, workspace_id: uuid.UUID, name: str) -> Workspace:
        raise NotImplementedError

    async def delete(self, workspace_id: uuid.UUID) -> None:
        raise NotImplementedError


def identity(display_name: str | None = "Ada") -> ExternalIdentity:
    return ExternalIdentity(
        subject=str(uuid.uuid4()), email="ada@example.com", display_name=display_name
    )


async def test_resolving_a_new_identity_onboards_it_once() -> None:
    accounts, workspaces, transaction = FakeAccounts(), FakeWorkspaces(), FakeTransaction()
    service = AccountService(accounts, workspaces, transaction)
    ada = identity()

    user = await service.resolve_external(ada)
    again = await service.resolve_external(ada)

    assert user == again
    assert user.auth_provider == "supabase"
    assert [(w.name, w.is_personal, w.owner_id) for w in workspaces.items] == [
        ("Personal", True, user.id)
    ]
    assert transaction.commits == 1


async def test_concurrent_onboarding_uses_the_winning_profile() -> None:
    accounts, transaction = FakeAccounts(), FakeTransaction()
    service = AccountService(accounts, FakeWorkspaces(), transaction)
    ada = identity()
    winner = User(
        id=uuid.uuid4(),
        auth_provider="supabase",
        email=ada.email,
        display_name="Ada",
        created_at=datetime.now(UTC),
    )
    accounts.concurrent_user = winner

    assert await service.resolve_external(ada) == winner
    assert transaction.rollbacks == 1


@pytest.mark.parametrize(
    ("display_name", "expected"),
    [("  Ada Lovelace ", "Ada Lovelace"), (None, "ada"), ("", "ada"), ("\x07", "ada")],
)
async def test_initial_display_name(display_name: str | None, expected: str) -> None:
    service = AccountService(FakeAccounts(), FakeWorkspaces(), FakeTransaction())

    user = await service.resolve_external(identity(display_name))

    assert user.display_name == expected


async def test_authorize_checks_ownership_not_just_existence() -> None:
    workspaces = FakeWorkspaces()
    service = WorkspaceService(workspaces, FakeTransaction())
    owner, stranger = uuid.uuid4(), uuid.uuid4()
    workspace = await service.create(owner, "Lab")

    assert await service.authorize(owner, workspace.id) == workspace
    with pytest.raises(WorkspaceNotFoundError):
        await service.authorize(stranger, workspace.id)
    with pytest.raises(WorkspaceNotFoundError):
        await service.rename(stranger, workspace.id, "Mine")
