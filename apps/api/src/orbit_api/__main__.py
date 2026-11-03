"""Run the API server: `uv run orbit-api` or `python -m orbit_api`."""

import copy
from typing import Any

import uvicorn
from uvicorn.config import LOGGING_CONFIG

from orbit_api.config import Settings, get_settings
from orbit_api.observability import TEXT_FORMAT


def main() -> None:
    settings = get_settings()
    uvicorn.run(
        "orbit_api.main:app",
        host=settings.api_host,
        port=settings.api_port,
        log_level=settings.log_level,
        log_config=log_config(settings),
        # Orbit logs each request itself, without query strings (see `orbit_api.observability`).
        access_log=False,
        proxy_headers=True,
        forwarded_allow_ips=settings.forwarded_allow_ips,
        reload=settings.is_development,
    )


def log_config(settings: Settings) -> dict[str, Any]:
    """Uvicorn's logging config, extended so `orbit_api` messages (requests, the storage mode
    announced at startup, worker activity) are printed with their request IDs."""
    config = copy.deepcopy(LOGGING_CONFIG)
    config["filters"] = {"request_id": {"()": "orbit_api.observability.RequestIdFilter"}}
    config["formatters"]["orbit"] = (
        {"()": "orbit_api.observability.JsonFormatter"}
        if settings.log_format == "json"
        else {"format": TEXT_FORMAT}
    )
    config["handlers"]["orbit"] = {
        "formatter": "orbit",
        "class": "logging.StreamHandler",
        "stream": "ext://sys.stderr",
        "filters": ["request_id"],
    }
    config["loggers"]["orbit_api"] = {
        "handlers": ["orbit"],
        "level": settings.log_level.upper(),
        "propagate": False,
    }
    return config


if __name__ == "__main__":
    main()
