"""Builds the provider connectors from server configuration. The one place that knows every
vendor; a provider without an OAuth client ID isn't offered."""

from typing import Final

import httpx2

from orbit_api.config import Settings
from orbit_api.providers.integrations import google, microsoft
from orbit_api.providers.integrations.http import TIMEOUT, ApiClient
from orbit_api.services.integrations.connectors import ProviderConnector
from orbit_api.services.integrations.models import PROVIDER_IDS, ProviderId

NAMES: Final[dict[ProviderId, str]] = {"google": "Google", "microsoft": "Microsoft"}


class HttpConnectorRegistry:
    """Connectors over one shared HTTP client (connection pooling). Close it on shutdown."""

    def __init__(
        self, settings: Settings, transport: httpx2.AsyncBaseTransport | None = None
    ) -> None:
        # Redirects are never followed automatically: a redirect must not carry a token.
        self._client = httpx2.AsyncClient(
            timeout=TIMEOUT, transport=transport, follow_redirects=False
        )
        self._connectors: dict[ProviderId, ProviderConnector] = {}
        if settings.google_client_id:
            http = ApiClient(self._client, NAMES["google"])
            secret = settings.google_client_secret
            self._connectors["google"] = ProviderConnector(
                provider="google",
                name=NAMES["google"],
                oauth=google.GoogleOAuth(
                    http, settings.google_client_id, secret.get_secret_value() if secret else None
                ),
                scopes=dict(google.SCOPES),
                base_scopes=google.BASE_SCOPES,
                calendar=google.GoogleCalendar(http),
                mail=google.GoogleMail(http),
                files=google.GoogleDrive(http),
            )
        if settings.microsoft_client_id:
            http = ApiClient(self._client, NAMES["microsoft"])
            secret = settings.microsoft_client_secret
            self._connectors["microsoft"] = ProviderConnector(
                provider="microsoft",
                name=NAMES["microsoft"],
                oauth=microsoft.MicrosoftOAuth(
                    http,
                    settings.microsoft_client_id,
                    secret.get_secret_value() if secret else None,
                    settings.microsoft_tenant,
                ),
                scopes=dict(microsoft.SCOPES),
                base_scopes=microsoft.BASE_SCOPES,
                calendar=microsoft.MicrosoftCalendar(http),
                mail=microsoft.OutlookMail(http),
                files=microsoft.OneDriveFiles(http),
            )

    def get(self, provider: ProviderId) -> ProviderConnector | None:
        return self._connectors.get(provider)

    def known(self) -> list[ProviderId]:
        return list(PROVIDER_IDS)

    async def aclose(self) -> None:
        await self._client.aclose()
