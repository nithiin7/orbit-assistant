"""Validating and running AI action proposals with the modules' own rules.

Validation uses each module's own request schema (the same models its routes accept), so a
proposal can't hold anything the module's API would refuse. Execution calls the module's own
service, exactly as its route would. Only the allowlisted kinds exist; there is no way to run
arbitrary queries or touch other tables.
"""

import json
import uuid
from datetime import date
from decimal import Decimal
from typing import Final, Literal, cast
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from orbit_api.repositories.capture import CaptureServices
from orbit_api.schemas.bookmarks import CreateBookmarkRequest
from orbit_api.schemas.calendar import CreateEventRequest
from orbit_api.schemas.documents import UpdateDocumentRequest
from orbit_api.schemas.finance import CreateTransactionRequest, Description, TransactionDate
from orbit_api.schemas.fitness import ActivityRequest, MeasurementRequest, WaterRequest
from orbit_api.schemas.habits import CreateHabitRequest, HabitScheduleModel
from orbit_api.schemas.notes import AddNoteTagRequest, CreateNoteRequest
from orbit_api.schemas.places import CreatePlaceRequest
from orbit_api.schemas.reminders import CreateReminderRequest
from orbit_api.schemas.shopping import CreateItemRequest
from orbit_api.schemas.tasks import CreateTaskRequest
from orbit_api.schemas.watchlist import CreateWatchItemRequest
from orbit_api.services.ai.models import ActionKind, ActionResult, InvalidActionError
from orbit_api.services.bookmarks.models import (
    CollectionNotFoundError,
    DuplicateBookmarkError,
)
from orbit_api.services.calendar.models import CategoryNotFoundError as EventCategoryNotFoundError
from orbit_api.services.calendar.models import EventNoteNotFoundError, EventTaskNotFoundError
from orbit_api.services.calendar.service import CalendarService
from orbit_api.services.documents.models import DocumentNotFoundError
from orbit_api.services.documents.service import DocumentService
from orbit_api.services.finance.models import (
    AccountNotFoundError,
    CategoryNotFoundError,
    InvalidTransactionError,
    TransactionDraft,
)
from orbit_api.services.finance.money import CURRENCY_EXPONENTS
from orbit_api.services.fitness.models import ActivityKind, Owner
from orbit_api.services.notes.content import (
    NoteDocument,
    build_document,
    document_from_text,
    load_document,
)
from orbit_api.services.notes.models import (
    FolderNotFoundError,
    NoteChanges,
    NoteNotFoundError,
    RevisionConflictError,
    TooManyTagsError,
)
from orbit_api.services.notes.service import NoteService
from orbit_api.services.places.models import PlaceStatus, VisitDateError
from orbit_api.services.reminders.models import ReminderInPastError, ReminderTaskNotFoundError
from orbit_api.services.reminders.recurrence import Weekday
from orbit_api.services.reminders.service import ReminderService
from orbit_api.services.shopping.models import ShoppingListNotFoundError
from orbit_api.services.tasks.service import TaskService
from orbit_api.services.watchlist.models import (
    DuplicateTitleError,
    InvalidWatchItemError,
    WatchKind,
    WatchStatus,
)
from orbit_api.utils.clock import utc_now

MAX_TAGS: Final = 5


class _AppendToNote(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note_id: uuid.UUID
    text: str = Field(min_length=1, max_length=10_000)


class _AddNoteTags(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note_id: uuid.UUID
    tags: list[str] = Field(min_length=1, max_length=MAX_TAGS)


class _UpdateDocumentDetails(BaseModel):
    """Only descriptive fields an extraction can fill; never the file, folder, or state."""

    model_config = ConfigDict(extra="forbid")

    document_id: uuid.UUID
    provider: str | None = None
    issuing_authority: str | None = None
    reference_number: str | None = None
    issue_date: str | None = None
    effective_date: str | None = None
    expiry_date: str | None = None
    renewal_date: str | None = None


class AddShoppingItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    quantity: str | None = Field(default=None, max_length=50)
    notes: str = Field(default="", max_length=1000)
    list_name: str | None = Field(default=None, description="Defaults to the main list.")


class CreateHabit(BaseModel):
    """A yes-or-no habit: on `weekdays`, `times_per_week`, or (with neither) every day."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=1000)
    weekdays: list[Weekday] = Field(default_factory=list[Weekday])
    times_per_week: int | None = Field(default=None, ge=1, le=7)
    start_date: date | None = None


class LogWater(BaseModel):
    model_config = ConfigDict(extra="forbid")

    amount_ml: int = Field(ge=1, le=10_000)
    day: date | None = Field(default=None, description="Defaults to today.")


class LogWeight(BaseModel):
    model_config = ConfigDict(extra="forbid")

    weight_kg: float = Field(ge=1, le=650)
    day: date | None = Field(default=None, description="Defaults to today.")


class LogActivity(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: ActivityKind
    duration_minutes: int | None = Field(default=None, ge=1, le=1440)
    distance_km: float | None = Field(default=None, gt=0, le=1000)
    steps: int | None = Field(default=None, ge=1, le=200_000)
    day: date | None = Field(default=None, description="Defaults to today.")
    note: str = Field(default="", max_length=1000)


class AddTransaction(BaseModel):
    """Income or an expense, never a transfer. `amount` is in major units (450.50), so a model
    can't misplace the decimal point; Orbit converts it with the account's currency."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["expense", "income"]
    amount: Decimal = Field(gt=0, max_digits=15, decimal_places=2)
    description: Description
    occurred_on: TransactionDate | None = Field(default=None, description="Defaults to today.")
    account: str | None = Field(default=None, description="Defaults to the default account.")
    category: str | None = Field(default=None, description="An existing category's name.")
    notes: str = Field(default="", max_length=2000)


class AddPlace(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    country_code: str = Field(min_length=2, max_length=2, description="ISO 3166 alpha-2.")
    status: PlaceStatus = "want_to_visit"
    locality: str = Field(default="", max_length=200)
    visited_on: date | None = None
    note: str = Field(default="", max_length=2000)


class SaveLink(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str = Field(min_length=1, max_length=2048)
    title: str | None = Field(default=None, max_length=300)
    note: str = Field(default="", max_length=2000)
    tags: list[str] = Field(default_factory=list[str], max_length=10)


class AddWatchItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: WatchKind
    title: str = Field(min_length=1, max_length=300)
    status: WatchStatus = "want"
    platform: str | None = Field(default=None, max_length=60)
    recommended_by: str | None = Field(default=None, max_length=100)
    release_year: int | None = Field(default=None, ge=1870, le=2200)
    notes: str = Field(default="", max_length=2000)


def _today(timezone: str) -> date:
    return utc_now().astimezone(ZoneInfo(timezone)).date()


def _capture(model: BaseModel) -> dict[str, object]:
    return cast(dict[str, object], model.model_dump(mode="json", exclude_none=True))


def _habit_request(habit: CreateHabit, start: date) -> CreateHabitRequest:
    if habit.weekdays:
        schedule = HabitScheduleModel(type="weekdays", weekdays=habit.weekdays)
    elif habit.times_per_week is not None:
        schedule = HabitScheduleModel(type="weekly_target", times_per_week=habit.times_per_week)
    else:
        schedule = HabitScheduleModel(type="daily")
    return CreateHabitRequest(
        name=habit.name, description=habit.description, schedule=schedule, start_date=start
    )


def _activity_request(activity: LogActivity, day: date) -> ActivityRequest:
    return ActivityRequest(
        day=day,
        kind=activity.kind,
        steps=activity.steps,
        distance_m=round(activity.distance_km * 1000) if activity.distance_km else None,
        duration_s=activity.duration_minutes * 60 if activity.duration_minutes else None,
        note=activity.note,
    )


def _watch_request(item: AddWatchItem) -> CreateWatchItemRequest:
    return CreateWatchItemRequest(
        kind=item.kind,
        title=item.title,
        status=item.status,
        platform=item.platform,
        recommended_by=item.recommended_by,
        release_year=item.release_year,
        notes=item.notes,
    )


def _place_request(place: AddPlace) -> CreatePlaceRequest:
    return CreatePlaceRequest(
        name=place.name,
        country_code=place.country_code,
        status=place.status,
        locality=place.locality,
        visited_on=place.visited_on,
        note=place.note,
    )


def _link_request(link: SaveLink) -> CreateBookmarkRequest:
    return CreateBookmarkRequest(url=link.url, title=link.title, note=link.note, tags=link.tags)


def _clean(payload: dict[str, object]) -> dict[str, object]:
    """Drop nulls and empty strings the model used for 'not stated'."""
    return {k: v for k, v in payload.items() if v is not None and v != "" and v != "null"}


class ModuleActionValidator:
    def validate(
        self, kind: ActionKind, payload: dict[str, object], timezone: str
    ) -> tuple[dict[str, object], str]:
        try:
            return self._validate(kind, _clean(payload), timezone)
        except ValidationError:
            raise InvalidActionError("The proposed values aren't valid.") from None

    def _validate(
        self, kind: ActionKind, payload: dict[str, object], timezone: str
    ) -> tuple[dict[str, object], str]:
        match kind:
            case "create_task":
                # Models add fields of their own (a list, a status); ignore those.
                known = {"title", "description", "priority", "due_date"}
                task = CreateTaskRequest.model_validate(
                    {k: v for k, v in payload.items() if k in known}
                )
                due = f", due {task.due_date:%a %d %b}" if task.due_date else ""
                return _dump(task), f"Create task “{task.title}”{due}"
            case "create_reminder":
                payload.setdefault("timezone", timezone)
                reminder = CreateReminderRequest.model_validate(payload)
                return (
                    _dump(reminder),
                    f"Remind “{reminder.title}” on {reminder.start_date:%a %d %b} at "
                    f"{reminder.time_of_day:%H:%M}",
                )
            case "create_event":
                payload.setdefault("timezone", timezone)
                allowed = {
                    "title",
                    "start",
                    "end",
                    "timezone",
                    "all_day",
                    "description",
                    "location",
                }
                event = CreateEventRequest.model_validate(
                    {k: v for k, v in payload.items() if k in allowed}
                )
                when = (
                    f"{event.start:%a %d %b} (all day)"
                    if event.all_day
                    else f"{event.start:%a %d %b %H:%M} to {event.end:%H:%M}"
                )
                return _dump(event), f"Add event “{event.title}” on {when}"
            case "create_note":
                note = CreateNoteRequest.model_validate(
                    {"title": payload.get("title", ""), "text": payload.get("text", "")}
                )
                return _dump(note), f"Create note “{note.title or 'Untitled'}”"
            case "append_to_note":
                append = _AppendToNote.model_validate(payload)
                document_from_text(append.text)
                return _dump(append), "Add text to the end of a note"
            case "add_note_tags":
                tags = _AddNoteTags.model_validate(payload)
                names = [AddNoteTagRequest(name=t).name for t in tags.tags]
                return (
                    {"note_id": str(tags.note_id), "tags": names},
                    "Tag the note: " + ", ".join(names),
                )
            case "update_document_details":
                details = _UpdateDocumentDetails.model_validate(payload)
                fields = details.model_dump(exclude={"document_id"}, exclude_none=True)
                if not fields:
                    raise InvalidActionError("Nothing to change.")
                UpdateDocumentRequest.model_validate(fields)
                labels = ", ".join(k.replace("_", " ") for k in fields)
                return (
                    {"document_id": str(details.document_id), **fields},
                    f"Fill in the document's {labels}",
                )
            case "add_shopping_item":
                item = AddShoppingItem.model_validate(payload)
                CreateItemRequest(name=item.name, quantity=item.quantity, notes=item.notes)
                where = f"“{item.list_name}”" if item.list_name else "your shopping list"
                return _capture(item), f"Add “{item.name}” to {where}"
            case "create_habit":
                habit = CreateHabit.model_validate(payload)
                start = habit.start_date or _today(timezone)
                _habit_request(habit, start)
                return (
                    _capture(habit.model_copy(update={"start_date": start})),
                    f"Start the habit “{habit.name}”",
                )
            case "log_water":
                water = LogWater.model_validate(payload)
                day = water.day or _today(timezone)
                WaterRequest(day=day, amount_ml=water.amount_ml)
                return (
                    _capture(water.model_copy(update={"day": day})),
                    f"Log {water.amount_ml} ml of water on {day:%a %d %b}",
                )
            case "log_weight":
                weight = LogWeight.model_validate(payload)
                day = weight.day or _today(timezone)
                MeasurementRequest(day=day, weight_g=round(weight.weight_kg * 1000))
                return (
                    _capture(weight.model_copy(update={"day": day})),
                    f"Log a weight of {weight.weight_kg:g} kg on {day:%a %d %b}",
                )
            case "log_activity":
                activity = LogActivity.model_validate(payload)
                day = activity.day or _today(timezone)
                _activity_request(activity, day)
                return (
                    _capture(activity.model_copy(update={"day": day})),
                    f"Log {activity.kind.replace('_', ' ')} on {day:%a %d %b}",
                )
            case "add_transaction":
                entry = AddTransaction.model_validate(payload)
                day = entry.occurred_on or _today(timezone)
                account = f"“{entry.account}”" if entry.account else "your default account"
                return (
                    _capture(entry.model_copy(update={"occurred_on": day})),
                    f"Record {entry.type} of {entry.amount:f} for “{entry.description}” on "
                    f"{day:%a %d %b}, in {account}",
                )
            case "add_place":
                place = AddPlace.model_validate(payload)
                request = _place_request(place)
                return _capture(place), f"Add “{request.name}” to your places"
            case "save_link":
                link = SaveLink.model_validate(payload)
                request = _link_request(link)
                return _capture(link), f"Save the link {link.title or request.url}"
            case "add_watch_item":
                watch = AddWatchItem.model_validate(payload)
                _watch_request(watch)
                return _capture(watch), f"Add “{watch.title}” to your watchlist"


def _dump(model: BaseModel) -> dict[str, object]:
    return cast(dict[str, object], model.model_dump(mode="json", exclude_unset=True))


class ModuleActionExecutor:
    def __init__(
        self,
        *,
        tasks: TaskService,
        reminders: ReminderService,
        calendar: CalendarService,
        notes: NoteService,
        documents: DocumentService,
        capture: CaptureServices,
    ) -> None:
        self._tasks = tasks
        self._reminders = reminders
        self._calendar = calendar
        self._notes = notes
        self._documents = documents
        self._capture = capture

    async def execute(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        kind: ActionKind,
        payload: dict[str, object],
        timezone: str | None,
    ) -> ActionResult:
        try:
            return await self._execute(workspace_id, user_id, kind, payload, timezone)
        except DuplicateBookmarkError:
            raise InvalidActionError("That link is already saved.") from None
        except DuplicateTitleError:
            raise InvalidActionError("That title is already on your watchlist.") from None
        except VisitDateError:
            raise InvalidActionError("Only a visited place can have a visit date.") from None
        except ShoppingListNotFoundError:
            raise InvalidActionError("That shopping list no longer exists.") from None
        except (AccountNotFoundError, CategoryNotFoundError, CollectionNotFoundError):
            raise InvalidActionError("A linked record no longer exists.") from None
        except InvalidTransactionError as exc:
            raise InvalidActionError(str(exc) or "The transaction isn't valid.") from None
        except InvalidWatchItemError:
            raise InvalidActionError("The title's details aren't valid.") from None
        except ValidationError:
            raise InvalidActionError("The proposed values aren't valid.") from None
        except (NoteNotFoundError, DocumentNotFoundError):
            raise InvalidActionError("The record no longer exists.") from None
        except ReminderInPastError:
            raise InvalidActionError("That time has already passed.") from None
        except RevisionConflictError:
            raise InvalidActionError("The note changed since this was proposed.") from None
        except TooManyTagsError:
            raise InvalidActionError("The note has as many tags as it can hold.") from None
        except (
            ReminderTaskNotFoundError,
            EventCategoryNotFoundError,
            EventNoteNotFoundError,
            EventTaskNotFoundError,
            FolderNotFoundError,
        ):
            raise InvalidActionError("A linked record no longer exists.") from None
        except ValueError as exc:
            # The modules' invalid-value errors (times, schedules) carry safe messages.
            raise InvalidActionError(str(exc) or "The proposed values aren't valid.") from None

    async def _execute(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        kind: ActionKind,
        payload: dict[str, object],
        timezone: str | None,
    ) -> ActionResult:
        capture = self._capture
        owner = Owner(workspace_id=workspace_id, user_id=user_id)
        zone = timezone or "UTC"
        match kind:
            case "create_task":
                task = await self._tasks.create(
                    workspace_id, CreateTaskRequest.model_validate(payload).to_draft()
                )
                return ActionResult(kind="task", id=task.id, title=task.title)
            case "create_reminder":
                view = await self._reminders.create(
                    workspace_id,
                    CreateReminderRequest.model_validate(payload).to_draft(),
                    default_timezone=timezone,
                )
                return ActionResult(kind="reminder", id=view.reminder.id, title=view.reminder.title)
            case "create_event":
                detail = await self._calendar.create_event(
                    workspace_id,
                    CreateEventRequest.model_validate(payload).to_draft(),
                    default_timezone=timezone,
                )
                return ActionResult(kind="event", id=detail.event.id, title=detail.event.title)
            case "create_note":
                note = await self._notes.create(
                    workspace_id, CreateNoteRequest.model_validate(payload).to_draft()
                )
                return ActionResult(
                    kind="note", id=note.note.id, title=note.note.title or "Untitled note"
                )
            case "append_to_note":
                append = _AppendToNote.model_validate(payload)
                note = await self._notes.get(workspace_id, append.note_id)
                document = _appended(note.content, append.text)
                detail = await self._notes.update(
                    workspace_id,
                    note.id,
                    NoteChanges(document=document, expected_revision=note.revision),
                )
                return ActionResult(
                    kind="note", id=detail.note.id, title=detail.note.title or "Untitled note"
                )
            case "add_note_tags":
                tags = _AddNoteTags.model_validate(payload)
                note = await self._notes.get(workspace_id, tags.note_id)
                for name in tags.tags:
                    await self._notes.add_tag(workspace_id, note.id, name)
                return ActionResult(kind="note", id=note.id, title=note.title or "Untitled note")
            case "update_document_details":
                details = _UpdateDocumentDetails.model_validate(payload)
                fields = details.model_dump(exclude={"document_id"}, exclude_none=True)
                changes = UpdateDocumentRequest.model_validate(fields).to_changes()
                document = await self._documents.update(workspace_id, details.document_id, changes)
                return ActionResult(kind="document", id=document.id, title=document.title)
            case "add_shopping_item":
                wanted = AddShoppingItem.model_validate(payload)
                list_id = await self._shopping_list(workspace_id, wanted.list_name)
                item = await capture.shopping.add_item(
                    workspace_id,
                    list_id,
                    CreateItemRequest(
                        name=wanted.name, quantity=wanted.quantity, notes=wanted.notes
                    ).to_draft(),
                )
                return ActionResult(kind="shopping_item", id=item.id, title=item.name)
            case "create_habit":
                habit = CreateHabit.model_validate(payload)
                created = await capture.habits.create(
                    workspace_id,
                    _habit_request(habit, habit.start_date or _today(zone)).to_draft(),
                    default_timezone=timezone,
                )
                saved = created.progress.habit
                return ActionResult(kind="habit", id=saved.id, title=saved.name)
            case "log_water":
                water = LogWater.model_validate(payload)
                day = water.day or _today(zone)
                logged = await capture.fitness.nutrition.add_water(owner, day, water.amount_ml)
                entry = logged.entries[-1]
                return ActionResult(kind="water", id=entry.id, title=f"{water.amount_ml} ml")
            case "log_weight":
                weight = LogWeight.model_validate(payload)
                request = MeasurementRequest(
                    day=weight.day or _today(zone), weight_g=round(weight.weight_kg * 1000)
                )
                measurement = await capture.fitness.body.add_measurement(owner, request.to_draft())
                return ActionResult(
                    kind="measurement", id=measurement.id, title=f"{weight.weight_kg:g} kg"
                )
            case "log_activity":
                activity = LogActivity.model_validate(payload)
                added = await capture.fitness.tracking.add_activity(
                    owner, _activity_request(activity, activity.day or _today(zone)).to_draft()
                )
                return ActionResult(
                    kind="activity", id=added.id, title=activity.kind.replace("_", " ")
                )
            case "add_transaction":
                entry = AddTransaction.model_validate(payload)
                recorded = await capture.finance.create(
                    workspace_id, await self._transaction_request(workspace_id, entry, zone)
                )
                return ActionResult(kind="transaction", id=recorded.id, title=recorded.description)
            case "add_place":
                place = await capture.places.add(
                    workspace_id, _place_request(AddPlace.model_validate(payload)).to_draft()
                )
                return ActionResult(kind="place", id=place.id, title=place.name)
            case "save_link":
                bookmark = await capture.bookmarks.add(
                    workspace_id, _link_request(SaveLink.model_validate(payload)).to_draft()
                )
                return ActionResult(kind="bookmark", id=bookmark.id, title=bookmark.title)
            case "add_watch_item":
                title = await capture.watchlist.add(
                    workspace_id, _watch_request(AddWatchItem.model_validate(payload)).to_draft()
                )
                return ActionResult(kind="watch_item", id=title.id, title=title.title)

    async def _shopping_list(self, workspace_id: uuid.UUID, name: str | None) -> uuid.UUID:
        """The list called `name`, or the default list when no name was given."""
        lists = [e.shopping_list for e in await self._capture.shopping.overview(workspace_id)]
        if name is None:
            return next(item.id for item in lists if item.is_default)
        wanted = name.strip().casefold()
        for shopping_list in lists:
            if shopping_list.name.casefold() == wanted:
                return shopping_list.id
        raise InvalidActionError(f"There's no shopping list called “{name.strip()}”.")

    async def _transaction_request(
        self, workspace_id: uuid.UUID, entry: AddTransaction, timezone: str
    ) -> TransactionDraft:
        """The draft for `entry`: its account and category found by name, its amount in the
        account's minor unit. Never guesses between several accounts."""
        finance = self._capture.finance
        accounts = [
            view.account
            for view in await finance.accounts(workspace_id)
            if view.account.archived_at is None
        ]
        if entry.account is not None:
            wanted = entry.account.strip().casefold()
            account = next((a for a in accounts if a.name.casefold() == wanted), None)
            if account is None:
                raise InvalidActionError(f"There's no account called “{entry.account.strip()}”.")
        else:
            account = next((a for a in accounts if a.is_default), None)
            if account is None and len(accounts) == 1:
                account = accounts[0]
            if account is None:
                raise InvalidActionError("Say which account this belongs to.")
        scale = Decimal(10) ** CURRENCY_EXPONENTS[account.currency]
        minor = entry.amount * scale
        if minor != minor.to_integral_value():
            raise InvalidActionError(f"{account.currency} amounts can't have that many decimals.")
        category_id: uuid.UUID | None = None
        if entry.category is not None:
            wanted = entry.category.strip().casefold()
            category_id = next(
                (
                    c.id
                    for c in await finance.categories(workspace_id)
                    if c.type == entry.type and c.name.casefold() == wanted
                ),
                None,
            )
        return CreateTransactionRequest(
            type=entry.type,
            amount=int(minor),
            occurred_on=entry.occurred_on or _today(timezone),
            description=entry.description,
            account_id=account.id,
            category_id=category_id,
            notes=entry.notes,
        ).to_draft()


def _appended(content: str, text: str) -> NoteDocument:
    """The note's document with `text` added as paragraphs at the end."""
    existing = load_document(content)
    current = cast(dict[str, object], json.loads(existing.json))
    added = cast(dict[str, object], json.loads(document_from_text(text).json))
    nodes = cast(list[object], current.get("content") or []) + cast(
        list[object], added.get("content") or []
    )
    return build_document({"type": "doc", "content": nodes})
