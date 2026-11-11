"""Places and their settings. Every query is filtered by workspace, so callers cannot reach other
workspaces' rows."""

import uuid
from typing import Any, cast

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.models import PlaceModel, PlaceSettingsModel
from orbit_api.repositories.transaction import flush
from orbit_api.services.places.models import Location, Place, PlaceStatus


def _to_place(model: PlaceModel) -> Place:
    location = (
        Location(latitude=model.latitude, longitude=model.longitude)
        if model.latitude is not None and model.longitude is not None
        else None
    )
    return Place(
        id=model.id,
        workspace_id=model.workspace_id,
        name=model.name,
        locality=model.locality,
        country_code=model.country_code,
        location=location,
        # The table's CHECK constraint limits `status` to these values.
        status=cast(PlaceStatus, model.status),
        visited_on=model.visited_on,
        favorite=model.favorite,
        note=model.note,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _fields(place: Place) -> dict[str, Any]:
    """The columns a place's fields set, apart from its identity."""
    return {
        "name": place.name,
        "locality": place.locality,
        "country_code": place.country_code,
        "latitude": place.location.latitude if place.location else None,
        "longitude": place.location.longitude if place.location else None,
        "status": place.status,
        "visited_on": place.visited_on,
        "favorite": place.favorite,
        "note": place.note,
        "updated_at": place.updated_at,
    }


class SqlPlaceRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def all(self, workspace_id: uuid.UUID) -> list[Place]:
        models = await self._session.scalars(
            select(PlaceModel)
            .where(PlaceModel.workspace_id == workspace_id)
            .order_by(PlaceModel.created_at.desc(), PlaceModel.id)
        )
        return [_to_place(model) for model in models]

    async def get(self, workspace_id: uuid.UUID, place_id: uuid.UUID) -> Place | None:
        model = await self._get_model(workspace_id, place_id)
        return None if model is None else _to_place(model)

    async def add(self, place: Place) -> None:
        self._session.add(
            PlaceModel(
                id=place.id,
                workspace_id=place.workspace_id,
                created_at=place.created_at,
                **_fields(place),
            )
        )
        await flush(self._session)

    async def save(self, place: Place) -> None:
        model = await self._get_model(place.workspace_id, place.id)
        if model is None:
            return
        for name, value in _fields(place).items():
            setattr(model, name, value)
        await flush(self._session)

    async def delete(self, workspace_id: uuid.UUID, place_id: uuid.UUID) -> bool:
        deleted = await self._session.scalars(
            delete(PlaceModel)
            .where(PlaceModel.id == place_id, PlaceModel.workspace_id == workspace_id)
            .returning(PlaceModel.id)
        )
        return deleted.first() is not None

    async def _get_model(self, workspace_id: uuid.UUID, place_id: uuid.UUID) -> PlaceModel | None:
        return await self._session.scalar(
            select(PlaceModel).where(
                PlaceModel.id == place_id, PlaceModel.workspace_id == workspace_id
            )
        )


class SqlPlaceSettings:
    """A workspace's Places settings; no row means online maps are off."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def online_maps(self, workspace_id: uuid.UUID) -> bool:
        model = await self._session.get(PlaceSettingsModel, workspace_id)
        return model is not None and model.online_maps

    async def set_online_maps(self, workspace_id: uuid.UUID, enabled: bool) -> None:
        model = await self._session.get(PlaceSettingsModel, workspace_id)
        if model is None:
            self._session.add(PlaceSettingsModel(workspace_id=workspace_id, online_maps=enabled))
        else:
            model.online_maps = enabled
        await flush(self._session)
