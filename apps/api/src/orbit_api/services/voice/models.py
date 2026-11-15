"""Voice settings, the audio provider interface, and voice errors.

Voice adds no assistant of its own: a transcript is sent to the AI assistant like a typed
question, and the answer is spoken. What lives here is only the speech around that: turning
audio into text and text into audio, either in the browser or through one of the person's AI
providers that has an OpenAI-style audio API.
"""

import uuid
from collections.abc import AsyncIterator
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import datetime
from typing import Final, Literal, Protocol

from orbit_api.services.ai.models import Processing, ProviderConnection, ProviderKind

SpeechEngine = Literal["browser", "provider"]
# Where speech is processed: on this machine or network, by a cloud provider, or by the
# browser's own engine (whose processing Orbit can't see; some browsers send audio to their
# vendor).
SpeechProcessing = Literal["local", "cloud", "browser"]
ListeningMode = Literal["continuous", "push_to_talk"]

# Provider kinds with an OpenAI-style audio API (`/audio/transcriptions`, `/audio/speech`):
# OpenAI itself and compatible servers (whisper.cpp's server, Speaches, Kokoro-FastAPI, …).
AUDIO_PROVIDER_KINDS: Final[frozenset[ProviderKind]] = frozenset({"openai", "openai_compatible"})

# "auto" lets the engine detect the language (Whisper) or use the browser's own language.
AUTO_LANGUAGE: Final = "auto"

# About two minutes of compressed speech; one utterance is far shorter.
MAX_AUDIO_BYTES: Final = 10 * 1024 * 1024
# One spoken chunk: the web splits answers into sentences, so this is generous.
MAX_SPEECH_CHARS: Final = 2000
AUDIO_TYPES: Final[dict[str, str]] = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/mpeg": "mp3",
    "audio/mp4": "mp4",
    "audio/x-m4a": "m4a",
}
SPEECH_CONTENT_TYPE: Final = "audio/mpeg"


@dataclass(frozen=True, slots=True)
class VoiceSettings:
    user_id: uuid.UUID
    stt_engine: SpeechEngine = "browser"
    stt_provider_id: uuid.UUID | None = None
    stt_model: str | None = None
    tts_engine: SpeechEngine = "browser"
    tts_provider_id: uuid.UUID | None = None
    tts_model: str | None = None
    tts_voice: str | None = None
    recognition_language: str = AUTO_LANGUAGE
    # `None`: answer in the language of the question.
    response_language: str | None = None
    listening_mode: ListeningMode = "continuous"
    silence_ms: int = 900
    sensitivity: int = 5
    auto_speak: bool = True
    speaking_rate: int = 100
    # Spoken conversations are deleted this many days after their last message; `None` keeps
    # them until deleted, like typed ones.
    history_days: int | None = None
    updated_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class AudioProviderInfo:
    """One of the person's AI providers that can transcribe or speak."""

    id: uuid.UUID
    name: str
    kind: ProviderKind
    processing: Processing


@dataclass(frozen=True, slots=True)
class VoiceStatus:
    server_enabled: bool
    ai_enabled: bool
    allow_cloud: bool
    providers: list[AudioProviderInfo]
    # Where each half runs; `None` when its provider is missing.
    stt_processing: SpeechProcessing | None
    tts_processing: SpeechProcessing | None


@dataclass(frozen=True, slots=True)
class Transcript:
    text: str
    language: str | None
    duration_ms: int


@dataclass(frozen=True, slots=True)
class VoiceOption:
    id: str
    name: str


@dataclass(frozen=True, slots=True)
class VoiceTest:
    ok: bool
    message: str
    transcription_ms: int | None
    speech_ms: int | None


class AudioProvider(Protocol):
    async def transcribe(
        self,
        model: str,
        audio: bytes,
        filename: str,
        content_type: str,
        language: str | None,
    ) -> Transcript: ...

    def speak(
        self, model: str, voice: str, text: str, speed: float
    ) -> AbstractAsyncContextManager[AsyncIterator[bytes]]:
        """Opens the request (raising a `ProviderError` for a refusal), then yields the audio
        as it arrives."""
        ...

    async def list_voices(self) -> list[VoiceOption]: ...


class AudioProviderFactory(Protocol):
    def build(self, connection: ProviderConnection, api_key: str | None) -> AudioProvider: ...


class VoiceNotConfiguredError(Exception):
    """The chosen engine needs a provider and model first."""


class VoiceProviderUnsupportedError(ValueError):
    """The provider has no audio API Orbit can use."""


class AudioRejectedError(ValueError):
    """The uploaded audio is empty, too large, or not a supported type."""
