"""Anthropic's Messages API. Anthropic offers no embeddings endpoint, so semantic search needs
a second provider for embeddings when Anthropic answers questions."""

from collections.abc import AsyncIterator, Sequence
from typing import Final

from orbit_api.providers.ai.http import Json, ProviderHttp, integer, items, obj, sse_data, text
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
from orbit_api.services.ai.providers import KIND_CAPABILITIES, UnsupportedCapabilityError

API_VERSION: Final = "2023-06-01"
JSON_INSTRUCTION: Final = "Respond with a single JSON object only, with no text before or after it."


class AnthropicProvider:
    def __init__(self, http: ProviderHttp, base_url: str, api_key: str | None) -> None:
        self._http = http
        self._base = base_url.rstrip("/")
        self._api_key = api_key

    @property
    def kind(self) -> ProviderKind:
        return "anthropic"

    @property
    def capabilities(self) -> Capabilities:
        return KIND_CAPABILITIES["anthropic"]

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json", "anthropic-version": API_VERSION}
        if self._api_key:
            headers["x-api-key"] = self._api_key
        return headers

    def _body(self, request: ChatRequest, stream: bool) -> Json:
        system = "\n\n".join(m.content for m in request.messages if m.role == "system")
        if request.json_mode:
            system = f"{system}\n\n{JSON_INSTRUCTION}".strip()
        body: Json = {
            "model": request.model,
            "max_tokens": request.max_tokens,
            "temperature": request.temperature,
            "messages": [
                {"role": m.role, "content": m.content}
                for m in request.messages
                if m.role != "system"
            ],
            "stream": stream,
        }
        if system:
            body["system"] = system
        return body

    async def complete(self, request: ChatRequest) -> Completion:
        data = await self._http.post(
            f"{self._base}/v1/messages", self._headers(), self._body(request, False)
        )
        blocks = [obj(block) for block in items(data.get("content"))]
        content = "".join(text(b.get("text")) for b in blocks if b.get("type") == "text")
        usage = obj(data.get("usage"))
        return Completion(
            text=content,
            usage=TokenUsage(
                input_tokens=integer(usage.get("input_tokens")),
                output_tokens=integer(usage.get("output_tokens")),
            ),
        )

    async def stream(self, request: ChatRequest) -> AsyncIterator[StreamChunk]:
        input_tokens: int | None = None
        async with self._http.stream_lines(
            f"{self._base}/v1/messages", self._headers(), self._body(request, True)
        ) as lines:
            async for line in lines:
                event = sse_data(line)
                if event is None:
                    continue
                kind = event.get("type")
                if kind == "message_start":
                    usage = obj(obj(event.get("message")).get("usage"))
                    input_tokens = integer(usage.get("input_tokens"))
                elif kind == "content_block_delta":
                    delta = obj(event.get("delta"))
                    if delta.get("type") == "text_delta" and text(delta.get("text")):
                        yield StreamChunk(text=text(delta.get("text")))
                elif kind == "message_delta":
                    usage = obj(event.get("usage"))
                    yield StreamChunk(
                        usage=TokenUsage(
                            input_tokens=input_tokens,
                            output_tokens=integer(usage.get("output_tokens")),
                        )
                    )
                elif kind == "error":
                    raise self._http.malformed()

    async def embed(self, model: str, texts: Sequence[str]) -> Embeddings:
        raise UnsupportedCapabilityError(
            "Anthropic doesn't offer embeddings. Choose another provider for semantic search."
        )

    async def list_models(self) -> list[ModelInfo]:
        data = await self._http.get(f"{self._base}/v1/models?limit=100", self._headers())
        names = sorted({text(obj(row).get("id")) for row in items(data.get("data"))} - {""})
        return [ModelInfo(id=name, embeddings=False, chat=True) for name in names]
