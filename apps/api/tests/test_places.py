"""Places: adding, updating, and deleting places, online maps and place search, and isolation
between workspaces."""

import uuid
from collections.abc import Iterator
from typing import Any

import httpx2
import pytest
from fastapi.testclient import TestClient

from orbit_api.config import Settings
from orbit_api.main import create_app
from orbit_api.providers.geo.nominatim import NominatimGeocoder, parse_results
from orbit_api.services.places.models import Location, PlaceMatch, PlaceSearchError
from tests.support import FAST_PASSWORD_HASHER, bearer, sign_up

WORKSPACES = "/api/v1/workspaces"

Headers = dict[str, str]
Json = dict[str, Any]

KYOTO = PlaceMatch(
    name="Kyoto",
    locality="Kyoto Prefecture",
    country_code="JP",
    location=Location(latitude=35.0116, longitude=135.7681),
    label="Kyoto, Kyoto Prefecture, Japan",
)


class FakeGeocoder:
    def __init__(self) -> None:
        self.queries: list[str] = []
        self.fail = False

    async def search(self, query: str) -> list[PlaceMatch]:
        self.queries.append(query)
        if self.fail:
            raise PlaceSearchError
        return [KYOTO]

    async def aclose(self) -> None:
        pass


@pytest.fixture
def geocoder() -> FakeGeocoder:
    return FakeGeocoder()


def make_client(settings: Settings, geocoder: FakeGeocoder) -> Iterator[TestClient]:
    app = create_app(settings.model_copy(update={"local_open_registration": True}))
    app.state.password_hasher = FAST_PASSWORD_HASHER
    app.state.geocoder = geocoder
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def client(migrated_settings: Settings, geocoder: FakeGeocoder) -> Iterator[TestClient]:
    """Two local accounts are needed to test isolation, so registration is explicitly open."""
    yield from make_client(migrated_settings, geocoder)


@pytest.fixture
def ada(client: TestClient) -> Headers:
    return bearer(sign_up(client, email="ada@example.com", display_name="Ada"))


@pytest.fixture
def grace(client: TestClient) -> Headers:
    return bearer(sign_up(client, email="grace@example.com", display_name="Grace"))


def base_url(client: TestClient, headers: Headers) -> str:
    workspace: Json = client.get(WORKSPACES, headers=headers).json()["workspaces"][0]
    return f"{WORKSPACES}/{workspace['id']}/places"


@pytest.fixture
def url(client: TestClient, ada: Headers) -> str:
    """Places in Ada's personal workspace."""
    return base_url(client, ada)


def add(client: TestClient, base: str, headers: Headers, **fields: Any) -> Json:
    body = {"name": "Lisbon", "country_code": "PT", "status": "visited", **fields}
    response = client.post(f"{base}/items", json=body, headers=headers)
    assert response.status_code == 201, response.text
    place: Json = response.json()
    return place


def listed(client: TestClient, url: str, headers: Headers) -> list[Json]:
    response = client.get(f"{url}/items", headers=headers)
    assert response.status_code == 200, response.text
    places: list[Json] = response.json()["places"]
    return places


# Places


def test_add_with_only_a_name_and_country(client: TestClient, ada: Headers, url: str) -> None:
    place = add(client, url, ada, country_code="pt")
    assert place["name"] == "Lisbon"
    assert place["country_code"] == "PT"
    assert place["locality"] == ""
    assert place["location"] is None
    assert place["status"] == "visited"
    assert place["visited_on"] is None
    assert place["favorite"] is False
    assert place["note"] == ""
    assert listed(client, url, ada) == [place]


def test_add_with_every_field(client: TestClient, ada: Headers, url: str) -> None:
    place = add(
        client,
        url,
        ada,
        name="  Fushimi Inari  ",
        locality="Kyoto",
        country_code="JP",
        location={"latitude": 34.9671, "longitude": 135.7727},
        visited_on="2024-04-02",
        favorite=True,
        note="Go early.\nTake water.",
    )
    assert place["name"] == "Fushimi Inari"
    assert place["locality"] == "Kyoto"
    assert place["location"] == {"latitude": 34.9671, "longitude": 135.7727}
    assert place["visited_on"] == "2024-04-02"
    assert place["favorite"] is True
    assert place["note"] == "Go early.\nTake water."
    assert client.get(f"{url}/items/{place['id']}", headers=ada).json() == place


@pytest.mark.parametrize(
    "body",
    [
        {"country_code": "PT", "status": "visited"},
        {"name": "", "country_code": "PT", "status": "visited"},
        {"name": "x" * 121, "country_code": "PT", "status": "visited"},
        {"name": "Tab\x00", "country_code": "PT", "status": "visited"},
        {"name": "Nowhere", "country_code": "ZZ", "status": "visited"},
        {"name": "Nowhere", "country_code": "PRT", "status": "visited"},
        {"name": "Lisbon", "country_code": "PT", "status": "maybe"},
        {"name": "Lisbon", "country_code": "PT", "status": "visited", "note": "x" * 1001},
        {
            "name": "Lisbon",
            "country_code": "PT",
            "status": "visited",
            "location": {"latitude": 91, "longitude": 0},
        },
        {
            "name": "Lisbon",
            "country_code": "PT",
            "status": "visited",
            "location": {"latitude": 0, "longitude": -181},
        },
        {"name": "Lisbon", "country_code": "PT", "status": "visited", "extra": True},
    ],
)
def test_input_is_validated(client: TestClient, ada: Headers, url: str, body: Json) -> None:
    assert client.post(f"{url}/items", json=body, headers=ada).status_code == 422


def test_only_visited_places_have_a_visit_date(client: TestClient, ada: Headers, url: str) -> None:
    response = client.post(
        f"{url}/items",
        json={
            "name": "Reykjavik",
            "country_code": "IS",
            "status": "want_to_visit",
            "visited_on": "2025-01-01",
        },
        headers=ada,
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "Only visited places have a visit date."

    wish = add(client, url, ada, name="Reykjavik", country_code="IS", status="want_to_visit")
    item = f"{url}/items/{wish['id']}"
    assert client.patch(item, json={"visited_on": "2025-01-01"}, headers=ada).status_code == 422
    # Marking it visited with a date in the same change works.
    response = client.patch(
        item, json={"status": "visited", "visited_on": "2025-01-01"}, headers=ada
    )
    assert response.status_code == 200
    assert response.json()["visited_on"] == "2025-01-01"
    # Moving it back to the wishlist clears the date.
    response = client.patch(item, json={"status": "want_to_visit"}, headers=ada)
    assert response.json()["visited_on"] is None


def test_newest_first(client: TestClient, ada: Headers, url: str) -> None:
    first = add(client, url, ada, name="First")
    second = add(client, url, ada, name="Second")
    assert [place["id"] for place in listed(client, url, ada)] == [second["id"], first["id"]]


def test_update(client: TestClient, ada: Headers, url: str) -> None:
    place = add(client, url, ada, location={"latitude": 38.72, "longitude": -9.14})
    item = f"{url}/items/{place['id']}"

    response = client.patch(
        item,
        json={"name": "Porto", "locality": "Norte", "favorite": True, "note": "Port wine"},
        headers=ada,
    )
    assert response.status_code == 200
    updated: Json = response.json()
    assert updated["name"] == "Porto"
    assert updated["locality"] == "Norte"
    assert updated["favorite"] is True
    assert updated["note"] == "Port wine"
    assert updated["location"] == {"latitude": 38.72, "longitude": -9.14}
    assert updated["updated_at"] >= place["updated_at"]

    response = client.patch(item, json={"location": None, "country_code": "es"}, headers=ada)
    assert response.json()["location"] is None
    assert response.json()["country_code"] == "ES"


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"name": None},
        {"status": None},
        {"country_code": "XX"},
        {"favorite": None},
        {"location": {"latitude": 0}},
    ],
)
def test_update_is_validated(client: TestClient, ada: Headers, url: str, body: Json) -> None:
    place = add(client, url, ada)
    assert client.patch(f"{url}/items/{place['id']}", json=body, headers=ada).status_code == 422


def test_delete(client: TestClient, ada: Headers, url: str) -> None:
    place = add(client, url, ada)
    item = f"{url}/items/{place['id']}"
    assert client.delete(item, headers=ada).status_code == 204
    assert client.get(item, headers=ada).status_code == 404
    assert client.delete(item, headers=ada).status_code == 404
    assert listed(client, url, ada) == []


def test_unknown_and_invalid_ids(client: TestClient, ada: Headers, url: str) -> None:
    missing = f"{url}/items/{uuid.uuid4()}"
    assert client.get(missing, headers=ada).status_code == 404
    assert client.patch(missing, json={"favorite": True}, headers=ada).status_code == 404
    assert client.get(f"{url}/items/not-an-id", headers=ada).status_code == 422


def test_other_workspaces_places_are_unreachable(
    client: TestClient, ada: Headers, grace: Headers, url: str
) -> None:
    place = add(client, url, ada)
    grace_url = base_url(client, grace)
    item = f"{grace_url}/items/{place['id']}"

    assert client.get(item, headers=grace).status_code == 404
    assert client.patch(item, json={"favorite": True}, headers=grace).status_code == 404
    assert client.delete(item, headers=grace).status_code == 404
    assert listed(client, grace_url, grace) == []
    # Grace can't reach Ada's workspace URL at all.
    assert client.get(f"{url}/items", headers=grace).status_code == 404
    assert (
        client.put(f"{url}/settings", json={"online_maps": True}, headers=grace).status_code == 404
    )
    assert listed(client, url, ada)[0]["favorite"] is False


# Online maps and place search


def test_online_maps_are_off_until_turned_on(
    client: TestClient, ada: Headers, url: str, geocoder: FakeGeocoder
) -> None:
    settings = client.get(f"{url}/settings", headers=ada).json()
    assert settings == {"online_maps": False, "online_maps_allowed": True, "map_style_url": None}
    response = client.post(f"{url}/search", json={"query": "Kyoto"}, headers=ada)
    assert response.status_code == 409
    assert geocoder.queries == []

    response = client.put(f"{url}/settings", json={"online_maps": True}, headers=ada)
    assert response.status_code == 200
    assert response.json()["online_maps"] is True
    assert response.json()["map_style_url"] == "https://tiles.openfreemap.org/styles/positron"

    response = client.post(f"{url}/search", json={"query": "  Kyoto "}, headers=ada)
    assert response.status_code == 200
    assert response.json() == {
        "matches": [
            {
                "name": "Kyoto",
                "locality": "Kyoto Prefecture",
                "country_code": "JP",
                "location": {"latitude": 35.0116, "longitude": 135.7681},
                "label": "Kyoto, Kyoto Prefecture, Japan",
            }
        ]
    }
    assert geocoder.queries == ["Kyoto"]

    client.put(f"{url}/settings", json={"online_maps": False}, headers=ada)
    assert client.post(f"{url}/search", json={"query": "Kyoto"}, headers=ada).status_code == 409


def test_search_is_validated_and_failures_are_safe(
    client: TestClient, ada: Headers, url: str, geocoder: FakeGeocoder
) -> None:
    client.put(f"{url}/settings", json={"online_maps": True}, headers=ada)
    assert client.post(f"{url}/search", json={"query": "K"}, headers=ada).status_code == 422
    assert client.post(f"{url}/search", json={"query": "x" * 201}, headers=ada).status_code == 422
    geocoder.fail = True
    response = client.post(f"{url}/search", json={"query": "Kyoto"}, headers=ada)
    assert response.status_code == 502


def test_the_server_can_turn_online_maps_off(
    migrated_settings: Settings, geocoder: FakeGeocoder
) -> None:
    settings = migrated_settings.model_copy(update={"online_maps_enabled": False})
    for client in make_client(settings, geocoder):
        ada = bearer(sign_up(client, email="ada@example.com", display_name="Ada"))
        url = base_url(client, ada)
        response = client.put(f"{url}/settings", json={"online_maps": True}, headers=ada)
        assert response.status_code == 409
        assert client.get(f"{url}/settings", headers=ada).json() == {
            "online_maps": False,
            "online_maps_allowed": False,
            "map_style_url": None,
        }
        assert client.post(f"{url}/search", json={"query": "Kyoto"}, headers=ada).status_code == 409
        # Places themselves still work.
        add(client, url, ada)


# Nominatim


NOMINATIM_RESULTS: list[object] = [
    {
        "lat": "35.0115754",
        "lon": "135.7681441",
        "name": "Kyoto",
        "display_name": "Kyoto, Kyoto Prefecture, Japan",
        "address": {"city": "Kyoto", "state": "Kyoto Prefecture", "country_code": "jp"},
    },
    # No country: skipped.
    {"lat": "0", "lon": "0", "name": "Null Island", "display_name": "Null Island"},
    # Bad position: skipped.
    {"lat": "x", "lon": "1", "name": "Bad", "address": {"country_code": "fr"}},
    {"lat": "95", "lon": "1", "name": "Too far north", "address": {"country_code": "fr"}},
    # Unknown country code: skipped.
    {"lat": "1", "lon": "1", "name": "Nowhere", "address": {"country_code": "zz"}},
    # No name: taken from the address.
    {
        "lat": "48.8584",
        "lon": "2.2945",
        "name": "",
        "display_name": "Tour Eiffel, Paris, France",
        "address": {"city": "Paris", "country_code": "fr"},
    },
    "garbage",
]


def test_parse_results() -> None:
    matches = parse_results(NOMINATIM_RESULTS)
    assert matches == [
        PlaceMatch(
            name="Kyoto",
            locality="Kyoto Prefecture",
            country_code="JP",
            location=Location(latitude=35.011575, longitude=135.768144),
            label="Kyoto, Kyoto Prefecture, Japan",
        ),
        PlaceMatch(
            name="Tour Eiffel",
            locality="Paris",
            country_code="FR",
            location=Location(latitude=48.8584, longitude=2.2945),
            label="Tour Eiffel, Paris, France",
        ),
    ]
    with pytest.raises(PlaceSearchError):
        parse_results({"error": "nope"})


@pytest.mark.anyio
async def test_geocoder_sends_only_the_phrase_and_caches() -> None:
    requests: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        return httpx2.Response(200, json=NOMINATIM_RESULTS[:1])

    geocoder = NominatimGeocoder(
        httpx2.MockTransport(handler), base_url="https://geo.example/", min_interval=0
    )
    try:
        first = await geocoder.search("Kyoto")
        again = await geocoder.search("  kyoto ")
    finally:
        await geocoder.aclose()
    assert first == again
    assert len(requests) == 1
    request = requests[0]
    assert str(request.url).startswith("https://geo.example/search?")
    assert request.url.params["q"] == "Kyoto"
    assert request.headers["User-Agent"] == "Orbit/1.0 (self-hosted personal assistant)"
    assert "cookie" not in request.headers
    assert "authorization" not in request.headers


@pytest.mark.anyio
@pytest.mark.parametrize("status", [429, 500])
async def test_geocoder_errors(status: int) -> None:
    geocoder = NominatimGeocoder(
        httpx2.MockTransport(lambda _request: httpx2.Response(status)),
        base_url="https://geo.example",
        min_interval=0,
    )
    try:
        with pytest.raises(PlaceSearchError):
            await geocoder.search("Kyoto")
    finally:
        await geocoder.aclose()
