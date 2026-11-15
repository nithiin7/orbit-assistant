"""OpenAI's audio API, and servers that implement it as `openai_compatible` (whisper.cpp's
server, Speaches/faster-whisper-server, Kokoro-FastAPI, LocalAI, and others): transcription at
`/audio/transcriptions`, speech at `/audio/speech`, and, where the server offers it, a voice list
at `/audio/voices` (OpenAI has none; the person types a voice name)."""

import time
from collections.abc import AsyncGenerator, AsyncIterator
from contextlib import asynccontextmanager
from typing import Final

from orbit_api.providers.ai.http import Json, ProviderHttp, items, obj, text
from orbit_api.services.voice.models import Transcript, VoiceOption

MAX_VOICES: Final = 200


class OpenAiAudioProvider:
    def __init__(self, http: ProviderHttp, base_url: str, api_key: str | None) -> None:
        self._http = http
        self._base = base_url.rstrip("/")
        self._api_key = api_key

    def _auth(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._api_key}"} if self._api_key else {}

    async def transcribe(
        self,
        model: str,
        audio: bytes,
        filename: str,
        content_type: str,
        language: str | None,
    ) -> Transcript:
        data = {"model": model, "response_format": "json"}
        if language:
            data["language"] = language
        started = time.monotonic()
        body = await self._http.post_form(
            f"{self._base}/audio/transcriptions",
            self._auth(),
            data,
            {"file": (filename, audio, content_type)},
        )
        if not isinstance(body.get("text"), str):
            raise self._http.malformed()
        language_found = body.get("language")
        return Transcript(
            text=text(body.get("text")).strip(),
            language=language_found if isinstance(language_found, str) else None,
            duration_ms=round((time.monotonic() - started) * 1000),
        )

    @asynccontextmanager
    async def speak(
        self, model: str, voice: str, text: str, speed: float
    ) -> AsyncGenerator[AsyncIterator[bytes]]:
        body: Json = {
            "model": model,
            "voice": voice,
            "input": text,
            "response_format": "mp3",
            "speed": speed,
        }
        headers = {**self._auth(), "Content-Type": "application/json"}
        async with self._http.stream_bytes(f"{self._base}/audio/speech", headers, body) as chunks:
            yield chunks

    async def list_voices(self) -> list[VoiceOption]:
        body = await self._http.get(f"{self._base}/audio/voices", self._auth())
        options: list[VoiceOption] = []
        for item in items(body.get("voices") or body.get("data")):
            if isinstance(item, str):
                options.append(VoiceOption(id=item, name=item))
                continue
            entry = obj(item)
            voice_id = text(entry.get("id") or entry.get("voice_id") or entry.get("name"))
            if voice_id:
                options.append(VoiceOption(id=voice_id, name=text(entry.get("name")) or voice_id))
        return options[:MAX_VOICES]
