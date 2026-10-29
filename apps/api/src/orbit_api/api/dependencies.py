"""FastAPI dependencies shared by routers: database sessions, settings, and services."""

from collections.abc import AsyncIterator
from datetime import timedelta
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.config import Settings
from orbit_api.db.database import Database
from orbit_api.repositories.accounts import SqlAccountRepository, SqlLocalAuthRepository
from orbit_api.repositories.avatars import SqlAvatarRepository
from orbit_api.repositories.dashboard import SqlDashboardRepository
from orbit_api.repositories.notifications import SqlNotificationRepository
from orbit_api.repositories.reminders import SqlOccurrenceRepository, SqlReminderRepository
from orbit_api.repositories.shopping import SqlShoppingItemRepository, SqlShoppingListRepository
from orbit_api.repositories.tasks import SqlTaskRepository
from orbit_api.repositories.transaction import SqlTransaction
from orbit_api.repositories.workspaces import SqlWorkspaceRepository
from orbit_api.services.accounts.service import AccountService
from orbit_api.services.avatars.service import AvatarService
from orbit_api.services.dashboard.service import DashboardService
from orbit_api.services.local_auth.service import LocalAuthService, PasswordHasher
from orbit_api.services.notifications.service import NotificationService
from orbit_api.services.reminders.service import ReminderService
from orbit_api.services.shopping.service import ShoppingService
from orbit_api.services.tasks.service import TaskService
from orbit_api.services.workspaces.service import WorkspaceService


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    """One session per request, closed afterwards. Services commit explicitly; anything
    left uncommitted is rolled back when the session closes."""
    database: Database = request.app.state.database
    async with database.session() as session:
        yield session


SessionDep = Annotated[AsyncSession, Depends(get_session)]


def get_app_settings(request: Request) -> Settings:
    """The settings the running app was created with (not re-read from the environment)."""
    return request.app.state.settings


SettingsDep = Annotated[Settings, Depends(get_app_settings)]


def get_password_hasher(request: Request) -> PasswordHasher:
    return request.app.state.password_hasher


def get_account_service(session: SessionDep) -> AccountService:
    return AccountService(
        SqlAccountRepository(session), SqlWorkspaceRepository(session), SqlTransaction(session)
    )


AccountServiceDep = Annotated[AccountService, Depends(get_account_service)]


def get_local_auth_service(
    session: SessionDep,
    settings: SettingsDep,
    account_service: AccountServiceDep,
    hasher: Annotated[PasswordHasher, Depends(get_password_hasher)],
) -> LocalAuthService:
    return LocalAuthService(
        accounts=SqlAccountRepository(session),
        credentials=SqlLocalAuthRepository(session),
        account_service=account_service,
        transaction=SqlTransaction(session),
        hasher=hasher,
        session_ttl=timedelta(hours=settings.local_session_ttl_hours),
        open_registration=settings.local_registration_open,
    )


LocalAuthServiceDep = Annotated[LocalAuthService, Depends(get_local_auth_service)]


def get_workspace_service(session: SessionDep) -> WorkspaceService:
    return WorkspaceService(SqlWorkspaceRepository(session), SqlTransaction(session))


WorkspaceServiceDep = Annotated[WorkspaceService, Depends(get_workspace_service)]


def get_avatar_service(session: SessionDep) -> AvatarService:
    return AvatarService(SqlAvatarRepository(session), SqlTransaction(session))


AvatarServiceDep = Annotated[AvatarService, Depends(get_avatar_service)]


def get_dashboard_service(session: SessionDep) -> DashboardService:
    return DashboardService(SqlDashboardRepository(session), SqlTransaction(session))


DashboardServiceDep = Annotated[DashboardService, Depends(get_dashboard_service)]


def get_task_service(session: SessionDep) -> TaskService:
    return TaskService(SqlTaskRepository(session), SqlTransaction(session))


TaskServiceDep = Annotated[TaskService, Depends(get_task_service)]


def get_shopping_service(session: SessionDep) -> ShoppingService:
    return ShoppingService(
        SqlShoppingListRepository(session),
        SqlShoppingItemRepository(session),
        SqlTransaction(session),
    )


ShoppingServiceDep = Annotated[ShoppingService, Depends(get_shopping_service)]


def get_reminder_service(session: SessionDep) -> ReminderService:
    return ReminderService(
        SqlReminderRepository(session),
        SqlOccurrenceRepository(session),
        SqlTaskRepository(session),
        SqlTransaction(session),
    )


ReminderServiceDep = Annotated[ReminderService, Depends(get_reminder_service)]


def get_notification_service(session: SessionDep) -> NotificationService:
    return NotificationService(SqlNotificationRepository(session), SqlTransaction(session))


NotificationServiceDep = Annotated[NotificationService, Depends(get_notification_service)]
