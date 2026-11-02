"""Provider adapters against mocked HTTP: request shapes, streaming, embeddings, model
listing, capability gaps, and error mapping that never leaks keys."""

import json
import uuid
from collections.abc import Callable
from datetime import UTC, datetime

import httpx2
import pytest

from orbit_api.providers.ai.registry import HttpProviderFactory
from orbit_api.services.ai.models import (
    ChatMessage,
    ChatRequest,
    ProviderConnection,
    ProviderKind,
    StreamChunk,
)
from orbit_api.services.ai.providers import (
    AiProvider,
    ProviderAuthError,
    ProviderRateLimitError,
    ProviderRequestError,
    ProviderUnavailableError,
    UnsupportedCapabilityError,
)

pytestmark = pytest.mark.anyio

KEY = "sk-secret-123456"
NOW = datetime(2026, 11, 2, tzinfo=UTC)
REQUEST = ChatRequest(
    model="m",
    messages=[ChatMessage("system", "rules"), ChatMessage("user", "hi")],
)

Handler = Callable[[httpx2.Request], httpx2.Response]


def provider(kind: ProviderKind, handler: Handler, base_url: str | None = None) -> AiProvider:
    connection = ProviderConnection(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        name="Test",
        kind=kind,
        base_url=base_url,
        api_key_ciphertext=None,
        input_price=None,
        output_price=None,
        created_at=NOW,
        updated_at=NOW,
    )
    factory = HttpProviderFactory(transport=httpx2.MockTransport(handler))
    return factory.build(connection, KEY)


def sse(*events: object) -> httpx2.Response:
    body = "".join(f"data: {json.dumps(e)}\n\n" for e in events) + "data: [DONE]\n\n"
    return httpx2.Response(200, text=body, headers={"content-type": "text/event-stream"})


async def collect(adapter: AiProvider) -> tuple[str, list[StreamChunk]]:
    chunks = [chunk async for chunk in adapter.stream(REQUEST)]
    return "".join(c.text for c in chunks), chunks


async def test_openai_completes_with_bearer_key_and_usage() -> None:
    seen: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return httpx2.Response(
            200,
            json={
                "choices": [{"message": {"content": "Hello"}}],
                "usage": {"prompt_tokens": 5, "completion_tokens": 2},
            },
        )

    result = await provider("openai", handler).complete(REQUEST)
    assert result.text == "Hello"
    assert (result.usage.input_tokens, result.usage.output_tokens) == (5, 2)
    assert seen[0].url == "https://api.openai.com/v1/chat/completions"
    assert seen[0].headers["authorization"] == f"Bearer {KEY}"
    assert json.loads(seen[0].content)["messages"][0] == {"role": "system", "content": "rules"}


async def test_openai_streams_deltas_then_usage() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        assert json.loads(request.content)["stream_options"] == {"include_usage": True}
        return sse(
            {"choices": [{"delta": {"content": "Hel"}}]},
            {"choices": [{"delta": {"content": "lo"}}]},
            {"choices": [], "usage": {"prompt_tokens": 3, "completion_tokens": 1}},
        )

    text, chunks = await collect(provider("openai", handler))
    assert text == "Hello"
    assert chunks[-1].usage is not None and chunks[-1].usage.input_tokens == 3


async def test_openai_compatible_servers_get_no_vendor_only_options() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        assert "stream_options" not in json.loads(request.content)
        assert str(request.url).startswith("http://localhost:1234/v1/")
        return sse({"choices": [{"delta": {"content": "ok"}}]})

    text, _ = await collect(provider("openai_compatible", handler, "http://localhost:1234/v1"))
    assert text == "ok"


async def test_openai_embeddings_keep_input_order() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(
            200,
            json={
                "data": [
                    {"index": 1, "embedding": [0.0, 1.0]},
                    {"index": 0, "embedding": [1.0, 0.0]},
                ],
                "usage": {"prompt_tokens": 4},
            },
        )

    result = await provider("openai", handler).embed("e", ["a", "b"])
    assert result.vectors == [[1.0, 0.0], [0.0, 1.0]]


async def test_anthropic_sends_system_separately_and_streams() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        body = json.loads(request.content)
        assert request.headers["x-api-key"] == KEY
        assert body["system"] == "rules"
        assert [m["role"] for m in body["messages"]] == ["user"]
        return sse(
            {"type": "message_start", "message": {"usage": {"input_tokens": 9}}},
            {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Hi"}},
            {"type": "message_delta", "usage": {"output_tokens": 1}},
        )

    text, chunks = await collect(provider("anthropic", handler))
    assert text == "Hi"
    assert chunks[-1].usage is not None
    assert (chunks[-1].usage.input_tokens, chunks[-1].usage.output_tokens) == (9, 1)


async def test_anthropic_reports_embeddings_as_unsupported() -> None:
    adapter = provider("anthropic", lambda r: httpx2.Response(500))
    assert not adapter.capabilities.embeddings
    with pytest.raises(UnsupportedCapabilityError):
        await adapter.embed("m", ["x"])


async def test_gemini_puts_the_key_in_a_header_never_the_url() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        assert KEY not in str(request.url)
        assert request.headers["x-goog-api-key"] == KEY
        if request.url.path.endswith(":batchEmbedContents"):
            return httpx2.Response(200, json={"embeddings": [{"values": [0.5, 0.5]}]})
        if request.method == "GET":
            return httpx2.Response(
                200,
                json={
                    "models": [
                        {
                            "name": "models/g-chat",
                            "supportedGenerationMethods": ["generateContent"],
                        },
                        {"name": "models/g-embed", "supportedGenerationMethods": ["embedContent"]},
                    ]
                },
            )
        body = json.loads(request.content)
        assert body["systemInstruction"]["parts"][0]["text"] == "rules"
        return httpx2.Response(
            200,
            json={
                "candidates": [{"content": {"parts": [{"text": "G"}]}}],
                "usageMetadata": {"promptTokenCount": 2, "candidatesTokenCount": 1},
            },
        )

    adapter = provider("gemini", handler)
    assert (await adapter.complete(REQUEST)).text == "G"
    assert (await adapter.embed("g-embed", ["x"])).vectors == [[0.5, 0.5]]
    models = await adapter.list_models()
    assert [(m.id, m.chat, m.embeddings) for m in models] == [
        ("g-chat", True, False),
        ("g-embed", False, True),
    ]


async def test_ollama_streams_ndjson_and_lists_models() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        if request.url.path == "/api/tags":
            return httpx2.Response(
                200, json={"models": [{"name": "llama3"}, {"name": "nomic-embed-text"}]}
            )
        lines = [
            {"message": {"content": "lo"}, "done": False},
            {"message": {"content": "cal"}, "done": True, "prompt_eval_count": 4, "eval_count": 2},
        ]
        return httpx2.Response(200, text="\n".join(json.dumps(line) for line in lines))

    adapter = provider("ollama", handler)
    text, chunks = await collect(adapter)
    assert text == "local"
    assert chunks[-1].usage is not None and chunks[-1].usage.output_tokens == 2
    models = await adapter.list_models()
    assert [(m.id, m.embeddings) for m in models] == [("llama3", False), ("nomic-embed-text", True)]


@pytest.mark.parametrize(
    ("status", "error"),
    [
        (401, ProviderAuthError),
        (429, ProviderRateLimitError),
        (503, ProviderUnavailableError),
        (404, ProviderRequestError),
    ],
)
async def test_http_errors_map_to_safe_errors_without_the_key(
    status: int, error: type[Exception]
) -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(status, json={"error": {"message": f"bad key {KEY} or model"}})

    with pytest.raises(error) as raised:
        await provider("openai", handler).complete(REQUEST)
    assert KEY not in str(raised.value)
    if status == 404:
        assert "[redacted]" in str(raised.value)


async def test_unreachable_providers_are_reported_as_unavailable() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("refused")

    with pytest.raises(ProviderUnavailableError):
        await provider("ollama", handler).complete(REQUEST)
    with pytest.raises(ProviderUnavailableError):
        await collect(provider("ollama", handler))
