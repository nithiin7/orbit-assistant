"""Voice settings and spoken-history deletion, and the voice services on one session."""

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Final, cast

from sqlalchemy import Select, delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.db.models import (
    AiActionProposalModel,
    AiConversationModel,
    AiMessageModel,
    VoiceSettingsModel,
)
from orbit_api.repositories.transaction import SqlTransaction, flush
from orbit_api.services.ai.configuration import AiConfigService
from orbit_api.services.voice.models import (
    AudioProviderFactory,
    ListeningMode,
    SpeechEngine,
    VoiceSettings,
)
from orbit_api.services.voice.service import VoiceService

_ENGINES: Final[dict[str, SpeechEngine]] = {"browser": "browser", "provider": "provider"}
_MODES: Final[dict[str, ListeningMode]] = {
    "continuous": "continuous",
    "push_to_talk": "push_to_talk",
}


class SqlVoiceSettingsRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, user_id: uuid.UUID) -> VoiceSettings | None:
        model = await self._session.get(VoiceSettingsModel, user_id)
        if model is None:
            return None
        return VoiceSettings(
            user_id=model.user_id,
            stt_engine=_ENGINES.get(model.stt_engine, "browser"),
            stt_provider_id=model.stt_provider_id,
            stt_model=model.stt_model,
            tts_engine=_ENGINES.get(model.tts_engine, "browser"),
            tts_provider_id=model.tts_provider_id,
            tts_model=model.tts_model,
            tts_voice=model.tts_voice,
            recognition_language=model.recognition_language,
            response_language=model.response_language,
            listening_mode=_MODES.get(model.listening_mode, "continuous"),
            silence_ms=model.silence_ms,
            sensitivity=model.sensitivity,
            auto_speak=model.auto_speak,
            speaking_rate=model.speaking_rate,
            history_days=model.history_days,
            updated_at=model.updated_at,
        )

    async def put(self, settings: VoiceSettings) -> None:
        model = await self._session.get(VoiceSettingsModel, settings.user_id)
        if model is None:
            model = VoiceSettingsModel(user_id=settings.user_id)
            self._session.add(model)
        model.stt_engine = settings.stt_engine
        model.stt_provider_id = settings.stt_provider_id
        model.stt_model = settings.stt_model
        model.tts_engine = settings.tts_engine
        model.tts_provider_id = settings.tts_provider_id
        model.tts_model = settings.tts_model
        model.tts_voice = settings.tts_voice
        model.recognition_language = settings.recognition_language
        model.response_language = settings.response_language
        model.listening_mode = settings.listening_mode
        model.silence_ms = settings.silence_ms
        model.sensitivity = settings.sensitivity
        model.auto_speak = settings.auto_speak
        model.speaking_rate = settings.speaking_rate
        model.history_days = settings.history_days
        if settings.updated_at is not None:
            model.updated_at = settings.updated_at
        await flush(self._session)


class SqlVoiceHistoryRepository:
    """Deletes whole conversations: removing only the spoken questions would leave answers to
    questions that are gone."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def delete_spoken(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, before: datetime | None
    ) -> int:
        query = select(AiConversationModel.id).where(
            AiConversationModel.workspace_id == workspace_id,
            AiConversationModel.user_id == user_id,
            AiConversationModel.id.in_(_spoken()),
        )
        if before is not None:
            query = query.where(AiConversationModel.updated_at < before)
        return await self._delete(list((await self._session.scalars(query)).all()))

    async def retention(self) -> list[tuple[uuid.UUID, int]]:
        rows = await self._session.execute(
            select(VoiceSettingsModel.user_id, VoiceSettingsModel.history_days).where(
                VoiceSettingsModel.history_days.is_not(None)
            )
        )
        return [(user_id, cast(int, days)) for user_id, days in rows.all()]

    async def delete_spoken_everywhere(self, user_id: uuid.UUID, before: datetime) -> int:
        ids = (
            await self._session.scalars(
                select(AiConversationModel.id).where(
                    AiConversationModel.user_id == user_id,
                    AiConversationModel.updated_at < before,
                    AiConversationModel.id.in_(_spoken()),
                )
            )
        ).all()
        return await self._delete(list(ids))

    async def _delete(self, ids: list[uuid.UUID]) -> int:
        if not ids:
            return 0
        # Proposals and messages first, so this holds even where foreign keys are off.
        await self._session.execute(
            delete(AiActionProposalModel).where(AiActionProposalModel.conversation_id.in_(ids))
        )
        await self._session.execute(
            delete(AiMessageModel).where(AiMessageModel.conversation_id.in_(ids))
        )
        await self._session.execute(
            delete(AiConversationModel).where(AiConversationModel.id.in_(ids))
        )
        await flush(self._session)
        return len(ids)


def _spoken() -> Select[uuid.UUID]:
    """Conversations with at least one spoken question."""
    return select(AiMessageModel.conversation_id).where(AiMessageModel.input_mode == "voice")


@dataclass(frozen=True, slots=True)
class VoiceServices:
    service: VoiceService


def build_voice(
    session: AsyncSession, ai: AiConfigService, factory: AudioProviderFactory
) -> VoiceServices:
    return VoiceServices(
        service=VoiceService(
            SqlVoiceSettingsRepository(session),
            SqlVoiceHistoryRepository(session),
            ai,
            factory,
            SqlTransaction(session),
        )
    )
