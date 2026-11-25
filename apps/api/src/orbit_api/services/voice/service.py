"""Voice settings, speech through the person's AI providers, and spoken-history retention.

Speech through a provider follows the AI layer's rules: AI on for the person and the server,
cloud consent for cloud providers, the monthly limit checked first, and every call recorded in
AI usage (counts and timings only; never audio or text).
"""

import io
import time
import uuid
import wave
from collections.abc import AsyncGenerator, AsyncIterator, Callable
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from typing import Protocol

from orbit_api.services.ai.configuration import AiConfigService
from orbit_api.services.ai.models import (
    AiSettings,
    Processing,
    ProviderConnection,
    ProviderNotFoundError,
    TokenUsage,
    UsageOperation,
    UsageRecord,
)
from orbit_api.services.ai.providers import ProviderError, base_url_of, processing_of
from orbit_api.services.ai.usage import estimate_cost
from orbit_api.services.voice.models import (
    AUDIO_PROVIDER_KINDS,
    AUDIO_TYPES,
    AUTO_LANGUAGE,
    MAX_AUDIO_BYTES,
    MAX_SPEECH_CHARS,
    AudioProvider,
    AudioProviderFactory,
    AudioProviderInfo,
    AudioRejectedError,
    SpeechEngine,
    SpeechProcessing,
    Transcript,
    VoiceNotConfiguredError,
    VoiceOption,
    VoiceProviderUnsupportedError,
    VoiceSettings,
    VoiceStatus,
    VoiceTest,
)
from orbit_api.utils.clock import utc_now

TEST_PHRASE = "Orbit voice check."


class VoiceSettingsRepository(Protocol):
    async def get(self, user_id: uuid.UUID) -> VoiceSettings | None: ...

    async def put(self, settings: VoiceSettings) -> None: ...


class VoiceHistoryRepository(Protocol):
    async def delete_spoken(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, before: datetime | None
    ) -> int:
        """Delete the person's conversations in the workspace that have a spoken question
        (only those last updated before `before`, when given); return how many."""
        ...

    async def retention(self) -> list[tuple[uuid.UUID, int]]:
        """`(user_id, history_days)` for everyone who limits how long spoken history is kept."""
        ...

    async def delete_spoken_everywhere(self, user_id: uuid.UUID, before: datetime) -> int: ...


class Transaction(Protocol):
    async def commit(self) -> None: ...


@dataclass(frozen=True, slots=True)
class _Audio:
    connection: ProviderConnection
    provider: AudioProvider
    processing: Processing
    model: str
    settings: AiSettings


def language_code(language: str | None) -> str | None:
    """The ISO 639-1 code Whisper-style APIs expect (`en-IN` → `en`); `None` to detect."""
    if not language or language == AUTO_LANGUAGE:
        return None
    return language.split("-", 1)[0].lower()


def silent_wav(seconds: float = 0.5, rate: int = 16_000) -> bytes:
    """A short silent WAV, to check a transcription endpoint answers without sending speech."""
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(b"\x00\x00" * int(rate * seconds))
    return buffer.getvalue()


async def purge_spoken_history(
    history: VoiceHistoryRepository, transaction: Transaction, now: datetime
) -> int:
    """Delete spoken conversations past each person's retention; run by the worker."""
    removed = 0
    for user_id, days in await history.retention():
        removed += await history.delete_spoken_everywhere(user_id, now - timedelta(days=days))
    await transaction.commit()
    return removed


class VoiceService:
    def __init__(
        self,
        settings: VoiceSettingsRepository,
        history: VoiceHistoryRepository,
        ai: AiConfigService,
        factory: AudioProviderFactory,
        transaction: Transaction,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._settings = settings
        self._history = history
        self._ai = ai
        self._factory = factory
        self._transaction = transaction
        self._clock = clock

    # Settings

    async def settings(self, user_id: uuid.UUID) -> VoiceSettings:
        return await self._settings.get(user_id) or VoiceSettings(user_id=user_id)

    async def update(self, user_id: uuid.UUID, settings: VoiceSettings) -> VoiceSettings:
        """Replace the settings. Provider engines need one of the person's audio-capable
        providers and a model (and a voice, for speech)."""
        settings = replace(settings, user_id=user_id, updated_at=self._clock())
        if settings.stt_engine == "provider":
            await self._check_provider(user_id, settings.stt_provider_id, settings.stt_model)
        else:
            settings = replace(settings, stt_provider_id=None, stt_model=None)
        if settings.tts_engine == "provider":
            await self._check_provider(user_id, settings.tts_provider_id, settings.tts_model)
            if not settings.tts_voice:
                raise VoiceNotConfiguredError("Choose a voice for spoken answers.")
        else:
            settings = replace(settings, tts_provider_id=None, tts_model=None, tts_voice=None)
        await self._settings.put(settings)
        await self._transaction.commit()
        return settings

    async def status(self, user_id: uuid.UUID) -> VoiceStatus:
        ai = await self._ai.settings(user_id)
        voice = await self.settings(user_id)
        providers = [
            AudioProviderInfo(
                id=c.id,
                name=c.name,
                kind=c.kind,
                processing=processing_of(c.kind, base_url_of(c)),
            )
            for c in await self._ai.providers(user_id)
            if c.kind in AUDIO_PROVIDER_KINDS
        ]
        by_id: dict[uuid.UUID, SpeechProcessing] = {p.id: p.processing for p in providers}

        def where(engine: SpeechEngine, provider_id: uuid.UUID | None) -> SpeechProcessing | None:
            if engine == "browser":
                return "browser"
            return by_id.get(provider_id) if provider_id else None

        return VoiceStatus(
            server_enabled=self._ai.server_enabled,
            ai_enabled=self._ai.server_enabled and ai.enabled,
            allow_cloud=ai.allow_cloud,
            providers=providers,
            stt_processing=where(voice.stt_engine, voice.stt_provider_id),
            tts_processing=where(voice.tts_engine, voice.tts_provider_id),
        )

    # Speech

    async def transcribe(
        self,
        user_id: uuid.UUID,
        workspace_id: uuid.UUID,
        audio: bytes,
        content_type: str,
        language: str | None = None,
    ) -> Transcript:
        """Transcribe one utterance with the person's transcription provider. The audio is
        passed through and never stored."""
        kind = content_type.split(";", 1)[0].strip().lower()
        if kind not in AUDIO_TYPES:
            raise AudioRejectedError("Orbit can't read that audio format.")
        if not audio:
            raise AudioRejectedError("No audio was received.")
        if len(audio) > MAX_AUDIO_BYTES:
            raise AudioRejectedError("That recording is too long; speak in shorter turns.")
        voice = await self.settings(user_id)
        if voice.stt_engine != "provider" or not voice.stt_provider_id or not voice.stt_model:
            raise VoiceNotConfiguredError("Choose a transcription provider in Settings → Voice.")
        target = await self._audio(user_id, voice.stt_provider_id, voice.stt_model)
        started = time.monotonic()
        await self._ai.usage.check_limit(user_id, target.settings.monthly_token_limit)
        try:
            transcript = await target.provider.transcribe(
                target.model,
                audio,
                f"speech.{AUDIO_TYPES[kind]}",
                kind,
                language_code(language or voice.recognition_language),
            )
        except ProviderError as exc:
            await self._record(target, workspace_id, "transcription", started, exc)
            raise
        await self._record(target, workspace_id, "transcription", started, None)
        return transcript

    @asynccontextmanager
    async def speak(
        self, user_id: uuid.UUID, workspace_id: uuid.UUID, text: str
    ) -> AsyncGenerator[AsyncIterator[bytes]]:
        """Open a spoken rendering of `text` with the person's speech provider; provider
        refusals are raised before any audio is yielded."""
        text = " ".join(text.split())
        if not text:
            raise AudioRejectedError("Nothing to say.")
        if len(text) > MAX_SPEECH_CHARS:
            raise AudioRejectedError("That's too long to speak at once.")
        voice = await self.settings(user_id)
        if (
            voice.tts_engine != "provider"
            or not voice.tts_provider_id
            or not voice.tts_model
            or not voice.tts_voice
        ):
            raise VoiceNotConfiguredError("Choose a speech provider in Settings → Voice.")
        target = await self._audio(user_id, voice.tts_provider_id, voice.tts_model)
        await self._ai.usage.check_limit(user_id, target.settings.monthly_token_limit)
        started = time.monotonic()
        async with AsyncExitStack() as stack:
            try:
                chunks = await stack.enter_async_context(
                    target.provider.speak(
                        target.model, voice.tts_voice, text, voice.speaking_rate / 100
                    )
                )
            except ProviderError as exc:
                await self._record(target, workspace_id, "speech", started, exc)
                raise
            # Recorded when the audio starts: the duration is the time to the first byte.
            await self._record(target, workspace_id, "speech", started, None)
            yield chunks

    async def voices(self, user_id: uuid.UUID, provider_id: uuid.UUID) -> list[VoiceOption]:
        """The provider's voices, when it lists them; an empty list means type a voice name."""
        target = await self._audio(user_id, provider_id, "")
        try:
            return await target.provider.list_voices()
        except ProviderError:
            return []

    async def test(self, user_id: uuid.UUID, workspace_id: uuid.UUID) -> VoiceTest:
        """Check the configured provider engines answer: speak a short phrase, then transcribe
        it (or a moment of silence, when speech is the browser's)."""
        voice = await self.settings(user_id)
        if voice.stt_engine == "browser" and voice.tts_engine == "browser":
            return VoiceTest(
                ok=True,
                message="Both run in your browser; test them on the voice screen.",
                transcription_ms=None,
                speech_ms=None,
            )
        speech_ms: int | None = None
        transcription_ms: int | None = None
        spoken = b""
        try:
            if voice.tts_engine == "provider":
                started = time.monotonic()
                async with self.speak(user_id, workspace_id, TEST_PHRASE) as chunks:
                    parts = [chunk async for chunk in chunks]
                spoken = b"".join(parts)
                speech_ms = round((time.monotonic() - started) * 1000)
            if voice.stt_engine == "provider":
                started = time.monotonic()
                if spoken:
                    await self.transcribe(user_id, workspace_id, spoken, "audio/mpeg")
                else:
                    await self.transcribe(user_id, workspace_id, silent_wav(), "audio/wav")
                transcription_ms = round((time.monotonic() - started) * 1000)
        except ProviderError as exc:
            return VoiceTest(
                ok=False, message=str(exc), transcription_ms=transcription_ms, speech_ms=speech_ms
            )
        return VoiceTest(
            ok=True,
            message="Voice providers answered.",
            transcription_ms=transcription_ms,
            speech_ms=speech_ms,
        )

    # History

    async def clear_history(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> int:
        removed = await self._history.delete_spoken(workspace_id, user_id, None)
        await self._transaction.commit()
        return removed

    # Internals

    async def _check_provider(
        self, user_id: uuid.UUID, provider_id: uuid.UUID | None, model: str | None
    ) -> None:
        if provider_id is None or not model:
            raise VoiceNotConfiguredError("Choose a provider and model.")
        connection = next(
            (c for c in await self._ai.providers(user_id) if c.id == provider_id), None
        )
        if connection is None:
            raise ProviderNotFoundError
        if connection.kind not in AUDIO_PROVIDER_KINDS:
            raise VoiceProviderUnsupportedError(
                "Only OpenAI and OpenAI-compatible servers can transcribe or speak."
            )

    async def _audio(self, user_id: uuid.UUID, provider_id: uuid.UUID, model: str) -> _Audio:
        settings = await self._ai.require_enabled(user_id)
        connection, key, processing = await self._ai.audio_connection(settings, provider_id)
        if connection.kind not in AUDIO_PROVIDER_KINDS:
            raise VoiceProviderUnsupportedError(
                "Only OpenAI and OpenAI-compatible servers can transcribe or speak."
            )
        return _Audio(
            connection=connection,
            provider=self._factory.build(connection, key),
            processing=processing,
            model=model,
            settings=settings,
        )

    async def _record(
        self,
        target: _Audio,
        workspace_id: uuid.UUID,
        operation: UsageOperation,
        started: float,
        error: ProviderError | None,
    ) -> None:
        await self._ai.usage.record(
            UsageRecord(
                user_id=target.settings.user_id,
                workspace_id=workspace_id,
                provider_kind=target.connection.kind,
                provider_name=target.connection.name,
                model=target.model,
                operation=operation,
                usage=TokenUsage(),
                cost_micros=estimate_cost(target.connection, TokenUsage()),
                duration_ms=round((time.monotonic() - started) * 1000),
                success=error is None,
                error_type=type(error).__name__ if error is not None else None,
                processing=target.processing,
                created_at=self._clock(),
            )
        )
