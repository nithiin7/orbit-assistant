"""Building the AI services on one database session: the modules' own services they compose,
and the AI repositories. Used per request by the API, by the assistant's streaming response
(on a session of its own), and by the worker for indexing."""

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.config import Settings
from orbit_api.repositories.ai import (
    SqlAiProviderRepository,
    SqlAiSettingsRepository,
    SqlAiUsageRepository,
    SqlConversationRepository,
    SqlDismissalRepository,
    SqlIndexRepository,
    SqlProposalRepository,
)
from orbit_api.repositories.budgets import build_budget_service
from orbit_api.repositories.calendar import build_calendar_service
from orbit_api.repositories.commitments import build_commitment_service
from orbit_api.repositories.documents import build_document_service
from orbit_api.repositories.finance import (
    SqlFinanceAccountRepository,
    SqlFinanceCategoryRepository,
    SqlFinanceTransactionRepository,
)
from orbit_api.repositories.fitness import build_fitness
from orbit_api.repositories.habits import build_habit_service
from orbit_api.repositories.notes import build_note_service
from orbit_api.repositories.reminders import SqlOccurrenceRepository, SqlReminderRepository
from orbit_api.repositories.tasks import SqlTaskRepository
from orbit_api.repositories.transaction import SqlTransaction
from orbit_api.services.ai.actions import ActionExecutor, ActionValidator, ProposalService
from orbit_api.services.ai.assist import AssistService
from orbit_api.services.ai.assistant import AssistantService, Grounder
from orbit_api.services.ai.configuration import AiConfigService
from orbit_api.services.ai.context import ContextBuilder, Sources
from orbit_api.services.ai.health_assist import HealthAssistService
from orbit_api.services.ai.indexing import IndexService
from orbit_api.services.ai.insights import InsightService
from orbit_api.services.ai.models import ActionKind, ActionResult, InvalidActionError
from orbit_api.services.ai.providers import ProviderFactory
from orbit_api.services.ai.retrieval import Retriever
from orbit_api.services.ai.sources import SourceCatalog
from orbit_api.services.ai.usage import UsageService
from orbit_api.services.calendar.service import CalendarService
from orbit_api.services.documents.service import DocumentService
from orbit_api.services.finance.service import FinanceService
from orbit_api.services.notes.service import NoteService
from orbit_api.services.reminders.service import ReminderService
from orbit_api.services.search.service import SearchService
from orbit_api.services.tasks.service import TaskService
from orbit_api.system.attachment_store import FileAttachmentStore
from orbit_api.system.network import resolve_host
from orbit_api.system.secrets import FernetSecretBox
from orbit_api.utils.clock import utc_now


class _NoActions:
    """For callers that never handle proposals (the worker): every action is refused."""

    def validate(
        self, kind: ActionKind, payload: dict[str, object], timezone: str
    ) -> tuple[dict[str, object], str]:
        raise InvalidActionError("Actions aren't available here.")

    async def execute(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        kind: ActionKind,
        payload: dict[str, object],
        timezone: str | None,
    ) -> ActionResult:
        raise InvalidActionError("Actions aren't available here.")


_NO_ACTIONS = _NoActions()


@dataclass(frozen=True, slots=True)
class ModuleServices:
    """The modules' own services the AI layer reads through and acts through."""

    tasks: TaskService
    notes: NoteService
    calendar: CalendarService
    reminders: ReminderService
    documents: DocumentService
    finance: FinanceService


@dataclass(frozen=True, slots=True)
class AiServices:
    modules: ModuleServices
    config: AiConfigService
    usage: UsageService
    index: IndexService
    catalog: SourceCatalog
    retriever: Retriever
    context: ContextBuilder
    grounder: Grounder
    proposals: ProposalService
    assistant: AssistantService
    assist: AssistService
    health: HealthAssistService
    insights: InsightService


def build_ai(
    session: AsyncSession,
    settings: Settings,
    factory: ProviderFactory,
    *,
    validator: ActionValidator | None = None,
    executor: Callable[[ModuleServices], ActionExecutor] | None = None,
    clock: Callable[[], datetime] = utc_now,
) -> AiServices:
    transaction = SqlTransaction(session)
    files = FileAttachmentStore(settings.attachments_dir)
    tasks = TaskService(SqlTaskRepository(session), transaction, clock)
    notes = build_note_service(session)
    calendar = build_calendar_service(session, clock)
    reminders = ReminderService(
        SqlReminderRepository(session),
        SqlOccurrenceRepository(session),
        SqlTaskRepository(session),
        transaction,
    )
    documents = build_document_service(session, files, clock)
    finance = FinanceService(
        SqlFinanceAccountRepository(session),
        SqlFinanceCategoryRepository(session),
        SqlFinanceTransactionRepository(session),
        transaction,
    )
    habits = build_habit_service(session, clock)
    fitness = build_fitness(session, files, clock)
    modules = ModuleServices(
        tasks=tasks,
        notes=notes,
        calendar=calendar,
        reminders=reminders,
        documents=documents,
        finance=finance,
    )
    usage = UsageService(SqlAiUsageRepository(session), transaction, clock)
    config = AiConfigService(
        SqlAiSettingsRepository(session),
        SqlAiProviderRepository(session),
        FernetSecretBox.from_settings(settings),
        factory,
        usage,
        transaction,
        server_enabled=settings.ai_enabled,
        allow_private=settings.ai_private_endpoints_allowed,
        resolve=resolve_host,
        clock=clock,
    )
    catalog = SourceCatalog(
        tasks=tasks, notes=notes, events=calendar, documents=documents, habits=habits
    )
    index_repository = SqlIndexRepository(session)
    index = IndexService(index_repository, catalog, transaction, clock=clock)
    search = SearchService(
        tasks=tasks,
        notes=notes,
        events=calendar,
        documents=documents,
        habits=habits,
        transactions=finance,
        transaction=transaction,
    )
    retriever = Retriever(keyword=search, chunks=index_repository, catalog=catalog)
    context = ContextBuilder(
        Sources(
            tasks=tasks,
            calendar=calendar,
            reminders=reminders,
            finance=finance,
            payments=build_commitment_service(session, clock),
            budgets=build_budget_service(session, clock),
            habits=habits,
            workouts=fitness.workouts,
            health=fitness,
            documents=documents,
            notes=notes,
        ),
        transaction,
    )
    grounder = Grounder(context, retriever)
    proposals = ProposalService(
        SqlProposalRepository(session),
        validator or _NO_ACTIONS,
        executor(modules) if executor else _NO_ACTIONS,
        transaction,
        clock,
    )
    assistant = AssistantService(
        config=config,
        conversations=SqlConversationRepository(session),
        grounder=grounder,
        proposals=proposals,
        transaction=transaction,
        clock=clock,
    )
    assist = AssistService(
        config=config,
        notes=notes,
        documents=documents,
        tasks=tasks,
        calendar=calendar,
        transactions=finance,
        catalog=catalog,
        context=context,
        grounder=grounder,
        retriever=retriever,
        proposals=proposals,
        clock=clock,
    )
    health = HealthAssistService(
        config=config,
        library=fitness.library,
        workouts=fitness.workouts,
        goals=fitness.tracking,
        clock=clock,
    )
    insights = InsightService(context, SqlDismissalRepository(session), transaction)
    return AiServices(
        modules=modules,
        config=config,
        usage=usage,
        index=index,
        catalog=catalog,
        retriever=retriever,
        context=context,
        grounder=grounder,
        proposals=proposals,
        assistant=assistant,
        assist=assist,
        health=health,
        insights=insights,
    )
