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
from orbit_api.repositories.budgets import build_budget_service
from orbit_api.repositories.commitments import build_commitment_service
from orbit_api.repositories.dashboard import SqlDashboardRepository
from orbit_api.repositories.finance import (
    SqlFinanceAccountRepository,
    SqlFinanceCategoryRepository,
    SqlFinanceTransactionRepository,
)
from orbit_api.repositories.goals import build_goal_service
from orbit_api.repositories.investments import (
    build_asset_service,
    build_investment_service,
    build_net_worth_service,
)
from orbit_api.repositories.notifications import SqlNotificationRepository
from orbit_api.repositories.planning import build_planning_service
from orbit_api.repositories.reminders import SqlOccurrenceRepository, SqlReminderRepository
from orbit_api.repositories.shopping import SqlShoppingItemRepository, SqlShoppingListRepository
from orbit_api.repositories.tasks import SqlTaskRepository
from orbit_api.repositories.transaction import SqlTransaction
from orbit_api.repositories.workspaces import SqlWorkspaceRepository
from orbit_api.services.accounts.service import AccountService
from orbit_api.services.avatars.service import AvatarService
from orbit_api.services.budgets.service import BudgetService
from orbit_api.services.commitments.service import CommitmentService
from orbit_api.services.dashboard.service import DashboardService
from orbit_api.services.finance.service import FinanceService
from orbit_api.services.goals.service import GoalService
from orbit_api.services.investments.assets import AssetService
from orbit_api.services.investments.service import InvestmentService
from orbit_api.services.local_auth.service import LocalAuthService, PasswordHasher
from orbit_api.services.networth.service import NetWorthService
from orbit_api.services.notifications.service import NotificationService
from orbit_api.services.planning.service import PlanningService
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


def get_finance_service(session: SessionDep) -> FinanceService:
    return FinanceService(
        SqlFinanceAccountRepository(session),
        SqlFinanceCategoryRepository(session),
        SqlFinanceTransactionRepository(session),
        SqlTransaction(session),
    )


FinanceServiceDep = Annotated[FinanceService, Depends(get_finance_service)]


def get_commitment_service(session: SessionDep) -> CommitmentService:
    return build_commitment_service(session)


CommitmentServiceDep = Annotated[CommitmentService, Depends(get_commitment_service)]


def get_investment_service(session: SessionDep) -> InvestmentService:
    return build_investment_service(session)


InvestmentServiceDep = Annotated[InvestmentService, Depends(get_investment_service)]


def get_asset_service(session: SessionDep) -> AssetService:
    return build_asset_service(session)


AssetServiceDep = Annotated[AssetService, Depends(get_asset_service)]


def get_net_worth_service(session: SessionDep) -> NetWorthService:
    return build_net_worth_service(session)


NetWorthServiceDep = Annotated[NetWorthService, Depends(get_net_worth_service)]


def get_budget_service(session: SessionDep) -> BudgetService:
    return build_budget_service(session)


BudgetServiceDep = Annotated[BudgetService, Depends(get_budget_service)]


def get_goal_service(session: SessionDep) -> GoalService:
    return build_goal_service(session)


GoalServiceDep = Annotated[GoalService, Depends(get_goal_service)]


def get_planning_service(session: SessionDep) -> PlanningService:
    return build_planning_service(session)


PlanningServiceDep = Annotated[PlanningService, Depends(get_planning_service)]
