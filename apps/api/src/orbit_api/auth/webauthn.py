"""WebAuthn with a device's built-in authenticator (Touch ID, Windows Hello), via py_webauthn.

Only platform authenticators with user verification are asked for: the device itself must
confirm the person with a fingerprint, face, or device PIN. No attestation is requested, so
nothing identifying the device's make is collected.
"""

import json
import uuid
from typing import Any, cast

from webauthn import (
    base64url_to_bytes,
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers.exceptions import WebAuthnException
from webauthn.helpers.structs import (
    AuthenticatorAttachment,
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from orbit_api.services.app_lock.models import (
    InvalidDeviceResponseError,
    RegisteredKey,
    RelyingParty,
)

RP_NAME = "Orbit"
TIMEOUT_MS = 60_000


class WebAuthnDevices:
    def registration_options(
        self,
        *,
        party: RelyingParty,
        user_id: uuid.UUID,
        user_name: str,
        display_name: str,
        challenge: bytes,
        exclude: list[bytes],
    ) -> dict[str, Any]:
        options = generate_registration_options(
            rp_id=party.id,
            rp_name=RP_NAME,
            user_id=user_id.bytes,
            user_name=user_name,
            user_display_name=display_name,
            challenge=challenge,
            timeout=TIMEOUT_MS,
            authenticator_selection=AuthenticatorSelectionCriteria(
                authenticator_attachment=AuthenticatorAttachment.PLATFORM,
                resident_key=ResidentKeyRequirement.DISCOURAGED,
                user_verification=UserVerificationRequirement.REQUIRED,
            ),
            exclude_credentials=[PublicKeyCredentialDescriptor(id=item) for item in exclude],
        )
        return _json(options_to_json(options))

    def verify_registration(
        self, *, credential: dict[str, Any], challenge: bytes, party: RelyingParty
    ) -> RegisteredKey:
        try:
            verified = verify_registration_response(
                credential=credential,
                expected_challenge=challenge,
                expected_rp_id=party.id,
                expected_origin=party.origin,
                require_user_verification=True,
            )
        except (WebAuthnException, ValueError, TypeError, KeyError) as exc:
            raise InvalidDeviceResponseError from exc
        return RegisteredKey(
            credential_id=verified.credential_id,
            public_key=verified.credential_public_key,
            sign_count=verified.sign_count,
        )

    def authentication_options(
        self, *, party: RelyingParty, challenge: bytes, allow: list[bytes]
    ) -> dict[str, Any]:
        options = generate_authentication_options(
            rp_id=party.id,
            challenge=challenge,
            timeout=TIMEOUT_MS,
            allow_credentials=[PublicKeyCredentialDescriptor(id=item) for item in allow],
            user_verification=UserVerificationRequirement.REQUIRED,
        )
        return _json(options_to_json(options))

    def credential_id(self, credential: dict[str, Any]) -> bytes:
        raw_id = credential.get("rawId")
        if not isinstance(raw_id, str) or not raw_id:
            raise InvalidDeviceResponseError
        try:
            return base64url_to_bytes(raw_id)
        except ValueError as exc:
            raise InvalidDeviceResponseError from exc

    def verify_authentication(
        self,
        *,
        credential: dict[str, Any],
        challenge: bytes,
        party: RelyingParty,
        public_key: bytes,
        sign_count: int,
    ) -> int:
        try:
            verified = verify_authentication_response(
                credential=credential,
                expected_challenge=challenge,
                expected_rp_id=party.id,
                expected_origin=party.origin,
                credential_public_key=public_key,
                credential_current_sign_count=sign_count,
                require_user_verification=True,
            )
        except (WebAuthnException, ValueError, TypeError, KeyError) as exc:
            raise InvalidDeviceResponseError from exc
        return verified.new_sign_count


def _json(text: str) -> dict[str, Any]:
    return cast(dict[str, Any], json.loads(text))
