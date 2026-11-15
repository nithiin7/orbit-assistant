"""A deterministic speech provider for tests: transcription returns a scripted text, speech
yields fixed audio chunks, and every call is recorded (never real audio or a network)."""

from collections.abc import AsyncGenerator, AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

from orbit_api.services.ai.models import ProviderConnection
from orbit_api.services.ai.providers import ProviderError
from orbit_api.services.voice.models import AudioProvider, Transcript, VoiceOption


@dataclass
class FakeAudioState:
    transcript: str = "What do I have tomorrow?"
    language: str | None = "en"
    chunks: list[bytes] = field(default_factory=lambda: [b"ID3", b"\x00audio-1", b"\x00audio-2"])
    voices: list[VoiceOption] = field(default_factory=lambda: [VoiceOption("calm", "Calm")])
    error: ProviderError | None = None
    voices_error: ProviderError | None = None
    keys: list[str | None] = field(default_factory=list[str | None])
    transcribed: list[tuple[str, int, str, str | None]] = field(
        default_factory=list[tuple[str, int, str, str | None]]
    )
    spoken: list[tuple[str, str, str, float]] = field(
        default_factory=list[tuple[str, str, str, float]]
    )


class FakeAudioProvider:
    def __init__(self, state: FakeAudioState) -> None:
        self._state = state

    async def transcribe(
        self, model: str, audio: bytes, filename: str, content_type: str, language: str | None
    ) -> Transcript:
        if self._state.error is not None:
            raise self._state.error
        self._state.transcribed.append((model, len(audio), content_type, language))
        return Transcript(text=self._state.transcript, language=self._state.language, duration_ms=5)

    @asynccontextmanager
    async def speak(
        self, model: str, voice: str, text: str, speed: float
    ) -> AsyncGenerator[AsyncIterator[bytes]]:
        if self._state.error is not None:
            raise self._state.error
        self._state.spoken.append((model, voice, text, speed))

        async def chunks() -> AsyncIterator[bytes]:
            for chunk in self._state.chunks:
                yield chunk

        yield chunks()

    async def list_voices(self) -> list[VoiceOption]:
        if self._state.voices_error is not None:
            raise self._state.voices_error
        return self._state.voices


class FakeAudioFactory:
    def __init__(self, state: FakeAudioState | None = None) -> None:
        self.state = state or FakeAudioState()

    def build(self, connection: ProviderConnection, api_key: str | None) -> AudioProvider:
        self.state.keys.append(api_key)
        return FakeAudioProvider(self.state)

    async def aclose(self) -> None:
        return None
