"""Body measurements, BMI, and progress photos.

- Measurements are dated entries with any subset of values; editing replaces an entry,
  deleting removes it, and every other entry is kept as history.
- BMI uses the latest weight and the latest height (from a measurement, else the profile), and
  only when both are plausible. It isn't stored, and no body-fat figure is ever estimated.
- Photos reuse the attachment store that note attachments and documents use. The file is
  written first and its metadata saved after, so a failed save deletes the file; deleting a
  photo deletes its file after the metadata commits. Only PNG, JPEG, and WebP images whose bytes
  match their extension are accepted, and they're served only to their owner.
"""

import uuid
from collections.abc import Callable, Sequence
from dataclasses import replace
from datetime import date, datetime
from pathlib import Path
from typing import Protocol

from orbit_api.services.fitness.calculations import bmi
from orbit_api.services.fitness.models import (
    Bmi,
    FitnessNotFoundError,
    InvalidFitnessError,
    Measurement,
    MeasurementDraft,
    Owner,
    Photo,
)
from orbit_api.services.fitness.store import FitnessStore
from orbit_api.services.transactions import Transaction
from orbit_api.utils.clock import utc_now
from orbit_api.utils.file_types import detect_file_type

PHOTO_TYPES = frozenset({"png", "jpg", "jpeg", "webp"})


class PhotoFiles(Protocol):
    """Where photo bytes live: the shared attachment store."""

    async def write(self, workspace_id: uuid.UUID, blob_id: uuid.UUID, data: bytes, /) -> None: ...

    async def locate(self, workspace_id: uuid.UUID, blob_id: uuid.UUID, /) -> Path | None: ...

    async def delete(self, workspace_id: uuid.UUID, blob_ids: Sequence[uuid.UUID], /) -> None: ...


class BodyService:
    def __init__(
        self,
        store: FitnessStore,
        files: PhotoFiles,
        transaction: Transaction,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._store = store
        self._files = files
        self._transaction = transaction
        self._clock = clock

    # Measurements

    async def measurements(
        self, owner: Owner, start: date | None = None, end: date | None = None
    ) -> list[Measurement]:
        return await self._store.measurements(owner, start, end)

    async def add_measurement(self, owner: Owner, draft: MeasurementDraft) -> Measurement:
        _check(draft)
        now = self._clock()
        measurement = Measurement(
            id=uuid.uuid4(),
            owner=owner,
            day=draft.day,
            values=draft.values,
            note=draft.note,
            created_at=now,
            updated_at=now,
        )
        await self._store.put_measurement(measurement)
        await self._transaction.commit()
        return measurement

    async def update_measurement(
        self, owner: Owner, measurement_id: uuid.UUID, draft: MeasurementDraft
    ) -> Measurement:
        """Correct an entry: its date, values, and note are replaced."""
        _check(draft)
        current = await self._store.get_measurement(owner, measurement_id)
        if current is None:
            raise FitnessNotFoundError("Measurement")
        updated = replace(
            current, day=draft.day, values=draft.values, note=draft.note, updated_at=self._clock()
        )
        await self._store.put_measurement(updated)
        await self._transaction.commit()
        return updated

    async def delete_measurement(self, owner: Owner, measurement_id: uuid.UUID) -> None:
        if not await self._store.delete_measurement(owner, measurement_id):
            raise FitnessNotFoundError("Measurement")
        await self._transaction.commit()

    async def bmi(self, owner: Owner) -> Bmi | None:
        """BMI from the latest weight and height, or `None` without both."""
        measurements = await self._store.measurements(owner)
        weights = [m for m in measurements if m.values.weight_g is not None]
        if not weights:
            return None
        latest = weights[-1]
        heights = [m.values.height_mm for m in measurements if m.values.height_mm is not None]
        profile = await self._store.get_profile(owner)
        height = heights[-1] if heights else (profile.settings.height_mm if profile else None)
        weight = latest.values.weight_g
        if height is None or weight is None:
            return None
        value = bmi(weight, height)
        if value is None:
            return None
        return Bmi(value=value, weight_g=weight, height_mm=height, weight_day=latest.day)

    # Photos

    async def photos(self, owner: Owner) -> list[Photo]:
        return await self._store.photos(owner)

    async def add_photo(
        self, owner: Owner, *, day: date, note: str, filename: str, data: bytes
    ) -> Photo:
        # Raises `FileTypeError` for anything but a PNG, JPEG, or WebP image.
        file_type = detect_file_type(filename, data, PHOTO_TYPES)
        photo = Photo(
            id=uuid.uuid4(),
            owner=owner,
            day=day,
            note=note,
            blob_id=uuid.uuid4(),
            content_type=file_type.content_type,
            size_bytes=len(data),
            created_at=self._clock(),
        )
        await self._files.write(owner.workspace_id, photo.blob_id, data)
        try:
            await self._store.add_photo(photo)
            await self._transaction.commit()
        except BaseException:
            # Nothing may point at the file, so it must not outlive a failed save. Re-raised.
            await self._transaction.rollback()
            await self._files.delete(owner.workspace_id, [photo.blob_id])
            raise
        return photo

    async def photo_file(self, owner: Owner, photo_id: uuid.UUID) -> tuple[Photo, Path]:
        photo = await self._store.get_photo(owner, photo_id)
        if photo is None:
            raise FitnessNotFoundError("Photo")
        path = await self._files.locate(owner.workspace_id, photo.blob_id)
        if path is None:
            raise FitnessNotFoundError("Photo file")
        return photo, path

    async def delete_photo(self, owner: Owner, photo_id: uuid.UUID) -> None:
        photo = await self._store.get_photo(owner, photo_id)
        if photo is None:
            raise FitnessNotFoundError("Photo")
        await self._store.delete_photo(owner, photo_id)
        await self._transaction.commit()
        await self._files.delete(owner.workspace_id, [photo.blob_id])


def _check(draft: MeasurementDraft) -> None:
    if draft.values.is_empty():
        raise InvalidFitnessError("Enter at least one measurement.")
