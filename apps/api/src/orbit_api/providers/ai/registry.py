"""Builds the adapter for a provider connection. The one place that knows every vendor."""

from typing import Final

import httpx2

from orbit_api.providers.ai.anthropic import AnthropicProvider
from orbit_api.providers.ai.gemini import GeminiProvider
from orbit_api.providers.ai.http import ProviderHttp
from orbit_api.providers.ai.ollama import OllamaProvider
from orbit_api.providers.ai.openai import OpenAiProvider
from orbit_api.services.ai.models import ProviderConnection, ProviderKind
from orbit_api.services.ai.providers import AiProvider, ProviderRequestError, base_url_of

DISPLAY_NAMES: Final[dict[ProviderKind, str]] = {
    "openai": "OpenAI",
    "anthropic": "Anthropic",
    "gemini": "Google Gemini",
    "ollama": "Ollama",
    "openai_compatible": "The server",
}

# Generous for slow local models; connecting is quick or not at all.
TIMEOUT: Final = httpx2.Timeout(120.0, connect=10.0)


class HttpProviderFactory:
    """Adapters over one shared HTTP client (connection pooling). Close it on shutdown."""

    def __init__(self, transport: httpx2.AsyncBaseTransport | None = None) -> None:
        # Redirects are not followed: a provider endpoint that redirects elsewhere would bypass
        # the endpoint checks made when it was configured.
        self._client = httpx2.AsyncClient(
            timeout=TIMEOUT, transport=transport, follow_redirects=False
        )

    def build(self, connection: ProviderConnection, api_key: str | None) -> AiProvider:
        base_url = base_url_of(connection)
        if base_url is None:
            raise ProviderRequestError("Set the server's address for this provider.")
        http = ProviderHttp(self._client, DISPLAY_NAMES[connection.kind], api_key)
        match connection.kind:
            case "openai" | "openai_compatible":
                return OpenAiProvider(http, base_url, api_key, connection.kind)
            case "anthropic":
                return AnthropicProvider(http, base_url, api_key)
            case "gemini":
                return GeminiProvider(http, base_url, api_key)
            case "ollama":
                return OllamaProvider(http, base_url, api_key)

    async def aclose(self) -> None:
        await self._client.aclose()
