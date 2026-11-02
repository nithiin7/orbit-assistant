"""The provider interface every AI adapter implements, and the errors adapters raise.

Services only see `AiProvider`; vendor HTTP APIs live in `orbit_api.providers.ai`. Not every
provider can do everything (Anthropic has no embeddings API), so each adapter declares its
`Capabilities`, and calling something unsupported raises `UnsupportedCapabilityError` rather
than failing somewhere deeper.
"""

import ipaddress
from collections.abc import AsyncIterator, Sequence
from typing import Final, Protocol
from urllib.parse import urlsplit

from orbit_api.services.ai.models import (
    Capabilities,
    ChatRequest,
    Completion,
    Embeddings,
    ModelInfo,
    Processing,
    ProviderConnection,
    ProviderKind,
    StreamChunk,
)

DEFAULT_BASE_URLS: Final[dict[ProviderKind, str | None]] = {
    "openai": "https://api.openai.com/v1",
    "anthropic": "https://api.anthropic.com",
    "gemini": "https://generativelanguage.googleapis.com",
    "ollama": "http://localhost:11434",
    # No default: an OpenAI-compatible server (LM Studio, llama.cpp, vLLM, …) is wherever the
    # person runs it.
    "openai_compatible": None,
}

KIND_CAPABILITIES: Final[dict[ProviderKind, Capabilities]] = {
    "openai": Capabilities(
        chat=True,
        streaming=True,
        structured_output=True,
        embeddings=True,
        model_listing=True,
        usage_reporting=True,
    ),
    "anthropic": Capabilities(
        chat=True,
        streaming=True,
        structured_output=True,
        embeddings=False,
        model_listing=True,
        usage_reporting=True,
    ),
    "gemini": Capabilities(
        chat=True,
        streaming=True,
        structured_output=True,
        embeddings=True,
        model_listing=True,
        usage_reporting=True,
    ),
    "ollama": Capabilities(
        chat=True,
        streaming=True,
        structured_output=True,
        embeddings=True,
        model_listing=True,
        usage_reporting=True,
    ),
    # Servers differ; embeddings and usage are attempted and reported if they fail.
    "openai_compatible": Capabilities(
        chat=True,
        streaming=True,
        structured_output=True,
        embeddings=True,
        model_listing=True,
        usage_reporting=False,
    ),
}

# Kinds that need an API key to work at all.
KEY_REQUIRED: Final[frozenset[ProviderKind]] = frozenset({"openai", "anthropic", "gemini"})


class ProviderError(Exception):
    """A provider call failed. `message` is safe to show: it never contains the API key or
    the prompt."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class ProviderAuthError(ProviderError):
    """The provider rejected the credentials."""


class ProviderRateLimitError(ProviderError):
    """The provider is rate limiting or out of quota."""


class ProviderUnavailableError(ProviderError):
    """The provider couldn't be reached, timed out, or had a server error."""


class ProviderRequestError(ProviderError):
    """The provider refused the request, for example an unknown model."""


class ProviderResponseError(ProviderError):
    """The provider answered with something Orbit couldn't read."""


class UnsupportedCapabilityError(ProviderError):
    """The provider can't do this, such as embeddings with Anthropic."""


class AiProvider(Protocol):
    @property
    def kind(self) -> ProviderKind: ...

    @property
    def capabilities(self) -> Capabilities: ...

    async def complete(self, request: ChatRequest) -> Completion: ...

    def stream(self, request: ChatRequest) -> AsyncIterator[StreamChunk]: ...

    async def embed(self, model: str, texts: Sequence[str]) -> Embeddings: ...

    async def list_models(self) -> list[ModelInfo]: ...


class ProviderFactory(Protocol):
    """Builds an adapter for a connection, with its decrypted key (if any)."""

    def build(self, connection: ProviderConnection, api_key: str | None) -> AiProvider: ...


def base_url_of(connection: ProviderConnection) -> str | None:
    return connection.base_url or DEFAULT_BASE_URLS[connection.kind]


def processing_of(kind: ProviderKind, base_url: str | None) -> Processing:
    """`local` when the endpoint's host is this machine or a private network address, else
    `cloud`. Decided from the URL alone, so it is the same everywhere it is shown."""
    url = base_url or DEFAULT_BASE_URLS[kind]
    if url is None:
        return "cloud"
    host = (urlsplit(url).hostname or "").lower()
    return "local" if is_private_host(host) else "cloud"


def is_private_host(host: str) -> bool:
    """Loopback, private, or link-local addresses, `localhost`, and `.local` names."""
    if host in {"localhost", ""} or host.endswith((".localhost", ".local")):
        return host != ""
    try:
        address = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        return False
    return address.is_loopback or address.is_private or address.is_link_local


def looks_like_embedding_model(model: str) -> bool:
    name = model.lower()
    return any(marker in name for marker in ("embed", "bge-", "e5-", "gte-", "minilm"))
