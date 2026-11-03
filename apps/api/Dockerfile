# syntax=docker/dockerfile:1
#
# Orbit API image. Build from the repository root, which holds the uv workspace and lock file:
#
#   docker build -f apps/api/Dockerfile -t orbit-api .
#
# Commands (see docker-entrypoint.sh): `api` (default), `migrate`, `worker [args]`.
# All data (SQLite database, attachments, generated AI key file) lives in the /data volume.

ARG PYTHON_VERSION=3.12

FROM python:${PYTHON_VERSION}-slim AS build

COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /usr/local/bin/uv

# Install into /opt/venv with the image's Python, and compile bytecode for faster startup.
ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_PYTHON_DOWNLOADS=never \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /src

# Dependencies first, so this layer is reused until uv.lock or a pyproject.toml changes.
COPY pyproject.toml uv.lock ./
COPY apps/api/pyproject.toml apps/api/README.md apps/api/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --package orbit-api --no-install-workspace

# Then the API itself, installed as a regular (non-editable) package so /src isn't needed later.
COPY apps/api/src apps/api/src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --package orbit-api --no-editable


FROM python:${PYTHON_VERSION}-slim AS runtime

LABEL org.opencontainers.image.title="Orbit API" \
      org.opencontainers.image.description="API and reminder worker for Orbit, a privacy-first personal assistant." \
      org.opencontainers.image.licenses="Apache-2.0"

# An unprivileged user that owns only the data directory.
RUN groupadd --system --gid 10001 orbit \
    && useradd --system --uid 10001 --gid orbit --no-create-home --home-dir /nonexistent orbit \
    && mkdir -p /data \
    && chown orbit:orbit /data \
    && chmod 700 /data

COPY --from=build /opt/venv /opt/venv
COPY --chmod=755 apps/api/docker-entrypoint.sh /usr/local/bin/orbit-entrypoint

# Container defaults. Every ORBIT_* setting can be overridden at runtime; see
# apps/api/.env.example and docs/deployment.md.
ENV PATH="/opt/venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    ORBIT_ENV=production \
    ORBIT_API_HOST=0.0.0.0 \
    ORBIT_API_PORT=8000 \
    ORBIT_SQLITE_PATH=/data/orbit.sqlite3 \
    ORBIT_ATTACHMENTS_PATH=/data/attachments

# An empty working directory, so settings never pick up a stray `.env` file.
WORKDIR /app
USER orbit
VOLUME ["/data"]
EXPOSE 8000

# Ready means the database answers and its schema is current; Compose starts the web app only
# then. `/api/v1/health/live` checks the process alone.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('ORBIT_API_PORT', '8000') + '/api/v1/health/ready', timeout=4)"]

ENTRYPOINT ["orbit-entrypoint"]
CMD ["api"]
