import pytest
from fastapi.testclient import TestClient

from orbit_api.services.avatars.service import MAX_AVATAR_BYTES, detect_image_type
from tests.support import bearer, sign_up

AVATAR = "/api/v1/me/avatar"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 64


@pytest.mark.parametrize(
    ("data", "expected"),
    [
        (PNG, "image/png"),
        (JPEG, "image/jpeg"),
        (WEBP, "image/webp"),
        (b"<svg xmlns='http://www.w3.org/2000/svg'/>", None),
        (b"GIF89a", None),
        (b"", None),
    ],
)
def test_detects_image_type_from_the_file_signature(data: bytes, expected: str | None) -> None:
    assert detect_image_type(data) == expected


def test_no_photo_by_default(client: TestClient) -> None:
    ada = bearer(sign_up(client))

    response = client.get(AVATAR, headers=ada)

    assert response.status_code == 204
    assert response.content == b""


def test_set_replace_and_remove_photo(client: TestClient) -> None:
    ada = bearer(sign_up(client))

    assert (
        client.put(AVATAR, content=PNG, headers={**ada, "Content-Type": "image/png"}).status_code
        == 204
    )
    response = client.get(AVATAR, headers=ada)
    assert response.status_code == 200
    assert response.content == PNG
    assert response.headers["content-type"] == "image/png"
    assert response.headers["x-content-type-options"] == "nosniff"

    # The stored type follows the file, not the declared header.
    client.put(AVATAR, content=WEBP, headers={**ada, "Content-Type": "image/png"})
    assert client.get(AVATAR, headers=ada).headers["content-type"] == "image/webp"

    assert client.delete(AVATAR, headers=ada).status_code == 204
    assert client.get(AVATAR, headers=ada).status_code == 204


def test_rejects_files_that_are_not_supported_images(client: TestClient) -> None:
    ada = bearer(sign_up(client))
    svg = b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"

    response = client.put(AVATAR, content=svg, headers={**ada, "Content-Type": "image/png"})

    assert response.status_code == 415
    assert response.json() == {"detail": "Use a PNG, JPEG, or WebP image."}
    assert client.get(AVATAR, headers=ada).status_code == 204


def test_rejects_photos_over_the_size_limit(client: TestClient) -> None:
    ada = bearer(sign_up(client))
    oversized = PNG + b"\x00" * MAX_AVATAR_BYTES

    response = client.put(AVATAR, content=oversized, headers={**ada, "Content-Type": "image/png"})

    assert response.status_code == 413
    assert client.get(AVATAR, headers=ada).status_code == 204


def test_photos_are_private_to_their_owner(client: TestClient) -> None:
    ada = bearer(sign_up(client, email="ada@example.com"))
    grace = bearer(sign_up(client, email="grace@example.com"))
    client.put(AVATAR, content=JPEG, headers={**ada, "Content-Type": "image/jpeg"})

    assert client.get(AVATAR, headers=grace).status_code == 204
    client.delete(AVATAR, headers=grace)
    assert client.get(AVATAR, headers=ada).content == JPEG
