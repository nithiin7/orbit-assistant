"""A deterministic AI provider for tests: scripted answers and bag-of-words embeddings, so
similar texts get similar vectors without any network or model."""

import hashlib
import re
from collections.abc import AsyncIterator, Callable, Sequence
from dataclasses import dataclass, field

from orbit_api.services.ai.models import (
    Capabilities,
    ChatRequest,
    Completion,
    Embeddings,
    ModelInfo,
    ProviderConnection,
    ProviderKind,
    StreamChunk,
    TokenUsage,
)
from orbit_api.services.ai.providers import KIND_CAPABILITIES, AiProvider, ProviderError

DIMENSIONS = 64

Script = Callable[[ChatRequest], str]


def embed_text(text: str) -> list[float]:
    vector = [0.0] * DIMENSIONS
    for word in re.findall(r"[a-z]{3,}", text.lower()):
        digest = hashlib.sha256(word.encode()).digest()
        vector[digest[0] % DIMENSIONS] += 1.0
    if not any(vector):
        vector[0] = 1.0
    return vector


@dataclass
class FakeState:
    """Shared across every adapter the factory builds, so tests can script and inspect."""

    script: Script = lambda request: "I couldn't find that in Orbit."
    requests: list[ChatRequest] = field(default_factory=list[ChatRequest])
    embedded: list[str] = field(default_factory=list[str])
    keys: list[str | None] = field(default_factory=list[str | None])
    chat_error: ProviderError | None = None
    embed_error: ProviderError | None = None
    models: list[ModelInfo] = field(
        default_factory=lambda: [
            ModelInfo(id="chat-model", chat=True, embeddings=False),
            ModelInfo(id="embed-model", chat=False, embeddings=True),
        ]
    )

    def last_prompt(self) -> str:
        return "\n".join(m.content for m in self.requests[-1].messages)


class FakeProvider:
    def __init__(self, state: FakeState, kind: ProviderKind) -> None:
        self._state = state
        self._kind: ProviderKind = kind

    @property
    def kind(self) -> ProviderKind:
        return self._kind

    @property
    def capabilities(self) -> Capabilities:
        return KIND_CAPABILITIES[self._kind]

    async def complete(self, request: ChatRequest) -> Completion:
        self._state.requests.append(request)
        if self._state.chat_error is not None:
            raise self._state.chat_error
        return Completion(text=self._state.script(request), usage=TokenUsage(100, 20))

    async def stream(self, request: ChatRequest) -> AsyncIterator[StreamChunk]:
        self._state.requests.append(request)
        if self._state.chat_error is not None:
            raise self._state.chat_error
        text = self._state.script(request)
        for start in range(0, len(text), 7):
            yield StreamChunk(text=text[start : start + 7])
        yield StreamChunk(usage=TokenUsage(120, len(text) // 4))

    async def embed(self, model: str, texts: Sequence[str]) -> Embeddings:
        if self._state.embed_error is not None:
            raise self._state.embed_error
        self._state.embedded.extend(texts)
        return Embeddings(vectors=[embed_text(t) for t in texts], usage=TokenUsage(len(texts), 0))

    async def list_models(self) -> list[ModelInfo]:
        if self._state.chat_error is not None:
            raise self._state.chat_error
        return self._state.models


class FakeProviderFactory:
    def __init__(self, state: FakeState | None = None) -> None:
        self.state = state or FakeState()

    def build(self, connection: ProviderConnection, api_key: str | None) -> AiProvider:
        self.state.keys.append(api_key)
        return FakeProvider(self.state, connection.kind)

    async def aclose(self) -> None:
        return None
