"""Briefing settings, the AI-written summary, the agent's briefing tool, and preparation by the
worker, through the API with a scripted AI provider."""

import json
import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from orbit_api.api.agent_tools import tool_factory
from orbit_api.config import Settings
from orbit_api.db.database import Database
from orbit_api.main import create_app
from orbit_api.repositories.agent_services import build_agent
from orbit_api.scheduler.worker import ReminderWorker
from orbit_api.services.agent.tools import PreparedCall, ToolContext
from orbit_api.system.attachment_store import FileAttachmentStore
from tests.ai_fakes import FakeProviderFactory, FakeState
from tests.support import FAST_PASSWORD_HASHER, bearer, sign_up

WORKSPACES = "/api/v1/workspaces"
AI = "/api/v1/me/ai"

Headers = dict[str, str]
Json = dict[str, Any]


@pytest.fixture
def fake() -> FakeProviderFactory:
    return FakeProviderFactory(FakeState())


@pytest.fixture
def app(migrated_settings: Settings, fake: FakeProviderFactory) -> FastAPI:
    app = create_app(migrated_settings.model_copy(update={"local_open_registration": True}))
    app.state.password_hasher = FAST_PASSWORD_HASHER
    app.state.ai_providers = fake
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


def today() -> date:
    return datetime.now(UTC).date()


def ok(response: Any, code: int = 200) -> Json:
    assert response.status_code == code, response.text
    body: Json = response.json()
    return body


def enable_ai(client: TestClient, headers: Headers, modules: list[str] | None = None) -> None:
    provider = ok(
        client.post(f"{AI}/providers", json={"name": "Local", "kind": "ollama"}, headers=headers),
        201,
    )
    settings: Json = {"enabled": True, "chat_provider_id": provider["id"], "chat_model": "m"}
    if modules is not None:
        settings["modules"] = modules
    ok(client.patch(f"{AI}/settings", json=settings, headers=headers))


def briefing(client: TestClient, ws: str, headers: Headers) -> Json:
    return ok(client.get(f"{ws}/briefings/today", params={"timezone": "UTC"}, headers=headers))


def seed(client: TestClient, ws: str, headers: Headers) -> None:
    """A task due today and a bill due today, ₹4,321.00."""
    ok(
        client.post(
            f"{ws}/tasks",
            json={"title": "Renew passport", "due_date": str(today()), "priority": "high"},
            headers=headers,
        ),
        201,
    )
    ok(
        client.post(
            f"{ws}/finance/recurring-payments",
            json={
                "kind": "bill",
                "name": "Electricity",
                "provider": "Grid",
                "amount": 4_321_00,
                "frequency": "monthly",
                "next_due_date": str(today()),
            },
            headers=headers,
        ),
        201,
    )


class TestSettings:
    def test_defaults_changes_and_validation(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        url = f"{ws}/briefings/settings"
        assert ok(client.get(url, headers=ada)) == {
            "horizon_days": 7,
            "hidden": [],
            "prepare_at": None,
        }

        body: Json = {"horizon_days": 3, "hidden": ["health", "budgets"], "prepare_at": "07:30"}
        saved = ok(client.put(url, json=body, headers=ada))

        # Stored in briefing order, whatever order they were sent in.
        assert saved == {
            "horizon_days": 3,
            "hidden": ["budgets", "health"],
            "prepare_at": "07:30:00",
        }
        assert ok(client.get(url, headers=ada)) == saved
        content = briefing(client, ws, ada)["content"]
        assert content["horizon_days"] == 3
        assert (content["health"], content["budgets"]) == (None, None)
        assert content["unavailable"] == []
        states = {s["module"]: s["status"] for s in content["sources"]}
        assert states["health"] == states["budgets"] == "off"

    @pytest.mark.parametrize(
        "body",
        [
            {"horizon_days": 0, "hidden": [], "prepare_at": None},
            {"horizon_days": 15, "hidden": [], "prepare_at": None},
            {"horizon_days": 7, "hidden": ["weather"], "prepare_at": None},
            {"horizon_days": 7, "hidden": [], "prepare_at": "07:30:15"},
            {"horizon_days": 7, "hidden": [], "prepare_at": "25:00"},
            {"horizon_days": 7, "hidden": []},
        ],
    )
    def test_invalid_settings_are_rejected(
        self, client: TestClient, ws: str, ada: Headers, body: Json
    ) -> None:
        response = client.put(f"{ws}/briefings/settings", json=body, headers=ada)
        assert response.status_code == 422, response.text

    def test_settings_are_per_person_and_workspace(
        self, client: TestClient, ws: str, ada: Headers, grace: Headers
    ) -> None:
        body: Json = {"horizon_days": 2, "hidden": [], "prepare_at": None}
        ok(client.put(f"{ws}/briefings/settings", json=body, headers=ada))

        assert client.get(f"{ws}/briefings/settings", headers=grace).status_code == 404
        theirs = personal(client, grace)
        assert ok(client.get(f"{theirs}/briefings/settings", headers=grace))["horizon_days"] == 7


def narrative_reply(request: Any) -> str:
    """Point at the first record given, and at one that doesn't exist."""
    prompt = "\n".join(m.content for m in request.messages)
    first = next(line.split(":")[0] for line in prompt.splitlines() if line.startswith("I1:"))
    return json.dumps(
        {
            "headline": "A focused day",
            "summary": "Your passport renewal is due today.",
            "priorities": [
                {"ref": first, "reason": "It's due today."},
                {"ref": "I99", "reason": "Made up."},
            ],
        }
    )


class TestNarrative:
    def test_needs_ai_and_a_stored_briefing(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        day = today().isoformat()
        url = f"{ws}/briefings/{day}/narrative"
        assert client.post(url, headers=ada).status_code == 404
        briefing(client, ws, ada)
        assert client.post(url, headers=ada).status_code == 409
        enable_ai(client, ada, modules=["watchlist"])
        # AI may read none of the briefing's modules.
        assert client.post(url, headers=ada).status_code == 403

    def test_written_from_permitted_modules_kept_and_cleared_on_regeneration(
        self, client: TestClient, ws: str, ada: Headers, fake: FakeProviderFactory
    ) -> None:
        seed(client, ws, ada)
        enable_ai(client, ada)  # The defaults: no finance, no health.
        prepared = briefing(client, ws, ada)
        fake.state.script = narrative_reply
        url = f"{ws}/briefings/{prepared['date']}/narrative"

        body = ok(client.post(url, headers=ada))

        narrative = body["narrative"]
        assert (narrative["headline"], narrative["model"]) == ("A focused day", "m")
        assert narrative["processing"] == "local"
        assert "payments" not in narrative["modules"] and "tasks" in narrative["modules"]
        # Only real items are priorities, with the snapshot's own titles.
        (priority,) = narrative["priorities"]
        assert priority["title"] == "Renew passport"
        assert priority["key"].startswith("task:")
        prompt = fake.state.last_prompt()
        assert "Renew passport" in prompt
        assert "Electricity" not in prompt
        # Stored with the briefing, and dropped when the snapshot changes.
        assert briefing(client, ws, ada)["narrative"] == narrative
        regenerated = ok(
            client.post(f"{ws}/briefings/today/regenerate", json={"timezone": "UTC"}, headers=ada)
        )
        assert regenerated["narrative"] is None

    def test_finance_permission_shows_names_never_amounts(
        self, client: TestClient, ws: str, ada: Headers, fake: FakeProviderFactory
    ) -> None:
        seed(client, ws, ada)
        enable_ai(client, ada, modules=["tasks", "finance"])
        prepared = briefing(client, ws, ada)
        fake.state.script = narrative_reply

        ok(client.post(f"{ws}/briefings/{prepared['date']}/narrative", headers=ada))

        prompt = fake.state.last_prompt()
        assert "Electricity" in prompt
        for amount in ("4321", "4,321", "432100"):
            assert amount not in prompt

    def test_an_unusable_reply_is_a_bad_gateway_and_saves_nothing(
        self, client: TestClient, ws: str, ada: Headers, fake: FakeProviderFactory
    ) -> None:
        seed(client, ws, ada)
        enable_ai(client, ada)
        prepared = briefing(client, ws, ada)
        fake.state.script = lambda request: "Sorry, no JSON today."

        response = client.post(f"{ws}/briefings/{prepared['date']}/narrative", headers=ada)

        assert response.status_code == 502
        assert briefing(client, ws, ada)["narrative"] is None

    def test_another_persons_briefing_is_not_found(
        self, client: TestClient, ws: str, ada: Headers, grace: Headers
    ) -> None:
        prepared = briefing(client, ws, ada)
        response = client.post(f"{ws}/briefings/{prepared['date']}/narrative", headers=grace)
        assert response.status_code == 404


class TestAgentTool:
    def test_registered_as_a_read_only_tool(
        self, client: TestClient, ws: str, ada: Headers
    ) -> None:
        tools = ok(client.get(f"{ws}/agent/tools", headers=ada))["tools"]
        tool = next(t for t in tools if t["name"] == "get_daily_briefing")
        assert tool["access"] == "read"

    def test_reads_the_stored_briefing_as_the_agent_and_ai_may(
        self,
        client: TestClient,
        ws: str,
        ada: Headers,
        migrated_settings: Settings,
        fake: FakeProviderFactory,
        app: FastAPI,
    ) -> None:
        database: Database = app.state.database
        assert client.portal is not None
        workspace_id = uuid.UUID(ws.rsplit("/", 1)[1])
        user_id = uuid.UUID(ok(client.get("/api/v1/me", headers=ada))["id"])

        async def run() -> str:
            async with database.session() as session:
                services = build_agent(session, migrated_settings, fake, tool_factory)
                await services.service.agent(workspace_id, user_id)
                tool = services.engine.registry.get("get_daily_briefing")
                assert tool is not None
                ctx = ToolContext(workspace_id, user_id, "UTC", today(), datetime.now(UTC))
                call = PreparedCall(tool=tool.spec.name, arguments={}, summary="")
                output = await tool.handler.run(call, ctx)
                return output.text

        assert "No briefing has been prepared" in client.portal.call(run)
        seed(client, ws, ada)
        briefing(client, ws, ada)
        # AI is off, so nothing may be read.
        assert "Neither the agent nor AI" in client.portal.call(run)
        enable_ai(client, ada, modules=["tasks", "finance"])
        text = client.portal.call(run)
        # The agent's defaults don't include finance, so the bill stays out.
        assert "Renew passport" in text
        assert "Electricity" not in text


class TestWorker:
    def test_prepares_due_briefings_once(
        self,
        client: TestClient,
        ws: str,
        ada: Headers,
        grace: Headers,
        migrated_settings: Settings,
        app: FastAPI,
    ) -> None:
        database: Database = app.state.database
        assert client.portal is not None
        seed(client, ws, ada)
        now = datetime.now(UTC)
        earlier = (now - timedelta(minutes=1)).time().replace(second=0, microsecond=0)
        if earlier > now.time():
            pytest.skip("too close to midnight UTC to schedule a time earlier today")
        body: Json = {"horizon_days": 7, "hidden": [], "prepare_at": earlier.strftime("%H:%M")}
        ok(client.put(f"{ws}/briefings/settings", json=body, headers=ada))
        # Grace prepares hers at 23:59, which hasn't come yet (or is skipped above).
        theirs = personal(client, grace)
        later: Json = {
            "horizon_days": 7,
            "hidden": [],
            "prepare_at": time(23, 59).strftime("%H:%M"),
        }
        ok(client.put(f"{theirs}/briefings/settings", json=later, headers=grace))
        worker = ReminderWorker(
            database, files=FileAttachmentStore(migrated_settings.attachments_dir)
        )

        first = client.portal.call(worker.prepare_briefings)
        again = client.portal.call(worker.prepare_briefings)

        assert (first, again) == (1, 0)
        history = ok(client.get(f"{ws}/briefings", headers=ada))
        assert history["total"] == 1
        assert history["items"][0]["summary"]["tasks_due_today"] == 1
        assert ok(client.get(f"{theirs}/briefings", headers=grace))["total"] == 0
