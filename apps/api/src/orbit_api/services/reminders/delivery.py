"""Delivering due reminder occurrences as in-app notifications.

A worker (`orbit_api.scheduler`) claims due occurrences, then hands each claim to
`ReminderDelivery` in a transaction of its own. The guarantees, and what provides them:

- **Durable:** occurrences are database rows, so pending work survives restarts.
- **No duplicates:** a claim is a lease (`claim_token`, `claimed_until`) taken by one atomic
  conditional update, so concurrent workers never claim the same occurrence at once. Delivery
  first re-confirms the claim, then writes the notification, marks the occurrence `delivered`,
  and schedules the next occurrence in one transaction. A worker whose lease expired and was
  taken over finds its claim gone and writes nothing. As a last line of defence, the database
  allows one notification per occurrence and recipient.
- **Recovery:** a worker that dies mid-delivery leaves its occurrence `processing`; once the lease
  expires, any worker claims it again. Its transaction rolled back, so nothing was half-written.
- **Retries:** a failed attempt returns the occurrence to `pending` with exponential backoff. After
  `max_attempts` it becomes `failed`, which is kept for inspection (`orbit-worker status`) and
  can be retried (`orbit-worker retry-failed`). The reminder's next occurrence is still scheduled.
- **Late delivery:** an occurrence delivered late (the worker was stopped) is delivered once;
  missed occurrences of a recurring reminder are not replayed, and the next one is the first
  after both the delivered occurrence and the present.
"""

import uuid
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Literal, Protocol

from orbit_api.services.notifications.models import Notification
from orbit_api.services.reminders.models import (
    ClaimedOccurrence,
    DeliveryOutcome,
    DeliveryTarget,
    Reminder,
)
from orbit_api.services.reminders.service import OccurrenceScheduler, schedule_next
from orbit_api.services.transactions import Transaction

DEFAULT_MAX_ATTEMPTS = 5
RETRY_BASE_DELAY = timedelta(seconds=30)
RETRY_MAX_DELAY = timedelta(minutes=30)

# `skipped`: the claim was lost (taken over after its lease expired, or the reminder was deleted),
# so this worker did nothing.
DeliveryResult = Literal["delivered", "cancelled", "retrying", "failed", "skipped"]


class DeliveryOccurrences(OccurrenceScheduler, Protocol):
    async def confirm_claim(self, occurrence_id: uuid.UUID, claim_token: uuid.UUID) -> bool:
        """Whether the claim is still held. Also locks the occurrence for this transaction."""
        ...

    async def finish(
        self,
        occurrence_id: uuid.UUID,
        claim_token: uuid.UUID,
        outcome: DeliveryOutcome,
        now: datetime,
        error: str | None = None,
    ) -> bool:
        """Record a final outcome, only while the claim is held; report whether it was."""
        ...

    async def release(
        self,
        occurrence_id: uuid.UUID,
        claim_token: uuid.UUID,
        available_at: datetime,
        error: str,
    ) -> bool:
        """Return a claimed occurrence to `pending` for another attempt at `available_at`."""
        ...


class DeliveryReminders(Protocol):
    async def get_for_delivery(self, reminder_id: uuid.UUID) -> DeliveryTarget | None:
        """The reminder, its task's state, and its recipients, locked for this transaction."""
        ...

    async def record_outcome(
        self, reminder_id: uuid.UUID, occurrence_at: datetime, outcome: DeliveryOutcome
    ) -> None: ...


class NotificationWriter(Protocol):
    async def add(self, notification: Notification) -> None: ...


def retry_delay(attempts: int) -> timedelta:
    """Exponential backoff after the `attempts`-th failed attempt: 30 s, 1 min, 2 min, …"""
    return min(RETRY_BASE_DELAY * 2 ** max(attempts - 1, 0), RETRY_MAX_DELAY)


class ReminderDelivery:
    def __init__(
        self,
        reminders: DeliveryReminders,
        occurrences: DeliveryOccurrences,
        notifications: NotificationWriter,
        transaction: Transaction,
        clock: Callable[[], datetime],
        max_attempts: int = DEFAULT_MAX_ATTEMPTS,
    ) -> None:
        self._reminders = reminders
        self._occurrences = occurrences
        self._notifications = notifications
        self._transaction = transaction
        self._clock = clock
        self._max_attempts = max_attempts

    async def deliver(self, claim: ClaimedOccurrence) -> DeliveryResult:
        """Deliver one claimed occurrence. Exceptions propagate with nothing committed; pass the
        claim to `record_failure` in a fresh transaction."""
        if not await self._occurrences.confirm_claim(claim.id, claim.claim_token):
            await self._transaction.rollback()
            return "skipped"
        if claim.attempts > self._max_attempts:
            # Claimed again after a worker died mid-delivery too often; stop trying.
            await self._transaction.rollback()
            return await self.record_failure(claim, "MaxAttemptsExceeded")

        target = await self._reminders.get_for_delivery(claim.reminder_id)
        if target is None:
            await self._transaction.rollback()
            return "skipped"
        reminder = target.reminder
        now = self._clock()

        outcome: DeliveryOutcome
        if not reminder.enabled or target.task_completed:
            outcome = "cancelled"
        else:
            outcome = "delivered"
            for recipient in target.recipients:
                await self._notifications.add(_notification(reminder, claim, recipient, now))
        await self._finish(claim, reminder, outcome, now)
        await self._transaction.commit()
        return outcome

    async def record_failure(self, claim: ClaimedOccurrence, error: str) -> DeliveryResult:
        """Schedule another attempt, or give up after `max_attempts`. `error` is a short,
        content-free description such as an exception's class name."""
        now = self._clock()
        if claim.attempts < self._max_attempts:
            released = await self._occurrences.release(
                claim.id, claim.claim_token, now + retry_delay(claim.attempts), error
            )
            if not released:
                await self._transaction.rollback()
                return "skipped"
            await self._transaction.commit()
            return "retrying"

        if not await self._occurrences.finish(claim.id, claim.claim_token, "failed", now, error):
            await self._transaction.rollback()
            return "skipped"
        target = await self._reminders.get_for_delivery(claim.reminder_id)
        if target is not None:
            await self._reminders.record_outcome(claim.reminder_id, claim.scheduled_for, "failed")
            await schedule_next(
                self._occurrences, target.reminder, max(claim.scheduled_for, now), now
            )
        await self._transaction.commit()
        return "failed"

    async def _finish(
        self,
        claim: ClaimedOccurrence,
        reminder: Reminder,
        outcome: DeliveryOutcome,
        now: datetime,
    ) -> None:
        if not await self._occurrences.finish(claim.id, claim.claim_token, outcome, now):
            # Confirmed at the start of this transaction, which still holds the lock.
            raise RuntimeError("The occurrence's claim was lost during delivery.")
        await self._reminders.record_outcome(reminder.id, claim.scheduled_for, outcome)
        # Skip occurrences missed while no worker ran: the next is after both this one and now.
        await schedule_next(self._occurrences, reminder, max(claim.scheduled_for, now), now)


def _notification(
    reminder: Reminder, claim: ClaimedOccurrence, recipient: uuid.UUID, now: datetime
) -> Notification:
    return Notification(
        id=uuid.uuid4(),
        user_id=recipient,
        workspace_id=reminder.workspace_id,
        reminder_id=reminder.id,
        occurrence_id=claim.id,
        title=reminder.title,
        body=reminder.description,
        scheduled_for=claim.scheduled_for,
        created_at=now,
        read_at=None,
    )
