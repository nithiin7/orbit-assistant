"""Transaction boundary shared by services."""

from typing import Protocol


class ConflictError(Exception):
    """A write violated a uniqueness constraint, for example because of a concurrent request."""


class Transaction(Protocol):
    """Commits or discards the current unit of work. Raises `ConflictError` on conflicts."""

    async def commit(self) -> None: ...

    async def rollback(self) -> None: ...
