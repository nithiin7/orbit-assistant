# Orbit: Copilot instructions

Orbit is a privacy-first, local-first personal assistant in early development. Full shared rules
are in `AGENTS.md` (canonical) and architecture in `docs/architecture.md`; read them for
non-trivial work. The essentials are repeated here because Copilot may not load those files.

## Architecture

- pnpm + uv monorepo. `apps/web`: Next.js 16 App Router, React 19, strict TypeScript, Tailwind
  CSS v4. `apps/api`: FastAPI on Python 3.12 (`src/orbit_api`).
- Web and API talk only over HTTP. The only shared types are in `@orbit/contracts`
  (`packages/contracts`), generated from the API's Pydantic models. Never hand-edit
  `openapi.json` or `src/schema.ts` there; change the models and run
  `pnpm contracts:generate`.
- The API owns all data access through SQLAlchemy (SQLite in `local` mode, PostgreSQL in
  `cloud` mode) with Alembic migrations. The web app never touches a database. Identity
  exists (profiles, local or Supabase auth, workspaces; dependencies in `api/auth.py`). The
  product features are tasks, shopping lists, reminders with in-app notifications
  (delivered by the worker in `scheduler/`), and finance (accounts, transactions, categories,
  monthly reports, CSV export, loans and EMIs, subscriptions, recurring bills, upcoming
  payments); no other features or AI integration exist yet.
  Don't build on them unless the task asks.

## Rules

- Do only the requested task. No unrelated refactors, features, or new dependencies.
- TypeScript: no `any`, unsafe `as`, or unexplained suppressions. Server Components by
  default; `"use client"` only when needed. Accessible, keyboard-operable UI with visible
  focus. Only `NEXT_PUBLIC_*` reaches the browser, so never put secrets there.
- Python: full type hints (Pyright strict). Pydantic at API and config boundaries. Config only
  via `orbit_api/config.py` (`ORBIT_*`). No swallowed exceptions or hardcoded secrets.
- Security: validate untrusted input, enforce authorization server-side, never trust
  client-supplied user or workspace IDs, never log secrets or personal data.
- Tests accompany behavior changes. Never weaken or delete tests to make checks pass.
- Formatting and linting are owned by Prettier/ESLint (web) and Ruff (API). Follow them.

## Commands (from the repo root)

- `pnpm check`: lint, format check, type check, and tests for everything.
- `pnpm test:web` (Vitest), `pnpm test:api` (Pytest), `pnpm build` (web production build).
- `pnpm contracts:check` after changing API routes or models.

## Git

Conventional Commits with a header of 72 characters or fewer (`feat(web): add task list`).
Keep changes focused. Never claim checks passed without running them.

## Reviews

Prioritize correctness, security and authorization, data integrity, missing tests, and
accessibility over style. The linters and formatters already enforce style.
