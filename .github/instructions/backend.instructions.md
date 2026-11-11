---
applyTo: "apps/api/**/*.py"
description: "FastAPI backend conventions for apps/api"
---

# Backend (`apps/api`)

Follows `AGENTS.md`. Specifics:

- Package `orbit_api` in `apps/api/src/`. `main.py`: `create_app(settings)`. `config.py`:
  `Settings` (`ORBIT_*`) via `get_settings()`. `api/v1/`: routers at `/api/v1`.
- Thin routes: Pydantic request/response models, delegate logic, return typed models (the
  return annotation is the response schema).
- Layers: `api/v1/` → `schemas/` → framework-free `services/` → `repositories/` → `db/`
  (engines, sessions, migrations; no FastAPI). Adapters in `providers/`. Routes take
  `SessionDep`. Mirror the closest module.
- Storage mode explicit, no `local`/`cloud` fallback; Alembic revisions work on SQLite and
  PostgreSQL.
- Pyright strict; avoid `Any` and unexplained `# pyright: ignore`. Explicit exceptions mapped
  to safe HTTP errors; never swallow; no secrets or internals in responses or logs.
- `async def` only for code awaiting async I/O; no blocking calls inside.
- Never trust client-supplied user or workspace IDs for authorization.
- Changed routes or exposed models: `pnpm contracts:generate` and commit `packages/contracts`.
- Verify (AGENTS.md "Verification scope"): small: the module's test file, `ruff check` and
  `ruff format --check` on changed files, `uv run pyright`; large: add `uv run pytest`.
