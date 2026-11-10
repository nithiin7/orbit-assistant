"""FastAPI dependencies shared by routers: database sessions, settings, and services."""

from collections.abc import AsyncIterator
from datetime import timedelta
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.config import Settings
from orbit_api.db.database import Database
from orbit_api.repositories.accounts import SqlAccountRepository, SqlLocalAuthRepository
from orbit_api.repositories.agent_services import AgentServices, build_agent
from orbit_api.repositories.ai_services import AiServices, build_ai
from orbit_api.repositories.avatars import SqlAvatarRepository
from orbit_api.repositories.backup import build_backup_service
from orbit_api.repositories.budgets import build_budget_service
from orbit_api.repositories.calendar import (
    build_calendar_preference_service,
    build_calendar_service,
)
from orbit_api.repositories.commitments import build_commitment_service
from orbit_api.repositories.dashboard import SqlDashboardRepository
from orbit_api.repositories.documents import build_document_service
from orbit_api.repositories.finance import (
    SqlFinanceAccountRepository,
    SqlFinanceCategoryRepository,
    SqlFinanceTransactionRepository,
)
from orbit_api.repositories.fitness import build_fitness
from orbit_api.repositories.goals import build_goal_service
from orbit_api.repositories.habits import build_habit_service, build_routine_service
from orbit_api.repositories.integrations import Integrations, build_integrations
from orbit_api.repositories.investments import (
    build_asset_service,
    build_investment_service,
    build_net_worth_service,
)
from orbit_api.repositories.notes import build_attachment_service, build_note_service
from orbit_api.repositories.notifications import SqlNotificationRepository
from orbit_api.repositories.planning import build_planning_service
from orbit_api.repositories.reminders import SqlOccurrenceRepository, SqlReminderRepository
from orbit_api.repositories.search.history import build_search_history
from orbit_api.repositories.search.providers import build_universal_search
from orbit_api.repositories.shopping import SqlShoppingItemRepository, SqlShoppingListRepository
from orbit_api.repositories.tasks import SqlTaskRepository
from orbit_api.repositories.transaction import SqlTransaction
from orbit_api.repositories.watchlist import SqlLookupSettings, SqlWatchItemRepository
from orbit_api.repositories.workspaces import SqlWorkspaceRepository
from orbit_api.services.accounts.service import AccountService
from orbit_api.services.avatars.service import AvatarService
from orbit_api.services.backup.service import BackupService
from orbit_api.services.budgets.service import BudgetService
from orbit_api.services.calendar.service import CalendarPreferenceService, CalendarService
from orbit_api.services.commitments.service import CommitmentService
from orbit_api.services.dashboard.service import DashboardService
from orbit_api.services.dashboard.today import DailyOverviewService
from orbit_api.services.documents.service import DocumentService
from orbit_api.services.finance.service import FinanceService
from orbit_api.services.fitness.overview import Fitness
from orbit_api.services.goals.service import GoalService
from orbit_api.services.habits.routines import RoutineService
from orbit_api.services.habits.service import HabitService
from orbit_api.services.investments.assets import AssetService
from orbit_api.services.investments.service import InvestmentService
from orbit_api.services.local_auth.service import LocalAuthService, PasswordHasher
from orbit_api.services.local_auth.throttle import SignInThrottle
from orbit_api.services.networth.service import NetWorthService
from orbit_api.services.notes.attachments import AttachmentService
from orbit_api.services.notes.service import NoteService
from orbit_api.services.notifications.service import NotificationService
from orbit_api.services.planning.service import PlanningService
from orbit_api.services.reminders.service import ReminderService
from orbit_api.services.search.history import SearchHistoryService
from orbit_api.services.search.service import SearchService
from orbit_api.services.search.universal import UniversalSearchService
from orbit_api.services.shopping.service import ShoppingService
from orbit_api.services.tasks.service import TaskService
from orbit_api.services.watchlist.service import TitleCatalogs, WatchlistService
from orbit_api.services.workspaces.service import WorkspaceService
from orbit_api.system.attachment_store import FileAttachmentStore
from orbit_api.system.backup_store import FileArchiveStore
from orbit_api.system.secrets import FernetSecretBox


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


def get_sign_in_throttle(request: Request) -> SignInThrottle:
    return request.app.state.sign_in_throttle


SignInThrottleDep = Annotated[SignInThrottle, Depends(get_sign_in_throttle)]


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


def get_note_service(session: SessionDep) -> NoteService:
    return build_note_service(session)


NoteServiceDep = Annotated[NoteService, Depends(get_note_service)]


def get_attachment_store(settings: SettingsDep) -> FileAttachmentStore:
    return FileAttachmentStore(settings.attachments_dir)


AttachmentStoreDep = Annotated[FileAttachmentStore, Depends(get_attachment_store)]


def get_watchlist_service(
    request: Request, session: SessionDep, settings: SettingsDep, store: AttachmentStoreDep
) -> WatchlistService:
    # Tests replace the TMDB client with a fake.
    catalogs: TitleCatalogs = getattr(request.app.state, "tmdb")  # noqa: B009 - untyped State
    return WatchlistService(
        SqlWatchItemRepository(session),
        SqlLookupSettings(session),
        store,
        SqlTransaction(session),
        FernetSecretBox.from_settings(settings),
        catalogs,
    )


WatchlistServiceDep = Annotated[WatchlistService, Depends(get_watchlist_service)]


def get_archive_store(settings: SettingsDep) -> FileArchiveStore:
    return FileArchiveStore(settings.backups_dir)


ArchiveStoreDep = Annotated[FileArchiveStore, Depends(get_archive_store)]


def get_backup_service(session: SessionDep, settings: SettingsDep) -> BackupService:
    return build_backup_service(session, settings)


BackupServiceDep = Annotated[BackupService, Depends(get_backup_service)]


def get_attachment_service(session: SessionDep, store: AttachmentStoreDep) -> AttachmentService:
    return build_attachment_service(session, store)


AttachmentServiceDep = Annotated[AttachmentService, Depends(get_attachment_service)]


def get_document_service(session: SessionDep, store: AttachmentStoreDep) -> DocumentService:
    return build_document_service(session, store)


DocumentServiceDep = Annotated[DocumentService, Depends(get_document_service)]


def get_calendar_service(session: SessionDep) -> CalendarService:
    return build_calendar_service(session)


CalendarServiceDep = Annotated[CalendarService, Depends(get_calendar_service)]


def get_calendar_preference_service(session: SessionDep) -> CalendarPreferenceService:
    return build_calendar_preference_service(session)


CalendarPreferenceServiceDep = Annotated[
    CalendarPreferenceService, Depends(get_calendar_preference_service)
]


def get_habit_service(session: SessionDep) -> HabitService:
    return build_habit_service(session)


HabitServiceDep = Annotated[HabitService, Depends(get_habit_service)]


def get_routine_service(session: SessionDep) -> RoutineService:
    return build_routine_service(session)


RoutineServiceDep = Annotated[RoutineService, Depends(get_routine_service)]


def get_fitness(session: SessionDep, store: AttachmentStoreDep) -> Fitness:
    return build_fitness(session, store)


FitnessDep = Annotated[Fitness, Depends(get_fitness)]


def get_daily_overview_service(
    session: SessionDep,
    tasks: TaskServiceDep,
    calendar: CalendarServiceDep,
    reminders: ReminderServiceDep,
    habits: HabitServiceDep,
    documents: DocumentServiceDep,
    commitments: CommitmentServiceDep,
) -> DailyOverviewService:
    """The overview composes the modules' own services; it has no repository of its own."""
    return DailyOverviewService(
        tasks=tasks,
        calendar=calendar,
        reminders=reminders,
        habits=habits,
        documents=documents,
        payments=commitments,
        transaction=SqlTransaction(session),
    )


DailyOverviewServiceDep = Annotated[DailyOverviewService, Depends(get_daily_overview_service)]


def get_search_service(
    session: SessionDep,
    tasks: TaskServiceDep,
    notes: NoteServiceDep,
    calendar: CalendarServiceDep,
    documents: DocumentServiceDep,
    habits: HabitServiceDep,
    finance: FinanceServiceDep,
) -> SearchService:
    """Search composes the modules' own searches; there is no index."""
    return SearchService(
        tasks=tasks,
        notes=notes,
        events=calendar,
        documents=documents,
        habits=habits,
        transactions=finance,
        transaction=SqlTransaction(session),
    )


SearchServiceDep = Annotated[SearchService, Depends(get_search_service)]


def get_universal_search(session: SessionDep) -> UniversalSearchService:
    """Universal search reads the modules' tables through its own declarative sources
    (`repositories/search/catalog.py`); there is no index."""
    return build_universal_search(session)


UniversalSearchDep = Annotated[UniversalSearchService, Depends(get_universal_search)]


def get_search_history(session: SessionDep) -> SearchHistoryService:
    return build_search_history(session)


SearchHistoryDep = Annotated[SearchHistoryService, Depends(get_search_history)]


def get_ai_services(request: Request, session: SessionDep, settings: SettingsDep) -> AiServices:
    """The AI services on the request's session. Action proposals run through the modules' own
    request schemas and services (`api/ai_actions.py`)."""
    return build_ai_for(session, request.app.state)


def build_ai_for(session: AsyncSession, state: object) -> AiServices:
    # Imported here: `ai_actions` depends on the route schemas, which import this module's
    # neighbours; a top-level import would be circular.
    from orbit_api.api.ai_actions import ModuleActionExecutor, ModuleActionValidator

    app_settings: Settings = getattr(state, "settings")  # noqa: B009 - Starlette's State is untyped
    return build_ai(
        session,
        app_settings,
        getattr(state, "ai_providers"),  # noqa: B009
        validator=ModuleActionValidator(),
        executor=lambda modules: ModuleActionExecutor(
            tasks=modules.tasks,
            reminders=modules.reminders,
            calendar=modules.calendar,
            notes=modules.notes,
            documents=modules.documents,
        ),
    )


AiServicesDep = Annotated[AiServices, Depends(get_ai_services)]


def get_integrations(request: Request, session: SessionDep, settings: SettingsDep) -> Integrations:
    """The integration services on the request's session, over the app's shared connectors."""
    return build_integrations(session, settings, request.app.state.integration_connectors)


IntegrationsDep = Annotated[Integrations, Depends(get_integrations)]


def get_agent_services(request: Request, session: SessionDep) -> AgentServices:
    """The agent's services on the request's session. Tools run through the modules' own
    request schemas and services (`api/agent_tools.py`)."""
    return build_agent_for(session, request.app.state)


def build_agent_for(session: AsyncSession, state: object) -> AgentServices:
    # Imported here for the same reason as `build_ai_for`: `agent_tools` uses route schemas.
    from orbit_api.api.agent_tools import tool_factory

    app_settings: Settings = getattr(state, "settings")  # noqa: B009 - Starlette's State is untyped
    return build_agent(
        session,
        app_settings,
        getattr(state, "ai_providers"),  # noqa: B009
        tool_factory,
        connectors=getattr(state, "integration_connectors"),  # noqa: B009
    )


AgentServicesDep = Annotated[AgentServices, Depends(get_agent_services)]
