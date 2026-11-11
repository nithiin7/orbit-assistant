"""Places: where you've been and where you want to go, for a world map of your travels.

Offline by default. A place needs only a name and a country, which is enough to shade the
country on the map. With online maps on (Settings → Places), the browser loads map tiles and the
server looks up search phrases with a geocoder, so places get a pin; only the phrase leaves the
server.

Every method takes a `workspace_id` that the caller has already authorized (the `WorkspaceDep`
API dependency does this), and repositories filter every query by it.
"""

import uuid
from collections.abc import Callable
from dataclasses import replace
from datetime import datetime
from typing import Protocol

from orbit_api.services.places.models import (
    OnlineMapsOffError,
    Place,
    PlaceChanges,
    PlaceDraft,
    PlaceMatch,
    PlaceNotFoundError,
    VisitDateError,
)
from orbit_api.services.transactions import Transaction
from orbit_api.utils.changes import UNSET
from orbit_api.utils.clock import utc_now


class PlaceRepository(Protocol):
    async def all(self, workspace_id: uuid.UUID) -> list[Place]:
        """Every place in the workspace, newest first."""
        ...

    async def get(self, workspace_id: uuid.UUID, place_id: uuid.UUID) -> Place | None:
        """The place, only if it belongs to `workspace_id`."""
        ...

    async def add(self, place: Place) -> None: ...

    async def save(self, place: Place) -> None:
        """Store an existing place's fields. Matches on both its ID and workspace."""
        ...

    async def delete(self, workspace_id: uuid.UUID, place_id: uuid.UUID) -> bool:
        """Delete the place if it belongs to `workspace_id`; report whether it existed."""
        ...


class PlaceSettings(Protocol):
    async def online_maps(self, workspace_id: uuid.UUID) -> bool: ...

    async def set_online_maps(self, workspace_id: uuid.UUID, enabled: bool) -> None: ...


class Geocoder(Protocol):
    """Looks up places by name. Raises `PlaceSearchError` when it can't."""

    async def search(self, query: str) -> list[PlaceMatch]: ...


class PlaceService:
    def __init__(
        self,
        places: PlaceRepository,
        settings: PlaceSettings,
        transaction: Transaction,
        geocoder: Geocoder,
        *,
        online_maps_allowed: bool,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._places = places
        self._settings = settings
        self._transaction = transaction
        self._geocoder = geocoder
        self._online_allowed = online_maps_allowed
        self._clock = clock

    # Places

    async def places(self, workspace_id: uuid.UUID) -> list[Place]:
        return await self._places.all(workspace_id)

    async def get(self, workspace_id: uuid.UUID, place_id: uuid.UUID) -> Place:
        place = await self._places.get(workspace_id, place_id)
        if place is None:
            raise PlaceNotFoundError
        return place

    async def add(self, workspace_id: uuid.UUID, draft: PlaceDraft) -> Place:
        """Add a place. Raises `VisitDateError` for a visit date on a place not yet visited."""
        if draft.status != "visited" and draft.visited_on is not None:
            raise VisitDateError
        now = self._clock()
        place = Place(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            name=draft.name,
            locality=draft.locality,
            country_code=draft.country_code,
            location=draft.location,
            status=draft.status,
            visited_on=draft.visited_on,
            favorite=draft.favorite,
            note=draft.note,
            created_at=now,
            updated_at=now,
        )
        await self._places.add(place)
        await self._transaction.commit()
        return place

    async def update(
        self, workspace_id: uuid.UUID, place_id: uuid.UUID, changes: PlaceChanges
    ) -> Place:
        """Change some of a place's fields. Moving it to `want_to_visit` clears its visit date;
        setting a date on a place that isn't visited raises `VisitDateError`."""
        place = await self.get(workspace_id, place_id)
        status = place.status if changes.status is UNSET else changes.status
        visited_on = place.visited_on if changes.visited_on is UNSET else changes.visited_on
        if status != "visited":
            if changes.visited_on is not UNSET and changes.visited_on is not None:
                raise VisitDateError
            visited_on = None
        updated = replace(
            place,
            name=place.name if changes.name is UNSET else changes.name,
            locality=place.locality if changes.locality is UNSET else changes.locality,
            country_code=place.country_code
            if changes.country_code is UNSET
            else changes.country_code,
            location=place.location if changes.location is UNSET else changes.location,
            status=status,
            visited_on=visited_on,
            favorite=place.favorite if changes.favorite is UNSET else changes.favorite,
            note=place.note if changes.note is UNSET else changes.note,
        )
        if updated == place:
            return place
        updated = replace(updated, updated_at=self._clock())
        await self._places.save(updated)
        await self._transaction.commit()
        return updated

    async def delete(self, workspace_id: uuid.UUID, place_id: uuid.UUID) -> None:
        if not await self._places.delete(workspace_id, place_id):
            raise PlaceNotFoundError
        await self._transaction.commit()

    # Online maps and place search

    @property
    def online_maps_allowed(self) -> bool:
        """Whether the server lets workspaces turn online maps on."""
        return self._online_allowed

    async def online_maps(self, workspace_id: uuid.UUID) -> bool:
        """Whether online maps are on for this workspace (and allowed on this server)."""
        return self._online_allowed and await self._settings.online_maps(workspace_id)

    async def set_online_maps(self, workspace_id: uuid.UUID, enabled: bool) -> bool:
        """Turn online maps on or off. Raises `OnlineMapsOffError` when turning them on on a
        server that doesn't allow them."""
        if enabled and not self._online_allowed:
            raise OnlineMapsOffError
        await self._settings.set_online_maps(workspace_id, enabled)
        await self._transaction.commit()
        return enabled

    async def search(self, workspace_id: uuid.UUID, query: str) -> list[PlaceMatch]:
        """Look a place up by name. Raises `OnlineMapsOffError` unless online maps are on."""
        if not await self.online_maps(workspace_id):
            raise OnlineMapsOffError
        return await self._geocoder.search(query)
