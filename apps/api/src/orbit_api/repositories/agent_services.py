"""Building the agent's services on one database session: the AI layer it reasons with, the
modules' services its tools read and write through, and the agent's own repositories. Used per
request by the API and per job by the worker.

Write tools run on module services built with a flush-only transaction, so the engine commits
each write together with the step that records it (exactly once, even across crashes).
"""

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.config import Settings
from orbit_api.repositories.agent import AiModelGateway, SqlAgentStore, SqlChangeFeed
from orbit_api.repositories.ai_services import AiServices, build_ai
from orbit_api.repositories.calendar import SqlCalendarRepository
from orbit_api.repositories.documents import SqlDocumentStore
from orbit_api.repositories.habits import build_habit_service
from orbit_api.repositories.integrations import (
    FlushTransaction,
    NotificationNotifier,
    build_integrations,
)
from orbit_api.repositories.notes import (
    SqlNoteFolderRepository,
    SqlNoteRepository,
    SqlNoteTagRepository,
)
from orbit_api.repositories.notifications import SqlNotificationRepository
from orbit_api.repositories.reminders import SqlOccurrenceRepository, SqlReminderRepository
from orbit_api.repositories.tasks import SqlTaskRepository
from orbit_api.repositories.transaction import SqlTransaction
from orbit_api.services.agent.automation import AutomationService
from orbit_api.services.agent.engine import ExecutionEngine
from orbit_api.services.agent.models import (
    AgentDisabledError,
    RunLimitReachedError,
    ToolFailedError,
    WorkflowNotFoundError,
)
from orbit_api.services.agent.monitoring import Monitor
from orbit_api.services.agent.service import AgentService
from orbit_api.services.agent.signals import SignalReader
from orbit_api.services.agent.tools import (
    MailHit,
    MailReader,
    ToolContext,
    ToolRegistry,
)
from orbit_api.services.ai.providers import ProviderFactory
from orbit_api.services.calendar.service import CalendarService
from orbit_api.services.documents.service import DocumentService
from orbit_api.services.integrations.connectors import ConnectorRegistry
from orbit_api.services.notes.service import NoteService
from orbit_api.services.reminders.service import ReminderService
from orbit_api.services.tasks.service import TaskService
from orbit_api.system.attachment_store import FileAttachmentStore
from orbit_api.utils.clock import utc_now


@dataclass(frozen=True, slots=True)
class WriteServices:
    """The modules' services on a flush-only transaction, for tools that change records."""

    tasks: TaskService
    reminders: ReminderService
    calendar: CalendarService
    notes: NoteService
    documents: DocumentService


@dataclass(frozen=True, slots=True)
class ToolInputs:
    """What the concrete tools (`orbit_api.api.agent_tools`) are built from."""

    ai: AiServices
    writes: WriteServices
    store: SqlAgentStore
    notifications: SqlNotificationRepository
    mail: MailReader | None
    start_workflow: Callable[[ToolContext, uuid.UUID], Awaitable[str]]
    workflow_title: Callable[[ToolContext, uuid.UUID], Awaitable[str | None]]


type ToolFactory = Callable[[ToolInputs], ToolRegistry]


@dataclass(frozen=True, slots=True)
class AgentServices:
    service: AgentService
    automation: AutomationService
    engine: ExecutionEngine


class IntegrationMailReader:
    """Searches the labels a person chose for Orbit in their connected mailboxes, through the
    integrations' own mail service (tokens, scopes, and date range included)."""

    def __init__(self, session: AsyncSession, settings: Settings, connectors: ConnectorRegistry):
        self._session = session
        self._settings = settings
        self._connectors = connectors

    async def search(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, query: str, limit: int
    ) -> list[MailHit]:
        if not self._settings.integrations_enabled:
            raise ToolFailedError("Integrations are turned off on this server.")
        integrations = build_integrations(self._session, self._settings, self._connectors)
        connections = [
            c
            for c in await integrations.service.connections(workspace_id, user_id)
            if "mail" in c.capabilities and c.status == "active"
        ]
        if not connections:
            raise ToolFailedError("No mailbox is connected to this workspace.")
        hits: list[MailHit] = []
        for connection in connections:
            for choice in await integrations.mail.labels(connection):
                if not choice.selected:
                    continue
                try:
                    page = await integrations.mail.messages(
                        connection, choice.label.external_id, query, None
                    )
                # A deliberate boundary: a provider's failure is reported as the tool's
                # failure, with a safe message; its details may include account data.
                except Exception:
                    raise ToolFailedError(
                        "The mail provider couldn't be reached.", retryable=True
                    ) from None
                hits += [
                    MailHit(
                        subject=m.subject[:200],
                        sender=m.sender[:200],
                        received=m.received_at.date(),
                        snippet=m.snippet[:300],
                    )
                    for m in page.messages
                ]
        return sorted(hits, key=lambda h: h.received, reverse=True)[:limit]


def build_agent(
    session: AsyncSession,
    settings: Settings,
    providers: ProviderFactory,
    tools: ToolFactory,
    *,
    connectors: ConnectorRegistry | None = None,
    clock: Callable[[], datetime] = utc_now,
) -> AgentServices:
    transaction = SqlTransaction(session)
    deferred = FlushTransaction(session)
    ai = build_ai(session, settings, providers, clock=clock)
    store = SqlAgentStore(session)
    notifications = SqlNotificationRepository(session)
    writes = WriteServices(
        tasks=TaskService(SqlTaskRepository(session), deferred, clock),
        reminders=ReminderService(
            SqlReminderRepository(session),
            SqlOccurrenceRepository(session),
            SqlTaskRepository(session),
            deferred,
        ),
        calendar=CalendarService(
            SqlCalendarRepository(session),
            SqlReminderRepository(session),
            SqlOccurrenceRepository(session),
            deferred,
            clock,
        ),
        notes=NoteService(
            SqlNoteRepository(session),
            SqlNoteFolderRepository(session),
            SqlNoteTagRepository(session),
            SqlTaskRepository(session),
            deferred,
        ),
        documents=DocumentService(
            SqlDocumentStore(session),
            FileAttachmentStore(settings.attachments_dir),
            SqlReminderRepository(session),
            SqlOccurrenceRepository(session),
            deferred,
            clock,
        ),
    )
    models = AiModelGateway(ai.config)
    notifier = NotificationNotifier(session, clock)
    # The agent service starts workflows for the `run_workflow` tool, and the tools exist
    # before it does: the tool calls it through this late-bound reference.
    holder: dict[str, AgentService] = {}

    async def start_workflow(ctx: ToolContext, workflow_id: uuid.UUID) -> str:
        try:
            execution = await holder["service"].run_workflow(
                ctx.workspace_id,
                ctx.user_id,
                workflow_id,
                idempotency_key=f"{ctx.execution_id}:{workflow_id}",
                trigger="agent",
                commit=False,
            )
        except WorkflowNotFoundError:
            raise ToolFailedError("That workflow doesn't exist.") from None
        except (AgentDisabledError, RunLimitReachedError):
            raise ToolFailedError("The workflow can't run now.") from None
        return f"Started “{execution.title}”. It runs with its own steps and approvals."

    async def workflow_title(ctx: ToolContext, workflow_id: uuid.UUID) -> str | None:
        workflow = await store.get_workflow(ctx.workspace_id, ctx.user_id, workflow_id)
        return workflow.name if workflow else None

    registry = tools(
        ToolInputs(
            ai=ai,
            writes=writes,
            store=store,
            notifications=notifications,
            mail=IntegrationMailReader(session, settings, connectors) if connectors else None,
            start_workflow=start_workflow,
            workflow_title=workflow_title,
        )
    )
    engine = ExecutionEngine(store, registry, models, notifier, transaction, clock)
    service = AgentService(
        store, engine, models, transaction, server_enabled=settings.agent_enabled, clock=clock
    )
    holder["service"] = service
    signals = SignalReader(
        SqlChangeFeed(session), ai.context.sources, build_habit_service(session, clock)
    )
    monitor = Monitor(
        ai.context.sources, ai.insights, build_habit_service(session, clock), transaction
    )
    automation = AutomationService(
        store, engine, signals, monitor, notifier, transaction, clock=clock
    )
    return AgentServices(service=service, automation=automation, engine=engine)
