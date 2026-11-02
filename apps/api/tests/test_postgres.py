"""PostgreSQL integration tests. Opt-in: they need a disposable PostgreSQL database.

Run with `ORBIT_TEST_DATABASE_URL=postgresql://... uv run pytest -m postgres`. The database is
migrated up and back down to an empty schema, so never point this at real data.
"""

import os
import uuid
from collections.abc import Iterator
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from orbit_api.config import Settings
from orbit_api.db.database import open_database
from orbit_api.db.engine import create_engine
from orbit_api.db.migrate import downgrade, upgrade
from orbit_api.main import create_app
from orbit_api.repositories.calendar import build_calendar_service
from orbit_api.repositories.documents import build_document_service
from orbit_api.repositories.fitness import build_fitness
from orbit_api.repositories.habits import build_habit_service, build_routine_service
from orbit_api.repositories.tasks import SqlTaskRepository
from orbit_api.repositories.transaction import SqlTransaction
from orbit_api.services.calendar.models import DateWindow, EventDraft, OccurrenceChanges
from orbit_api.services.calendar.recurrence import EventRecurrence
from orbit_api.services.documents.models import (
    DateRange,
    DocumentChanges,
    DocumentDetails,
    DocumentDraft,
    DocumentQuery,
    LinkTarget,
)
from orbit_api.services.fitness.models import (
    ActivityDraft,
    FitnessConflictError,
    FoodEntryDraft,
    GoalDraft,
    HabitLinkDraft,
    LoggedExercise,
    LoggedSession,
    MeasurementDraft,
    MeasurementValues,
    Nutrients,
    Owner,
    PortionDraft,
    ProfileDraft,
    SessionStart,
    SetValues,
    Targets,
    TemplateDraft,
    TemplateExerciseDraft,
)
from orbit_api.services.habits.models import (
    ActiveSessionExistsError,
    HabitChanges,
    HabitDraft,
    LogDraft,
    ReminderTime,
    RoutineDraft,
    StepDraft,
)
from orbit_api.services.habits.schedule import HabitSchedule
from orbit_api.services.tasks.models import TaskDraft
from orbit_api.services.tasks.service import TaskService
from orbit_api.system.attachment_store import FileAttachmentStore

TEST_DATABASE_URL = os.environ.get("ORBIT_TEST_DATABASE_URL")

pytestmark = [
    pytest.mark.postgres,
    pytest.mark.skipif(not TEST_DATABASE_URL, reason="ORBIT_TEST_DATABASE_URL is not set"),
]


@pytest.fixture
def cloud_settings() -> Iterator[Settings]:
    settings = Settings(
        env="test",
        storage_mode="cloud",
        database_url=TEST_DATABASE_URL,
        supabase_url="https://project.supabase.co",
        supabase_publishable_key="sb_publishable_test",
        _env_file=None,  # pyright: ignore[reportCallIssue]
    )
    upgrade(settings)
    yield settings
    downgrade(settings, "base")


PROTECTED_TABLES = (
    "users",
    "local_credentials",
    "local_sessions",
    "workspaces",
    "user_avatars",
    "tasks",
    "shopping_lists",
    "shopping_items",
    "dashboard_layouts",
    "reminders",
    "reminder_occurrences",
    "notifications",
    "finance_accounts",
    "finance_categories",
    "finance_transactions",
    "finance_loans",
    "finance_loan_installments",
    "finance_recurring_payments",
    "finance_recurring_occurrences",
    "finance_investment_accounts",
    "finance_holdings",
    "finance_holding_prices",
    "finance_sip_plans",
    "finance_deposits",
    "finance_investment_transactions",
    "finance_assets",
    "finance_asset_valuations",
    "finance_net_worth_snapshots",
    "calendar_categories",
    "calendar_events",
    "calendar_event_exceptions",
    "calendar_event_alerts",
    "calendar_event_notes",
    "calendar_event_tasks",
    "calendar_preferences",
    "document_folders",
    "document_categories",
    "documents",
    "document_versions",
    "document_tags",
    "document_renewals",
    "document_links",
    "fitness_profiles",
    "fitness_exercises",
    "fitness_templates",
    "fitness_template_exercises",
    "fitness_sessions",
    "fitness_session_exercises",
    "fitness_sets",
    "fitness_measurements",
    "fitness_photos",
    "fitness_foods",
    "fitness_meals",
    "fitness_meal_items",
    "fitness_food_entries",
    "fitness_water_entries",
    "fitness_activities",
    "fitness_goals",
    "fitness_goal_progress",
    "fitness_habit_links",
    "fitness_workout_events",
    "fitness_links",
    "ai_providers",
    "ai_settings",
    "ai_index_sources",
    "ai_chunks",
    "ai_conversations",
    "ai_messages",
    "ai_action_proposals",
    "ai_usage",
    "ai_insight_dismissals",
)


@pytest.mark.anyio
async def test_every_table_enables_row_level_security(cloud_settings: Settings) -> None:
    engine = create_engine(cloud_settings)
    try:
        async with engine.connect() as connection:
            result = await connection.execute(
                text("SELECT relname, relrowsecurity FROM pg_class WHERE relname = ANY(:names)"),
                {"names": list(PROTECTED_TABLES)},
            )
            rows: dict[str, bool] = dict(result.all())
    finally:
        await engine.dispose()

    assert rows == dict.fromkeys(PROTECTED_TABLES, True)


@pytest.mark.anyio
async def test_row_level_security_denies_roles_without_policies(cloud_settings: Settings) -> None:
    """A role that does not own the tables, like Supabase's `anon` and `authenticated`, sees no
    rows: RLS is enabled and no policy grants access. Everything is rolled back afterwards."""
    engine = create_engine(cloud_settings)
    try:
        async with engine.connect() as connection:
            await connection.execute(
                text(
                    "INSERT INTO users (id, auth_provider, auth_subject, email, display_name,"
                    " created_at, updated_at) VALUES (gen_random_uuid(), 'local', 's',"
                    " 'a@example.com', 'A', now(), now())"
                )
            )
            owner_sees = await connection.scalar(text("SELECT count(*) FROM users"))
            await connection.execute(text("CREATE ROLE orbit_rls_probe NOLOGIN"))
            await connection.execute(text("GRANT SELECT ON users TO orbit_rls_probe"))
            await connection.execute(text("SET LOCAL ROLE orbit_rls_probe"))
            probe_sees = await connection.scalar(text("SELECT count(*) FROM users"))
            await connection.rollback()
    finally:
        await engine.dispose()

    assert (owner_sees, probe_sees) == (1, 0)


def test_cloud_mode_serves_requests_against_postgres(cloud_settings: Settings) -> None:
    with TestClient(create_app(cloud_settings)) as client:
        response = client.get("/api/v1/health/database")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "storage_mode": "cloud"}


@pytest.mark.anyio
async def test_calendar_series_on_postgres(cloud_settings: Settings) -> None:
    """The calendar's SQL on PostgreSQL: naive local times, JSON rules, composite keys, row
    locks, alert reminders, and cascades. Driven through the service, since cloud mode's API needs
    Supabase tokens."""
    database = await open_database(cloud_settings)
    user_id, workspace_id = uuid.uuid4(), uuid.uuid4()
    try:
        async with database.session() as session:
            await session.execute(
                text(
                    "INSERT INTO users (id, auth_provider, auth_subject, email, display_name,"
                    " created_at, updated_at) VALUES (:id, 'local', :subject, 'c@example.com', 'C',"
                    " now(), now())"
                ),
                {"id": user_id, "subject": str(user_id)},
            )
            await session.execute(
                text(
                    "INSERT INTO workspaces (id, owner_id, name, is_personal, created_at,"
                    " updated_at) VALUES (:id, :owner, 'Personal', true, now(), now())"
                ),
                {"id": workspace_id, "owner": user_id},
            )
            await session.commit()

            calendar = build_calendar_service(session)
            category = (await calendar.categories(workspace_id))[0]
            detail = await calendar.create_event(
                workspace_id,
                EventDraft(
                    title="Standup",
                    start=datetime(2030, 3, 29, 9, 0),
                    end=datetime(2030, 3, 29, 9, 30),
                    timezone="Europe/Paris",
                    category_id=category.id,
                    recurrence=EventRecurrence("daily", count=5),
                    alerts=(10,),
                ),
                default_timezone=None,
            )
            event_id = detail.event.id
            await calendar.update_occurrence(
                workspace_id,
                event_id,
                datetime(2030, 3, 30, 9, 0),
                "this",
                OccurrenceChanges(title="Moved", start=datetime(2030, 3, 30, 11, 0)),
            )
            await calendar.delete_occurrence(
                workspace_id, event_id, datetime(2030, 3, 31, 9, 0), "this"
            )
            tail = await calendar.update_occurrence(
                workspace_id,
                event_id,
                datetime(2030, 4, 1, 9, 0),
                "following",
                OccurrenceChanges(title="Later"),
            )
            result = await calendar.range(
                workspace_id, DateWindow(date(2030, 3, 29), date(2030, 4, 5), "Europe/Paris")
            )
            assert [(o.title, o.start_at.isoformat()) for o in result.occurrences] == [
                ("Standup", "2030-03-29T08:00:00+00:00"),
                ("Moved", "2030-03-30T10:00:00+00:00"),
                ("Later", "2030-04-01T07:00:00+00:00"),
                ("Later", "2030-04-02T07:00:00+00:00"),
            ]
            reminders = await session.scalar(
                text("SELECT count(*) FROM reminders WHERE calendar_event_alert_id IS NOT NULL")
            )
            assert reminders == 2  # One per series' alert.

            await calendar.delete_event(workspace_id, tail.event.id)
            await calendar.delete_category(workspace_id, category.id)
            left = await session.scalar(
                text("SELECT count(*) FROM reminders WHERE calendar_event_alert_id IS NOT NULL")
            )
            assert left == 1
            assert (await calendar.get_event(workspace_id, event_id)).event.category_id is None
    finally:
        async with database.session() as session:
            await session.execute(text("DELETE FROM users WHERE id = :id"), {"id": user_id})
            await session.commit()
        await database.dispose()


@pytest.mark.anyio
async def test_habits_and_routines_on_postgres(cloud_settings: Settings) -> None:
    """Habits on PostgreSQL: JSON schedules, float targets, the one-entry-per-day upsert,
    managed reminders, the partial unique index on active sessions, and cascades."""
    database = await open_database(cloud_settings)
    user_id, workspace_id = uuid.uuid4(), uuid.uuid4()
    try:
        async with database.session() as session:
            await session.execute(
                text(
                    "INSERT INTO users (id, auth_provider, auth_subject, email, display_name,"
                    " created_at, updated_at) VALUES (:id, 'local', :subject, 'h@example.com', 'H',"
                    " now(), now())"
                ),
                {"id": user_id, "subject": str(user_id)},
            )
            await session.execute(
                text(
                    "INSERT INTO workspaces (id, owner_id, name, is_personal, created_at,"
                    " updated_at) VALUES (:id, :owner, 'Personal', true, now(), now())"
                ),
                {"id": workspace_id, "owner": user_id},
            )
            await session.commit()

            habits = build_habit_service(session)
            category = (await habits.categories(workspace_id))[0]
            created = await habits.create(
                workspace_id,
                HabitDraft(
                    name="Water",
                    kind="numeric",
                    unit="litres",
                    target=2.5,
                    schedule=HabitSchedule("weekdays", weekdays=frozenset({"mon", "thu"})),
                    start_date=date(2026, 1, 1),
                    timezone="Europe/Paris",
                    category_id=category.id,
                    reminders=(ReminderTime(datetime(2030, 1, 1, 7, 0).time()),),
                ),
                default_timezone=None,
            )
            habit_id = created.progress.habit.id
            day = date(2026, 1, 5)
            await habits.log(workspace_id, habit_id, day, LogDraft("progress", 1.25))
            logged = await habits.log(workspace_id, habit_id, day, LogDraft("progress", 2.5))
            assert logged.state == "completed" and logged.log is not None
            assert logged.log.target == 2.5
            await habits.update(
                workspace_id,
                habit_id,
                HabitChanges(schedule=HabitSchedule("daily", every=2), status="paused"),
            )
            detail = await habits.get(workspace_id, habit_id)
            assert len(detail.progress.habit.versions) == 2
            assert (
                detail.reminders
                and await session.scalar(
                    text("SELECT count(*) FROM reminders WHERE habit_reminder_id IS NOT NULL")
                )
                == 0
            )  # Paused: its reminder is cancelled.

            routines = build_routine_service(session)
            routine = await routines.create(
                workspace_id,
                RoutineDraft(name="Morning", timezone="UTC", steps=(StepDraft("Drink"),)),
                default_timezone=None,
            )
            await routines.start(workspace_id, routine.routine.id, None)
            with pytest.raises(ActiveSessionExistsError):
                await routines.start(workspace_id, routine.routine.id, None)

            await habits.delete_category(workspace_id, category.id)
            await habits.delete(workspace_id, habit_id)
            assert await session.scalar(text("SELECT count(*) FROM habit_logs")) == 0
    finally:
        async with database.session() as session:
            await session.execute(text("DELETE FROM users WHERE id = :id"), {"id": user_id})
            await session.commit()
        await database.dispose()


@pytest.mark.anyio
async def test_documents_on_postgres(cloud_settings: Settings, tmp_path: Path) -> None:
    """Documents on PostgreSQL: JSON metadata, ILIKE search across joined names, counts,
    versions, tags, the one-target link check and its composite keys, managed reminders, and
    permanent deletion."""
    database = await open_database(cloud_settings)
    user_id, workspace_id = uuid.uuid4(), uuid.uuid4()
    pdf = b"%PDF-1.7\n%%EOF\n"
    try:
        async with database.session() as session:
            await session.execute(
                text(
                    "INSERT INTO users (id, auth_provider, auth_subject, email, display_name,"
                    " created_at, updated_at) VALUES (:id, 'local', :subject, 'd@example.com', 'D',"
                    " now(), now())"
                ),
                {"id": user_id, "subject": str(user_id)},
            )
            await session.execute(
                text(
                    "INSERT INTO workspaces (id, owner_id, name, is_personal, created_at,"
                    " updated_at) VALUES (:id, :owner, 'Personal', true, now(), now())"
                ),
                {"id": workspace_id, "owner": user_id},
            )
            await session.commit()

            documents = build_document_service(session, FileAttachmentStore(tmp_path))
            categories = await documents.categories(workspace_id)
            assert len(categories) == 14
            folder = await documents.create_folder(workspace_id, "Garage", None)
            uploaded = await documents.upload(
                workspace_id,
                "insurance.pdf",
                pdf,
                DocumentDraft(
                    title="Car insurance",
                    folder_id=folder.id,
                    category_id=categories[5].category.id,
                    details=DocumentDetails(expiry_date=date(2030, 3, 31), provider="Acme"),
                    tags=("Car",),
                ),
                default_timezone="Asia/Kolkata",
            )
            await documents.add_version(workspace_id, uploaded.id, "insurance-2.pdf", pdf + b"2")
            found, total = await documents.find(
                workspace_id, DocumentQuery(search="garage insurance car")
            )
            assert total == 1 and found[0].tags == ("Car",)
            expiring, _ = await documents.find(
                workspace_id,
                DocumentQuery(
                    expiry=DateRange(date(2030, 1, 1), date(2030, 12, 31)), sort="expiry"
                ),
            )
            assert [d.id for d in expiring] == [uploaded.id]
            counts = await documents.counts(workspace_id, date(2030, 3, 1))
            assert (counts.all, counts.expiring_30, counts.total_bytes) == (1, 1, 2 * len(pdf) + 1)

            tasks = TaskService(SqlTaskRepository(session), SqlTransaction(session))
            task = await tasks.create(workspace_id, TaskDraft(title="Renew"))
            await documents.link(workspace_id, uploaded.id, LinkTarget("task", task.id))
            detail = await documents.detail(workspace_id, uploaded.id)
            assert [link.title for link in detail.links] == ["Renew"]
            assert detail.next_reminder_at is not None
            updated = await documents.update(
                workspace_id, uploaded.id, DocumentChanges(custom_fields=(), tags=("Car", "Tax"))
            )
            assert updated.tags == ("Car", "Tax")

            await documents.trash(workspace_id, uploaded.id)
            assert await documents.empty_trash(workspace_id) == 1
            remaining = await session.scalar(
                text("SELECT count(*) FROM reminders WHERE document_id IS NOT NULL")
            )
            assert remaining == 0
            # The files went with the document.
            assert not any(path.is_file() for path in tmp_path.rglob("*"))
    finally:
        await database.dispose()


@pytest.mark.anyio
async def test_fitness_on_postgres(cloud_settings: Settings, tmp_path: Path) -> None:
    """Health and fitness on PostgreSQL: built-ins and the custom-or-built-in check, JSON
    muscles, templates, the one-unfinished-workout partial index, logged workouts and records,
    measurements, nutrition totals, goals, habit contributions, and per-person filtering."""
    database = await open_database(cloud_settings)
    user_id, other_id, workspace_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    try:
        async with database.session() as session:
            for person, email in ((user_id, "f@example.com"), (other_id, "o@example.com")):
                await session.execute(
                    text(
                        "INSERT INTO users (id, auth_provider, auth_subject, email, display_name,"
                        " created_at, updated_at) VALUES (:id, 'local', :subject, :email, 'F',"
                        " now(), now())"
                    ),
                    {"id": person, "subject": str(person), "email": email},
                )
            await session.execute(
                text(
                    "INSERT INTO workspaces (id, owner_id, name, is_personal, created_at,"
                    " updated_at) VALUES (:id, :owner, 'Personal', true, now(), now())"
                ),
                {"id": workspace_id, "owner": user_id},
            )
            await session.commit()

            fitness = build_fitness(session, FileAttachmentStore(tmp_path))
            owner = Owner(workspace_id, user_id)
            await fitness.library.update_profile(
                owner, ProfileDraft(weight_unit="lb", targets=Targets(water_ml=2000))
            )
            exercises = {e.details.name: e for e in await fitness.library.exercises(owner)}
            assert len(await fitness.library.exercises(owner)) == len(exercises)
            bench = exercises["Bench press"]
            assert bench.details.primary_muscles == ("chest",)
            template = await fitness.library.create_template(
                owner,
                TemplateDraft(
                    name="Push",
                    exercises=(TemplateExerciseDraft(bench.id, sets=2, target_reps_max=5),),
                ),
            )
            today = date.today()
            started = await fitness.workouts.start(
                owner, SessionStart(day=today, timezone="UTC", template_id=template.id)
            )
            assert len(started.exercises[0].sets) == 2
            with pytest.raises(FitnessConflictError):
                await fitness.workouts.start(owner, SessionStart(day=today, timezone="UTC"))
            await fitness.workouts.finish(owner, started.session.id, "abandoned")

            habit = await build_habit_service(session).create(
                workspace_id,
                HabitDraft(
                    name="Lift",
                    kind="boolean",
                    schedule=HabitSchedule(type="daily"),
                    start_date=today,
                    timezone="UTC",
                ),
                default_timezone="UTC",
            )
            await fitness.integrations.link_habit(
                owner, HabitLinkDraft(habit.progress.habit.id, "workout", contributes=True)
            )
            now = datetime.now().astimezone()
            await fitness.workouts.log(
                owner,
                LoggedSession(
                    name="Push",
                    day=today,
                    timezone="UTC",
                    started_at=now.replace(microsecond=0) - timedelta(hours=1),
                    ended_at=now.replace(microsecond=0),
                    exercises=(
                        LoggedExercise(
                            bench.id, (SetValues(reps=5, weight_g=100_000, completed=True),)
                        ),
                    ),
                ),
            )
            records = {r.kind: r.value for r in await fitness.workouts.records(owner)}
            assert records["max_weight"] == 100_000
            logged = await session.scalar(
                text("SELECT count(*) FROM habit_logs WHERE habit_id = :id"),
                {"id": habit.progress.habit.id},
            )
            assert logged == 1

            await fitness.body.add_measurement(
                owner, MeasurementDraft(today, MeasurementValues(weight_g=80_000, height_mm=1800))
            )
            assert (await fitness.body.bmi(owner)) is not None
            await fitness.nutrition.add_entry(
                owner,
                FoodEntryDraft(
                    today,
                    "lunch",
                    PortionDraft(
                        quantity_milli=1000,
                        name="Rice",
                        serving_unit="cup",
                        nutrients=Nutrients(energy_cal=200_000),
                    ),
                ),
            )
            assert (await fitness.nutrition.day(owner, today)).totals.energy_cal == 200_000
            await fitness.tracking.add_activity(owner, ActivityDraft(today, "steps", steps=5000))
            goal = await fitness.tracking.create_goal(
                owner,
                GoalDraft(
                    name="Weight",
                    category="body_weight",
                    start_value=82_000,
                    target_value=78_000,
                    start_date=today,
                    auto_track=True,
                ),
                today,
            )
            assert goal.fraction == 0.5

            # Another person in the same workspace sees none of it.
            other = Owner(workspace_id, other_id)
            assert await fitness.workouts.records(other) == []
            assert await fitness.body.measurements(other) == []
            assert await fitness.tracking.goals(other, today) == []
            overview = await fitness.overview(owner, today, "UTC")
            assert overview.week_workouts == 1 and overview.water_ml == 0
    finally:
        await database.dispose()


@pytest.mark.anyio
async def test_ai_layer_on_postgres(cloud_settings: Settings, tmp_path: Path) -> None:
    """The AI layer on PostgreSQL: settings JSON, providers and the settings' foreign keys,
    indexing with BYTEA embeddings and leased claims, hybrid retrieval, usage aggregation, and
    the proposals' conditional approval."""
    from orbit_api.repositories.ai import SqlProposalRepository
    from orbit_api.repositories.ai_services import build_ai
    from orbit_api.services.ai.configuration import ProviderDraft, SettingsChanges
    from orbit_api.services.tasks.models import TaskDraft
    from tests.ai_fakes import FakeProviderFactory

    database = await open_database(cloud_settings)
    user_id, workspace_id = uuid.uuid4(), uuid.uuid4()
    factory = FakeProviderFactory()
    settings = cloud_settings.model_copy(
        update={"attachments_path": tmp_path, "ai_allow_private_endpoints": True}
    )
    try:
        async with database.session() as session:
            await session.execute(
                text(
                    "INSERT INTO users (id, auth_provider, auth_subject, email, display_name,"
                    " created_at, updated_at) VALUES (:id, 'local', :subject, 'a@example.com', 'A',"
                    " now(), now())"
                ),
                {"id": user_id, "subject": str(user_id)},
            )
            await session.execute(
                text(
                    "INSERT INTO workspaces (id, owner_id, name, is_personal, created_at,"
                    " updated_at) VALUES (:id, :owner, 'Personal', true, now(), now())"
                ),
                {"id": workspace_id, "owner": user_id},
            )
            await session.commit()

            ai = build_ai(session, settings, factory)
            # Keyless and local, so no secret key is needed in cloud mode.
            provider = await ai.config.create_provider(
                user_id, ProviderDraft(name="Local", kind="ollama")
            )
            current = await ai.config.update_settings(
                user_id,
                SettingsChanges(
                    enabled=True,
                    chat_provider_id=provider.id,
                    chat_model="chat-model",
                    embedding_provider_id=provider.id,
                    embedding_model="embed-model",
                ),
            )
            await ai.modules.tasks.create(workspace_id, TaskDraft(title="Prepare tax documents"))
            embedder = await ai.config.embedding_provider(current, workspace_id)
            assert embedder is not None
            queued = await ai.index.reconcile(workspace_id, current.modules, embedder.embedding_key)
            assert queued.queued == 1
            run = await ai.index.process(workspace_id, embedder)
            assert run.indexed == 1
            # A claimed record can't be claimed again while leased.
            assert (await ai.index.summary(workspace_id, embedder)).counts["indexed"] == 1

            result = await ai.retriever.search(
                workspace_id, "tax paperwork", modules=current.modules, embedder=embedder
            )
            assert result.semantic and result.matches[0].ref.title == "Prepare tax documents"

            summary = await ai.usage.summary(user_id, 30, None)
            assert summary.lines[0].operation == "embedding" and summary.month_tokens > 0

            [proposal] = await ai.proposals.propose(
                workspace_id,
                user_id,
                [("create_task", {"title": "x"}, "Create task")],
            )
            repository = SqlProposalRepository(session)
            now = datetime.now().astimezone()
            assert await repository.transition(proposal.id, "pending", "rejected", now)
            assert not await repository.transition(proposal.id, "pending", "executing", now)
            await session.commit()

            await ai.config.delete_provider(user_id, provider.id)
            after = await ai.config.settings(user_id)
            assert after.chat_provider_id is None and after.embedding_model is None
    finally:
        await database.dispose()
