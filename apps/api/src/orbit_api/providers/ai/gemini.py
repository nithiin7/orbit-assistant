"""Google's Gemini API (Generative Language API). The key goes in the `x-goog-api-key` header,
never in the URL, so it can't end up in proxy or access logs."""

from collections.abc import AsyncIterator, Sequence
from urllib.parse import quote

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
from orbit_api.services.ai.providers import KIND_CAPABILITIES

# Gemini's batch embedding endpoint takes at most this many texts per request.
BATCH_LIMIT = 100


class GeminiProvider:
    def __init__(self, http: ProviderHttp, base_url: str, api_key: str | None) -> None:
        self._http = http
        self._base = base_url.rstrip("/")
        self._api_key = api_key

    @property
    def kind(self) -> ProviderKind:
        return "gemini"

    @property
    def capabilities(self) -> Capabilities:
        return KIND_CAPABILITIES["gemini"]

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["x-goog-api-key"] = self._api_key
        return headers

    def _model_url(self, model: str, method: str) -> str:
        name = model.removeprefix("models/")
        return f"{self._base}/v1beta/models/{quote(name, safe='-._')}:{method}"

    def _body(self, request: ChatRequest) -> Json:
        system = "\n\n".join(m.content for m in request.messages if m.role == "system")
        config: Json = {
            "temperature": request.temperature,
            "maxOutputTokens": request.max_tokens,
        }
        if request.json_mode:
            config["responseMimeType"] = "application/json"
        body: Json = {
            "contents": [
                {
                    "role": "model" if m.role == "assistant" else "user",
                    "parts": [{"text": m.content}],
                }
                for m in request.messages
                if m.role != "system"
            ],
            "generationConfig": config,
        }
        if system:
            body["systemInstruction"] = {"parts": [{"text": system}]}
        return body

    async def complete(self, request: ChatRequest) -> Completion:
        data = await self._http.post(
            self._model_url(request.model, "generateContent"), self._headers(), self._body(request)
        )
        return Completion(text=_candidate_text(data), usage=_usage(data))

    async def stream(self, request: ChatRequest) -> AsyncIterator[StreamChunk]:
        url = f"{self._model_url(request.model, 'streamGenerateContent')}?alt=sse"
        usage: TokenUsage | None = None
        async with self._http.stream_lines(url, self._headers(), self._body(request)) as lines:
            async for line in lines:
                event = sse_data(line)
                if event is None:
                    continue
                piece = _candidate_text(event)
                if piece:
                    yield StreamChunk(text=piece)
                if obj(event.get("usageMetadata")):
                    usage = _usage(event)
        if usage is not None:
            yield StreamChunk(usage=usage)

    async def embed(self, model: str, texts: Sequence[str]) -> Embeddings:
        name = f"models/{model.removeprefix('models/')}"
        vectors: list[list[float]] = []
        for start in range(0, len(texts), BATCH_LIMIT):
            batch = texts[start : start + BATCH_LIMIT]
            data = await self._http.post(
                self._model_url(model, "batchEmbedContents"),
                self._headers(),
                {"requests": [{"model": name, "content": {"parts": [{"text": t}]}} for t in batch]},
            )
            found = [floats(obj(row).get("values")) for row in items(data.get("embeddings"))]
            if len(found) != len(batch) or any(v is None for v in found):
                raise self._http.malformed()
            vectors.extend(v for v in found if v is not None)
        # Gemini doesn't report token counts for embeddings.
        return Embeddings(vectors=vectors)

    async def list_models(self) -> list[ModelInfo]:
        data = await self._http.get(f"{self._base}/v1beta/models?pageSize=200", self._headers())
        models: list[ModelInfo] = []
        for row in items(data.get("models")):
            entry = obj(row)
            name = text(entry.get("name")).removeprefix("models/")
            methods = {text(m) for m in items(entry.get("supportedGenerationMethods"))}
            if name:
                models.append(
                    ModelInfo(
                        id=name,
                        embeddings=bool(methods & {"embedContent", "batchEmbedContents"}),
                        chat="generateContent" in methods,
                    )
                )
        return sorted(models, key=lambda m: m.id)


def _candidate_text(data: Json) -> str:
    candidates = items(data.get("candidates"))
    if not candidates:
        return ""
    parts = items(obj(obj(candidates[0]).get("content")).get("parts"))
    return "".join(text(obj(part).get("text")) for part in parts)


def _usage(data: Json) -> TokenUsage:
    meta = obj(data.get("usageMetadata"))
    return TokenUsage(
        input_tokens=integer(meta.get("promptTokenCount")),
        output_tokens=integer(meta.get("candidatesTokenCount")),
    )
