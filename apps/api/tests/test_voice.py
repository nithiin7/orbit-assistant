"""Voice through the API with a fake speech provider: settings and consent, transcription and
speech (never stored), voice-originated messages in the ordinary conversation, spoken
confirmation that can't bypass approval, history deletion and retention, and isolation."""

import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.main import create_app
from orbit_api.scheduler.worker import ReminderWorker
from orbit_api.services.agent.models import Approval
from orbit_api.services.ai.models import ChatRequest, Proposal
from orbit_api.services.ai.providers import ProviderUnavailableError
from orbit_api.services.voice.approvals import answer_approval, answer_proposal
from orbit_api.services.voice.confirmation import classify_reply
from orbit_api.services.voice.service import language_code
from tests.ai_fakes import FakeProviderFactory, FakeState
from tests.support import FAST_PASSWORD_HASHER, bearer, sign_up
from tests.voice_fakes import FakeAudioFactory

WORKSPACES = "/api/v1/workspaces"
AI = "/api/v1/me/ai"
VOICE = "/api/v1/me/voice"
KEY = "sk-live-abcdef123456"

Headers = dict[str, str]
Json = dict[str, Any]


@pytest.fixture
def fake() -> FakeProviderFactory:
    return FakeProviderFactory(FakeState())


@pytest.fixture
def audio() -> FakeAudioFactory:
    return FakeAudioFactory()


@pytest.fixture
def app(migrated_settings: Settings, fake: FakeProviderFactory, audio: FakeAudioFactory) -> FastAPI:
    app = create_app(migrated_settings.model_copy(update={"local_open_registration": True}))
    app.state.password_hasher = FAST_PASSWORD_HASHER
    app.state.ai_providers = fake
    app.state.voice_providers = audio
    return app


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def ada(client: TestClient) -> Headers:
    return bearer(sign_up(client, email="ada@example.com", display_name="Ada"))


@pytest.fixture
def grace(client: TestClient) -> Headers:
    return bearer(sign_up(client, email="grace@example.com", display_name="Grace"))


def personal(client: TestClient, headers: Headers) -> str:
    workspace: Json = client.get(WORKSPACES, headers=headers).json()["workspaces"][0]
    return f"{WORKSPACES}/{workspace['id']}"


@pytest.fixture
def ws(client: TestClient, ada: Headers) -> str:
    return personal(client, ada)


def ok(response: Any, status: int = 200) -> Json:
    assert response.status_code == status, response.text
    return response.json() if response.content else {}


def provider(client: TestClient, headers: Headers, *, kind: str = "openai_compatible") -> str:
    body: Json = {"name": f"P{kind}", "kind": kind}
    if kind == "openai_compatible":
        body["base_url"] = "http://127.0.0.1:8880/v1"
    if kind in ("openai", "openai_compatible"):
        body["api_key"] = KEY
    return str(ok(client.post(f"{AI}/providers", json=body, headers=headers), 201)["id"])


def enable_ai(client: TestClient, headers: Headers, chat_provider: str, **extra: Any) -> None:
    ok(
        client.patch(
            f"{AI}/settings",
            json={
                "enabled": True,
                "chat_provider_id": chat_provider,
                "chat_model": "chat-model",
                **extra,
            },
            headers=headers,
        )
    )


def voice_body(**changes: Any) -> Json:
    body: Json = {
        "stt_engine": "browser",
        "stt_provider_id": None,
        "stt_model": None,
        "tts_engine": "browser",
        "tts_provider_id": None,
        "tts_model": None,
        "tts_voice": None,
        "recognition_language": "en-IN",
        "response_language": None,
        "listening_mode": "continuous",
        "silence_ms": 900,
        "sensitivity": 5,
        "auto_speak": True,
        "speaking_rate": 100,
        "history_days": None,
    }
    return {**body, **changes}


def use_provider_voice(client: TestClient, headers: Headers, provider_id: str) -> Json:
    return ok(
        client.put(
            f"{VOICE}/settings",
            json=voice_body(
                stt_engine="provider",
                stt_provider_id=provider_id,
                stt_model="whisper-1",
                tts_engine="provider",
                tts_provider_id=provider_id,
                tts_model="tts-1",
                tts_voice="calm",
            ),
            headers=headers,
        )
    )


@pytest.fixture
def ready(client: TestClient, ada: Headers) -> str:
    """Ada with AI on and a local OpenAI-compatible server for chat and speech."""
    provider_id = provider(client, ada)
    enable_ai(client, ada, provider_id)
    use_provider_voice(client, ada, provider_id)
    return provider_id


def transcribe(
    client: TestClient, ws: str, headers: Headers, data: bytes = b"\x1aE\xdf\xa3voice", **kw: Any
) -> Any:
    content_type = kw.pop("content_type", "audio/webm;codecs=opus")
    return client.post(
        f"{ws}/voice/transcriptions",
        content=data,
        headers={**headers, "Content-Type": content_type},
        params=kw,
    )


def ask(client: TestClient, ws: str, headers: Headers, text: str, **body: Any) -> str:
    response = client.post(f"{ws}/ai/messages", json={"content": text, **body}, headers=headers)
    assert response.status_code == 200, response.text
    return response.text


def conversation_of(client: TestClient, ws: str, headers: Headers) -> Json:
    [first] = ok(client.get(f"{ws}/ai/conversations", headers=headers))["conversations"]
    return ok(client.get(f"{ws}/ai/conversations/{first['id']}", headers=headers))


# Settings


def test_voice_defaults_to_the_browser_and_never_stores_audio(
    client: TestClient, ada: Headers
) -> None:
    settings = ok(client.get(f"{VOICE}/settings", headers=ada))
    assert settings["stt_engine"] == "browser" and settings["tts_engine"] == "browser"
    assert settings["recognition_language"] == "auto"
    assert settings["stores_audio"] is False
    assert settings["stt_processing"] == "browser" and settings["ai_enabled"] is False
    assert settings["history_days"] is None


def test_only_providers_with_an_audio_api_are_offered(client: TestClient, ada: Headers) -> None:
    compatible = provider(client, ada)
    ollama = provider(client, ada, kind="ollama")
    settings = ok(client.get(f"{VOICE}/settings", headers=ada))
    assert [(p["id"], p["processing"]) for p in settings["providers"]] == [(compatible, "local")]
    response = client.put(
        f"{VOICE}/settings",
        json=voice_body(stt_engine="provider", stt_provider_id=ollama, stt_model="m"),
        headers=ada,
    )
    assert response.status_code == 422


def test_settings_are_validated_and_scoped_to_the_person(
    client: TestClient, ada: Headers, grace: Headers
) -> None:
    mine = provider(client, ada)
    # A provider engine needs a provider and model; speech also a voice.
    assert (
        client.put(f"{VOICE}/settings", json=voice_body(stt_engine="provider"), headers=ada)
    ).status_code == 409
    no_voice = voice_body(tts_engine="provider", tts_provider_id=mine, tts_model="tts-1")
    assert client.put(f"{VOICE}/settings", json=no_voice, headers=ada).status_code == 409
    # Someone else's provider is not found.
    theirs = voice_body(stt_engine="provider", stt_provider_id=mine, stt_model="whisper-1")
    assert client.put(f"{VOICE}/settings", json=theirs, headers=grace).status_code == 404
    for bad in (
        {"recognition_language": "english please"},
        {"silence_ms": 50},
        {"speaking_rate": 400},
        {"history_days": 0},
        {"sensitivity": 11},
    ):
        assert (
            client.put(f"{VOICE}/settings", json=voice_body(**bad), headers=ada).status_code == 422
        )
    saved = ok(
        client.put(
            f"{VOICE}/settings",
            json=voice_body(recognition_language="hi-IN", history_days=30, stt_model="ignored"),
            headers=ada,
        )
    )
    # Browser engines drop provider choices.
    assert saved["recognition_language"] == "hi-IN" and saved["stt_model"] is None
    assert saved["history_days"] == 30
    assert ok(client.get(f"{VOICE}/settings", headers=grace))["recognition_language"] == "auto"


def test_deleting_a_provider_clears_it_from_voice_settings(
    client: TestClient, ada: Headers, ready: str
) -> None:
    ok(client.delete(f"{AI}/providers/{ready}", headers=ada), 204)
    settings = ok(client.get(f"{VOICE}/settings", headers=ada))
    assert settings["stt_provider_id"] is None and settings["tts_provider_id"] is None
    assert settings["stt_processing"] is None


def test_voices_are_listed_when_the_provider_lists_them(
    client: TestClient, ada: Headers, ready: str, audio: FakeAudioFactory
) -> None:
    listed = ok(client.get(f"{VOICE}/providers/{ready}/voices", headers=ada))
    assert listed["voices"] == [{"id": "calm", "name": "Calm"}]
    audio.state.voices_error = ProviderUnavailableError("no list")
    assert ok(client.get(f"{VOICE}/providers/{ready}/voices", headers=ada))["voices"] == []
    unknown = uuid.uuid4()
    assert client.get(f"{VOICE}/providers/{unknown}/voices", headers=ada).status_code == 404


# Transcription and speech


def test_transcription_needs_ai_on_and_a_configured_provider(
    client: TestClient, ada: Headers, ws: str
) -> None:
    mine = provider(client, ada)
    use_provider_voice(client, ada, mine)
    # AI off.
    assert transcribe(client, ws, ada).status_code == 409
    enable_ai(client, ada, mine)
    ok(client.put(f"{VOICE}/settings", json=voice_body(), headers=ada))
    # Browser recognition: the server doesn't transcribe.
    assert transcribe(client, ws, ada).status_code == 409


def test_transcribes_an_utterance_and_records_usage_without_storing_audio(
    client: TestClient, ada: Headers, ws: str, ready: str, audio: FakeAudioFactory
) -> None:
    result = ok(transcribe(client, ws, ada))
    assert result["text"] == "What do I have tomorrow?" and result["language"] == "en"
    # `en-IN` is sent as the ISO 639-1 code the API expects; the key reaches only the adapter.
    assert audio.state.transcribed == [("whisper-1", 9, "audio/webm", "en")]
    assert audio.state.keys == [KEY]
    ok(transcribe(client, ws, ada, language="hi-IN"))
    assert audio.state.transcribed[-1][3] == "hi"
    usage = ok(client.get(f"{AI}/usage", headers=ada))
    assert any(line["operation"] == "transcription" for line in usage["lines"])
    assert KEY not in str(usage)


def test_bad_audio_is_refused(client: TestClient, ada: Headers, ws: str, ready: str) -> None:
    assert transcribe(client, ws, ada, content_type="text/plain").status_code == 422
    assert transcribe(client, ws, ada, data=b"").status_code == 422
    too_big = b"\x00" * (10 * 1024 * 1024 + 1)
    assert transcribe(client, ws, ada, data=too_big).status_code == 413


def test_provider_failures_are_safe_errors(
    client: TestClient, ada: Headers, ws: str, ready: str, audio: FakeAudioFactory
) -> None:
    audio.state.error = ProviderUnavailableError("Couldn't reach the server.")
    response = transcribe(client, ws, ada)
    assert response.status_code == 502 and KEY not in response.text
    speech = client.post(f"{ws}/voice/speech", json={"text": "Hello"}, headers=ada)
    assert speech.status_code == 502


def test_cloud_speech_needs_cloud_consent(client: TestClient, ada: Headers, ws: str) -> None:
    local = provider(client, ada)
    cloud = provider(client, ada, kind="openai")
    enable_ai(client, ada, local)
    use_provider_voice(client, ada, cloud)
    assert ok(client.get(f"{VOICE}/settings", headers=ada))["stt_processing"] == "cloud"
    assert transcribe(client, ws, ada).status_code == 409
    ok(client.patch(f"{AI}/settings", json={"allow_cloud": True}, headers=ada))
    assert transcribe(client, ws, ada).status_code == 200


def test_speech_streams_audio_in_order(
    client: TestClient, ada: Headers, ws: str, ready: str, audio: FakeAudioFactory
) -> None:
    response = client.post(f"{ws}/voice/speech", json={"text": "Your  day\nis clear."}, headers=ada)
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/mpeg"
    assert response.content == b"ID3\x00audio-1\x00audio-2"
    assert audio.state.spoken == [("tts-1", "calm", "Your day is clear.", 1.0)]
    too_long = client.post(f"{ws}/voice/speech", json={"text": "a" * 2001}, headers=ada)
    assert too_long.status_code == 422


def test_connection_test_speaks_then_transcribes(
    client: TestClient, ada: Headers, ws: str, ready: str, audio: FakeAudioFactory
) -> None:
    result = ok(client.post(f"{ws}/voice/test", headers=ada))
    assert result["ok"] is True and result["speech_ms"] is not None
    assert result["transcription_ms"] is not None
    assert audio.state.transcribed[-1][2] == "audio/mpeg"
    audio.state.error = ProviderUnavailableError("Couldn't reach the server.")
    failed = ok(client.post(f"{ws}/voice/test", headers=ada))
    assert failed["ok"] is False and failed["message"] == "Couldn't reach the server."


def test_speech_and_transcription_are_workspace_scoped(
    client: TestClient, ada: Headers, grace: Headers, ws: str, ready: str
) -> None:
    assert transcribe(client, ws, grace).status_code == 404
    assert client.post(f"{ws}/voice/speech", json={"text": "Hi"}, headers=grace).status_code == 404
    assert client.post(f"{ws}/voice/speech", json={"text": "Hi"}).status_code == 401


# Conversations


def test_spoken_questions_join_the_same_conversation_as_typed_ones(
    client: TestClient, ada: Headers, ws: str, ready: str, fake: FakeProviderFactory
) -> None:
    fake.state.script = lambda request: "You have a dentist visit."
    ask(client, ws, ada, "What do I have tomorrow?", input_mode="voice")
    conversation = conversation_of(client, ws, ada)
    conversation_id = conversation["id"]
    # Switch to typing in the same conversation: the spoken turn is context for the follow-up.
    ask(client, ws, ada, "And after that?", conversation_id=conversation_id)
    prompt = "\n".join(m.content for m in fake.state.requests[-1].messages)
    assert "What do I have tomorrow?" in prompt and "You have a dentist visit." in prompt
    messages = conversation_of(client, ws, ada)["messages"]
    assert [(m["role"], m["input_mode"]) for m in messages] == [
        ("user", "voice"),
        ("assistant", "text"),
        ("user", "text"),
        ("assistant", "text"),
    ]


def test_input_mode_is_validated(client: TestClient, ada: Headers, ws: str, ready: str) -> None:
    response = client.post(
        f"{ws}/ai/messages", json={"content": "Hi", "input_mode": "telepathy"}, headers=ada
    )
    assert response.status_code == 422


def test_clearing_voice_history_keeps_typed_conversations(
    client: TestClient, ada: Headers, grace: Headers, ws: str, ready: str
) -> None:
    ask(client, ws, ada, "Spoken question", input_mode="voice")
    ask(client, ws, ada, "Typed question")
    other = provider(client, grace)
    enable_ai(client, grace, other)
    grace_ws = personal(client, grace)
    ask(client, grace_ws, grace, "Grace speaks", input_mode="voice")
    # Grace can't clear Ada's workspace.
    assert client.delete(f"{ws}/voice/history", headers=grace).status_code == 404
    assert ok(client.delete(f"{ws}/voice/history", headers=ada))["removed"] == 1
    titles = [
        c["title"] for c in ok(client.get(f"{ws}/ai/conversations", headers=ada))["conversations"]
    ]
    assert titles == ["Typed question"]
    assert len(ok(client.get(f"{grace_ws}/ai/conversations", headers=grace))["conversations"]) == 1


def test_worker_deletes_spoken_conversations_past_retention(
    client: TestClient, app: FastAPI, ada: Headers, ws: str, ready: str
) -> None:
    settings = ok(client.get(f"{VOICE}/settings", headers=ada))
    body = {k: settings[k] for k in voice_body()}
    ok(client.put(f"{VOICE}/settings", json={**body, "history_days": 7}, headers=ada))
    ask(client, ws, ada, "Spoken question", input_mode="voice")
    ask(client, ws, ada, "Typed question")
    assert client.portal is not None
    now = ReminderWorker(app.state.database)
    assert client.portal.call(now.purge_voice_history) == 0
    later = ReminderWorker(app.state.database, clock=lambda: datetime.now(UTC) + timedelta(days=8))
    assert client.portal.call(later.purge_voice_history) == 1
    titles = [
        c["title"] for c in ok(client.get(f"{ws}/ai/conversations", headers=ada))["conversations"]
    ]
    assert titles == ["Typed question"]


# Spoken confirmation


def propose_task(request: ChatRequest) -> str:
    return (
        "I'll draft it.\n```orbit-action\n"
        '{"kind": "create_task", "payload": {"title": "Renew passport"}}\n```'
    )


def spoken_proposal(client: TestClient, ws: str, headers: Headers) -> tuple[str, str]:
    # Nothing readable, so the proposal isn't flagged as made while reading records.
    ok(client.patch(f"{AI}/settings", json={"modules": []}, headers=headers))
    ask(client, ws, headers, "Create a task to renew my passport", input_mode="voice")
    detail = conversation_of(client, ws, headers)
    [proposal] = detail["proposals"]
    return str(proposal["id"]), str(detail["id"])


def answer(client: TestClient, ws: str, headers: Headers, **body: Any) -> Any:
    return client.post(f"{ws}/voice/confirmations", json=body, headers=headers)


def test_only_a_clear_yes_approves_and_only_once(
    client: TestClient, ada: Headers, ws: str, ready: str, fake: FakeProviderFactory
) -> None:
    fake.state.script = propose_task
    proposal_id, conversation_id = spoken_proposal(client, ws, ada)
    binding = {"target": "proposal", "id": proposal_id, "conversation_id": conversation_id}
    for unclear in ("maybe later", "yes no", "is it done?", "yes and also add milk to shopping"):
        result = ok(answer(client, ws, ada, transcript=unclear, **binding))
        assert result["outcome"] == "unclear" and result["proposal"]["status"] == "pending"
    assert ok(client.get(f"{ws}/tasks", headers=ada))["total"] == 0
    result = ok(answer(client, ws, ada, transcript="Yes, go ahead.", **binding))
    assert result["outcome"] == "approved" and result["proposal"]["status"] == "executed"
    assert result["message"] == "Done."
    again = ok(answer(client, ws, ada, transcript="yes", **binding))
    assert again["outcome"] == "not_pending"
    assert ok(client.get(f"{ws}/tasks", headers=ada))["total"] == 1


def test_proposals_made_while_reading_records_need_the_screen(
    client: TestClient, ada: Headers, ws: str, ready: str, fake: FakeProviderFactory
) -> None:
    fake.state.script = propose_task
    ok(client.post(f"{ws}/tasks", json={"title": "Old task"}, headers=ada), 201)
    ask(client, ws, ada, "Create a task to renew my passport", input_mode="voice")
    detail = conversation_of(client, ws, ada)
    [proposal] = detail["proposals"]
    assert proposal["from_untrusted_context"] is True
    result = ok(
        answer(
            client,
            ws,
            ada,
            target="proposal",
            id=proposal["id"],
            conversation_id=detail["id"],
            transcript="yes",
        )
    )
    assert result["outcome"] == "needs_screen" and result["proposal"]["status"] == "pending"
    assert ok(client.get(f"{ws}/tasks", headers=ada))["total"] == 1


def test_a_spoken_no_rejects(
    client: TestClient, ada: Headers, ws: str, ready: str, fake: FakeProviderFactory
) -> None:
    fake.state.script = propose_task
    proposal_id, conversation_id = spoken_proposal(client, ws, ada)
    result = ok(
        answer(
            client,
            ws,
            ada,
            target="proposal",
            id=proposal_id,
            conversation_id=conversation_id,
            transcript="nahi, cancel it",
        )
    )
    assert result["outcome"] == "rejected" and result["proposal"]["status"] == "rejected"
    assert ok(client.get(f"{ws}/tasks", headers=ada))["total"] == 0


def test_confirmation_is_bound_to_the_conversation_person_and_workspace(
    client: TestClient, ada: Headers, grace: Headers, ws: str, ready: str, fake: FakeProviderFactory
) -> None:
    fake.state.script = propose_task
    proposal_id, _ = spoken_proposal(client, ws, ada)
    elsewhere = {"target": "proposal", "id": proposal_id, "transcript": "yes"}
    assert (
        answer(client, ws, ada, conversation_id=str(uuid.uuid4()), **elsewhere).status_code == 404
    )
    other = provider(client, grace)
    enable_ai(client, grace, other)
    grace_ws = personal(client, grace)
    assert (
        answer(client, grace_ws, grace, conversation_id=str(uuid.uuid4()), **elsewhere).status_code
        == 404
    )
    assert (
        answer(client, ws, grace, conversation_id=str(uuid.uuid4()), **elsewhere).status_code == 404
    )
    # Missing bindings are invalid requests.
    assert answer(client, ws, ada, **elsewhere).status_code == 422
    no_hash = {"target": "agent_approval", "id": str(uuid.uuid4()), "transcript": "yes"}
    assert answer(client, ws, ada, **no_hash).status_code == 422
    unknown = {**no_hash, "arguments_hash": "0" * 64}
    assert answer(client, ws, ada, **unknown).status_code == 404
    assert ok(client.get(f"{ws}/tasks", headers=ada))["total"] == 0


# Spoken confirmation rules, without the engines


def test_replies_are_read_strictly() -> None:
    for yes in (
        "yes",
        "Yes please",
        "OK, do it",
        "go ahead",
        "confirm",
        "haan",
        "haan ji",
        "हाँ",
        "theek hai",
    ):
        assert classify_reply(yes) == "confirm", yes
    for no in ("no", "No thanks", "cancel", "don't do it", "nahi", "mat karo", "stop", "नहीं"):
        assert classify_reply(no) == "reject", no
    for unclear in (
        "",
        "please",
        "do it",
        "yes no",
        "what?",
        "no yes",
        "the weather is nice today",
        "yes and remind me to call mom tomorrow",
        "don't, okay",
    ):
        assert classify_reply(unclear) == "unclear", unclear


def test_language_codes_for_transcription() -> None:
    assert language_code("en-IN") == "en" and language_code("hi-IN") == "hi"
    assert language_code("auto") is None and language_code(None) is None


NOW = datetime(2026, 11, 15, tzinfo=UTC)
WS, USER = uuid.uuid4(), uuid.uuid4()


def a_proposal(**changes: Any) -> Proposal:
    proposal = Proposal(
        id=uuid.uuid4(),
        workspace_id=WS,
        user_id=USER,
        conversation_id=uuid.uuid4(),
        message_id=uuid.uuid4(),
        kind="create_task",
        payload={"title": "x"},
        summary="Create task “x”",
        status="pending",
        from_untrusted_context=False,
        result_kind=None,
        result_id=None,
        error=None,
        created_at=NOW,
        decided_at=None,
    )
    return replace(proposal, **changes)


@dataclass
class FakeProposals:
    proposal: Proposal
    calls: list[str] = field(default_factory=list[str])

    async def get(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, proposal_id: uuid.UUID
    ) -> Proposal:
        return self.proposal

    async def approve(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        proposal_id: uuid.UUID,
        timezone: str | None,
    ) -> Proposal:
        self.calls.append("approve")
        return replace(self.proposal, status="executed")

    async def reject(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, proposal_id: uuid.UUID
    ) -> Proposal:
        self.calls.append("reject")
        return replace(self.proposal, status="rejected")


@pytest.mark.parametrize(
    "changes",
    [
        {"kind": "append_to_note"},
        {"kind": "update_document_details"},
        {"from_untrusted_context": True},
    ],
)
@pytest.mark.anyio
async def test_voice_leaves_changes_and_untrusted_proposals_to_the_screen(changes: Json) -> None:
    proposal = a_proposal(**changes)
    fakes = FakeProposals(proposal)
    assert proposal.conversation_id is not None
    decision = await answer_proposal(
        fakes, WS, USER, proposal.id, proposal.conversation_id, "yes", "UTC"
    )
    assert decision.outcome == "needs_screen" and fakes.calls == []


def an_approval(**changes: Any) -> Approval:
    approval = Approval(
        id=uuid.uuid4(),
        workspace_id=WS,
        user_id=USER,
        agent_id=uuid.uuid4(),
        execution_id=uuid.uuid4(),
        step_position=1,
        tool="tasks.create",
        arguments={"title": "x"},
        arguments_hash="a" * 64,
        summary="Create a task",
        reason="Asked to",
        context="Plan my week",
        target=None,
        effect="Creates a task",
        risk="low",
        status="pending",
        from_untrusted_context=False,
        expires_at=NOW + timedelta(hours=24),
        created_at=NOW,
        decided_at=None,
        result=None,
        error=None,
    )
    return replace(approval, **changes)


class FakeApprovals:
    def __init__(self, pending: Approval) -> None:
        self.pending = pending
        self.calls: list[tuple[str, str | None]] = []

    async def approval(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, approval_id: uuid.UUID
    ) -> Approval:
        return self.pending

    async def approve(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        approval_id: uuid.UUID,
        arguments_hash: str,
    ) -> Approval:
        self.calls.append(("approve", arguments_hash))
        return replace(self.pending, status="executed")

    async def reject(
        self, workspace_id: uuid.UUID, user_id: uuid.UUID, approval_id: uuid.UUID
    ) -> Approval:
        self.calls.append(("reject", None))
        return replace(self.pending, status="rejected")


@pytest.mark.anyio
async def test_agent_approvals_by_voice_pass_the_heard_hash_and_respect_risk() -> None:
    low = FakeApprovals(an_approval())
    decision = await answer_approval(low, WS, USER, low.pending.id, "b" * 64, "yes")
    # The service, not voice, compares the hash: a stale one fails there with 409.
    assert decision.outcome == "approved" and low.calls == [("approve", "b" * 64)]
    for risky in (
        an_approval(risk="medium"),
        an_approval(risk="high"),
        an_approval(from_untrusted_context=True),
    ):
        fakes = FakeApprovals(risky)
        decision = await answer_approval(fakes, WS, USER, risky.id, "a" * 64, "yes, do it")
        assert decision.outcome == "needs_screen" and fakes.calls == []
    unclear = FakeApprovals(an_approval())
    decision = await answer_approval(unclear, WS, USER, unclear.pending.id, "a" * 64, "uh what")
    assert decision.outcome == "unclear" and unclear.calls == []
    done = FakeApprovals(an_approval(status="executed"))
    decision = await answer_approval(done, WS, USER, done.pending.id, "a" * 64, "yes")
    assert decision.outcome == "not_pending" and done.calls == []
