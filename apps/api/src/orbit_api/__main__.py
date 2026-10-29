"""Run the API server: `uv run orbit-api` or `python -m orbit_api`."""

import uvicorn

from orbit_api.config import get_settings


def main() -> None:
    settings = get_settings()
    uvicorn.run(
        "orbit_api.main:app",
        host=settings.api_host,
        port=settings.api_port,
        log_level=settings.log_level,
        reload=settings.is_development,
    )


if __name__ == "__main__":
    main()
