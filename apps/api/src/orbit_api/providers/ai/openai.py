"""OpenAI's API, and servers that implement its chat completions and embeddings endpoints (LM
Studio, llama.cpp's server, vLLM, and others) as `openai_compatible`."""

from collections.abc import AsyncIterator, Sequence

from orbit_api.providers.ai.http import (
    Json,
    ProviderHttp,
    floats,
    integer,
    items,
    obj,
    sse_data,
    text,
)
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
from orbit_api.services.ai.providers import (
    KIND_CAPABILITIES,
    ProviderRequestError,
    looks_like_embedding_model,
)


class OpenAiProvider:
    def __init__(
        self, http: ProviderHttp, base_url: str, api_key: str | None, kind: ProviderKind
    ) -> None:
        self._http = http
        self._base = base_url.rstrip("/")
        self._api_key = api_key
        self._kind: ProviderKind = kind

    @property
    def kind(self) -> ProviderKind:
        return self._kind

    @property
    def capabilities(self) -> Capabilities:
        return KIND_CAPABILITIES[self._kind]

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        return headers

    def _body(self, request: ChatRequest, stream: bool) -> Json:
        body: Json = {
            "model": request.model,
            "messages": [{"role": m.role, "content": m.content} for m in request.messages],
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
            "stream": stream,
        }
        if request.json_mode:
            body["response_format"] = {"type": "json_object"}
        if stream and self._kind == "openai":
            # Other servers may reject unknown options; only OpenAI is asked for stream usage.
            body["stream_options"] = {"include_usage": True}
        return body

    async def complete(self, request: ChatRequest) -> Completion:
        data = await self._http.post(
            f"{self._base}/chat/completions", self._headers(), self._body(request, False)
        )
        choices = items(data.get("choices"))
        if not choices:
            raise self._http.malformed()
        content = text(obj(obj(choices[0]).get("message")).get("content"))
        return Completion(text=content, usage=_usage(data.get("usage")))

    async def stream(self, request: ChatRequest) -> AsyncIterator[StreamChunk]:
        async with self._http.stream_lines(
            f"{self._base}/chat/completions", self._headers(), self._body(request, True)
        ) as lines:
            async for line in lines:
                event = sse_data(line)
                if event is None:
                    continue
                for choice in items(event.get("choices")):
                    delta = text(obj(obj(choice).get("delta")).get("content"))
                    if delta:
                        yield StreamChunk(text=delta)
                if obj(event.get("usage")):
                    yield StreamChunk(usage=_usage(event.get("usage")))

    async def embed(self, model: str, texts: Sequence[str]) -> Embeddings:
        data = await self._http.post(
            f"{self._base}/embeddings", self._headers(), {"model": model, "input": list(texts)}
        )
        rows = sorted(
            (obj(row) for row in items(data.get("data"))),
            key=lambda row: integer(row.get("index")) or 0,
        )
        vectors = [floats(row.get("embedding")) for row in rows]
        if len(vectors) != len(texts) or any(v is None for v in vectors):
            raise self._http.malformed()
        return Embeddings(
            vectors=[v for v in vectors if v is not None], usage=_usage(data.get("usage"))
        )

    async def list_models(self) -> list[ModelInfo]:
        data = await self._http.get(f"{self._base}/models", self._headers())
        names = sorted({text(obj(row).get("id")) for row in items(data.get("data"))} - {""})
        if not names and "data" not in data:
            raise ProviderRequestError("The server didn't list any models.")
        return [
            ModelInfo(
                id=name,
                embeddings=looks_like_embedding_model(name),
                chat=not looks_like_embedding_model(name),
            )
            for name in names
        ]


def _usage(value: object) -> TokenUsage:
    usage = obj(value)
    return TokenUsage(
        input_tokens=integer(usage.get("prompt_tokens")),
        output_tokens=integer(usage.get("completion_tokens")),
    )
