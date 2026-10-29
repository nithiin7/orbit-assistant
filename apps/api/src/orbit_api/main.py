"""Application factory and ASGI entry point."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from orbit_api import __version__
from orbit_api.api.v1 import router as v1_router
from orbit_api.config import Settings, get_settings


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the FastAPI application from the given (or environment) settings."""
    settings = settings or get_settings()
    # Interactive API docs are a development aid; they are not served in production.
    docs_enabled = not settings.is_production

    app = FastAPI(
        title="Orbit API",
        version=__version__,
        docs_url="/docs" if docs_enabled else None,
        redoc_url=None,
        openapi_url="/openapi.json" if docs_enabled else None,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(v1_router)
    return app


app = create_app()
