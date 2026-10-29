"""Run the API server: `uv run orbit-api` or `python -m orbit_api`."""

import copy
from typing import Any

import uvicorn
from uvicorn.config import LOGGING_CONFIG

from orbit_api.config import Settings, get_settings


def main() -> None:
    settings = get_settings()
    uvicorn.run(
        "orbit_api.main:app",
        host=settings.api_host,
        port=settings.api_port,
        log_level=settings.log_level,
        log_config=_log_config(settings),
        reload=settings.is_development,
    )


def _log_config(settings: Settings) -> dict[str, Any]:
    """Uvicorn's logging config, extended so `orbit_api` messages (such as the storage mode
    announced at startup) are printed alongside Uvicorn's."""
    config = copy.deepcopy(LOGGING_CONFIG)
    config["loggers"]["orbit_api"] = {
        "handlers": ["default"],
        "level": settings.log_level.upper(),
        "propagate": False,
    }
    return config


if __name__ == "__main__":
    main()
