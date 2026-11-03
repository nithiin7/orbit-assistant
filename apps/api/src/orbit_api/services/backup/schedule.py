"""When automatic backups run.

The next run is stored, never kept in memory, so restarts lose nothing. After a run, the next
one is the previous scheduled time plus the interval, moved past `now`: a server that was off
for a week runs one backup when it starts, not seven, and then keeps its usual rhythm. A failed
run is retried an hour later (or at the next scheduled time, if that's sooner).
"""

from datetime import datetime, timedelta
from typing import Final

from dateutil.relativedelta import relativedelta

from orbit_api.services.backup.models import Frequency

RETRY_AFTER: Final = timedelta(hours=1)
# Long enough for any backup; one still "running" after this died with its process.
STALE_AFTER: Final = timedelta(hours=6)

_STEP: Final[dict[Frequency, relativedelta]] = {
    "daily": relativedelta(days=1),
    "weekly": relativedelta(weeks=1),
    "monthly": relativedelta(months=1),
}


def next_run(frequency: Frequency, scheduled: datetime | None, now: datetime) -> datetime | None:
    """The run after `scheduled` (or the first, when there was none), later than `now`."""
    step = _STEP.get(frequency)
    if step is None:
        return None
    if scheduled is None:
        return now + step
    following = scheduled + step
    while following <= now:
        following += step
    return following


def first_run(frequency: Frequency, now: datetime) -> datetime | None:
    """Turning automatic backups on runs the first one right away."""
    return None if frequency == "manual" else now


def retry_at(next_scheduled: datetime | None, now: datetime) -> datetime:
    retry = now + RETRY_AFTER
    return min(retry, next_scheduled) if next_scheduled is not None else retry
