"""The health and fitness API: profile, exercise library, templates, workouts and sets, records
and analytics, measurements and BMI, progress photos, nutrition, water, activity, goals, habit
contributions, calendar scheduling, notes and documents, and privacy between people.

The API uses the real clock, so workouts are on today (UTC); calendar events are in 2030 so their
alerts are always ahead."""

import os
import time
import uuid
from collections.abc import AsyncIterator, Iterator
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.db.database import Database, open_database
from orbit_api.main import create_app
from orbit_api.repositories.fitness import build_fitness
from orbit_api.scheduler.worker import ReminderWorker
from orbit_api.services.fitness.models import FitnessNotFoundError, Owner
from orbit_api.system.attachment_store import FileAttachmentStore
from tests.support import FAST_PASSWORD_HASHER, bearer, query, sign_up

WORKSPACES = "/api/v1/workspaces"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64

Headers = dict[str, str]
Json = dict[str, Any]


def today() -> date:
    return datetime.now(UTC).date()


TODAY = today().isoformat()


@pytest.fixture
def client(migrated_settings: Settings, tmp_path: Any) -> Iterator[TestClient]:
    settings = migrated_settings.model_copy(
        update={"local_open_registration": True, "attachments_path": tmp_path / "files"}
    )
    app = create_app(settings)
    app.state.password_hasher = FAST_PASSWORD_HASHER
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


@pytest.fixture
def fit(ws: str) -> str:
    return f"{ws}/fitness"


def ok(response: Any, code: int = 200) -> Any:
    assert response.status_code == code, response.text
    return response.json() if code != 204 else None


def library(client: TestClient, fit: str, headers: Headers) -> dict[str, Json]:
    exercises = ok(client.get(f"{fit}/exercises", headers=headers))["exercises"]
    return {e["name"]: e for e in exercises}


def bench(client: TestClient, fit: str, headers: Headers) -> Json:
    return library(client, fit, headers)["Bench press"]


def start(client: TestClient, fit: str, headers: Headers, **fields: Any) -> Json:
    return ok(client.post(f"{fit}/sessions", json={"day": TODAY, **fields}, headers=headers), 201)


def put_set(
    client: TestClient, fit: str, headers: Headers, session: Json, index: int, **values: Any
) -> Json:
    item = session["exercises"][index]
    target = item["sets"][values.pop("set", 0)]
    return ok(
        client.put(
            f"{fit}/sessions/{session['id']}/exercises/{item['id']}/sets/{target['id']}",
            json=values,
            headers=headers,
        )
    )


def log_workout(
    client: TestClient, fit: str, headers: Headers, exercise: Json, sets: list[Json], **fields: Any
) -> Json:
    started = datetime.now(UTC) - timedelta(hours=2)
    body = {
        "name": "Logged",
        "day": TODAY,
        "started_at": started.isoformat(),
        "ended_at": (started + timedelta(minutes=45)).isoformat(),
        "exercises": [{"exercise_id": exercise["id"], "sets": sets}],
        **fields,
    }
    return ok(client.post(f"{fit}/sessions/log", json=body, headers=headers), 201)


def _db(client: TestClient) -> Any:
    app: Any = client.app
    return app.state.settings.sqlite_path


class TestProfile:
    def test_defaults_update_and_validation(
        self, client: TestClient, fit: str, ada: Headers
    ) -> None:
        profile = ok(client.get(f"{fit}/profile", headers=ada))
        assert (profile["unit_system"], profile["weight_unit"], profile["height_mm"]) == (
            "metric",
            "kg",
            None,
        )
        assert profile["water_quick_amounts_ml"] == [250, 500, 750]
        body = {
            "unit_system": "imperial",
            "weight_unit": "lb",
            "length_unit": "in",
            "distance_unit": "mi",
            "energy_unit": "kj",
            "water_unit": "fl_oz",
            "height_mm": 1778,
            "targets": {"energy_cal": 2_200_000, "protein_mg": 150_000, "water_ml": 2500},
            "water_quick_amounts_ml": [500, 250, 500],
            "hidden_sections": ["records", "records"],
        }
        saved = ok(client.put(f"{fit}/profile", json=body, headers=ada))
        assert saved["weight_unit"] == "lb" and saved["targets"]["water_ml"] == 2500
        assert saved["water_quick_amounts_ml"] == [250, 500]
        assert saved["hidden_sections"] == ["records"]
        assert ok(client.get(f"{fit}/profile", headers=ada))["height_mm"] == 1778
        for bad in ({"weight_unit": "stone"}, {"height_mm": 100}, {"user_id": str(uuid.uuid4())}):
            assert client.put(f"{fit}/profile", json=bad, headers=ada).status_code == 422

    def test_date_of_birth_accepts_past_dates_before_2000(
        self, client: TestClient, fit: str, ada: Headers
    ) -> None:
        saved = ok(client.put(f"{fit}/profile", json={"date_of_birth": "1990-05-14"}, headers=ada))
        assert saved["date_of_birth"] == "1990-05-14"
        for bad in ("1899-12-31", (date.today() + timedelta(days=1)).isoformat()):
            body = {"date_of_birth": bad}
            assert client.put(f"{fit}/profile", json=body, headers=ada).status_code == 422

    def test_activity_targets_round_trip_and_validate(
        self, client: TestClient, fit: str, ada: Headers
    ) -> None:
        targets = ok(client.get(f"{fit}/profile", headers=ada))["targets"]
        assert (targets["steps"], targets["active_s"], targets["sleep_s"]) == (None, None, None)
        body = {"targets": {"steps": 8000, "active_s": 1800, "sleep_s": 27_000}}
        saved = ok(client.put(f"{fit}/profile", json=body, headers=ada))["targets"]
        assert (saved["steps"], saved["active_s"], saved["sleep_s"]) == (8000, 1800, 27_000)
        again = ok(client.get(f"{fit}/profile", headers=ada))["targets"]
        assert again["steps"] == 8000 and again["sleep_s"] == 27_000
        for bad in ({"steps": 0}, {"active_s": 30}, {"sleep_s": 90_000}):
            response = client.put(f"{fit}/profile", json={"targets": bad}, headers=ada)
            assert response.status_code == 422


class TestExercises:
    def test_builtins_are_created_once(self, client: TestClient, fit: str, ada: Headers) -> None:
        first = library(client, fit, ada)
        assert {"Bench press", "Back squat", "Running", "Plank"} <= set(first)
        assert first["Bench press"]["is_custom"] is False
        assert first["Bench press"]["builtin_key"] == "barbell_bench_press"
        assert first["Running"]["exercise_type"] == "distance_duration"
        assert library(client, fit, ada).keys() == first.keys()
        count = query(_db(client), "SELECT COUNT(*) FROM fitness_exercises")[0][0]
        assert count == len(first)

    def test_custom_exercises_can_be_edited_archived_and_deleted(
        self, client: TestClient, fit: str, ada: Headers
    ) -> None:
        body = {
            "name": "Landmine press",
            "category": "strength",
            "exercise_type": "weight_reps",
            "equipment": "barbell",
            "primary_muscles": ["shoulders"],
        }
        exercise = ok(client.post(f"{fit}/exercises", json=body, headers=ada), 201)
        assert exercise["is_custom"] is True
        assert exercise["builtin_key"] is None
        edited = ok(
            client.put(
                f"{fit}/exercises/{exercise['id']}",
                json={**body, "name": "Half-kneeling landmine press"},
                headers=ada,
            )
        )
        assert edited["name"] == "Half-kneeling landmine press"
        archived = ok(
            client.post(
                f"{fit}/exercises/{exercise['id']}/archive", json={"archived": True}, headers=ada
            )
        )
        assert archived["archived"] is True
        ok(client.delete(f"{fit}/exercises/{exercise['id']}", headers=ada), 204)
        assert client.get(f"{fit}/exercises/{exercise['id']}", headers=ada).status_code == 404

    def test_builtins_and_used_exercises_are_protected(
        self, client: TestClient, fit: str, ada: Headers
    ) -> None:
        exercise = bench(client, fit, ada)
        body = {"name": "X", "category": "strength", "exercise_type": "reps"}
        assert (
            client.put(f"{fit}/exercises/{exercise['id']}", json=body, headers=ada).status_code
            == 409
        )
        assert client.delete(f"{fit}/exercises/{exercise['id']}", headers=ada).status_code == 409
        custom = ok(client.post(f"{fit}/exercises", json=body, headers=ada), 201)
        log_workout(client, fit, ada, custom, [{"reps": 10, "completed": True}])
        response = client.delete(f"{fit}/exercises/{custom['id']}", headers=ada)
        assert response.status_code == 409 and "Archive" in response.json()["detail"]

    def test_invalid_exercises(self, client: TestClient, fit: str, ada: Headers) -> None:
        base = {"name": "X", "category": "strength", "exercise_type": "reps"}
        for bad in (
            {**base, "name": ""},
            {**base, "category": "yoga"},
            {**base, "primary_muscles": ["wings"]},
        ):
            assert client.post(f"{fit}/exercises", json=bad, headers=ada).status_code == 422
        both = {**base, "primary_muscles": ["chest"], "secondary_muscles": ["chest"]}
        assert client.post(f"{fit}/exercises", json=both, headers=ada).status_code == 422


def make_template(client: TestClient, fit: str, headers: Headers, **fields: Any) -> Json:
    names = library(client, fit, headers)
    body = {
        "name": "Push day",
        "category": "push",
        "exercises": [
            {
                "exercise_id": names["Bench press"]["id"],
                "sets": 3,
                "target_reps_min": 6,
                "target_reps_max": 8,
                "target_weight_g": 80_000,
                "rest_seconds": 120,
            },
            {"exercise_id": names["Dip"]["id"], "sets": 2, "target_reps_max": 12},
        ],
        **fields,
    }
    return ok(client.post(f"{fit}/templates", json=body, headers=headers), 201)


class TestTemplates:
    def test_create_edit_duplicate_archive(
        self, client: TestClient, fit: str, ada: Headers
    ) -> None:
        template = make_template(client, fit, ada)
        assert [e["exercise_name"] for e in template["exercises"]] == ["Bench press", "Dip"]
        # Reorder by sending the list in a new order.
        reordered = {
            "name": "Push day",
            "category": "push",
            "exercises": [
                {"exercise_id": template["exercises"][1]["exercise_id"], "sets": 2},
                {"exercise_id": template["exercises"][0]["exercise_id"], "sets": 4},
            ],
        }
        updated = ok(client.put(f"{fit}/templates/{template['id']}", json=reordered, headers=ada))
        assert [(e["exercise_name"], e["sets"]) for e in updated["exercises"]] == [
            ("Dip", 2),
            ("Bench press", 4),
        ]
        copy = ok(client.post(f"{fit}/templates/{template['id']}/duplicate", headers=ada), 201)
        assert copy["name"] == "Push day (copy)" and len(copy["exercises"]) == 2
        archived = ok(
            client.post(
                f"{fit}/templates/{template['id']}/archive", json={"archived": True}, headers=ada
            )
        )
        assert archived["archived"] is True
        assert len(ok(client.get(f"{fit}/templates", headers=ada))["templates"]) == 2

    def test_invalid_templates(self, client: TestClient, fit: str, ada: Headers) -> None:
        exercise = bench(client, fit, ada)
        bad_range = {
            "name": "X",
            "exercises": [
                {"exercise_id": exercise["id"], "target_reps_min": 10, "target_reps_max": 5}
            ],
        }
        assert client.post(f"{fit}/templates", json=bad_range, headers=ada).status_code == 422
        unknown = {"name": "X", "exercises": [{"exercise_id": str(uuid.uuid4())}]}
        assert client.post(f"{fit}/templates", json=unknown, headers=ada).status_code == 422


class TestWorkouts:
    def test_start_from_template_copies_planned_sets(
        self, client: TestClient, fit: str, ada: Headers
    ) -> None:
        template = make_template(client, fit, ada)
        session = start(client, fit, ada, template_id=template["id"])
        assert session["name"] == "Push day" and session["status"] == "active"
        assert session["template_name"] == "Push day"
        first = session["exercises"][0]
        assert (first["name"], first["rest_seconds"], len(first["sets"])) == ("Bench press", 120, 3)
        assert first["sets"][0]["reps"] == 8 and first["sets"][0]["weight_g"] == 80_000
        assert all(not s["completed"] for s in first["sets"])

    def test_one_workout_in_progress_survives_a_reload(
        self, client: TestClient, fit: str, ada: Headers
    ) -> None:
        session = start(client, fit, ada)
        assert client.post(f"{fit}/sessions", json={"day": TODAY}, headers=ada).status_code == 409
        active = ok(client.get(f"{fit}/sessions/active", headers=ada))["session"]
        assert active["id"] == session["id"]
        ok(client.post(f"{fit}/sessions/{session['id']}/abandon", headers=ada))
        assert ok(client.get(f"{fit}/sessions/active", headers=ada))["session"] is None

    def test_logging_sets(self, client: TestClient, fit: str, ada: Headers) -> None:
        exercise = bench(client, fit, ada)
        session = start(client, fit, ada)
        session = ok(
            client.post(
                f"{fit}/sessions/{session['id']}/exercises",
                json={"exercise_id": exercise["id"]},
                headers=ada,
            ),
            201,
        )
        item = session["exercises"][0]
        assert item["name"] == "Bench press" and len(item["sets"]) == 1
        session = put_set(
            client,
            fit,
            ada,
            session,
            0,
            reps=10,
            weight_g=60_000,
            set_type="warmup",
            completed=True,
        )
        assert session["exercises"][0]["sets"][0]["completed_at"] is not None
        sets_url = f"{fit}/sessions/{session['id']}/exercises/{item['id']}/sets"
        # Without values, the new set copies the last one, not yet done.
        session = ok(client.post(sets_url, json={}, headers=ada), 201)
        copied = session["exercises"][0]["sets"][1]
        assert (copied["reps"], copied["weight_g"], copied["completed"]) == (10, 60_000, False)
        session = ok(
            client.post(
                sets_url,
                json={"values": {"reps": 5, "weight_g": 100_000, "rpe": 8.5, "completed": True}},
                headers=ada,
            ),
            201,
        )
        session = put_set(
            client, fit, ada, session, 0, set=1, reps=8, weight_g=100_000, completed=True
        )
        # Warm-ups don't count toward volume: 8 x 100 kg + 5 x 100 kg.
        assert session["volume_g"] == 1_300_000
        assert session["exercises"][0]["volume_g"] == 1_300_000
        middle = session["exercises"][0]["sets"][1]["id"]
        session = ok(client.delete(f"{sets_url}/{middle}", headers=ada))
        assert [s["position"] for s in session["exercises"][0]["sets"]] == [0, 1]
        bad = client.put(
            f"{sets_url}/{session['exercises'][0]['sets'][0]['id']}",
            json={"rpe": 7.3},
            headers=ada,
        )
        assert bad.status_code == 422
        assert (
            client.put(f"{sets_url}/{uuid.uuid4()}", json={"reps": 1}, headers=ada).status_code
            == 404
        )

    def test_reordering_exercises(self, client: TestClient, fit: str, ada: Headers) -> None:
        template = make_template(client, fit, ada)
        session = start(client, fit, ada, template_id=template["id"])
        ids = [e["id"] for e in session["exercises"]]
        order = f"{fit}/sessions/{session['id']}/order"
        session = ok(client.put(order, json={"exercise_ids": ids[::-1]}, headers=ada))
        assert [e["name"] for e in session["exercises"]] == ["Dip", "Bench press"]
        assert client.put(order, json={"exercise_ids": ids[:1]}, headers=ada).status_code == 422

    def test_pause_resume_complete(self, client: TestClient, fit: str, ada: Headers) -> None:
        session = start(client, fit, ada)
        url = f"{fit}/sessions/{session['id']}"
        paused = ok(client.post(f"{url}/pause", headers=ada))
        assert paused["status"] == "paused" and paused["paused_at"] is not None
        assert client.post(f"{url}/pause", headers=ada).status_code == 409
        resumed = ok(client.post(f"{url}/resume", headers=ada))
        assert resumed["status"] == "active" and resumed["paused_at"] is None
        done = ok(client.post(f"{url}/complete", headers=ada))
        assert done["status"] == "completed" and done["duration_s"] is not None
        assert client.post(f"{url}/complete", headers=ada).status_code == 409
        # Ended workouts can have their times corrected; the duration follows.
        started = datetime.now(UTC) - timedelta(hours=3)
        corrected = ok(
            client.patch(
                url,
                json={
                    "started_at": started.isoformat(),
                    "ended_at": (started + timedelta(minutes=50)).isoformat(),
                    "notes": "Felt strong",
                },
                headers=ada,
            )
        )
        assert corrected["duration_s"] == 50 * 60 - corrected["paused_seconds"]
        assert corrected["notes"] == "Felt strong"
        backwards = {
            "started_at": started.isoformat(),
            "ended_at": (started - timedelta(1)).isoformat(),
        }
        assert client.patch(url, json=backwards, headers=ada).status_code == 422

    def test_times_of_a_workout_in_progress_cant_be_edited(
        self, client: TestClient, fit: str, ada: Headers
    ) -> None:
        session = start(client, fit, ada)
        body = {"started_at": datetime.now(UTC).isoformat()}
        response = client.patch(f"{fit}/sessions/{session['id']}", json=body, headers=ada)
        assert response.status_code == 409

    def test_history_keeps_snapshots_when_the_library_and_template_change(
        self, client: TestClient, fit: str, ada: Headers
    ) -> None:
        body = {"name": "Cable crunch", "category": "strength", "exercise_type": "weight_reps"}
        exercise = ok(client.post(f"{fit}/exercises", json=body, headers=ada), 201)
        template = ok(
            client.post(
                f"{fit}/templates",
                json={"name": "Core", "exercises": [{"exercise_id": exercise["id"], "sets": 2}]},
                headers=ada,
            ),
            201,
        )
        session = start(client, fit, ada, template_id=template["id"])
        ok(client.post(f"{fit}/sessions/{session['id']}/complete", headers=ada))
        client.put(
            f"{fit}/exercises/{exercise['id']}",
            json={**body, "name": "Kneeling cable crunch", "exercise_type": "reps"},
            headers=ada,
        )
        client.put(
            f"{fit}/templates/{template['id']}",
            json={"name": "Core v2", "exercises": [{"exercise_id": exercise["id"], "sets": 5}]},
            headers=ada,
        )
        past = ok(client.get(f"{fit}/sessions/{session['id']}", headers=ada))
        assert past["name"] == "Core"
        assert past["exercises"][0]["name"] == "Cable crunch"
        assert past["exercises"][0]["exercise_type"] == "weight_reps"
        assert len(past["exercises"][0]["sets"]) == 2

    def test_previous_performance_records_and_history(
        self, client: TestClient, fit: str, ada: Headers
    ) -> None:
        exercise = bench(client, fit, ada)
        log_workout(
            client,
            fit,
            ada,
            exercise,
            [
                {"set_type": "warmup", "reps": 5, "weight_g": 120_000, "completed": True},
                {"reps": 5, "weight_g": 100_000, "completed": True},
            ],
        )
        session = start(client, fit, ada)
        session = ok(
            client.post(
                f"{fit}/sessions/{session['id']}/exercises",
                json={"exercise_id": exercise["id"]},
                headers=ada,
            ),
            201,
        )
        previous = session["exercises"][0]["previous"]
        assert [s["weight_g"] for s in previous["sets"]] == [120_000, 100_000]
        session = put_set(client, fit, ada, session, 0, reps=3, weight_g=105_000, completed=True)
        ok(client.post(f"{fit}/sessions/{session['id']}/complete", headers=ada))

        records = {r["kind"]: r for r in ok(client.get(f"{fit}/records", headers=ada))["records"]}
        # The 120 kg warm-up never counts.
        assert records["max_weight"]["value"] == 105_000
        assert records["estimated_1rm"]["value"] == 116_667  # 100 kg x 5
        assert records["estimated_1rm"]["estimated"] is True
        history = ok(client.get(f"{fit}/exercises/{exercise['id']}/history", headers=ada))
        assert [p["max_weight_g"] for p in history["points"]] == [100_000, 105_000]

    def test_unfinished_and_abandoned_workouts_dont_count(
        self, client: TestClient, fit: str, ada: Headers
    ) -> None:
        exercise = bench(client, fit, ada)
        session = start(client, fit, ada)
        session = ok(
            client.post(
                f"{fit}/sessions/{session['id']}/exercises",
                json={"exercise_id": exercise["id"]},
                headers=ada,
            ),
            201,
        )
        put_set(client, fit, ada, session, 0, reps=1, weight_g=200_000, completed=True)
        ok(client.post(f"{fit}/sessions/{session['id']}/abandon", headers=ada))
        assert ok(client.get(f"{fit}/records", headers=ada))["records"] == []
        listed = ok(client.get(f"{fit}/sessions?status=abandoned", headers=ada))["sessions"]
        assert [s["status"] for s in listed] == ["abandoned"]

    def test_logging_a_past_workout_and_analytics(
        self, client: TestClient, fit: str, ada: Headers
    ) -> None:
        exercise = bench(client, fit, ada)
        logged = log_workout(
            client, fit, ada, exercise, [{"reps": 5, "weight_g": 100_000, "completed": True}]
        )
        assert logged["status"] == "completed" and logged["duration_s"] == 45 * 60
        start_day = (today() - timedelta(days=30)).isoformat()
        result = ok(
            client.get(f"{fit}/analytics?start={start_day}&end={TODAY}&date={TODAY}", headers=ada)
        )
        assert (result["workouts"], result["duration_s"], result["volume_g"]) == (1, 2700, 500_000)
        assert result["muscle_sets"] == {"chest": 1}
        assert result["current_week_streak"] == 1
        too_long = f"{fit}/analytics?start=2020-01-01&end={TODAY}&date={TODAY}"
        assert client.get(too_long, headers=ada).status_code == 422
        future = (datetime.now(UTC) + timedelta(days=1)).isoformat()
        body = {
            "name": "Later",
            "day": TODAY,
            "started_at": datetime.now(UTC).isoformat(),
            "ended_at": future,
        }
        assert client.post(f"{fit}/sessions/log", json=body, headers=ada).status_code == 422


class TestMeasurements:
    def test_history_corrections_bmi_and_deletion(
        self, client: TestClient, fit: str, ada: Headers
    ) -> None:
        url = f"{fit}/measurements"
        ok(client.put(f"{fit}/profile", json={"height_mm": 1750}, headers=ada))
        first = ok(
            client.post(url, json={"day": "2026-01-01", "weight_g": 80_000}, headers=ada), 201
        )
        ok(
            client.post(
                url, json={"day": "2026-02-01", "weight_g": 78_000, "waist_mm": 850}, headers=ada
            ),
            201,
        )
        listed = ok(client.get(url, headers=ada))
        assert [m["weight_g"] for m in listed["measurements"]] == [80_000, 78_000]
        assert listed["bmi"]["value"] == 25.5 and listed["bmi"]["height_mm"] == 1750
        corrected = ok(
            client.put(
                f"{url}/{first['id']}",
                json={"day": "2026-01-01", "weight_g": 81_000, "body_fat_pct": 21.04},
                headers=ada,
            )
        )
        assert corrected["weight_g"] == 81_000 and corrected["body_fat_pct"] == 21.0
        ok(client.delete(f"{url}/{first['id']}", headers=ada), 204)
        assert len(ok(client.get(url, headers=ada))["measurements"]) == 1
        ranged = ok(client.get(f"{url}?start=2026-03-01", headers=ada))
        assert ranged["measurements"] == []

    def test_no_bmi_without_height(self, client: TestClient, fit: str, ada: Headers) -> None:
        url = f"{fit}/measurements"
        ok(client.post(url, json={"day": "2026-01-01", "weight_g": 80_000}, headers=ada), 201)
        assert ok(client.get(url, headers=ada))["bmi"] is None

    def test_invalid_values(self, client: TestClient, fit: str, ada: Headers) -> None:
        url = f"{fit}/measurements"
        for bad in (
            {"day": "2026-01-01"},
            {"day": "2026-01-01", "weight_g": 100},
            {"day": "2026-01-01", "body_fat_pct": 120},
            {"day": "2026-01-01", "waist_mm": -5},
            {"day": "1800-01-01", "weight_g": 80_000},
        ):
            assert client.post(url, json=bad, headers=ada).status_code == 422, bad


class TestPhotos:
    def test_upload_download_and_delete(self, client: TestClient, fit: str, ada: Headers) -> None:
        photo = ok(
            client.post(
                f"{fit}/photos?filename=front.png&day=2026-01-01&note=Front",
                content=PNG,
                headers=ada,
            ),
            201,
        )
        assert photo["content_type"] == "image/png" and photo["note"] == "Front"
        assert "blob_id" not in photo
        download = client.get(f"{fit}/photos/{photo['id']}/file", headers=ada)
        assert download.status_code == 200 and download.content == PNG
        assert download.headers["cache-control"] == "private, no-store"
        assert download.headers["x-content-type-options"] == "nosniff"
        assert download.headers["content-disposition"].startswith("attachment")
        ok(client.delete(f"{fit}/photos/{photo['id']}", headers=ada), 204)
        assert client.get(f"{fit}/photos/{photo['id']}/file", headers=ada).status_code == 404

    def test_only_matching_images_are_accepted(
        self, client: TestClient, fit: str, ada: Headers
    ) -> None:
        url = f"{fit}/photos?day=2026-01-01"
        assert (
            client.post(f"{url}&filename=a.svg", content=b"<svg/>", headers=ada).status_code == 415
        )
        assert client.post(f"{url}&filename=a.png", content=JPEG, headers=ada).status_code == 415
        assert client.post(f"{url}&filename=a.jpg", content=JPEG, headers=ada).status_code == 201
        assert client.post(f"{url}&filename=a.png", content=b"", headers=ada).status_code == 422


class TestNutrition:
    def test_foods_entries_and_daily_totals(
        self, client: TestClient, fit: str, ada: Headers
    ) -> None:
        ok(
            client.put(
                f"{fit}/profile",
                json={"targets": {"energy_cal": 2_000_000, "protein_mg": 120_000}},
                headers=ada,
            )
        )
        oats = ok(
            client.post(
                f"{fit}/foods",
                json={
                    "name": "Oats",
                    "serving_quantity_milli": 40_000,
                    "serving_unit": "g",
                    "nutrients": {
                        "energy_cal": 150_000,
                        "protein_mg": 5_000,
                        "carbs_mg": 27_000,
                        "fat_mg": 3_000,
                        "fiber_mg": 4_000,
                    },
                },
                headers=ada,
            ),
            201,
        )
        # 60 g of a food logged per 40 g: one and a half servings.
        entry = ok(
            client.post(
                f"{fit}/food-entries",
                json={
                    "day": TODAY,
                    "meal": "breakfast",
                    "portion": {"food_id": oats["id"], "quantity_milli": 60_000},
                },
                headers=ada,
            ),
            201,
        )
        assert entry["portion"]["nutrients"] == {
            "energy_cal": 225_000,
            "protein_mg": 7_500,
            "carbs_mg": 40_500,
            "fat_mg": 4_500,
            "fiber_mg": 6_000,
        }
        ok(
            client.post(
                f"{fit}/food-entries",
                json={
                    "day": TODAY,
                    "meal": "snack",
                    "portion": {
                        "quantity_milli": 1_000,
                        "name": "Apple",
                        "serving_unit": "medium",
                        "nutrients": {"energy_cal": 95_000, "carbs_mg": 25_000},
                    },
                },
                headers=ada,
            ),
            201,
        )
        day = ok(client.get(f"{fit}/nutrition?date={TODAY}", headers=ada))
        assert day["totals"]["energy_cal"] == 320_000
        assert day["totals"]["fiber_mg"] == 6_000
        assert day["by_meal"]["breakfast"]["energy_cal"] == 225_000
        assert day["by_meal"]["dinner"]["energy_cal"] == 0
        assert day["targets"]["energy_cal"] == 2_000_000
        # Editing the food doesn't change what was logged.
        client.put(
            f"{fit}/foods/{oats['id']}",
            json={
                "name": "Oats",
                "serving_quantity_milli": 40_000,
                "serving_unit": "g",
                "nutrients": {"energy_cal": 999_000},
            },
            headers=ada,
        )
        again = ok(client.get(f"{fit}/nutrition?date={TODAY}", headers=ada))
        assert again["totals"]["energy_cal"] == 320_000
        foods = ok(client.get(f"{fit}/foods", headers=ada))["foods"]
        assert foods[0]["use_count"] == 1
        history = ok(client.get(f"{fit}/nutrition/history?start={TODAY}&end={TODAY}", headers=ada))
        assert history["days"][0]["entries"] == 2
        corrected = ok(
            client.put(
                f"{fit}/food-entries/{entry['id']}",
                json={
                    "day": TODAY,
                    "meal": "lunch",
                    "portion": {"food_id": oats["id"], "quantity_milli": 40_000},
                },
                headers=ada,
            )
        )
        assert (
            corrected["meal"] == "lunch"
            and corrected["portion"]["nutrients"]["energy_cal"] == 999_000
        )
        ok(client.delete(f"{fit}/food-entries/{entry['id']}", headers=ada), 204)

    def test_saved_meals(self, client: TestClient, fit: str, ada: Headers) -> None:
        item = {
            "quantity_milli": 2_000,
            "name": "Egg",
            "serving_unit": "egg",
            "nutrients": {"energy_cal": 140_000, "protein_mg": 12_000},
        }
        meal = ok(
            client.post(
                f"{fit}/meals", json={"name": "Usual breakfast", "items": [item]}, headers=ada
            ),
            201,
        )
        assert meal["totals"]["protein_mg"] == 12_000
        entries = ok(
            client.post(
                f"{fit}/meals/{meal['id']}/log",
                json={"day": TODAY, "meal": "breakfast"},
                headers=ada,
            ),
            201,
        )["entries"]
        assert [e["portion"]["name"] for e in entries] == ["Egg"]
        assert (
            client.post(
                f"{fit}/meals", json={"name": "Empty", "items": []}, headers=ada
            ).status_code
            == 422
        )

    def test_invalid_portions(self, client: TestClient, fit: str, ada: Headers) -> None:
        url = f"{fit}/food-entries"
        typed_without_nutrients = {
            "day": TODAY,
            "meal": "lunch",
            "portion": {"quantity_milli": 1000, "name": "Soup"},
        }
        assert client.post(url, json=typed_without_nutrients, headers=ada).status_code == 422
        zero = {"day": TODAY, "meal": "lunch", "portion": {"quantity_milli": 0, "food_id": None}}
        assert client.post(url, json=zero, headers=ada).status_code == 422
        unknown = {
            "day": TODAY,
            "meal": "lunch",
            "portion": {"quantity_milli": 1000, "food_id": str(uuid.uuid4())},
        }
        assert client.post(url, json=unknown, headers=ada).status_code == 422


class TestWater:
    def test_daily_totals_history_and_targets(
        self, client: TestClient, fit: str, ada: Headers
    ) -> None:
        ok(client.put(f"{fit}/profile", json={"targets": {"water_ml": 2000}}, headers=ada))
        ok(client.post(f"{fit}/water", json={"day": TODAY, "amount_ml": 500}, headers=ada), 201)
        day = ok(
            client.post(f"{fit}/water", json={"day": TODAY, "amount_ml": 750}, headers=ada), 201
        )
        assert (day["total_ml"], day["target_ml"], len(day["entries"])) == (1250, 2000, 2)
        day = ok(client.delete(f"{fit}/water/{day['entries'][0]['id']}", headers=ada))
        assert day["total_ml"] == 750
        history = ok(client.get(f"{fit}/water/history?start={TODAY}&end={TODAY}", headers=ada))
        assert history["days"] == [{"day": TODAY, "total_ml": 750}]
        assert (
            client.post(
                f"{fit}/water", json={"day": TODAY, "amount_ml": 0}, headers=ada
            ).status_code
            == 422
        )


class TestActivity:
    def test_recording_and_validation(self, client: TestClient, fit: str, ada: Headers) -> None:
        url = f"{fit}/activities"
        run = ok(
            client.post(
                url,
                json={"day": TODAY, "kind": "run", "distance_m": 5000, "duration_s": 1500},
                headers=ada,
            ),
            201,
        )
        assert run["source"] == "manual"
        ok(client.post(url, json={"day": TODAY, "kind": "rest_day"}, headers=ada), 201)
        ok(
            client.post(
                url, json={"day": TODAY, "kind": "sleep", "duration_s": 27000}, headers=ada
            ),
            201,
        )
        for bad in (
            {"day": TODAY, "kind": "steps"},
            {"day": TODAY, "kind": "rest_day", "steps": 10},
            {"day": TODAY, "kind": "run"},
            {"day": TODAY, "kind": "sleep", "distance_m": 10},
            {"day": TODAY, "kind": "walk", "steps": 1000, "distance_m": 800},
        ):
            assert client.post(url, json=bad, headers=ada).status_code == 422, bad
        runs = ok(client.get(f"{url}?kind=run", headers=ada))["activities"]
        assert [a["distance_m"] for a in runs] == [5000]
        ok(
            client.put(
                f"{url}/{run['id']}",
                json={"day": TODAY, "kind": "run", "distance_m": 5200},
                headers=ada,
            )
        )
        ok(client.delete(f"{url}/{run['id']}", headers=ada), 204)


def goal_url(fit: str, goal: Json | None = None, suffix: str = "") -> str:
    base = f"{fit}/goals" + (f"/{goal['id']}" if goal else "")
    return f"{base}{suffix}?date={TODAY}"


class TestGoals:
    def test_manual_goal_progress_history_pause_and_complete(
        self, client: TestClient, fit: str, ada: Headers
    ) -> None:
        start_day = (today() - timedelta(days=50)).isoformat()
        target_day = (today() + timedelta(days=50)).isoformat()
        goal = ok(
            client.post(
                goal_url(fit),
                json={
                    "name": "Run 10 km",
                    "category": "running_distance",
                    "start_value": 3000,
                    "target_value": 10000,
                    "start_date": start_day,
                    "target_date": target_day,
                },
                headers=ada,
            ),
            201,
        )
        assert goal["unit"] == "m" and goal["fraction"] == 0 and goal["pace"] == "behind"
        goal = ok(
            client.post(
                goal_url(fit, goal, "/check-ins"),
                json={"day": TODAY, "value": 6500},
                headers=ada,
            ),
            201,
        )
        assert goal["current_value"] == 6500 and goal["fraction"] == 0.5
        assert goal["pace"] == "on_track"
        assert [m["reached_on"] for m in goal["milestones"]][:2] == [TODAY, TODAY]
        tomorrow = (today() + timedelta(days=1)).isoformat()
        future = client.post(
            goal_url(fit, goal, "/check-ins"), json={"day": tomorrow, "value": 1}, headers=ada
        )
        assert future.status_code == 422
        paused = ok(
            client.post(goal_url(fit, goal, "/status"), json={"status": "paused"}, headers=ada)
        )
        assert paused["status"] == "paused"
        done = ok(
            client.post(goal_url(fit, goal, "/status"), json={"status": "completed"}, headers=ada)
        )
        assert done["status"] == "completed" and done["completed_at"] is not None
        listed = ok(client.get(f"{fit}/goals?status=active&date={TODAY}", headers=ada))["goals"]
        assert listed == []
        check_in = done["history"][0]["id"]
        undone = ok(client.delete(goal_url(fit, goal, f"/check-ins/{check_in}"), headers=ada))
        assert undone["current_value"] == 3000

    def test_auto_tracked_weight_and_strength_goals(
        self, client: TestClient, fit: str, ada: Headers
    ) -> None:
        start_day = (today() - timedelta(days=10)).isoformat()
        weight = ok(
            client.post(
                goal_url(fit),
                json={
                    "name": "Reach 75 kg",
                    "category": "body_weight",
                    "start_value": 80_000,
                    "target_value": 75_000,
                    "start_date": start_day,
                    "auto_track": True,
                },
                headers=ada,
            ),
            201,
        )
        # Before the start date doesn't count; afterwards, the latest weight is current.
        before = (today() - timedelta(days=20)).isoformat()
        client.post(f"{fit}/measurements", json={"day": before, "weight_g": 70_000}, headers=ada)
        client.post(f"{fit}/measurements", json={"day": TODAY, "weight_g": 77_500}, headers=ada)
        weight = ok(client.get(goal_url(fit, weight), headers=ada))
        assert weight["current_value"] == 77_500 and weight["fraction"] == 0.5
        assert weight["history"][0]["source"] == "measurement"
        manual = client.post(
            goal_url(fit, weight, "/check-ins"), json={"day": TODAY, "value": 1}, headers=ada
        )
        assert manual.status_code == 409

        exercise = bench(client, fit, ada)
        strength = ok(
            client.post(
                goal_url(fit),
                json={
                    "name": "Bench 120 kg",
                    "category": "strength",
                    "start_value": 100_000,
                    "target_value": 120_000,
                    "start_date": start_day,
                    "auto_track": True,
                    "exercise_id": exercise["id"],
                },
                headers=ada,
            ),
            201,
        )
        log_workout(
            client,
            fit,
            ada,
            exercise,
            [
                {"set_type": "warmup", "reps": 1, "weight_g": 130_000, "completed": True},
                {"reps": 3, "weight_g": 110_000, "completed": True},
            ],
        )
        strength = ok(client.get(goal_url(fit, strength), headers=ada))
        assert strength["current_value"] == 110_000 and strength["exercise_name"] == "Bench press"

    def test_invalid_goals(self, client: TestClient, fit: str, ada: Headers) -> None:
        base = {
            "name": "X",
            "category": "custom",
            "start_value": 0,
            "target_value": 10,
            "start_date": TODAY,
            "unit": "pages",
        }
        for bad in (
            {**base, "target_value": 0},
            {**base, "unit": ""},
            {**base, "auto_track": True},
            {**base, "target_date": TODAY},
            {**base, "category": "strength", "auto_track": True},
            {**base, "habit_id": str(uuid.uuid4())},
        ):
            assert client.post(goal_url(fit), json=bad, headers=ada).status_code == 422, bad


def make_habit(client: TestClient, ws: str, headers: Headers, **fields: Any) -> Json:
    body = {
        "name": "Exercise",
        "schedule": {"type": "daily"},
        "start_date": (today() - timedelta(days=5)).isoformat(),
        "timezone": "UTC",
        **fields,
    }
    habit: Json = ok(client.post(f"{ws}/habits", json=body, headers=headers), 201)["habit"]
    return habit


def habit_log(client: TestClient, habit: Json) -> list[tuple[Any, ...]]:
    return query(
        _db(client),
        "SELECT value, skipped FROM habit_logs WHERE habit_id = ?",
        habit["id"].replace("-", ""),
    )


class TestHabitIntegration:
    def test_workouts_complete_a_linked_habit_only_when_enabled(
        self, client: TestClient, ws: str, fit: str, ada: Headers
    ) -> None:
        habit = make_habit(client, ws, ada)
        link = {"habit_id": habit["id"], "source": "workout"}
        ok(client.put(f"{fit}/habit-links", json=link, headers=ada))
        session = start(client, fit, ada)
        ok(client.post(f"{fit}/sessions/{session['id']}/complete", headers=ada))
        assert habit_log(client, habit) == []  # Linked, but not contributing.

        saved = ok(
            client.put(f"{fit}/habit-links", json={**link, "contributes": True}, headers=ada)
        )
        assert saved["contributes"] is True and saved["habit_name"] == "Exercise"
        assert len(ok(client.get(f"{fit}/habit-links", headers=ada))["links"]) == 1
        session = start(client, fit, ada)
        ok(client.post(f"{fit}/sessions/{session['id']}/complete", headers=ada))
        assert habit_log(client, habit) == [(1.0, 0)]
        # Another workout the same day doesn't add a second entry.
        session = start(client, fit, ada)
        ok(client.post(f"{fit}/sessions/{session['id']}/complete", headers=ada))
        assert len(habit_log(client, habit)) == 1

    def test_completing_a_habit_never_creates_a_workout(
        self, client: TestClient, ws: str, fit: str, ada: Headers
    ) -> None:
        habit = make_habit(client, ws, ada)
        client.put(
            f"{fit}/habit-links",
            json={"habit_id": habit["id"], "source": "workout", "contributes": True},
            headers=ada,
        )
        ok(
            client.put(
                f"{ws}/habits/{habit['id']}/log/{TODAY}", json={"status": "completed"}, headers=ada
            )
        )
        assert ok(client.get(f"{fit}/sessions", headers=ada))["sessions"] == []

    def test_water_raises_a_numeric_habit_but_never_lowers_or_unskips(
        self, client: TestClient, ws: str, fit: str, ada: Headers
    ) -> None:
        ok(client.put(f"{fit}/profile", json={"water_unit": "l"}, headers=ada))
        habit = make_habit(client, ws, ada, name="Water", kind="numeric", unit="litres", target=2)
        client.put(
            f"{fit}/habit-links",
            json={"habit_id": habit["id"], "source": "water", "contributes": True},
            headers=ada,
        )
        day = ok(
            client.post(f"{fit}/water", json={"day": TODAY, "amount_ml": 750}, headers=ada), 201
        )
        assert habit_log(client, habit) == [(0.75, 0)]
        client.post(f"{fit}/water", json={"day": TODAY, "amount_ml": 500}, headers=ada)
        assert habit_log(client, habit) == [(1.25, 0)]
        client.delete(f"{fit}/water/{day['entries'][0]['id']}", headers=ada)
        assert habit_log(client, habit) == [(1.25, 0)]

        yesterday = (today() - timedelta(days=1)).isoformat()
        client.put(
            f"{ws}/habits/{habit['id']}/log/{yesterday}", json={"status": "skipped"}, headers=ada
        )
        client.post(f"{fit}/water", json={"day": yesterday, "amount_ml": 3000}, headers=ada)
        logs = query(
            _db(client),
            "SELECT value, skipped FROM habit_logs WHERE habit_id = ? AND day = ?",
            habit["id"].replace("-", ""),
            yesterday,
        )
        assert logs == [(0.0, 1)]

    def test_activity_contributes_to_habits_of_its_kind(
        self, client: TestClient, ws: str, fit: str, ada: Headers
    ) -> None:
        habit = make_habit(client, ws, ada, name="Steps", kind="numeric", unit="steps", target=8000)
        client.put(
            f"{fit}/habit-links",
            json={
                "habit_id": habit["id"],
                "source": "activity",
                "activity_kind": "steps",
                "contributes": True,
            },
            headers=ada,
        )
        client.post(
            f"{fit}/activities", json={"day": TODAY, "kind": "run", "distance_m": 5000}, headers=ada
        )
        assert habit_log(client, habit) == []
        client.post(
            f"{fit}/activities", json={"day": TODAY, "kind": "steps", "steps": 9000}, headers=ada
        )
        assert habit_log(client, habit) == [(9000.0, 0)]

    def test_invalid_links(self, client: TestClient, ws: str, fit: str, ada: Headers) -> None:
        habit = make_habit(client, ws, ada)
        url = f"{fit}/habit-links"
        assert (
            client.put(
                url, json={"habit_id": habit["id"], "source": "activity"}, headers=ada
            ).status_code
            == 422
        )
        unknown = {"habit_id": str(uuid.uuid4()), "source": "workout"}
        assert client.put(url, json=unknown, headers=ada).status_code == 422
        assert client.delete(f"{url}/{habit['id']}", headers=ada).status_code == 404


class TestCalendarIntegration:
    def test_scheduling_creates_one_event_with_reminders_and_starts_from_it(
        self, client: TestClient, ws: str, fit: str, ada: Headers
    ) -> None:
        template = make_template(client, fit, ada)
        scheduled = ok(
            client.post(
                f"{fit}/schedule",
                json={
                    "template_id": template["id"],
                    "start": "2030-01-14T18:00",
                    "end": "2030-01-14T19:00",
                    "timezone": "UTC",
                    "alerts": [30],
                },
                headers=ada,
            ),
            201,
        )
        event_id = scheduled["calendar_event_id"]
        assert scheduled["title"] == "Push day" and scheduled["template_name"] == "Push day"
        events = ok(client.get(f"{ws}/calendar/events", headers=ada))["events"]
        assert [e["title"] for e in events] == ["Push day"]
        reminders = query(
            _db(client), "SELECT COUNT(*) FROM reminders WHERE calendar_event_alert_id IS NOT NULL"
        )
        assert reminders == [(1,)]
        listed = ok(
            client.get(f"{fit}/schedule?start=2030-01-14&end=2030-01-15&timezone=UTC", headers=ada)
        )["workouts"]
        assert [w["calendar_event_id"] for w in listed] == [event_id]
        assert listed[0]["start_at"] == "2030-01-14T18:00:00Z"

        session = start(client, fit, ada, calendar_event_id=event_id)
        assert session["calendar_event_id"] == event_id and session["name"] == "Push day"
        assert len(session["exercises"]) == 2
        found = ok(client.get(f"{fit}/schedule/{event_id}", headers=ada))
        assert found["session_ids"] == [session["id"]]

        # Deleting the event removes the link but keeps the workout.
        ok(client.delete(f"{ws}/calendar/events/{event_id}", headers=ada), 204)
        assert client.get(f"{fit}/schedule/{event_id}", headers=ada).status_code == 404
        kept = ok(client.get(f"{fit}/sessions/{session['id']}", headers=ada))
        assert kept["calendar_event_id"] is None

    def test_linking_an_existing_event(
        self, client: TestClient, ws: str, fit: str, ada: Headers
    ) -> None:
        event = ok(
            client.post(
                f"{ws}/calendar/events",
                json={"title": "Gym", "start": "2030-01-14T07:00", "end": "2030-01-14T08:00"},
                headers=ada,
            ),
            201,
        )
        assert (
            client.post(
                f"{fit}/sessions",
                json={"day": TODAY, "calendar_event_id": event["id"]},
                headers=ada,
            ).status_code
            == 422
        )
        linked = ok(client.put(f"{fit}/schedule/{event['id']}", json={}, headers=ada))
        assert linked["title"] == "Gym"
        ok(client.put(f"{fit}/schedule/{event['id']}", json={}, headers=ada))
        assert query(_db(client), "SELECT COUNT(*) FROM fitness_workout_events") == [(1,)]
        ok(client.delete(f"{fit}/schedule/{event['id']}", headers=ada), 204)
        assert ok(client.get(f"{ws}/calendar/events/{event['id']}", headers=ada))["title"] == "Gym"
        unknown = client.put(f"{fit}/schedule/{uuid.uuid4()}", json={}, headers=ada)
        assert unknown.status_code == 422


class TestNotesAndDocuments:
    def test_linking_notes_and_documents_to_workouts_and_goals(
        self, client: TestClient, ws: str, fit: str, ada: Headers
    ) -> None:
        session = start(client, fit, ada, name="Leg day")
        url = f"{fit}/sessions/{session['id']}"
        links = ok(client.post(f"{url}/note", json={}, headers=ada), 201)["links"]
        assert links[0]["kind"] == "note" and links[0]["title"].startswith("Leg day ·")
        document = ok(
            client.post(f"{ws}/documents", json={"title": "Training plan"}, headers=ada), 201
        )
        doc_id = document["document"]["id"] if "document" in document else document["id"]
        links = ok(client.put(f"{url}/links/document/{doc_id}", headers=ada))["links"]
        assert [link["kind"] for link in links] == ["note", "document"]
        assert ok(client.get(url, headers=ada))["links"][1]["title"] == "Training plan"
        ok(client.delete(f"{url}/links/document/{doc_id}", headers=ada), 204)
        assert client.put(f"{url}/links/note/{uuid.uuid4()}", headers=ada).status_code == 422

        goal = ok(
            client.post(
                goal_url(fit),
                json={
                    "name": "Squat",
                    "category": "custom",
                    "unit": "kg",
                    "start_value": 1,
                    "target_value": 2,
                    "start_date": TODAY,
                },
                headers=ada,
            ),
            201,
        )
        ok(client.put(f"{fit}/goals/{goal['id']}/links/document/{doc_id}", headers=ada))
        assert (
            ok(client.get(goal_url(fit, goal), headers=ada))["links"][0]["title"] == "Training plan"
        )


class TestOverview:
    def test_dashboard_summaries(self, client: TestClient, fit: str, ada: Headers) -> None:
        exercise = bench(client, fit, ada)
        log_workout(
            client, fit, ada, exercise, [{"reps": 5, "weight_g": 100_000, "completed": True}]
        )
        client.post(f"{fit}/measurements", json={"day": TODAY, "weight_g": 80_000}, headers=ada)
        client.post(f"{fit}/water", json={"day": TODAY, "amount_ml": 500}, headers=ada)
        client.post(
            f"{fit}/activities", json={"day": TODAY, "kind": "steps", "steps": 4000}, headers=ada
        )
        ok(client.put(f"{fit}/profile", json={"hidden_sections": ["nutrition"]}, headers=ada))
        overview = ok(client.get(f"{fit}/overview?date={TODAY}", headers=ada))
        assert overview["week_workouts"] == 1 and len(overview["completed_today"]) == 1
        assert overview["active_session"] is None
        assert overview["weight_trend"] == [{"day": TODAY, "weight_g": 80_000}]
        assert overview["water_ml"] == 500
        assert [a["kind"] for a in overview["recent_activities"]] == ["steps"]
        assert {r["kind"] for r in overview["records"]} >= {"max_weight"}
        assert overview["hidden_sections"] == ["nutrition"]


class TestPrivacy:
    def test_other_people_cant_reach_health_records(
        self, client: TestClient, fit: str, ada: Headers, grace: Headers
    ) -> None:
        session = start(client, fit, ada)
        photo = ok(
            client.post(f"{fit}/photos?filename=a.png&day=2026-01-01", content=PNG, headers=ada),
            201,
        )
        for path in (
            "/overview?date=2026-01-01",
            "/profile",
            "/exercises",
            f"/sessions/{session['id']}",
            f"/photos/{photo['id']}/file",
            "/measurements",
        ):
            assert client.get(f"{fit}{path}", headers=grace).status_code == 404, path
        assert client.get(f"{fit}/profile").status_code == 401
        # Grace's own workspace doesn't see Ada's records either.
        theirs = f"{personal(client, grace)}/fitness"
        assert client.get(f"{theirs}/sessions/{session['id']}", headers=grace).status_code == 404
        assert client.get(f"{theirs}/photos/{photo['id']}/file", headers=grace).status_code == 404
        assert ok(client.get(f"{theirs}/photos", headers=grace))["photos"] == []


@pytest.fixture
async def database(migrated_settings: Settings) -> AsyncIterator[Database]:
    database = await open_database(migrated_settings)
    yield database
    await database.dispose()


@pytest.mark.anyio
async def test_records_are_private_to_their_owner_within_a_workspace(
    client: TestClient, fit: str, ada: Headers, database: Database, tmp_path: Any
) -> None:
    """Health data is filtered by person, not only by workspace, so it stays private if a
    workspace is ever shared."""
    session = start(client, fit, ada)
    client.post(f"{fit}/measurements", json={"day": TODAY, "weight_g": 80_000}, headers=ada)
    photo = ok(
        client.post(f"{fit}/photos?filename=a.png&day=2026-01-01", content=PNG, headers=ada), 201
    )
    workspace_id = uuid.UUID(fit.split("/")[-2])
    rows = query(_db(client), "SELECT id FROM users")
    other = uuid.uuid4()
    query(
        _db(client),
        "INSERT INTO users (id, email, display_name, auth_provider, auth_subject, created_at,"
        " updated_at) VALUES (?, 'm@example.com', 'M', 'local', ?, '2026-01-01', '2026-01-01')",
        other.hex,
        other.hex,
    )
    assert len(rows) == 1
    async with database.session() as db_session:
        fitness = build_fitness(db_session, FileAttachmentStore(tmp_path / "files"))
        member = Owner(workspace_id=workspace_id, user_id=other)
        assert await fitness.workouts.active(member) is None
        assert await fitness.body.measurements(member) == []
        assert await fitness.body.photos(member) == []
        with pytest.raises(FitnessNotFoundError):
            await fitness.workouts.get(member, uuid.UUID(session["id"]))
        with pytest.raises(FitnessNotFoundError):
            await fitness.body.photo_file(member, uuid.UUID(photo["id"]))


@pytest.mark.anyio
async def test_the_file_sweep_keeps_progress_photos(
    client: TestClient, fit: str, ada: Headers, database: Database, tmp_path: Any
) -> None:
    photo = ok(
        client.post(f"{fit}/photos?filename=a.png&day=2026-01-01", content=PNG, headers=ada), 201
    )
    files = tmp_path / "files"
    directory = next(files.iterdir())
    stray = directory / str(uuid.uuid4())
    stray.write_bytes(b"left over")
    old = time.time() - 2 * 3600
    for path in directory.iterdir():
        os.utime(path, (old, old))

    worker = ReminderWorker(database, files=FileAttachmentStore(files))
    assert await worker.sweep_files() == 1
    assert not stray.exists()
    assert client.get(f"{fit}/photos/{photo['id']}/file", headers=ada).status_code == 200
