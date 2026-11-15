"""Builds the speech adapter for a provider connection."""

import httpx2

from orbit_api.providers.ai.http import ProviderHttp
from orbit_api.providers.ai.registry import DISPLAY_NAMES
from orbit_api.providers.voice.openai_audio import OpenAiAudioProvider
from orbit_api.services.ai.models import ProviderConnection
from orbit_api.services.ai.providers import ProviderRequestError, base_url_of
from orbit_api.services.voice.models import AudioProvider, VoiceProviderUnsupportedError

# Transcribing a long utterance on a local CPU model can take a while.
TIMEOUT = httpx2.Timeout(90.0, connect=10.0)


class HttpAudioProviderFactory:
    """Speech adapters over one shared HTTP client. Close it on shutdown."""

    def __init__(self, transport: httpx2.AsyncBaseTransport | None = None) -> None:
        # Redirects are not followed, as for chat: they would bypass the endpoint checks.
        self._client = httpx2.AsyncClient(
            timeout=TIMEOUT, transport=transport, follow_redirects=False
        )

    def build(self, connection: ProviderConnection, api_key: str | None) -> AudioProvider:
        base_url = base_url_of(connection)
        if base_url is None:
            raise ProviderRequestError("Set the server's address for this provider.")
        match connection.kind:
            case "openai" | "openai_compatible":
                http = ProviderHttp(self._client, DISPLAY_NAMES[connection.kind], api_key)
                return OpenAiAudioProvider(http, base_url, api_key)
            case _:
                raise VoiceProviderUnsupportedError(
                    "Only OpenAI and OpenAI-compatible servers can transcribe or speak."
                )

    async def aclose(self) -> None:
        await self._client.aclose()
