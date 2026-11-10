"""Episode progress through a series, given what is known of its seasons."""

from collections.abc import Sequence

from orbit_api.services.watchlist.models import Progress


def next_episode(current: Progress | None, seasons: Sequence[int] | None) -> Progress:
    """The episode after `current`: the next one in the season, or the first of the next season
    once the season's episode count is reached. Without season counts episodes just count up.
    The last episode of a known series stays where it is."""
    if current is None:
        return Progress(season=1, episode=1)
    if not seasons or current.season > len(seasons):
        return Progress(season=current.season, episode=current.episode + 1)
    if current.episode < seasons[current.season - 1]:
        return Progress(season=current.season, episode=current.episode + 1)
    if current.season < len(seasons):
        return Progress(season=current.season + 1, episode=1)
    return current


def is_finale(progress: Progress | None, seasons: Sequence[int] | None) -> bool:
    """Whether `progress` is the series' last known episode."""
    if progress is None or not seasons:
        return False
    return progress.season == len(seasons) and progress.episode >= seasons[-1]


def last_episode(seasons: Sequence[int] | None) -> Progress | None:
    """The series' last known episode, for marking it watched."""
    if not seasons or seasons[-1] < 1:
        return None
    return Progress(season=len(seasons), episode=seasons[-1])


def fits(progress: Progress, seasons: Sequence[int] | None) -> bool:
    """Whether `progress` names an episode that exists, when the seasons are known."""
    if not seasons:
        return True
    return progress.season <= len(seasons) and progress.episode <= seasons[progress.season - 1]
