"""Ollama's native API: local models on this machine (or another the person runs). No API key
is needed by default; one can be set for a server behind an authenticating proxy."""

import json
from collections.abc import AsyncIterator, Sequence
from typing import cast

from orbit_api.providers.ai.http import Json, ProviderHttp, floats, integer, items, obj, text
from orbit_api.services.ai.models import (
    Capabilities,
    ChatRequest,
    Completion,
    Embeddings,
    ModelInfo,
    ProviderKind,
    StreamChunk,
    TokenUsage,
)
from orbit_api.services.ai.providers import KIND_CAPABILITIES, looks_like_embedding_model


class OllamaProvider:
    def __init__(self, http: ProviderHttp, base_url: str, api_key: str | None) -> None:
        self._http = http
        self._base = base_url.rstrip("/")
        self._api_key = api_key

    @property
    def kind(self) -> ProviderKind:
        return "ollama"

    @property
    def capabilities(self) -> Capabilities:
        return KIND_CAPABILITIES["ollama"]

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        return headers

    def _body(self, request: ChatRequest, stream: bool) -> Json:
        body: Json = {
            "model": request.model,
            "messages": [{"role": m.role, "content": m.content} for m in request.messages],
            "stream": stream,
            "options": {"temperature": request.temperature, "num_predict": request.max_tokens},
        }
        if request.json_mode:
            body["format"] = "json"
        return body

    async def complete(self, request: ChatRequest) -> Completion:
        data = await self._http.post(
            f"{self._base}/api/chat", self._headers(), self._body(request, False)
        )
        return Completion(text=text(obj(data.get("message")).get("content")), usage=_usage(data))

    async def stream(self, request: ChatRequest) -> AsyncIterator[StreamChunk]:
        async with self._http.stream_lines(
            f"{self._base}/api/chat", self._headers(), self._body(request, True)
        ) as lines:
            async for line in lines:
                if not line.strip():
                    continue
                try:
                    value: object = json.loads(line)
                except ValueError:
                    raise self._http.malformed() from None
                event = cast(Json, value) if isinstance(value, dict) else {}
                piece = text(obj(event.get("message")).get("content"))
                if piece:
                    yield StreamChunk(text=piece)
                if event.get("done") is True:
                    yield StreamChunk(usage=_usage(event))

    async def embed(self, model: str, texts: Sequence[str]) -> Embeddings:
        data = await self._http.post(
            f"{self._base}/api/embed", self._headers(), {"model": model, "input": list(texts)}
        )
        vectors = [floats(row) for row in items(data.get("embeddings"))]
        if len(vectors) != len(texts) or any(v is None for v in vectors):
            raise self._http.malformed()
        return Embeddings(
            vectors=[v for v in vectors if v is not None],
            usage=TokenUsage(input_tokens=integer(data.get("prompt_eval_count"))),
        )

    async def list_models(self) -> list[ModelInfo]:
        data = await self._http.get(f"{self._base}/api/tags", self._headers())
        names = sorted({text(obj(row).get("name")) for row in items(data.get("models"))} - {""})
        return [
            ModelInfo(
                id=name,
                embeddings=looks_like_embedding_model(name),
                chat=not looks_like_embedding_model(name),
            )
            for name in names
        ]


def _usage(data: Json) -> TokenUsage:
    return TokenUsage(
        input_tokens=integer(data.get("prompt_eval_count")),
        output_tokens=integer(data.get("eval_count")),
    )
