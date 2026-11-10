"""Unit tests for the task service, using an in-memory repository and a fixed clock."""

import uuid
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta

import pytest

from orbit_api.services.tasks.models import (
    MAX_TASK_LISTS,
    Task,
    TaskChanges,
    TaskDraft,
    TaskList,
    TaskListChanges,
    TaskListNameTakenError,
    TaskListNotFoundError,
    TaskListOverview,
    TaskNotFoundError,
    TaskPage,
    TaskQuery,
    TaskSummary,
    TooManyTaskListsError,
)
from orbit_api.services.tasks.service import TaskService
from tests.test_account_service import FakeTransaction

pytestmark = pytest.mark.anyio

WORKSPACE = uuid.uuid4()
OTHER_WORKSPACE = uuid.uuid4()


class FakeTasks:
    def __init__(self) -> None:
        self.items: dict[uuid.UUID, Task] = {}
        self.task_lists: dict[uuid.UUID, TaskList] = {}
        self.saves = 0

    async def add(self, task: Task) -> None:
        self.items[task.id] = task

    async def get(self, workspace_id: uuid.UUID, task_id: uuid.UUID) -> Task | None:
        task = self.items.get(task_id)
        return task if task and task.workspace_id == workspace_id else None

    async def find(self, workspace_id: uuid.UUID, query: TaskQuery) -> TaskPage:
        tasks = [t for t in self.items.values() if t.workspace_id == workspace_id]
        return TaskPage(tasks=tasks, total=len(tasks))

    async def save(self, task: Task) -> None:
        self.saves += 1
        self.items[task.id] = task

    async def delete(self, workspace_id: uuid.UUID, task_id: uuid.UUID) -> bool:
        if await self.get(workspace_id, task_id) is None:
            return False
        del self.items[task_id]
        return True

    async def summarize(self, workspace_id: uuid.UUID, today: date) -> TaskSummary:
        raise NotImplementedError

    async def lists(self, workspace_id: uuid.UUID) -> list[TaskListOverview]:
        own = [entry for entry in self.task_lists.values() if entry.workspace_id == workspace_id]
        return [
            TaskListOverview(
                task_list=entry,
                open=sum(
                    1
                    for task in self.items.values()
                    if task.list_id == entry.id and task.status == "open"
                ),
            )
            for entry in sorted(own, key=lambda entry: entry.position)
        ]

    async def get_list(self, workspace_id: uuid.UUID, list_id: uuid.UUID) -> TaskList | None:
        entry = self.task_lists.get(list_id)
        return entry if entry and entry.workspace_id == workspace_id else None

    async def add_list(self, task_list: TaskList) -> None:
        self.task_lists[task_list.id] = task_list

    async def save_list(self, task_list: TaskList) -> None:
        self.task_lists[task_list.id] = task_list

    async def delete_list(self, workspace_id: uuid.UUID, list_id: uuid.UUID) -> bool:
        if await self.get_list(workspace_id, list_id) is None:
            return False
        for task in list(self.items.values()):
            if task.list_id == list_id:
                self.items[task.id] = replace(task, list_id=None)
        del self.task_lists[list_id]
        return True


class Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 10, 29, 9, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now

    def advance(self) -> datetime:
        self.now += timedelta(minutes=5)
        return self.now


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def repository() -> FakeTasks:
    return FakeTasks()


@pytest.fixture
def transaction() -> FakeTransaction:
    return FakeTransaction()


@pytest.fixture
def service(repository: FakeTasks, transaction: FakeTransaction, clock: Clock) -> TaskService:
    return TaskService(repository, transaction, clock=clock)


async def test_create_opens_a_task_in_the_workspace(
    service: TaskService, transaction: FakeTransaction, clock: Clock
) -> None:
    task = await service.create(WORKSPACE, TaskDraft(title="Plan", priority="high"))

    assert task.workspace_id == WORKSPACE
    assert (task.status, task.completed_at) == ("open", None)
    assert task.created_at == task.updated_at == clock.now
    assert transaction.commits == 1


async def test_complete_records_the_time_and_reopen_clears_it(
    service: TaskService, clock: Clock
) -> None:
    task = await service.create(WORKSPACE, TaskDraft(title="Plan"))
    completed_at = clock.advance()

    completed = await service.complete(WORKSPACE, task.id)
    assert (completed.status, completed.completed_at) == ("completed", completed_at)
    assert completed.updated_at == completed_at

    clock.advance()
    assert await service.complete(WORKSPACE, task.id) == completed

    reopened = await service.reopen(WORKSPACE, task.id)
    assert (reopened.status, reopened.completed_at) == ("open", None)


async def test_update_applies_only_the_given_changes(
    service: TaskService, clock: Clock, repository: FakeTasks
) -> None:
    task = await service.create(
        WORKSPACE, TaskDraft(title="Plan", description="Notes", due_date=date(2026, 11, 1))
    )
    clock.advance()

    updated = await service.update(WORKSPACE, task.id, TaskChanges(title="Plan B", due_date=None))

    assert updated == replace(task, title="Plan B", due_date=None, updated_at=clock.now)
    assert repository.items[task.id] == updated


async def test_changes_that_change_nothing_are_not_saved(
    service: TaskService, repository: FakeTasks, transaction: FakeTransaction
) -> None:
    task = await service.create(WORKSPACE, TaskDraft(title="Plan"))

    assert await service.update(WORKSPACE, task.id, TaskChanges(title="Plan")) == task
    assert await service.reopen(WORKSPACE, task.id) == task
    assert (repository.saves, transaction.commits) == (0, 1)


async def test_tasks_are_not_found_from_another_workspace(
    service: TaskService, repository: FakeTasks
) -> None:
    task = await service.create(WORKSPACE, TaskDraft(title="Plan"))

    with pytest.raises(TaskNotFoundError):
        await service.get(OTHER_WORKSPACE, task.id)
    with pytest.raises(TaskNotFoundError):
        await service.update(OTHER_WORKSPACE, task.id, TaskChanges(title="Mine"))
    with pytest.raises(TaskNotFoundError):
        await service.complete(OTHER_WORKSPACE, task.id)
    with pytest.raises(TaskNotFoundError):
        await service.delete(OTHER_WORKSPACE, task.id)
    assert repository.items[task.id] == task


async def test_delete_commits_only_when_a_task_was_deleted(
    service: TaskService, transaction: FakeTransaction
) -> None:
    task = await service.create(WORKSPACE, TaskDraft(title="Plan"))

    await service.delete(WORKSPACE, task.id)
    with pytest.raises(TaskNotFoundError):
        await service.delete(WORKSPACE, task.id)

    assert transaction.commits == 2


async def test_list_names_are_unique_ignoring_case_and_spacing(service: TaskService) -> None:
    work = await service.create_list(WORKSPACE, "Side  project", "blue")

    with pytest.raises(TaskListNameTakenError):
        await service.create_list(WORKSPACE, "side project", "green")
    other = await service.create_list(WORKSPACE, "Home", "green")
    with pytest.raises(TaskListNameTakenError):
        await service.update_list(WORKSPACE, other.id, TaskListChanges(name="SIDE PROJECT"))
    # Renaming a list to a new spelling of its own name is fine, and so is the same name in
    # another workspace.
    renamed = await service.update_list(WORKSPACE, work.id, TaskListChanges(name="Side Project"))
    assert renamed.name == "Side Project"
    assert (await service.create_list(OTHER_WORKSPACE, "Side project", "blue")).name


async def test_new_lists_go_last(service: TaskService) -> None:
    first = await service.create_list(WORKSPACE, "Work", "blue")
    second = await service.create_list(WORKSPACE, "Home", "green")

    assert (first.position, second.position) == (0, 1)
    assert [e.task_list.name for e in await service.lists(WORKSPACE)] == ["Work", "Home"]


async def test_a_workspace_has_a_limited_number_of_lists(service: TaskService) -> None:
    for index in range(MAX_TASK_LISTS):
        await service.create_list(WORKSPACE, f"List {index}", "blue")

    with pytest.raises(TooManyTaskListsError):
        await service.create_list(WORKSPACE, "One more", "blue")


async def test_tasks_only_go_on_lists_in_their_workspace(service: TaskService) -> None:
    elsewhere = await service.create_list(OTHER_WORKSPACE, "Work", "blue")
    task = await service.create(WORKSPACE, TaskDraft(title="Plan"))

    with pytest.raises(TaskListNotFoundError):
        await service.create(WORKSPACE, TaskDraft(title="Plan", list_id=elsewhere.id))
    with pytest.raises(TaskListNotFoundError):
        await service.update(WORKSPACE, task.id, TaskChanges(list_id=elsewhere.id))
    with pytest.raises(TaskListNotFoundError):
        await service.delete_list(WORKSPACE, elsewhere.id)


async def test_deleting_a_list_keeps_its_tasks(service: TaskService, repository: FakeTasks) -> None:
    work = await service.create_list(WORKSPACE, "Work", "blue")
    task = await service.create(WORKSPACE, TaskDraft(title="Plan", list_id=work.id))
    assert [e.open for e in await service.lists(WORKSPACE)] == [1]

    await service.delete_list(WORKSPACE, work.id)

    assert repository.items[task.id].list_id is None
    assert await service.lists(WORKSPACE) == []
