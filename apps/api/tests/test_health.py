from fastapi.testclient import TestClient

from orbit_api import __version__


def test_health_reports_ok(client: TestClient) -> None:
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "orbit-api", "version": __version__}


def test_health_allows_configured_cors_origin(client: TestClient) -> None:
    origin = "http://localhost:3000"
    response = client.get("/api/v1/health", headers={"Origin": origin})

    assert response.headers["access-control-allow-origin"] == origin


def test_health_rejects_unknown_cors_origin(client: TestClient) -> None:
    response = client.get("/api/v1/health", headers={"Origin": "https://evil.example"})

    assert "access-control-allow-origin" not in response.headers
