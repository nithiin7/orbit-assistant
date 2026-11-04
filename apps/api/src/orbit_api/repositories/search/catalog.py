"""What universal search searches: one `EntitySource` per record type, grouped by module.

Adding a record type is one declaration here; nothing else in search changes. Each source's
`scope` repeats its module's own authorization rule: the workspace for every module, plus the
owner for health records, which are personal. Trashed notes and documents are never searched.

Previews are deliberately narrow. Hits never carry amounts, balances, prices, or measurement
values; finance notes, document notes, issuers, providers, file names, and reference numbers can
match (or, for reference numbers and custom fields, are not searched at all) but never appear in
a snippet. A match on them shows only which field matched.
"""

from collections.abc import Callable
from datetime import date, datetime, time, timedelta
from typing import Any, Final

from sqlalchemy import ColumnElement, and_, case, exists, literal, or_, select

from orbit_api.db.models import (
    CalendarCategoryModel,
    CalendarEventAlertModel,
    CalendarEventExceptionModel,
    CalendarEventModel,
    DocumentCategoryModel,
    DocumentFolderModel,
    DocumentModel,
    DocumentTagModel,
    FinanceAccountModel,
    FinanceAssetModel,
    FinanceBudgetModel,
    FinanceCategoryModel,
    FinanceDepositModel,
    FinanceHoldingModel,
    FinanceLoanModel,
    FinanceRecurringPaymentModel,
    FinanceSavingsGoalModel,
    FinanceTransactionModel,
    FitnessExerciseModel,
    FitnessGoalModel,
    FitnessMeasurementModel,
    FitnessSessionExerciseModel,
    FitnessSessionModel,
    FitnessTemplateModel,
    HabitCategoryModel,
    HabitModel,
    NoteFolderModel,
    NoteModel,
    NoteTagAssignmentModel,
    NoteTagModel,
    ReminderModel,
    RoutineModel,
    RoutineStepModel,
    TaskModel,
)
from orbit_api.repositories.search.sources import (
    AnySelect,
    DescribeContext,
    Description,
    EntitySource,
    Row,
    SearchField,
    day_start,
    details,
    text_field,
)
from orbit_api.services.calendar.recurrence import rule_from_json, starts_between
from orbit_api.services.search.universal_models import SearchScope, UniversalModule
from orbit_api.utils.text_search import LIKE_ESCAPE

_PRIORITY_RANKS: Final = {"none": 0, "low": 1, "medium": 2, "high": 3}
_PRIORITY_NAMES: Final = {rank: name for name, rank in _PRIORITY_RANKS.items()}


# Tasks


def _describe_task(row: Row, _context: DescribeContext) -> Description:
    priority = _PRIORITY_NAMES.get(row["priority"], "none")
    return Description(details=details(("priority", "" if priority == "none" else priority)))


TASK = EntitySource(
    module="tasks",
    entity_type="task",
    table=TaskModel,
    id=TaskModel.id,
    title=TaskModel.title,
    updated_at=TaskModel.updated_at,
    created_at=TaskModel.created_at,
    status=TaskModel.status,
    scope=lambda scope: [TaskModel.workspace_id == scope.workspace_id],
    fields=(text_field("description", "description", TaskModel.description),),
    active=TaskModel.status == "open",
    day=TaskModel.due_date,
    filters={
        "task_status": lambda f: TaskModel.status == f.task_status,
        "task_priority": lambda f: TaskModel.priority.in_(
            [_PRIORITY_RANKS[p] for p in f.task_priorities]
        ),
    },
    columns={"priority": TaskModel.priority},
    describe=_describe_task,
)


# Notes


def _note_tags(pattern: str) -> ColumnElement[bool]:
    return exists(
        select(NoteTagAssignmentModel.note_id)
        .join(
            NoteTagModel,
            and_(
                NoteTagModel.id == NoteTagAssignmentModel.tag_id,
                NoteTagModel.workspace_id == NoteTagAssignmentModel.workspace_id,
            ),
        )
        .where(
            NoteTagAssignmentModel.note_id == NoteModel.id,
            NoteTagModel.name.ilike(pattern, escape=LIKE_ESCAPE),
        )
    )


def _join_note_folder(statement: AnySelect) -> AnySelect:
    return statement.outerjoin(
        NoteFolderModel,
        and_(
            NoteFolderModel.id == NoteModel.folder_id,
            NoteFolderModel.workspace_id == NoteModel.workspace_id,
        ),
    )


NOTE = EntitySource(
    module="notes",
    entity_type="note",
    table=NoteModel,
    id=NoteModel.id,
    title=NoteModel.title,
    updated_at=NoteModel.updated_at,
    created_at=NoteModel.created_at,
    status=NoteModel.note_type,
    scope=lambda scope: [
        NoteModel.workspace_id == scope.workspace_id,
        NoteModel.trashed_at.is_(None),
    ],
    fields=(
        SearchField("tags", "metadata", _note_tags),
        text_field("folder", "metadata", NoteFolderModel.name),
        # A locked note's text is neither matched nor shown; its title still is.
        text_field(
            "content",
            "content",
            case((NoteModel.is_locked, literal("")), else_=NoteModel.plain_text),
        ),
    ),
    active=NoteModel.archived_at.is_(None),
    archived=NoteModel.archived_at.is_not(None),
    joins=_join_note_folder,
    day=NoteModel.journal_date,
    columns={"folder_name": NoteFolderModel.name},
    describe=lambda row, _c: Description(details=details(("folder", row["folder_name"]))),
)


# Calendar


def _event_overrides(pattern: str) -> ColumnElement[bool]:
    """A changed occurrence of a series whose own title, description, or place matches."""
    exception = CalendarEventExceptionModel
    return exists(
        select(exception.id).where(
            exception.event_id == CalendarEventModel.id,
            exception.workspace_id == CalendarEventModel.workspace_id,
            exception.kind == "modified",
            or_(
                exception.title.ilike(pattern, escape=LIKE_ESCAPE),
                exception.description.ilike(pattern, escape=LIKE_ESCAPE),
                exception.location.ilike(pattern, escape=LIKE_ESCAPE),
            ),
        )
    )


def _events_between(start: date | None, end: date | None) -> ColumnElement[bool]:
    """Series with an occurrence that may fall in the days, like the calendar's own range
    query: starting before the range ends and not ending before it starts (UTC days)."""
    conditions: list[ColumnElement[bool]] = []
    if end is not None:
        conditions.append(CalendarEventModel.start_at < day_start(end + timedelta(days=1)))
    if start is not None:
        conditions.append(
            or_(
                CalendarEventModel.until_at.is_(None),
                CalendarEventModel.until_at >= day_start(start),
            )
        )
    return and_(*conditions)


# How far ahead a recurring event's next occurrence is looked for.
_OCCURRENCE_HORIZON: Final = timedelta(days=400)


def _describe_event(row: Row, context: DescribeContext) -> Description:
    """A one-off event shows its own date; a series shows its next occurrence from the filter's
    start (or today), so opening it lands on a day that has it."""
    start: datetime = row["start_local"]
    all_day = bool(row["all_day"])
    rule = rule_from_json(row["recurrence"])
    if rule is not None:
        reference = datetime.combine(context.date_from or context.today, time())
        after = max(start, reference)
        upcoming = starts_between(rule, start, after, after + _OCCURRENCE_HORIZON)
        if upcoming:
            start = upcoming[0]
    facts = details(
        ("location", row["location"]),
        ("category", row["category_name"]),
        ("repeats", "yes" if rule is not None else ""),
    )
    return Description(
        details=facts, day=start.date(), starts_at=None if all_day else start, all_day=all_day
    )


EVENT = EntitySource(
    module="calendar",
    entity_type="event",
    table=CalendarEventModel,
    id=CalendarEventModel.id,
    title=CalendarEventModel.title,
    updated_at=CalendarEventModel.updated_at,
    created_at=CalendarEventModel.created_at,
    status=CalendarEventModel.status,
    scope=lambda scope: [CalendarEventModel.workspace_id == scope.workspace_id],
    fields=(
        text_field("location", "metadata", CalendarEventModel.location),
        text_field("category", "metadata", CalendarCategoryModel.name),
        text_field("description", "description", CalendarEventModel.description),
        SearchField("occurrence", "metadata", _event_overrides),
    ),
    active=CalendarEventModel.status == "confirmed",
    joins=lambda statement: statement.outerjoin(
        CalendarCategoryModel,
        and_(
            CalendarCategoryModel.id == CalendarEventModel.category_id,
            CalendarCategoryModel.workspace_id == CalendarEventModel.workspace_id,
        ),
    ),
    date_range=_events_between,
    columns={
        "start_local": CalendarEventModel.start_local,
        "all_day": CalendarEventModel.all_day,
        "recurrence": CalendarEventModel.recurrence,
        "location": CalendarEventModel.location,
        "category_name": CalendarCategoryModel.name,
    },
    describe=_describe_event,
)


# Reminders

_ReminderTask = TaskModel.__table__.alias("reminder_task")
_ReminderAlert = CalendarEventAlertModel.__table__.alias("reminder_alert")
_ReminderEvent = CalendarEventModel.__table__.alias("reminder_event")


def _join_reminder_subjects(statement: AnySelect) -> AnySelect:
    return (
        statement.outerjoin(
            _ReminderTask,
            and_(
                _ReminderTask.c.id == ReminderModel.task_id,
                _ReminderTask.c.workspace_id == ReminderModel.workspace_id,
            ),
        )
        .outerjoin(
            _ReminderAlert,
            and_(
                _ReminderAlert.c.id == ReminderModel.calendar_event_alert_id,
                _ReminderAlert.c.workspace_id == ReminderModel.workspace_id,
            ),
        )
        .outerjoin(
            _ReminderEvent,
            and_(
                _ReminderEvent.c.id == _ReminderAlert.c.event_id,
                _ReminderEvent.c.workspace_id == ReminderModel.workspace_id,
            ),
        )
    )


REMINDER = EntitySource(
    module="reminders",
    entity_type="reminder",
    table=ReminderModel,
    id=ReminderModel.id,
    title=ReminderModel.title,
    updated_at=ReminderModel.updated_at,
    created_at=ReminderModel.created_at,
    status=case((ReminderModel.enabled, literal("enabled")), else_=literal("disabled")),
    scope=lambda scope: [ReminderModel.workspace_id == scope.workspace_id],
    fields=(
        text_field("description", "description", ReminderModel.description),
        text_field("task", "metadata", _ReminderTask.c.title),
        text_field("event", "metadata", _ReminderEvent.c.title),
    ),
    active=ReminderModel.enabled,
    joins=_join_reminder_subjects,
    day=ReminderModel.start_date,
    columns={
        "enabled": ReminderModel.enabled,
        # JSON `null` may be stored as text, so the check happens after loading.
        "recurrence": ReminderModel.recurrence,
        "task_title": _ReminderTask.c.title,
        "event_title": _ReminderEvent.c.title,
    },
    describe=lambda row, _c: Description(
        details=details(
            ("task", row["task_title"]),
            ("event", row["event_title"]),
            ("repeats", "yes" if row["recurrence"] is not None else ""),
            ("enabled", "" if row["enabled"] else "no"),
        )
    ),
)


# Finance. Hits carry names, types, and dates only: never amounts, balances, or prices.
# Notes are searched but never previewed.

Scope = Callable[[SearchScope], list[ColumnElement[bool]]]


def _workspace(model: Any) -> Scope:
    def scope(scope: SearchScope) -> list[ColumnElement[bool]]:
        return [model.workspace_id == scope.workspace_id]

    return scope


ACCOUNT = EntitySource(
    module="finance",
    entity_type="account",
    table=FinanceAccountModel,
    id=FinanceAccountModel.id,
    title=FinanceAccountModel.name,
    updated_at=FinanceAccountModel.updated_at,
    created_at=FinanceAccountModel.created_at,
    status=FinanceAccountModel.type,
    scope=_workspace(FinanceAccountModel),
    fields=(text_field("notes", "description", FinanceAccountModel.notes, preview=False),),
    active=FinanceAccountModel.archived_at.is_(None),
    archived=FinanceAccountModel.archived_at.is_not(None),
    columns={"currency": FinanceAccountModel.currency},
    describe=lambda row, _c: Description(details=details(("currency", row["currency"]))),
)

_TransactionAccount = FinanceAccountModel.__table__.alias("transaction_account")
_TransactionCategory = FinanceCategoryModel.__table__.alias("transaction_category")


def _join_transaction_labels(statement: AnySelect) -> AnySelect:
    return statement.outerjoin(
        _TransactionAccount,
        and_(
            _TransactionAccount.c.id == FinanceTransactionModel.account_id,
            _TransactionAccount.c.workspace_id == FinanceTransactionModel.workspace_id,
        ),
    ).outerjoin(
        _TransactionCategory,
        and_(
            _TransactionCategory.c.id == FinanceTransactionModel.category_id,
            _TransactionCategory.c.workspace_id == FinanceTransactionModel.workspace_id,
        ),
    )


TRANSACTION = EntitySource(
    module="finance",
    entity_type="transaction",
    table=FinanceTransactionModel,
    id=FinanceTransactionModel.id,
    # The description is the payee or merchant line; there is no separate payee field.
    title=FinanceTransactionModel.description,
    updated_at=FinanceTransactionModel.updated_at,
    created_at=FinanceTransactionModel.created_at,
    status=FinanceTransactionModel.type,
    scope=_workspace(FinanceTransactionModel),
    fields=(
        text_field("category", "metadata", _TransactionCategory.c.name),
        text_field("account", "metadata", _TransactionAccount.c.name),
        text_field("notes", "description", FinanceTransactionModel.notes, preview=False),
    ),
    joins=_join_transaction_labels,
    day=FinanceTransactionModel.occurred_on,
    filters={
        "transaction_type": lambda f: FinanceTransactionModel.type.in_(f.transaction_types),
    },
    columns={
        "account_name": _TransactionAccount.c.name,
        "category_name": _TransactionCategory.c.name,
    },
    describe=lambda row, _c: Description(
        details=details(("account", row["account_name"]), ("category", row["category_name"]))
    ),
)

LOAN = EntitySource(
    module="finance",
    entity_type="loan",
    table=FinanceLoanModel,
    id=FinanceLoanModel.id,
    title=FinanceLoanModel.name,
    updated_at=FinanceLoanModel.updated_at,
    created_at=FinanceLoanModel.created_at,
    status=FinanceLoanModel.status,
    scope=_workspace(FinanceLoanModel),
    fields=(
        text_field("lender", "metadata", FinanceLoanModel.lender),
        text_field("notes", "description", FinanceLoanModel.notes, preview=False),
    ),
    active=FinanceLoanModel.status == "active",
    archived=FinanceLoanModel.status == "archived",
    columns={"lender": FinanceLoanModel.lender, "loan_type": FinanceLoanModel.loan_type},
    describe=lambda row, _c: Description(
        details=details(("lender", row["lender"]), ("loan_type", row["loan_type"]))
    ),
)


def _recurring(kind: str) -> EntitySource:
    model = FinanceRecurringPaymentModel
    return EntitySource(
        module="finance",
        entity_type="subscription" if kind == "subscription" else "bill",
        table=model,
        id=model.id,
        title=model.name,
        updated_at=model.updated_at,
        created_at=model.created_at,
        status=model.state,
        scope=lambda scope: [model.workspace_id == scope.workspace_id, model.kind == kind],
        fields=(
            text_field("provider", "metadata", model.provider),
            text_field("notes", "description", model.notes, preview=False),
        ),
        active=model.state == "active",
        columns={"provider": model.provider, "frequency": model.frequency},
        describe=lambda row, _c: Description(
            details=details(("provider", row["provider"]), ("frequency", row["frequency"]))
        ),
    )


SUBSCRIPTION = _recurring("subscription")
BILL = _recurring("bill")

_HoldingAccount = FinanceAccountModel.__table__.alias("holding_account")

HOLDING = EntitySource(
    module="finance",
    entity_type="holding",
    table=FinanceHoldingModel,
    id=FinanceHoldingModel.id,
    title=FinanceHoldingModel.name,
    updated_at=FinanceHoldingModel.updated_at,
    created_at=FinanceHoldingModel.created_at,
    status=FinanceHoldingModel.kind,
    scope=_workspace(FinanceHoldingModel),
    fields=(
        text_field("symbol", "metadata", FinanceHoldingModel.symbol),
        text_field("isin", "metadata", FinanceHoldingModel.isin),
        text_field("issuer", "metadata", FinanceHoldingModel.issuer),
        text_field("category", "metadata", FinanceHoldingModel.category),
        text_field("account", "metadata", _HoldingAccount.c.name),
        text_field("notes", "description", FinanceHoldingModel.notes, preview=False),
    ),
    joins=lambda statement: statement.outerjoin(
        _HoldingAccount,
        and_(
            _HoldingAccount.c.id == FinanceHoldingModel.account_id,
            _HoldingAccount.c.workspace_id == FinanceHoldingModel.workspace_id,
        ),
    ),
    columns={
        "symbol": FinanceHoldingModel.symbol,
        "account_name": _HoldingAccount.c.name,
        "account_id": FinanceHoldingModel.account_id,
    },
    describe=lambda row, _c: Description(
        details=details(("symbol", row["symbol"]), ("account", row["account_name"])),
        parent_id=row["account_id"],
    ),
)

DEPOSIT = EntitySource(
    module="finance",
    entity_type="deposit",
    table=FinanceDepositModel,
    id=FinanceDepositModel.id,
    title=FinanceDepositModel.name,
    updated_at=FinanceDepositModel.updated_at,
    created_at=FinanceDepositModel.created_at,
    status=FinanceDepositModel.status,
    scope=_workspace(FinanceDepositModel),
    fields=(
        text_field("institution", "metadata", FinanceDepositModel.institution),
        text_field("notes", "description", FinanceDepositModel.notes, preview=False),
    ),
    active=FinanceDepositModel.status == "active",
    day=FinanceDepositModel.maturity_date,
    columns={"institution": FinanceDepositModel.institution, "kind": FinanceDepositModel.kind},
    describe=lambda row, _c: Description(
        details=details(("institution", row["institution"]), ("deposit_kind", row["kind"]))
    ),
)

ASSET = EntitySource(
    module="finance",
    entity_type="asset",
    table=FinanceAssetModel,
    id=FinanceAssetModel.id,
    title=FinanceAssetModel.name,
    updated_at=FinanceAssetModel.updated_at,
    created_at=FinanceAssetModel.created_at,
    status=FinanceAssetModel.category,
    scope=_workspace(FinanceAssetModel),
    fields=(
        text_field("category", "metadata", FinanceAssetModel.category),
        text_field("notes", "description", FinanceAssetModel.notes, preview=False),
    ),
    active=FinanceAssetModel.archived_at.is_(None),
    archived=FinanceAssetModel.archived_at.is_not(None),
)

BUDGET = EntitySource(
    module="finance",
    entity_type="budget",
    table=FinanceBudgetModel,
    id=FinanceBudgetModel.id,
    title=FinanceBudgetModel.name,
    updated_at=FinanceBudgetModel.updated_at,
    created_at=FinanceBudgetModel.created_at,
    status=FinanceBudgetModel.state,
    scope=_workspace(FinanceBudgetModel),
    fields=(text_field("notes", "description", FinanceBudgetModel.notes, preview=False),),
    active=FinanceBudgetModel.state == "active",
    archived=FinanceBudgetModel.state == "archived",
    columns={"period": FinanceBudgetModel.period},
    describe=lambda row, _c: Description(details=details(("period", row["period"]))),
)

SAVINGS_GOAL = EntitySource(
    module="finance",
    entity_type="savings_goal",
    table=FinanceSavingsGoalModel,
    id=FinanceSavingsGoalModel.id,
    title=FinanceSavingsGoalModel.name,
    updated_at=FinanceSavingsGoalModel.updated_at,
    created_at=FinanceSavingsGoalModel.created_at,
    status=FinanceSavingsGoalModel.state,
    scope=_workspace(FinanceSavingsGoalModel),
    fields=(
        text_field("category", "metadata", FinanceSavingsGoalModel.category),
        text_field("description", "description", FinanceSavingsGoalModel.description),
        text_field("notes", "description", FinanceSavingsGoalModel.notes, preview=False),
    ),
    active=FinanceSavingsGoalModel.state == "active",
    day=FinanceSavingsGoalModel.target_date,
)


# Habits

HABIT = EntitySource(
    module="habits",
    entity_type="habit",
    table=HabitModel,
    id=HabitModel.id,
    title=HabitModel.name,
    updated_at=HabitModel.updated_at,
    created_at=HabitModel.created_at,
    status=HabitModel.status,
    scope=_workspace(HabitModel),
    fields=(
        text_field("category", "metadata", HabitCategoryModel.name),
        text_field("description", "description", HabitModel.description),
    ),
    active=HabitModel.status == "active",
    archived=HabitModel.status == "archived",
    joins=lambda statement: statement.outerjoin(
        HabitCategoryModel,
        and_(
            HabitCategoryModel.id == HabitModel.category_id,
            HabitCategoryModel.workspace_id == HabitModel.workspace_id,
        ),
    ),
    filters={"habit_kind": lambda f: HabitModel.kind.in_(f.habit_kinds)},
    columns={"habit_kind": HabitModel.kind, "category_name": HabitCategoryModel.name},
    describe=lambda row, _c: Description(
        details=details(("habit_kind", row["habit_kind"]), ("category", row["category_name"]))
    ),
)


def _routine_steps(pattern: str) -> ColumnElement[bool]:
    return exists(
        select(RoutineStepModel.id).where(
            RoutineStepModel.routine_id == RoutineModel.id,
            RoutineStepModel.workspace_id == RoutineModel.workspace_id,
            or_(
                RoutineStepModel.name.ilike(pattern, escape=LIKE_ESCAPE),
                RoutineStepModel.description.ilike(pattern, escape=LIKE_ESCAPE),
            ),
        )
    )


ROUTINE = EntitySource(
    module="habits",
    entity_type="routine",
    table=RoutineModel,
    id=RoutineModel.id,
    title=RoutineModel.name,
    updated_at=RoutineModel.updated_at,
    created_at=RoutineModel.created_at,
    status=RoutineModel.status,
    scope=_workspace(RoutineModel),
    fields=(
        text_field("description", "description", RoutineModel.description),
        SearchField("steps", "content", _routine_steps),
    ),
    active=RoutineModel.status == "active",
    archived=RoutineModel.status == "archived",
)


# Documents. Reference numbers and custom fields are not searched, and file contents never are
# (there is no text extraction for search, and no OCR).


def _document_tags(pattern: str) -> ColumnElement[bool]:
    return exists(
        select(DocumentTagModel.document_id).where(
            DocumentTagModel.document_id == DocumentModel.id,
            DocumentTagModel.name.ilike(pattern, escape=LIKE_ESCAPE),
        )
    )


def _join_document_labels(statement: AnySelect) -> AnySelect:
    return statement.outerjoin(
        DocumentCategoryModel,
        and_(
            DocumentCategoryModel.id == DocumentModel.category_id,
            DocumentCategoryModel.workspace_id == DocumentModel.workspace_id,
        ),
    ).outerjoin(
        DocumentFolderModel,
        and_(
            DocumentFolderModel.id == DocumentModel.folder_id,
            DocumentFolderModel.workspace_id == DocumentModel.workspace_id,
        ),
    )


DOCUMENT = EntitySource(
    module="documents",
    entity_type="document",
    table=DocumentModel,
    id=DocumentModel.id,
    title=DocumentModel.title,
    updated_at=DocumentModel.updated_at,
    created_at=DocumentModel.created_at,
    status=case(
        (DocumentModel.archived_at.is_not(None), literal("archived")), else_=literal("active")
    ),
    scope=lambda scope: [
        DocumentModel.workspace_id == scope.workspace_id,
        DocumentModel.trashed_at.is_(None),
    ],
    fields=(
        text_field("category", "metadata", DocumentCategoryModel.name),
        text_field("folder", "metadata", DocumentFolderModel.name),
        SearchField("tags", "metadata", _document_tags),
        text_field("file_name", "metadata", DocumentModel.file_name, preview=False),
        text_field("issuer", "metadata", DocumentModel.issuing_authority, preview=False),
        text_field("provider", "metadata", DocumentModel.provider, preview=False),
        text_field("description", "description", DocumentModel.description),
        text_field("notes", "description", DocumentModel.notes, preview=False),
    ),
    active=DocumentModel.archived_at.is_(None),
    archived=DocumentModel.archived_at.is_not(None),
    joins=_join_document_labels,
    day=DocumentModel.expiry_date,
    filters={
        "document_category": lambda f: DocumentModel.category_id == f.document_category_id,
    },
    columns={
        "category_name": DocumentCategoryModel.name,
        "folder_name": DocumentFolderModel.name,
    },
    describe=lambda row, _c: Description(
        details=details(("category", row["category_name"]), ("folder", row["folder_name"]))
    ),
)


# Health. Personal: every source is scoped to the signed-in person as well as the workspace,
# exactly like the health module's own repository. No measurement values or nutrition numbers.


def _owned(model: Any) -> Scope:
    def scope(scope: SearchScope) -> list[ColumnElement[bool]]:
        return [model.workspace_id == scope.workspace_id, model.user_id == scope.user_id]

    return scope


EXERCISE = EntitySource(
    module="health",
    entity_type="exercise",
    table=FitnessExerciseModel,
    id=FitnessExerciseModel.id,
    title=FitnessExerciseModel.name,
    updated_at=FitnessExerciseModel.updated_at,
    created_at=FitnessExerciseModel.created_at,
    status=FitnessExerciseModel.category,
    scope=_owned(FitnessExerciseModel),
    fields=(
        text_field("category", "metadata", FitnessExerciseModel.category),
        text_field("equipment", "metadata", FitnessExerciseModel.equipment),
        text_field("description", "description", FitnessExerciseModel.description),
        text_field("instructions", "content", FitnessExerciseModel.instructions),
    ),
    active=FitnessExerciseModel.archived_at.is_(None),
    archived=FitnessExerciseModel.archived_at.is_not(None),
    columns={"equipment": FitnessExerciseModel.equipment},
    describe=lambda row, _c: Description(details=details(("equipment", row["equipment"]))),
)


def _session_exercises(pattern: str) -> ColumnElement[bool]:
    return exists(
        select(FitnessSessionExerciseModel.id).where(
            FitnessSessionExerciseModel.session_id == FitnessSessionModel.id,
            FitnessSessionExerciseModel.workspace_id == FitnessSessionModel.workspace_id,
            FitnessSessionExerciseModel.exercise_name.ilike(pattern, escape=LIKE_ESCAPE),
        )
    )


WORKOUT = EntitySource(
    module="health",
    entity_type="workout",
    table=FitnessSessionModel,
    id=FitnessSessionModel.id,
    title=FitnessSessionModel.name,
    updated_at=FitnessSessionModel.updated_at,
    created_at=FitnessSessionModel.created_at,
    status=FitnessSessionModel.status,
    scope=_owned(FitnessSessionModel),
    fields=(
        text_field("notes", "description", FitnessSessionModel.notes),
        SearchField("exercises", "content", _session_exercises),
    ),
    active=FitnessSessionModel.status != "abandoned",
    day=FitnessSessionModel.day,
)

WORKOUT_TEMPLATE = EntitySource(
    module="health",
    entity_type="workout_template",
    table=FitnessTemplateModel,
    id=FitnessTemplateModel.id,
    title=FitnessTemplateModel.name,
    updated_at=FitnessTemplateModel.updated_at,
    created_at=FitnessTemplateModel.created_at,
    status=FitnessTemplateModel.category,
    scope=_owned(FitnessTemplateModel),
    fields=(
        text_field("category", "metadata", FitnessTemplateModel.category),
        text_field("description", "description", FitnessTemplateModel.description),
        text_field("notes", "description", FitnessTemplateModel.notes),
    ),
    active=FitnessTemplateModel.archived_at.is_(None),
    archived=FitnessTemplateModel.archived_at.is_not(None),
)

FITNESS_GOAL = EntitySource(
    module="health",
    entity_type="fitness_goal",
    table=FitnessGoalModel,
    id=FitnessGoalModel.id,
    title=FitnessGoalModel.name,
    updated_at=FitnessGoalModel.updated_at,
    created_at=FitnessGoalModel.created_at,
    status=FitnessGoalModel.status,
    scope=_owned(FitnessGoalModel),
    fields=(
        text_field("category", "metadata", FitnessGoalModel.category),
        text_field("description", "description", FitnessGoalModel.description),
    ),
    active=FitnessGoalModel.status == "active",
    day=FitnessGoalModel.target_date,
)

MEASUREMENT = EntitySource(
    module="health",
    entity_type="measurement",
    table=FitnessMeasurementModel,
    id=FitnessMeasurementModel.id,
    # Measurements have no title; only their note is searched, and the web shows a label.
    title=literal(""),
    updated_at=FitnessMeasurementModel.updated_at,
    created_at=FitnessMeasurementModel.created_at,
    status=literal("measurement"),
    scope=_owned(FitnessMeasurementModel),
    fields=(text_field("note", "description", FitnessMeasurementModel.note),),
    day=FitnessMeasurementModel.day,
)


SOURCES: Final[dict[UniversalModule, tuple[EntitySource, ...]]] = {
    "tasks": (TASK,),
    "notes": (NOTE,),
    "calendar": (EVENT,),
    "reminders": (REMINDER,),
    "finance": (
        ACCOUNT,
        TRANSACTION,
        LOAN,
        SUBSCRIPTION,
        BILL,
        HOLDING,
        DEPOSIT,
        ASSET,
        BUDGET,
        SAVINGS_GOAL,
    ),
    "habits": (HABIT, ROUTINE),
    "documents": (DOCUMENT,),
    "health": (EXERCISE, WORKOUT, WORKOUT_TEMPLATE, FITNESS_GOAL, MEASUREMENT),
}
