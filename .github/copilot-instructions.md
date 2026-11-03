# Orbit: Copilot instructions

`AGENTS.md` at the repository root is canonical; read it for non-trivial work, including what is
built, what is not, and the known gotchas. Essentials:

## Architecture

- pnpm + uv monorepo. `apps/web`: Next.js 16 App Router, React 19, strict TypeScript, Tailwind
  CSS v4, TanStack Query. `apps/api`: FastAPI on Python 3.12 (`src/orbit_api`), SQLAlchemy and
  Alembic over SQLite (`local`) or PostgreSQL (`cloud`).
- Web and API talk only over HTTP. Shared types come only from `@orbit/contracts`, generated from
  the API's Pydantic models by `pnpm contracts:generate`; never hand-edit them.
- API layers: thin routes in `api/v1/`, Pydantic `schemas/`, framework-free `services/`,
  SQLAlchemy `repositories/`, and `db/`. Every workspace route uses `WorkspaceDep` and filters
  by workspace.

## Rules

- Do only the requested task; mirror the closest existing feature. No unneeded dependencies.
- TypeScript: no `any`, unsafe `as`, or unexplained suppressions. Server Components by default.
  Accessible, keyboard-operable UI. Only `NEXT_PUBLIC_*` reaches the browser.
- Python: full type hints (Pyright strict), Pydantic at boundaries, config only via
  `get_settings()`. No swallowed exceptions.
- Security: validate input, authorize on the server, never trust client-supplied IDs, never log
  secrets or personal data.
- Tests accompany behavior changes. Never weaken tests to make checks pass.

## Commands (repo root)

`pnpm check` (all gates), `pnpm test:web`, `pnpm test:api`, `pnpm build`, and
`pnpm contracts:check` after API changes. Conventional Commits, header ≤ 72 chars.

## Reviews

Prioritize correctness, authorization and isolation, data integrity, missing tests, and
accessibility over style; the linters own style.
