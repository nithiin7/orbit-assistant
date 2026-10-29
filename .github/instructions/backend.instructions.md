---
applyTo: "apps/api/**/*.py"
description: "FastAPI backend conventions for apps/api"
---

# Backend (`apps/api`)

Follows the shared rules in `AGENTS.md`. Backend specifics:

- Package `orbit_api` under `apps/api/src/`. `main.py` has the `create_app(settings)` factory,
  `config.py` the `Settings` (pydantic-settings, `ORBIT_*` prefix, read via `get_settings()`),
  and `api/v1/` the versioned routers mounted at `/api/v1`.
- Routes stay thin: validate with Pydantic request/response models, delegate logic, and return
  typed models (the return annotation is the response schema).
- As features land, separate schemas, framework-free services, and infrastructure adapters, as
  described in `docs/architecture.md`. Create these packages only when a feature needs them.
- Database: `db/` holds engines, sessions, and Alembic migrations (no FastAPI imports). Routes
  take `SessionDep`; services stay free of SQLAlchemy. Storage mode is explicit, with no
  fallback between `local` and `cloud`. Schema changes are Alembic revisions that work on
  SQLite and PostgreSQL.
- Full type hints; Pyright runs in strict mode. Avoid `Any` and unexplained
  `# pyright: ignore`.
- Raise explicit exceptions and map them to safe HTTP errors. No swallowed exceptions, and no
  secrets or internals in responses or logs.
- `async def` only for code that awaits async I/O. No blocking calls inside it.
- Never trust client-supplied user or workspace IDs for authorization.
- After changing any route or exposed model, run `pnpm contracts:generate` and include the
  regenerated `packages/contracts` files in the same change.
- Verify from `apps/api`: `uv run ruff check .`, `uv run ruff format --check .`,
  `uv run pyright`, `uv run pytest`.
