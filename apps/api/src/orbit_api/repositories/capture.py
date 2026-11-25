"""The module services behind the assistant's and agent's quick-capture actions.

Built on the caller's transaction: the assistant commits as each module's route would, while the
agent passes a flush-only transaction so a write commits together with the step recording it.

Capture only stores what the person said, so nothing here reaches the network: the adapters
these services need for lookups and previews refuse every call.
"""

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.config import Settings
from orbit_api.repositories.bookmarks import SqlBookmarkRepository, SqlBookmarkSettings
from orbit_api.repositories.finance import (
    SqlFinanceAccountRepository,
    SqlFinanceCategoryRepository,
    SqlFinanceTransactionRepository,
)
from orbit_api.repositories.fitness import build_fitness
from orbit_api.repositories.habits import build_habit_service
from orbit_api.repositories.people import SqlPeopleStore
from orbit_api.repositories.places import SqlPlaceRepository, SqlPlaceSettings
from orbit_api.repositories.reminders import SqlOccurrenceRepository, SqlReminderRepository
from orbit_api.repositories.shopping import SqlShoppingItemRepository, SqlShoppingListRepository
from orbit_api.repositories.watchlist import SqlLookupSettings, SqlWatchItemRepository
from orbit_api.services.bookmarks.models import FetchedPage, PreviewFetchError
from orbit_api.services.bookmarks.service import BookmarkService
from orbit_api.services.finance.service import FinanceService
from orbit_api.services.fitness.overview import Fitness
from orbit_api.services.habits.service import HabitService
from orbit_api.services.people.service import PeopleService
from orbit_api.services.places.models import PlaceMatch, PlaceSearchError
from orbit_api.services.places.service import PlaceService
from orbit_api.services.shopping.service import ShoppingService
from orbit_api.services.transactions import Transaction
from orbit_api.services.watchlist.models import CatalogError
from orbit_api.services.watchlist.service import TitleCatalog, WatchlistService
from orbit_api.system.attachment_store import FileAttachmentStore
from orbit_api.system.secrets import FernetSecretBox


class _NoGeocoder:
    async def search(self, query: str) -> list[PlaceMatch]:
        raise PlaceSearchError


class _NoLinkFetcher:
    async def page(self, url: str) -> FetchedPage:
        raise PreviewFetchError

    async def image(self, url: str, max_bytes: int) -> bytes:
        raise PreviewFetchError


class _NoCatalogs:
    def catalog(self, api_key: str) -> TitleCatalog:
        raise CatalogError


@dataclass(frozen=True, slots=True)
class CaptureServices:
    shopping: ShoppingService
    habits: HabitService
    finance: FinanceService
    fitness: Fitness
    places: PlaceService
    bookmarks: BookmarkService
    watchlist: WatchlistService
    people: PeopleService


def build_capture_services(
    session: AsyncSession, settings: Settings, transaction: Transaction
) -> CaptureServices:
    files = FileAttachmentStore(settings.attachments_dir)
    return CaptureServices(
        shopping=ShoppingService(
            SqlShoppingListRepository(session), SqlShoppingItemRepository(session), transaction
        ),
        habits=build_habit_service(session, transaction=transaction),
        finance=FinanceService(
            SqlFinanceAccountRepository(session),
            SqlFinanceCategoryRepository(session),
            SqlFinanceTransactionRepository(session),
            transaction,
        ),
        fitness=build_fitness(session, files, transaction=transaction),
        places=PlaceService(
            SqlPlaceRepository(session),
            SqlPlaceSettings(session),
            transaction,
            _NoGeocoder(),
            online_maps_allowed=False,
        ),
        bookmarks=BookmarkService(
            SqlBookmarkRepository(session),
            transaction,
            SqlBookmarkSettings(session),
            files,
            _NoLinkFetcher(),
        ),
        watchlist=WatchlistService(
            SqlWatchItemRepository(session),
            SqlLookupSettings(session),
            files,
            transaction,
            FernetSecretBox.from_settings(settings),
            _NoCatalogs(),
        ),
        people=PeopleService(
            SqlPeopleStore(session),
            SqlReminderRepository(session),
            SqlOccurrenceRepository(session),
            transaction,
        ),
    )
