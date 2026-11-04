# Architecture

This document describes how the Orbit repository is organized and why. Sections describe the
**current implementation** unless they are explicitly marked **planned**. Planned sections record
intended direction; none of that code exists yet. Coding-agent rules live in
[`AGENTS.md`](../AGENTS.md).

## Overview

```text
Browser ──► apps/web (Next.js, :3000) ──HTTP/JSON──► apps/api (FastAPI, :8000) ──► database
                                                                                  │
                                              local mode: SQLite file on this machine
                                              cloud mode: PostgreSQL (Supabase)
```

- **apps/web** renders the user interface. It is a Next.js App Router app written in strict
  TypeScript and styled with Tailwind CSS v4.
- **apps/api** is a FastAPI service that owns data access and business logic. It exposes health
  endpoints, sign-in configuration and local accounts, the signed-in user's profile, and
  workspaces, on the database foundation described under [Storage](#storage). Identity is
  described under [Identity and authorization](#identity-and-authorization). Product data:
  [tasks](#tasks), shopping lists, [reminders](#reminders-and-notifications), and
  [finance](#finance), [notes](#notes-and-knowledge-management), the
  [calendar](#calendar-and-events), [habits and routines](#habits-and-routines),
  [documents](#documents-and-the-personal-vault), and [health and fitness](#health-and-fitness),
  brought together by the [daily dashboard and command center](#daily-dashboard-and-command-center)
  and [universal search](#universal-search), with an optional [AI layer](#ai-intelligence-layer) on top (off until each person turns it on),
  and [external integrations](#external-integrations) that bring Google and Microsoft calendars,
  mail, and files into those modules, [backup, restore, and data
  portability](#backup-restore-and-data-portability) for every workspace, and a [personal agent
  and workflow automation](#personal-agent-and-automation) (off until each person turns it on).

The two apps communicate only over HTTP and share no runtime code. They share one thing: the
API contract in `packages/contracts`, described below.

## Dependency boundaries

| Module                       | May depend on                                     | Must not depend on                                    |
| ---------------------------- | ------------------------------------------------- | ----------------------------------------------------- |
| `apps/web`                   | `@orbit/contracts` (types only), its own packages | `apps/api` code, Python, server secrets, any database |
| `apps/api`                   | Its own Python dependencies                       | Anything in `apps/web` or `packages/`                 |
| `packages/contracts`         | Nothing at runtime (generated from `apps/api`)    | `apps/web`                                            |
| `packages/eslint-config`     | ESLint plugins                                    | Application code                                      |
| `packages/typescript-config` | Nothing                                           | Application code                                      |

- Web and API communicate only over HTTP. All data and business rules live behind the API.
  The web app never connects to SQLite or PostgreSQL and never holds database credentials. The web app renders, navigates, and calls the API through the typed helpers in `src/api/`.
- Within the web app, dependencies point one way:
  `src/app` → `src/components` → `src/hooks` → `src/providers` → `src/api`, `src/lib` →
  `src/utils`.
  `src/providers` holds app-wide React context (auth, workspaces, avatar, query client, theme)
  and may use other providers, but never components or hooks. `src/hooks` (query hooks that
  need auth or the active workspace) never imports components. `src/api` and `src/lib` import
  none of the React layers; `src/api` depends only on `@orbit/contracts`,
  `@tanstack/react-query`, `src/lib/env`, and pure `src/lib` helpers (such as
  `src/lib/shopping` for sorting and counting). `src/components/ui` primitives depend only on
  `src/utils/common`. `src/utils` holds generic helpers shared across features and imports no
  other app layer. ESLint enforces the layer rules (`apps/web/eslint.config.mjs`).
- Server data is cached by TanStack Query, keyed by workspace (`["workspaces", id, …]`). The
  cache is cleared whenever the signed-in user changes, so one user's data is never shown to
  another.
- Forms use React Hook Form with Yup schemas from `src/lib`. The schemas mirror the API's
  validation for immediate feedback; the API still validates every request.
- Selects, date pickers, and money inputs are custom accessible controls in
  `src/components/ui/` (a select-only combobox, a calendar dialog, and an input that groups digits
  as typed). Their popups use the Popover API so they sit above modal dialogs. Money is grouped
  per currency: lakhs and crores for INR, thousands for the rest.

## Shared API contract

```text
apps/api  Pydantic models + routes          (source of truth, edit here)
   │  pnpm contracts:generate
   ▼
packages/contracts/openapi.json             (generated by orbit_api.openapi, committed)
packages/contracts/src/schema.ts            (generated by openapi-typescript, committed)
packages/contracts/src/index.ts             (hand-written aliases, e.g. HealthResponse)
   │  import type { HealthResponse } from "@orbit/contracts"
   ▼
apps/web  src/api/                            (typed fetch helpers + TanStack Query options)
```

- **Python is the source of truth.** Models are written once in Pydantic. FastAPI already
  derives an OpenAPI schema from them, so no second schema language is needed.
- **Generated files are committed.** Reviewers see contract changes in pull requests, and the
  web app builds without a Python toolchain.
- **Drift is caught automatically.** `tests/test_openapi.py` (Pytest) fails if `openapi.json`
  is stale, and `openapi-typescript --check` (the contracts package's `lint` script) fails if
  `schema.ts` is stale. Both run in CI. After regenerating, `tsc` flags any web code that no
  longer matches the API.
- The schema is exported with fixed test settings, so local `.env` values never leak into it.
- **Type-only package.** `@orbit/contracts` exports TypeScript types only. It has no runtime
  code or build step.

## Monorepo tooling

| Concern            | JavaScript / TypeScript      | Python                      |
| ------------------ | ---------------------------- | --------------------------- |
| Package management | pnpm workspaces              | uv workspace                |
| Lockfile           | `pnpm-lock.yaml`             | `uv.lock`                   |
| Linting            | ESLint (flat config)         | Ruff                        |
| Formatting         | Prettier (+ Tailwind plugin) | Ruff formatter              |
| Type checking      | `tsc` (strict)               | Pyright (strict)            |
| Testing            | Vitest + Testing Library     | Pytest + FastAPI TestClient |

Each tool owns exactly one concern per language, so no two tools disagree about formatting or
import order. ESLint includes `eslint-config-prettier` to turn off stylistic rules, and Prettier
ignores Python files.

### Driving Python from pnpm

`apps/api/package.json` is a thin wrapper: each script is a single `uv run …` command. This lets
root scripts like `pnpm lint` and `pnpm test` fan out with `pnpm -r` across both stacks without
special cases. The Python project stays a normal uv project, so `uv` commands work directly
inside `apps/api`.

### Python workspace

The root `pyproject.toml` is a _virtual_ uv workspace root. It holds no package, only the
workspace member list and the shared Ruff configuration. `apps/api/pyproject.toml` declares the
API's dependencies, its development tools (in the `dev` dependency group), and its Pyright and
Pytest settings. A single `.venv` at the repository root serves all workspace members.

### Shared JS packages

- `@orbit/typescript-config` provides `base.json` (strict settings for any TS package) and
  `nextjs.json` (DOM libs, JSX, and the Next.js plugin).
- `@orbit/eslint-config/next` combines `eslint-config-next` (core web vitals, TypeScript,
  React hooks, jsx-a11y) with deterministic import sorting and Prettier compatibility.

These packages, and `@orbit/contracts`, are consumed via `workspace:*` and contain no build step.

## Web app

```text
apps/web/src/
├── app/                 # Routes (App Router)
│   ├── layout.tsx       # Root layout: theme provider + auth provider
│   ├── (app)/           # Signed-in routes: RequireAuth + WorkspaceProvider + app shell
│   │   ├── page.tsx     # Dashboard: user-arranged widgets (components/dashboard/)
│   │   ├── tasks/       # Tasks page
│   │   ├── reminders/   # Reminders page
│   │   ├── finance/     # Finance page: 13 views in four groups, chosen by ?view=
│   │   ├── notes/       # Notes page: view, folder, tag, search, and open note in the URL
│   │   ├── calendar/    # Calendar page: month, week, day, or agenda, and the date, in the URL
│   │   ├── settings/    # Settings: drill-down on small screens, split view on large; [panel]/ sub-pages
│   │   └── [section]/   # Placeholder page for every other nav section
│   ├── (auth)/          # Public routes without the shell: sign-in, sign-up
│   └── not-found.tsx    # Standalone 404 (works signed in or out)
├── styles/              # globals.css entry: tokens (light/dark), theme, motion, base, components, utilities; fonts.ts (Geist)
├── components/
│   ├── app-shell/       # Sidebar, mobile drawer, navigation links
│   ├── auth/            # RequireAuth, sign-in and sign-up forms
│   ├── avatar/          # UserAvatar
│   ├── dashboard/       # Customizable dashboard grid, shared widget frame, Today, Needs attention, quick actions
│   ├── quick-actions/   # Create or record from anywhere with each module's own dialog (dashboard, palette)
│   ├── workspace/       # Workspace switcher, dashboard overview
│   ├── tasks/           # Tasks page (composer, toolbar, list, edit dialog), dashboard summary
│   ├── reminders/       # Reminders page (list, create/edit dialog), dashboard widget
│   ├── finance/         # Finance page: navigation, views, shared blocks (tiles, panels, row actions), dialogs
│   ├── notes/           # Notes page: rail, list, Tiptap editor and toolbar, details, pickers, quick capture
│   ├── calendar/        # Calendar page: views, time grid, event and details dialogs, sidebar, dashboard widget
│   ├── notifications/   # Notification bell and panel (in the sidebar and mobile top bar)
│   ├── assistant/       # Assistant page: conversations, streaming answers, sources, proposals, insights
│   ├── ai/              # The contextual "AI" menu and its result dialog, used inside modules
│   ├── markdown/        # Safe Markdown rendering of model output (no HTML)
│   ├── settings/        # Settings menu and the account, workspace, theme, and storage panels
│   ├── storage/         # Storage-mode indicator and status card
│   └── ui/              # Small shadcn/ui-compatible primitives
├── hooks/               # Query hooks bound to auth and the active workspace (use-tasks, …)
├── providers/           # App-wide context: auth, workspaces, avatar, query client, theme
├── lib/
│   ├── navigation.ts    # Single source of truth for nav items and section routes
│   ├── settings.ts      # Single source of truth for settings panels and their routes
│   ├── avatar.ts        # Crop and resize profile photos in the browser before upload
│   ├── api.ts           # Typed API client (types from @orbit/contracts)
│   ├── auth/            # Auth clients (local, Supabase), session storage, validation
│   ├── workspaces.ts    # Active-workspace selection and per-user preference
│   ├── dashboard.ts     # Dashboard widget catalog and per-user layout preference
│   ├── tasks.ts         # Task filters, due-date display, validation mirroring the API
│   └── env.ts           # Validated public configuration
└── utils/               # Generic helpers shared across features; imports no other app layer
    ├── common/          # `cn()`, `mergeRefs()`, `byId()`, and the `Option` type
    ├── dates/           # Calendar dates and months (`YYYY-MM-DD`, `YYYY-MM`): today, arithmetic, labels
    ├── time-zones/      # IANA zones: browser zone, list and labels, wall-clock parts, preference schema
    ├── validation/      # Yup text-field builders mirroring the API's rules
    └── keyboard/        # Keyboard shortcut helpers
```

Design decisions:

- **Navigation is data.** `lib/navigation.ts` drives the sidebar, the mobile drawer, the
  dashboard module list, and the statically generated `[section]` routes. Unknown sections
  return 404 (`dynamicParams = false`). When a section gets a real implementation, add a
  dedicated route folder (for example `app/tasks/`). It takes precedence over `[section]`.
- **Mobile navigation uses the native `<dialog>` element.** It gives focus containment, Escape
  to close, and an inert background without a dialog library.
- **Theming** uses `next-themes` with a `class` strategy and CSS variables, compatible with
  shadcn/ui. New shadcn components can be added with `pnpm dlx shadcn@latest add <component>`
  from `apps/web` (see `components.json`).
- **Server Components by default.** Only components that need browser APIs or hooks are marked
  `"use client"` (theme toggle, nav links, mobile drawer, auth and workspace components).
- **Route groups split public and signed-in pages.** `(auth)` pages render without the app
  shell; `(app)` pages render inside `RequireAuth`, which shows a loading screen until the
  session is confirmed and redirects visitors to `/sign-in?next=…` (validated against open
  redirects by `lib/auth/redirect.ts`).

## API

```text
apps/api/src/orbit_api/
├── __main__.py          # `orbit-api` entry point (runs Uvicorn using settings)
├── main.py              # `create_app()` factory and ASGI `app`
├── config.py            # Pydantic Settings: the only place config is read
├── openapi.py           # Exports the OpenAPI contract to packages/contracts
├── api/
│   ├── dependencies.py  # FastAPI dependencies: database session, settings, services
│   ├── auth.py          # Authentication and authorization dependencies (the single gate)
│   ├── ai_actions.py    # AI proposals validated by module schemas, run by module services
│   └── v1/              # Versioned HTTP API, mounted at /api/v1
│       ├── health.py    # Liveness and database connectivity
│       ├── auth.py      # Sign-in configuration; local sign-up, sign-in, sign-out
│       ├── me.py        # The signed-in user's profile and profile photo
│       ├── storage.py   # Local database location; open its folder (local mode, not prod)
│       ├── workspaces.py # List, create, get, rename, and delete workspaces
│       ├── tasks.py     # Workspace-scoped tasks: CRUD, complete/reopen, filters, summary
│       ├── reminders.py # Workspace-scoped reminders: CRUD, enable/disable, upcoming
│       ├── finance.py   # Workspace-scoped finance: accounts, categories, transactions, reports, CSV
│       ├── commitments.py # Loans and EMIs, subscriptions and bills, payments, upcoming, summary
│       ├── notes.py     # Notes, folders, tags, links, tasks, journal, attachments
│       ├── calendar.py  # Categories, events and occurrences, range, agenda, links, preferences
│       ├── documents.py # Documents, uploads, versions, files, renewals, links, folders, export
│       ├── dashboard.py # The daily overview: today across modules, section by section
│       ├── search.py    # Grouped search; universal search (/search/results); recent and saved searches
│       ├── ai.py        # AI: settings, providers, usage (/me/ai); assistant, assist, search, insights, index
│       ├── integrations.py # Connections, OAuth, calendars, sync runs, conflicts, mail, files, webhooks
│       ├── backups.py   # Backups, settings, downloads, verification, exports, uploads, inspect, restore
│       └── notifications.py # The signed-in user's notifications: list, unread count, read state
├── auth/                # Adapters: Argon2 password hashing, Supabase JWT verification
├── providers/ai/        # Adapters: OpenAI (and compatible), Anthropic, Gemini, Ollama over HTTP
├── providers/integrations/ # Adapters: Google (Calendar, Gmail, Drive), Microsoft Graph over HTTP
├── system/              # Adapters: the OS file manager; the file store (attachments, documents); ZIPs
├── scheduler/           # Reminder worker (embedded in the API or `orbit-worker`) and its CLI
├── utils/               # Plain-Python helpers: UNSET, sort order, clock, LIKE patterns, file types
├── schemas/             # Pydantic request/response models (the API contract)
├── services/            # Domain logic, one package per feature (no FastAPI/SQLAlchemy):
│                        #   models.py (dataclasses, errors) and service.py (protocols, service)
├── repositories/        # SQLAlchemy implementations of the services' repository protocols
└── db/                  # Database infrastructure (SQLAlchemy + Alembic, no FastAPI)
    ├── base.py          # Declarative `Base` with a constraint naming convention
    ├── columns.py       # `UTCDateTime`: timezone-aware UTC timestamps on both databases
    ├── models/          # ORM tables: users, avatars, local credentials and sessions, workspaces, tasks
    ├── engine.py        # Engine per storage mode: SQLite PRAGMAs, Postgres pooling
    ├── database.py      # `open_database()`: connect, verify schema, sessions, dispose
    ├── migrate.py       # Programmatic Alembic: upgrade, downgrade, head revision
    └── migrations/      # Alembic environment and versioned revisions
        └── versions/    # 0001_baseline … 0021_create_backups
```

Design decisions:

- **Application factory.** `create_app(settings)` builds the app from explicit settings, so tests
  construct isolated apps without touching the process environment.
- **Centralized configuration.** `config.py` reads `ORBIT_*` environment variables (and an
  optional `apps/api/.env`). Values are type-validated at startup. Production rejects wildcard
  CORS origins, and the interactive docs are disabled there.
- **Versioned routes.** Endpoints live under `/api/v1`, so breaking changes can ship as `/api/v2`
  alongside.
- **Fail-fast startup.** The lifespan opens the database selected by `ORBIT_STORAGE_MODE`,
  checks connectivity and that the schema is at the latest migration, and logs the mode and
  target. If any check fails the API exits; it never falls back to another storage mode.
- **Safe database errors.** Connectivity failures during a request (SQLAlchemy
  `OperationalError`, `InterfaceError`, pool timeouts, or connection errors from the driver)
  are logged server-side and returned as `503 {"detail": "The database is unavailable."}`,
  without paths, hosts, or SQL.
- **Safe validation errors.** 422 responses list where and why validation failed, but never
  echo submitted values, so a rejected password is not reflected back or logged by proxies.
- **Authentication everywhere but health and sign-in.** See
  [Identity and authorization](#identity-and-authorization).

## Storage

Orbit stores application data in a relational database owned by the API. There are two
**storage modes**, chosen per deployment with `ORBIT_STORAGE_MODE`:

| Mode    | Database              | Driver      | Intended for                                           |
| ------- | --------------------- | ----------- | ------------------------------------------------------ |
| `local` | SQLite file (default) | `aiosqlite` | Single user, data stays on their machine               |
| `cloud` | PostgreSQL (Supabase) | `asyncpg`   | Hosted deployment, future authenticated multi-user use |

Both use SQLAlchemy 2.x (async) and the same Alembic migrations, so models and queries are
written once. SQLite is embedded in the API process; local mode needs no database server.

### Selecting a mode

- The mode is explicit configuration, validated at startup (`config.py`):
  - `local` uses `ORBIT_SQLITE_PATH` (default `apps/api/.data/orbit.sqlite3`, git-ignored and
    outside the web app). Setting `ORBIT_DATABASE_URL` in local mode is a configuration error,
    because it suggests cloud storage was intended.
  - `cloud` requires `ORBIT_DATABASE_URL`, a PostgreSQL URL. `postgres://` and
    `postgresql://` URLs are normalized to the `asyncpg` driver; other drivers are rejected.
    Production requires TLS in the URL (`?ssl=require`, `verify-ca`, or `verify-full`).
- The web app shows the active mode (from `GET /api/v1/health/database`) as a badge on the
  dashboard and the sign-in pages, and a status card in Settings, so users can see where their
  data goes. The UI can't change the mode. Switching is server configuration
  (`apps/api/.env`) plus a restart: the mode is an installation-wide decision rather than a
  per-user one, and the database URL is a secret that should never pass through the browser.
- In local mode outside production, **Settings → Storage** shows the SQLite file's path
  (`GET /api/v1/storage`, signed-in users only) and a button that opens its folder
  (`POST /api/v1/storage/reveal`). The API opens Finder, File Explorer, or the desktop file
  manager on its own machine, which in local mode is the user's computer. It runs a fixed
  command without a shell, on the configured path only (`system/file_manager.py`). Production
  and cloud mode never return the path and refuse to open anything; health endpoints never
  report paths.
- Startup logs the mode and a credential-free target, for example
  `Storage mode: local. Using the SQLite database at …`.
- **No fallback.** If the selected database cannot be opened, reached, or is not migrated, the
  API refuses to start. Silently using local storage when cloud storage was configured would
  let users believe their data was saved remotely when it was not.
- **One database at a time.** There are no dual writes and no synchronization between modes.

### Engines, pooling, and sessions

- **SQLite:** each connection enables `foreign_keys`, WAL journaling (`synchronous=NORMAL`),
  and a busy timeout. SQLAlchemy's default async queue pool is used.
- **PostgreSQL:** a bounded pool (`ORBIT_DATABASE_POOL_SIZE`, `ORBIT_DATABASE_MAX_OVERFLOW`),
  `pool_pre_ping` to discard dead connections, recycling after 30 minutes, and a 10-second
  connect timeout. Use Supabase's direct connection or **session** pooler. The transaction
  pooler (port 6543) does not support the prepared statements `asyncpg` uses.
- Both engines set `hide_parameters=True`, so bound values (user data) never appear in error
  messages or logs.
- **One session per request.** Routes receive an `AsyncSession` through `SessionDep`
  (`api/dependencies.py`). Services commit explicitly. Anything uncommitted is rolled back when
  the session closes at the end of the request. Sessions use `expire_on_commit=False`.

### Migrations

- Alembic owns the schema. Migrations live in `src/orbit_api/db/migrations/versions/`, ship
  with the package, and run on both SQLite (in batch mode, which rebuilds tables for `ALTER`)
  and PostgreSQL.
- `0001_baseline` creates no tables. It establishes version tracking.
- `0002_create_identity_and_workspace_tables` creates `users`, `local_credentials`,
  `local_sessions`, and `workspaces`, and enables RLS on them in PostgreSQL.
- `0003_create_user_avatars` creates `user_avatars` (profile photos) with RLS.
- `0004_create_tasks` creates `tasks` with RLS (see [Tasks](#tasks)).
- `0005_create_shopping` creates `shopping_lists` and `shopping_items` with RLS.
- `0006_create_dashboard_layouts` creates `dashboard_layouts` with RLS (see
  [Dashboard layout](#dashboard-layout)).
- `0007_create_reminders` creates `reminders`, `reminder_occurrences`, and `notifications` with
  RLS, and adds `users.timezone` (see [Reminders and notifications](#reminders-and-notifications)).
- `0008_create_finance` creates `finance_accounts`, `finance_categories`, and
  `finance_transactions` with RLS (see [Finance](#finance)).
- `0009_create_commitments` creates `finance_loans`, `finance_loan_installments`,
  `finance_recurring_payments`, and `finance_recurring_occurrences` with RLS, adds the `loan`
  account type, a unique `finance_transactions(id, workspace_id)` key, and the reminders' links to
  commitments (see [Financial commitments](#financial-commitments-phase-2)).
- `0010_create_investments` creates `finance_investment_accounts`, `finance_holdings`,
  `finance_holding_prices`, `finance_sip_plans`, `finance_deposits`,
  `finance_investment_transactions`, `finance_assets`, `finance_asset_valuations`, and
  `finance_net_worth_snapshots` with RLS, and adds the reminders' unique link to a deposit (see
  [Investments and net worth](#investments-and-net-worth-phase-3)).
- `0011_create_budgets_and_goals` creates `finance_budgets`, `finance_budget_periods`,
  `finance_budget_alerts`, `finance_savings_goals`, `finance_goal_contributions`, and
  `finance_monthly_plans` with RLS (see
  [Budgets, savings goals, and planning](#budgets-savings-goals-and-planning-phase-4)).
- `0012_create_notes` creates `note_folders`, `notes`, `note_tags`, `note_tag_assignments`,
  `note_links`, `note_task_links`, and `note_attachments` with RLS (see
  [Notes and knowledge management](#notes-and-knowledge-management)).
- `0013_create_calendar` creates `calendar_categories`, `calendar_events`,
  `calendar_event_exceptions`, `calendar_event_alerts`, `calendar_event_notes`,
  `calendar_event_tasks`, and `calendar_preferences` with RLS, adds `tasks.scheduled_start` and
  `scheduled_end`, and the reminders' unique link to an event alert (see
  [Calendar and events](#calendar-and-events)).
- `0014_create_habits` creates `habit_categories`, `habits`, `habit_schedule_versions`,
  `habit_pauses`, `habit_logs`, `habit_tasks`, `habit_notes`, `routines`, `routine_steps`,
  `routine_sessions` (with a partial unique index for one active session per routine),
  `routine_session_steps`, and `habit_reminders` with RLS, adds the reminders' unique link to a
  habit reminder time, and `calendar_preferences.show_habits` (see
  [Habits and routines](#habits-and-routines)).
- `0015_create_documents` creates `document_folders`, `document_categories`, `documents`,
  `document_versions`, `document_tags`, `document_renewals`, and `document_links` with RLS, adds
  a unique index on `finance_holdings(id, workspace_id)` (the target of holding links), and the
  reminders' unique link to a document (see
  [Documents and the personal vault](#documents-and-the-personal-vault)).
- `0016_create_fitness` creates the twenty `fitness_*` tables (profiles, exercises, templates
  and their exercises, sessions with a partial unique index for one unfinished workout per
  person, session exercises, sets, measurements, photos, foods, meals and their items, food and
  water entries, activities, goals and their progress, habit links, workout events, and links)
  with RLS; every top-level row carries an owning `user_id` (see
  [Health and fitness](#health-and-fitness)).
- `0017_add_dashboard_preferences` adds `density` (with a CHECK constraint) and `hide_amounts` to
  `dashboard_layouts`; existing layouts get the defaults (see
  [Customization model](#customization-model)).
- `0018_create_ai` creates `ai_providers`, `ai_settings`, `ai_index_sources`, `ai_chunks`,
  `ai_conversations`, `ai_messages`, `ai_action_proposals`, `ai_usage`, and
  `ai_insight_dismissals` with RLS (see [AI intelligence layer](#ai-intelligence-layer)).
- `0019_create_integrations` creates `integration_connections`, `integration_resources`,
  `integration_oauth_states`, `integration_links`, and `integration_sync_runs` with RLS (see
  [External integrations](#external-integrations)).
- `0020_create_search_history` creates `recent_searches` and `saved_searches` with RLS (see
  [Universal search](#universal-search)).
- `0021_create_backups` creates `backups` (with a partial unique index for one running backup per
  workspace), `backup_settings`, and `backup_uploads` with RLS (see
  [Backup, restore, and data portability](#backup-restore-and-data-portability)).
- Migrations are **applied explicitly** (`pnpm db:migrate`), never automatically at startup.
  Startup only checks that the database is at the head revision. For a shared cloud database,
  schema changes should be deliberate and reviewable.
- `tests/test_migrations.py` checks that the history is linear, that upgrade and downgrade
  work, and that ORM models match the migrations (`alembic check`).

### Backend layers

Identity (accounts and workspaces) introduced these layers; product features follow the same
structure.

| Layer         | Location                    | Responsibility                                                   | Depends on SQLAlchemy?         |
| ------------- | --------------------------- | ---------------------------------------------------------------- | ------------------------------ |
| Routes        | `api/v1/<feature>.py`       | HTTP: routing, status codes, auth dependencies, calling services | Only for the `SessionDep` type |
| Schemas       | `schemas/<feature>.py`      | Pydantic request/response models (the API contract)              | No                             |
| Services      | `services/<feature>/`       | Domain rules and authorization decisions, transaction boundaries | No (receives a repository)     |
| Repositories  | `repositories/<feature>.py` | Queries for one aggregate, always scoped to the owning user      | Yes                            |
| Models        | `db/models/<feature>.py`    | SQLAlchemy ORM tables, subclasses of `db.base.Base`              | Yes                            |
| DB foundation | `db/`                       | Engines, sessions, migrations, storage-mode selection            | Yes (no FastAPI)               |

- Services depend on a small `Protocol` per repository, not on SQLAlchemy, so domain logic is
  unit-testable without a database (`tests/test_account_service.py`). A concrete repository
  class takes an `AsyncSession`. Repositories exchange frozen dataclasses (for example
  `services.accounts.models.User`), never ORM objects. Each feature package keeps those domain
  types and its errors in `models.py`, and the repository protocols and service class in
  `service.py`.
- Services commit through a `Transaction` protocol (`services/transactions.py`), which an
  `AsyncSession` adapter implements. Uniqueness violations surface as `ConflictError`, so services
  can handle races (two first requests for the same Supabase user) without importing SQLAlchemy.
- Schemas and ORM models stay separate: API shape and storage shape evolve independently.
- Helpers shared across features live by dependency: plain Python (the `UNSET` partial-update
  sentinel, `SortOrder`, `utc_now`, LIKE patterns) in `utils/`, which imports nothing else from
  Orbit; SQLAlchemy helpers (`flush`, `SqlTransaction`) in `repositories/transaction.py`; and
  Pydantic field types (`Name`, `SearchText`, …) in `schemas/common.py`.
  The web app's counterpart is `src/utils`: a helper used by more than one feature gets its own
  module there (`@/utils/dates`, `@/utils/time-zones`, `@/utils/validation`, `@/utils/keyboard`,
  `@/utils/common`) rather than living in one feature's module and being borrowed by others.
- No generic repository base class or unit-of-work framework is planned. Add one only if
  several features demonstrably repeat the same code.

### Local security

- The SQLite file is created with mode `0600`, and its directory with `0700` when Orbit
  creates it. SQLite gives the `-wal` and `-shm` files the same permissions as the database
  file. Existing files and directories keep their permissions. On Windows these modes have
  little effect; rely on the user profile's ACLs.
- The data is **not encrypted at rest** by Orbit. Use full-disk encryption (FileVault,
  BitLocker, LUKS).
- The default location is inside the repository (`apps/api/.data/`) for development only.
  `.data/`, `*.sqlite*`, and `*.db*` files are git-ignored. For real use, point
  `ORBIT_SQLITE_PATH` at a user data directory. Never place it under `apps/web` (especially
  `public/`) or in a folder synced to a third party you don't trust.
- The API binds to `127.0.0.1` by default (`ORBIT_API_HOST`), so the local backend and its data
  are not reachable from other devices. Binding to `0.0.0.0` exposes the API, including local
  sign-in, to the network over plain HTTP. Sign-in is rate limited (below), but plain HTTP
  exposes passwords and session tokens to the network. Don't do it outside a trusted, isolated
  environment; use HTTPS ([deployment.md](deployment.md#https-on-your-own-domain)).
- Local sign-in is rate limited by `services/local_auth/throttle.py`, in the API process's
  memory: 10 failed sign-ins per account and 50 per client address in a sliding 15 minutes (a
  success clears the account's count), failed password changes counted the same way, and 10
  sign-ups per address an hour. Past a limit the API answers 429 with `Retry-After`, even for
  the right password, so the limit can't confirm a guess. Counts reset on restart and aren't
  shared between API processes; behind a proxy, `ORBIT_FORWARDED_ALLOW_IPS` makes the client
  address the visitor's rather than the proxy's.
- `POST /api/v1/auth/local/password` changes a local account's password after checking the
  current one, and deletes the account's other sessions in the same transaction. A wrong
  current password is 403 (not 401, which would sign the web app out).
- Backups: see [Backup, restore, and data portability](#backup-restore-and-data-portability)
  and [development.md](development.md#backups).

### Cloud security and Supabase

- The PostgreSQL URL is server-side configuration (`ORBIT_DATABASE_URL`, a `SecretStr`). It is
  never sent to the browser, never logged (startup logs only the host and database name), and
  validation errors never echo it.
- The browser never talks to the database. It uses the public Supabase client
  (`@supabase/supabase-js`, with the project URL and publishable key) for sign-in flows only.
  Application data always goes through the API.
- The API needs **no Supabase secret**: it verifies access tokens against the project's public
  signing keys. The service-role key is not used and must not be configured anywhere in Orbit.
- **Ownership** is described under [Identity and authorization](#identity-and-authorization).
- **Row Level Security (defense in depth):** the API connects as the table owner, which RLS does
  not restrict, so **application-level authorization is the primary control**. RLS guards other
  access paths, chiefly Supabase's auto-generated Data API, which exposes tables in the `public`
  schema to anyone holding the project's publishable (anon) key.
  1. Every migration that creates a table in PostgreSQL enables RLS on it in the same
     revision. `0002` does this for `users`, `local_credentials`, `local_sessions`, and
     `workspaces`; `0003` for `user_avatars`; `0004` for `tasks`; `0006` for `dashboard_layouts`;
     `0007` for `reminders`, `reminder_occurrences`, and `notifications`; `0008` for
     `finance_accounts`, `finance_categories`, and `finance_transactions`; `0009` for
     `finance_loans`, `finance_loan_installments`, `finance_recurring_payments`, and
     `finance_recurring_occurrences`; `0010` for the nine investment, asset, and snapshot tables;
     `0011` for the six budget, goal, and plan tables; `0012` for the seven note tables; `0013`
     for the seven calendar tables; `0014` for the twelve habit and routine tables; `0015` for
     the seven document tables; `0016` for the twenty fitness tables; `0018` for the nine AI
     tables; `0019` for the five integration tables; `0020` for the two search tables; `0021` for
     the three backup tables.
  2. **No policies exist**, deliberately: the browser never queries tables directly, so the
     Data API's `anon` and `authenticated` roles get no rows. Add `authenticated` policies
     (for example `owner_id = auth.uid()`) only if a client is ever allowed direct access.
  3. Tested by `tests/test_postgres.py` (opt-in): RLS is enabled on every table, and a
     role that does not own the tables sees no rows. This was verified against PostgreSQL 17,
     not against a live Supabase project; Supabase's own `anon` and `authenticated` roles are
     ordinary non-owner roles, so the same rule applies to them.
  4. Still worth considering: a dedicated, non-superuser role for the API, and a schema not
     exposed through the Data API.

### Not implemented in this phase

- **Synchronization or local↔cloud migration.** Moving data between modes needs stable
  record identity, conflict resolution, and deletion semantics (tombstones). Those depend on
  real schemas that don't exist yet. Until then, a deployment uses exactly one mode, and the
  API refuses to start rather than guess.
- **Shared workspaces**, invitations, and roles other than owner.
- **Linking local and cloud identities.** A local account and a Supabase account are unrelated,
  even with the same email.
- **Encryption at rest beyond the OS**, a desktop wrapper, and a bundled local database server.

## Identity and authorization

### Identity model

```text
users ──< workspaces ──< tasks    (owner_id → users.id, workspace_id → workspaces.id,
  │                 │                both ON DELETE CASCADE)
  │                 ├──< reminders   (see Reminders and notifications)
  │                 ├──< finance_accounts, finance_categories, finance_transactions (see Finance)
  │                 ├──< notes, note_folders, note_tags, … (see Notes and knowledge management)
  │                 └──< calendar_events, calendar_categories, … (see Calendar and events)
  ├──< notifications              (in-app inbox, per recipient)
  │
  ├── user_avatars                (profile photo bytes and type, 1:1)
  ├── dashboard_layouts           (dashboard widget order and widths, 1:1)
  ├── local_credentials           (local mode: email + Argon2id hash, 1:1)
  └──< local_sessions             (local mode: SHA-256 of the bearer token, expiry)
```

- **`users`** is the Orbit profile: UUID `id`, `email`, `display_name`, an optional IANA
  `timezone` (the default for new reminders), UTC `created_at` and
  `updated_at`, and the identity it belongs to, `(auth_provider, auth_subject)`, which is
  unique. `auth_provider` is `local` or `supabase` (a CHECK constraint); for Supabase,
  `auth_subject` is the Supabase user ID (the JWT `sub`), for local accounts it is the profile ID.
- **`workspaces`** belong to one owner. `is_personal` marks the default workspace created
  during onboarding; a partial unique index allows one personal workspace per user. Names are
  1 to 100 characters (validated by the API and a CHECK constraint). Deleting a workspace
  (`DELETE /api/v1/workspaces/{id}`) is permanent and cascades to its data; the personal
  workspace can't be deleted (409).
- **`user_avatars`** holds an optional profile photo, kept out of `users` so loading a profile
  never loads image bytes. The browser crops and resizes photos to 256 px before upload;
  `PUT /api/v1/me/avatar` takes the raw image, detects PNG, JPEG, or WebP from the file's
  signature (never SVG, never the declared type), and caps it at 512 KB. `GET` serves it with
  `nosniff` and a locked-down CSP, or 204 when none is set. Because the API needs a bearer token,
  the web app fetches the photo as a blob and shows it through an object URL.
- **Extensibility:** user data carries a non-null `workspace_id` foreign key, as `tasks` does;
  `finance_*` and `note*` tables do too. Shared workspaces would add a `workspace_members` table and change
  only the authorization check described below; the API already reports a `role` (`owner`).
- **`dashboard_layouts`** holds a user's optional dashboard arrangement (see
  [Dashboard layout](#dashboard-layout)). It belongs to the user, not a workspace, because it
  holds no workspace data.
- There is no general preferences table. The active workspace is a per-browser preference (see
  [Workspace selection](#workspace-selection)).

### Local and cloud identities

The storage mode decides the identity provider. There is no configuration that mixes them,
and no fallback from one to the other.

|                            | Local mode                                                               | Cloud mode                                                                                  |
| -------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Identity provider          | Orbit's own accounts in SQLite                                           | Supabase Auth                                                                               |
| Sign-up, sign-in, sign-out | `POST /api/v1/auth/local/*`                                              | `@supabase/supabase-js` in the browser                                                      |
| Password storage           | Argon2id (argon2-cffi), rehashed on sign-in when parameters change       | Supabase                                                                                    |
| Bearer token               | Opaque 256-bit random token; only its SHA-256 is stored                  | Supabase access token (JWT)                                                                 |
| Server-side validation     | Look up the token digest; reject if missing or expired                   | Verify signature (JWKS, ES256/RS256), `exp`, `iss`, `aud=authenticated`, `role`, UUID `sub` |
| Session lifetime           | `ORBIT_LOCAL_SESSION_TTL_HOURS` (default 14 days), fixed                 | Supabase settings; refreshed by the client                                                  |
| Sign-out                   | Deletes the session row (immediate revocation)                           | Ends the Supabase session in this browser                                                   |
| Registration               | Open outside production; first account only in production (configurable) | Supabase project settings                                                                   |
| Password reset             | Not available (no email in local mode)                                   | Supabase reset email → `/reset-password` (recovery session) → `updateUser`                  |
| Profile creation           | During sign-up, in the same transaction                                  | On the first authenticated request                                                          |

- `GET /api/v1/auth/config` tells the web app which provider applies, with only public values
  (`registration_open` locally; the Supabase URL and publishable key in cloud mode). The web app
  holds no Supabase configuration of its own, so it can't disagree with the API.
- **Local accounts** model a personal installation: the first person to open Orbit creates the
  owner account. More accounts can be allowed for a shared computer; each has its own isolated
  workspaces. Sign-in errors don't reveal whether an email exists (a dummy hash is verified for
  unknown emails). The local database stores no plaintext secret: no session secret or signing
  key is needed, and nothing secret is configured.
- **Supabase onboarding:** on the first request with a valid token, the API creates the profile
  and its Personal workspace. The initial display name comes from the `display_name` the user
  entered at sign-up (stored in Supabase user metadata), falling back to the email's local part.
  Concurrent first requests are handled: the loser of the unique-constraint race uses the
  winner's profile. The profile's email follows the token's `email` claim.
- **Supabase token revocation:** access tokens are verified locally, so a token stays valid until
  it expires (one hour by default) even after sign-out elsewhere. Supabase revokes the refresh
  token, so the session can't be extended.
- If Supabase's signing keys can't be fetched, protected requests fail with 503, never with
  access granted, and the browser keeps its session.

### Authorization

All rules live in `api/auth.py` and `services/workspaces/service.py`:

- **`CurrentUserDep`** reads only the `Authorization: Bearer` header. A missing, malformed,
  oversized, expired, or unknown token is `401 {"detail": "Sign in to continue."}` with
  `WWW-Authenticate: Bearer`. User IDs are never accepted from bodies or query strings; request
  models forbid unknown fields, so a submitted `user_id` or `owner_id` is a 422.
- **`WorkspaceDep`** authorizes the `{workspace_id}` path parameter through
  `WorkspaceService.authorize()`, which queries by both workspace ID and owner. A workspace that
  doesn't exist and one owned by someone else produce the same `404 Workspace not found.`, so
  responses never reveal other users' workspaces.
- **Pattern for features:** routes live under `/api/v1/workspaces/{workspace_id}/…`,
  declare `workspace: WorkspaceDep`, and pass `workspace.id` to repositories, which filter every
  query by it. Each feature adds cross-user isolation tests like `tests/test_workspaces.py` and
  `tests/test_tasks.py`. Tasks is the first feature built this way.
- Database constraints back the application checks: foreign keys with cascading deletes,
  unique identities, one personal workspace per user, and CHECK constraints on names, providers,
  and normalized emails.
- There is no role-based access control framework. Owner is the only role.

### Sessions in the browser

- Both modes send the token as a bearer header; the API sets no cookies, and CORS stays
  credential-free. Local tokens live in `localStorage` (`orbit:session`); Supabase keeps its
  session in `localStorage` (`orbit:supabase-auth`) and refreshes it. Scripts running on the page
  could read either, so XSS prevention protects sessions: no `dangerouslySetInnerHTML` with
  untrusted data, links limited to safe schemes and in-app paths, and a partial Content Security
  Policy (see [Observability](#observability)) that doesn't yet restrict scripts.
- `AuthProvider` restores the session on load and confirms it with `GET /api/v1/me` before
  rendering private pages. A 401 at any time discards the session and returns to sign-in;
  other failures (API down, database 503) show a retry screen and keep the session. Sign-in or
  sign-out in another tab is picked up.
- **Route protection happens in the browser** (`RequireAuth`), because tokens are not
  visible to the Next.js server. It is a UX guard: pages contain no private data, and every
  private byte comes from the API, which validates the token on each request.

### Workspace selection

- The active workspace is remembered per user in `localStorage`
  (`orbit:workspace:<user id>`). It is a selector, never a credential: every workspace request
  is authorized by the API. On load, a remembered workspace the user no longer has falls back to
  the personal workspace.
- Workspace-scoped data is cached by TanStack Query under keys that start with the workspace
  ID, so switching workspaces never shows the previous workspace's data, and the request for
  the previous workspace is cancelled. Deleting a workspace drops everything cached for it. A
  404 whose detail is "Workspace not found." re-validates the workspace list.

### Dashboard layout

The dashboard's arrangement and display preferences are saved per user; see
[Customization model](#customization-model). The dashboard itself is described under
[Daily dashboard and command center](#daily-dashboard-and-command-center).

## Tasks

The first product feature: to-dos inside a workspace.

### Data model

`tasks` (`db/models/tasks.py`, migration `0004`):

| Column                     | Notes                                                                             |
| -------------------------- | --------------------------------------------------------------------------------- |
| `id`                       | UUID primary key, generated by the service                                        |
| `workspace_id`             | Non-null FK to `workspaces.id`, `ON DELETE CASCADE`                               |
| `title`                    | 1 to 200 characters (CHECK); single line                                          |
| `description`              | Text, at most 5,000 characters (CHECK); empty when unset                          |
| `status`                   | `open` or `completed` (CHECK)                                                     |
| `priority`                 | Rank 0 to 3 (none, low, medium, high), so sorting by priority is a column order   |
| `due_date`                 | Optional calendar date (no time or time zone)                                     |
| `completed_at`             | Set exactly when `status` is `completed` (CHECK)                                  |
| `scheduled_start`, `_end`  | Optional UTC time block on the calendar, both or neither, end after start (CHECK) |
| `created_at`, `updated_at` | UTC timestamps; `updated_at` changes only when a field actually changes           |

Indexes: `(workspace_id, status, due_date)` and `(workspace_id, status, priority)`, matching the
list's usual shape (one workspace, often one status, sorted by due date or priority). Search is
a case-insensitive substring match (`ILIKE`, with `%`, `_`, and `\` matched literally), which
can't use an index; it scans one workspace's tasks, which is fine at personal scale. PostgreSQL
full-text or trigram search can replace it if that changes.

### API

All routes are under `/api/v1/workspaces/{workspace_id}/tasks` and authorize the workspace
through `WorkspaceDep` first. A task ID resolves only inside its own workspace: another user's
workspace is `404 Workspace not found.`, and a task from another workspace is
`404 Task not found.`, exactly like a missing one.

| Method   | Path                  | Purpose                                                                                                               |
| -------- | --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/`                   | List: `status`, `priority` (repeatable), `q`, `sort`, `order`, `limit` (≤ 500), `offset`; returns `tasks` and `total` |
| `POST`   | `/`                   | Create (`title`, optional `description`, `priority`, `due_date`)                                                      |
| `GET`    | `/summary`            | Counts of open, completed, overdue, and due-today tasks for `today`                                                   |
| `GET`    | `/{task_id}`          | Get one task                                                                                                          |
| `PATCH`  | `/{task_id}`          | Change some fields; `due_date: null` clears it                                                                        |
| `POST`   | `/{task_id}/complete` | Complete (idempotent: keeps the first completion time)                                                                |
| `POST`   | `/{task_id}/reopen`   | Reopen (idempotent)                                                                                                   |
| `DELETE` | `/{task_id}`          | Delete permanently                                                                                                    |

- `sort` is `due_date`, `priority`, or `created_at` (the default). Without `order`, each sort
  uses its natural direction: soonest due date, highest priority, or newest. Tasks without a due
  date always come last. Ties fall back to priority, due date, and creation time, so the order is
  stable.
- `GET` also filters by `scheduled` (`true` or `false`); `POST` and `PATCH` accept
  `scheduled_start` and `scheduled_end` together (aware datetimes, at most a week apart; both
  `null` unschedules). See [Calendar task integration](#calendar-task-integration).
- Status changes only through `complete` and `reopen`, which keep `completed_at` consistent.
  Request models forbid unknown fields, so `status`, `completed_at`, `workspace_id`, or `id` in a
  body is a 422.
- Due dates are calendar dates, so "overdue" depends on the user's time zone. The web app sends
  its local date as `summary?today=`; the API falls back to the UTC date.
- Titles and descriptions reject control characters (descriptions allow line breaks and tabs)
  but accept emoji sequences and non-breaking spaces.

### Web app

- `/tasks` (`components/tasks/`): a quick-add composer (title, due date, priority), a toolbar
  (debounced search, Open/Completed/All, priority filter, sort), the list, and an edit dialog on
  the native `<dialog>`. Keyboard: `N` focuses the composer, `/` focuses search, Escape clears
  the search or cancels a delete confirmation.
- `useTaskList` (in `src/hooks/use-tasks.ts`) queries the list for the active workspace.
  Within a workspace it keeps the previous results on screen while a new filter loads.
  `useTaskMutations` updates the cached lists in place and marks the dashboard summary stale.
- Completing or reopening is optimistic: the checkbox changes at once and reverts with an error
  if the API refuses. A completed task stays visible, struck through, until the list reloads.
  Creating or editing a task reloads the list in the background, so it lands in sorted position.
- The page loads at most 200 tasks and says when more match, rather than paginating.
- The dashboard's task card shows the summary counts and the next five open tasks by due date.

### Not implemented

Recurring tasks, subtasks, tags, sharing, and drag-and-drop ordering. Tasks can have a
scheduled time block on the [calendar](#calendar-task-integration), separate from the due date, and
[reminders](#reminders-and-notifications), which are a separate feature.

## Reminders and notifications

Reminders prompt the user at a chosen time, once or on a schedule, optionally about a task. When
one comes due, a worker delivers it as an **in-app notification** (the bell in the sidebar and
mobile top bar). In-app is the only channel today; see [Limitations](#reminder-limitations).

### Data model

```text
workspaces ──< reminders ──< reminder_occurrences          (ON DELETE CASCADE)
                  │                 │
tasks ──<─────────┘                 │   (task_id, workspace_id) → tasks(id, workspace_id),
                                    │   ON DELETE CASCADE; NULL for standalone reminders
users ──< notifications >───────────┘   (occurrence_id, reminder_id ON DELETE SET NULL;
                                         user_id, workspace_id ON DELETE CASCADE)
```

| Table                  | Holds                                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `reminders`            | Title, description, `enabled`, the schedule in local terms (`start_date`, `time_of_day`, IANA `timezone`, `recurrence`), the last outcome       |
| `reminder_occurrences` | One scheduled firing: `scheduled_for` (UTC), status, `attempts`, `available_at` (backoff), lease (`claim_token`, `claimed_until`), `last_error` |
| `notifications`        | One delivered occurrence for one recipient: a copy of the title and description, `scheduled_for`, `read_at`                                     |
| `users.timezone`       | Optional IANA time zone preference; new reminders start in it                                                                                   |

Why three tables: a reminder is what the user edits; an occurrence is the unit of work the
worker claims, retries, and records the outcome of; a notification is what the user reads. Keeping
occurrences separate makes delivery state (attempts, leases, failures) observable without
cluttering reminders, and lets notifications outlive edits and deletions of their reminder.

- **One pending occurrence per reminder.** Only the next occurrence is stored. Creating a
  reminder, changing its schedule, or enabling it replaces the pending occurrence in the same
  transaction; disabling it deletes it. Delivering an occurrence schedules the next.
- **Constraints:** `unique(reminder_id, scheduled_for)` (a reminder never fires twice for one
  instant); `unique(occurrence_id, user_id)` on notifications (one notification per occurrence
  and recipient); CHECKs tie the lease to `processing` and `finished_at` to final statuses. The
  composite foreign key to `tasks(id, workspace_id)` keeps a reminder in its task's workspace.
- **Indexes:** `(status, available_at)` for the worker's poll, `(reminder_id, status)` for the
  next occurrence, and `(user_id, created_at)` and `(user_id, read_at)` for the inbox and the
  unread count.
- **Status** (`scheduled`, `overdue`, `completed`, `disabled`) is derived in SQL, never stored:
  `disabled` when switched off; `completed` when the task is completed or nothing is left to
  fire; `overdue` when an occurrence is due but not delivered yet, or the last delivery failed;
  otherwise `scheduled`.
- Migration `0007_create_reminders` creates the three tables with RLS, adds `users.timezone`,
  and adds the unique `tasks(id, workspace_id)` key the composite foreign key needs.

### Time zones and recurrence

`services/reminders/recurrence.py` is pure and fully unit-tested (`tests/test_recurrence.py`).

- A schedule is a **local date and time in an IANA time zone**, converted to UTC one occurrence
  at a time. A reminder at 09:00 stays at 09:00 local time across daylight-saving changes.
  `scheduled_for` and all other timestamps are stored in UTC.
- **Time zone choice:** each reminder stores its own zone. New reminders default to the user's
  preference (Settings → Account), else the browser's zone (web app), else UTC (API). The server's
  own time zone is never used. Names are validated against the IANA database (`tzdata` ships it
  on platforms without one, such as Windows).
- **Skipped times** (02:30 when clocks jump from 02:00 to 03:00) fire at 03:30, the instant
  the wall clock would have shown 02:30. **Repeated times** (01:30 when clocks fall back) fire
  once, at the first 01:30.
- **Recurrence** is a versioned JSON document (`{"version": 1, "frequency": …, "weekdays": […]}`),
  validated on the way in (Pydantic) and on the way out (the repository). Frequencies: `daily`,
  `weekly` on chosen weekdays (Monday to Friday is the "every weekday" preset), and `monthly`.
  There are no user-supplied expressions (no cron strings or RRULEs).
- **Monthly on the 29th to 31st** fires on the last day of shorter months and returns to the
  original day in longer ones: Jan 31, Feb 28 (29 in leap years), Mar 31, Apr 30.
- A one-time reminder must be in the future when created or re-enabled (422 otherwise); a
  recurring one may start in the past and continues from now.

### Tasks and reminders

- A reminder's time is **independent of its task's due date**: rescheduling the task leaves its
  reminders where they are.
- While the task is **completed**, its reminders don't notify: occurrences that come due are
  recorded as `cancelled`, and recurring reminders keep their schedule, so **reopening** the task
  resumes them. Such reminders show as `completed` and are left out of "upcoming".
- **Deleting** the task deletes its reminders and their pending occurrences (database cascade).
  Delivered notifications stay in the inbox, without the link.
- **Finance-managed reminders.** A loan, subscription, or bill with reminders turned on owns one
  reminder (`reminders.finance_loan_id` or `finance_recurring_payment_id`, unique). It appears in
  the reminders list marked "Managed in Finance"; the reminders API refuses to edit or delete it
  (409). See [Reminder integration](#reminder-integration). A deposit's maturity reminder
  (`reminders.finance_deposit_id`) works the same way and fires once.
- **Calendar-managed reminders.** Each alert on a calendar event owns one reminder
  (`reminders.calendar_event_alert_id`, unique; a CHECK keeps it from also having a finance
  link), marked "Managed in Calendar" and refused by the reminders API (409). See
  [Reminder integration](#calendar-reminder-integration).

### Scheduling and delivery

```text
API request ──► reminders + next pending occurrence (one transaction)
                                    │
worker poll ──► claim due rows (atomic UPDATE … RETURNING, lease) ──► per occurrence, one transaction:
                  confirm claim → lock reminder → notification(s) → occurrence delivered
                  → reminder.last_outcome → next pending occurrence → COMMIT
```

The worker (`scheduler/worker.py`) holds no schedule in memory; each poll reads due work from the
database. It runs **inside each API process** by default (an asyncio task started and stopped by
the app's lifespan; `ORBIT_SCHEDULER_IN_API`) and/or as a **standalone process**
(`pnpm worker`, i.e. `uv run orbit-worker`). Any number of workers can share a database.

- **Claiming:** one conditional `UPDATE … WHERE id IN (SELECT … LIMIT n) AND <still claimable>
RETURNING` moves due `pending` rows (and `processing` rows whose lease expired) to
  `processing` with a fresh `claim_token` and `claimed_until`. On PostgreSQL the subquery uses
  `FOR UPDATE SKIP LOCKED` so concurrent workers take different rows; the re-checked condition
  makes a racing worker skip a row another just claimed. SQLite serializes writers.
- **Delivering:** each claimed occurrence gets its own transaction. Its first statement re-confirms
  the claim token, which also takes the row lock (PostgreSQL) or the write lock (SQLite) so no
  other worker can take over mid-delivery. The reminder row is then locked (`FOR UPDATE` on
  PostgreSQL), so an edit in flight finishes first. The notification, the occurrence's
  `delivered` status, and the next occurrence are committed together: an occurrence is
  `delivered` exactly when its notification exists. `processing` only means a worker holds the
  lease.
- **Retries:** a failed attempt rolls back, then returns the occurrence to `pending` with
  backoff (30 s, 1 min, 2 min, … up to 30 min). After 5 attempts it becomes `failed`; the
  reminder shows `overdue` with "the last delivery failed", and a recurring reminder's next
  occurrence is still scheduled. Only the exception's class name is stored (`last_error`), never
  reminder content.
- **Recovery:** `orbit-worker status` counts occurrences by status; `orbit-worker retry-failed`
  makes failed occurrences pending again. Editing or re-enabling a reminder also reschedules it.
- **Downtime:** after a stop, each reminder fires **once** for its oldest missed occurrence
  (late, with its original `scheduled_for`), and the next occurrence is the first one still in
  the future. Missed occurrences are not replayed one by one.
- **Shutdown:** the loop finishes the poll in progress before stopping (lifespan shutdown,
  SIGINT, or SIGTERM), so it never abandons a transaction. A killed worker's claims are
  recovered by any worker once their lease (2 minutes) expires.
- **Storage modes:** the same code runs on SQLite and PostgreSQL. Local mode typically runs the
  embedded worker in the single API process. Cloud mode can run the embedded worker in every
  API instance, a standalone worker, or both.

**Tested guarantees** (`tests/test_reminder_worker.py`, against real SQLite files with a
controllable clock): delivery exactly once per occurrence, including three concurrent workers on
separate connections; recovery of a crashed worker's claim after its lease; a worker whose lease
was taken over writes nothing; the database rejects a second notification for an occurrence;
pending work survives a restart; retry with backoff, final failure, and `retry-failed`; late
delivery after downtime; completed tasks, disabling, rescheduling, and deletion during delivery.

**Assumptions, not yet tested:** PostgreSQL concurrency relies on `SKIP LOCKED` and row locks
behaving as documented; the opt-in PostgreSQL suite checks RLS on the new tables but doesn't
run concurrent workers. Delivery is "at the next poll" (default every 15 s), not to the second.

### API

Reminders are workspace-scoped (`/api/v1/workspaces/{workspace_id}/reminders`, authorized by
`WorkspaceDep`); notifications belong to the signed-in user (`/api/v1/me/notifications`,
`CurrentUserDep`) and span their workspaces.

| Method   | Path                             | Purpose                                                                                      |
| -------- | -------------------------------- | -------------------------------------------------------------------------------------------- |
| `GET`    | `…/reminders`                    | List, soonest first: `status`, `task_id`, `limit` (≤ 200), `offset`; `reminders`, `total`    |
| `POST`   | `…/reminders`                    | Create (`title`, `start_date`, `time_of_day`, optional `timezone`, `recurrence`, `task_id`)  |
| `GET`    | `…/reminders/upcoming`           | Enabled reminders with an active occurrence and an open (or no) task, by time; `limit` ≤ 50  |
| `GET`    | `…/reminders/{id}`               | Get one                                                                                      |
| `PATCH`  | `…/reminders/{id}`               | Change fields, including `enabled`; schedule changes replace the pending occurrence          |
| `DELETE` | `…/reminders/{id}`               | Delete with its occurrences; notifications stay                                              |
| `GET`    | `/me/notifications`              | Inbox, newest first: `unread`, `limit` (≤ 100), `offset`; `notifications`, `total`, `unread` |
| `GET`    | `/me/notifications/unread-count` | `{"unread": n}`, cheap enough to poll                                                        |
| `PATCH`  | `/me/notifications/{id}`         | `{"read": true \| false}`; marking read again keeps the first read time                      |
| `POST`   | `/me/notifications/read-all`     | Mark all read; returns how many changed                                                      |

- A task in another workspace (or another user's) is a 422 "That task doesn't exist in this
  workspace.", the same as a missing one. Another user's reminder or notification is a 404.
- Request models forbid unknown fields, so a client can't set `status`, `workspace_id`, or
  occurrence data. Times must be whole minutes without an offset; dates are years 2000 to 2200.
- `PATCH /api/v1/me` accepts `timezone` (IANA name, or `null` to clear) alongside
  `display_name`.

### Web app

- `/reminders` (`components/reminders/`): status tabs (Upcoming, Overdue, Completed, Disabled,
  All), the list with an enable switch, schedule, recurrence, task, and time zone (shown when it
  differs from the viewer's), delete with confirmation, and a create/edit dialog (date, time,
  time zone, repeat presets, weekday toggles, task).
- The notification bell (`components/notifications/`) polls the unread count every 30 seconds
  (one indexed `COUNT`). Opening it loads the 20 newest notifications; each can be marked read or
  unread, or all at once. When the count rises, reminder lists are marked stale, since a delivery
  changed their status. Reminder lists also refetch every minute while shown.
- The dashboard's **Reminders** widget shows the next five from `…/upcoming` for the active
  workspace.
- Query keys: reminders under `["workspaces", id, "reminders", …]`; notifications under
  `["notifications", …]` (per user, cleared on sign-out like the rest of the cache).

### Reminder limitations

- **In-app only.** No browser push, email, SMS, or mobile notifications; a notification is seen
  when Orbit is open. The polling bell is the stand-in for a push channel.
- Delivery granularity is the poll interval. A reminder shows as `overdue` until delivered.
- Notifications go to the workspace's owner, its only member today. Shared workspaces would
  deliver to each member and need membership checks on notifications.
- No snooze, no end date or count for recurrences, no "every N days/weeks", and no history view
  beyond the inbox.

## Finance

Phase 1 of Orbit Finance: accounts tracked by hand, the transactions that move money in, out,
and between them, categories, monthly reports, and CSV export. Phase 2 adds commitments (loans,
subscriptions, and bills) on top of this ledger; see
[Financial commitments](#financial-commitments-phase-2). Phase 3 adds investments and net worth,
and phase 4 budgets, savings goals, and monthly plans, on the same ledger. Orbit never asks for bank
credentials and never connects to banks; there are no imports or synchronization.

### Money and currency

- **Integer minor units everywhere.** Every amount is a whole number of the currency's minor
  unit (paise for INR: ₹1,234.50 is `123450`), stored as `BIGINT`, summed by the database as
  integers, and sent as JSON integers. PostgreSQL's `SUM(bigint)` is `NUMERIC`, so repository
  sums are cast back to `BIGINT`. Request amounts must be JSON integers (`Strict` in Pydantic):
  `12.5`, `100.0`, and `"100"` are rejected rather than rounded.
- **Decimal text only at the edges.** `services/finance/money.py` turns minor units into decimal
  text with `divmod` (`to_decimal_string`); the web app (`lib/finance`) parses typed text such as
  `1,00,000.50` and formats amounts with string operations and `Intl.NumberFormat` on the exact
  decimal string. No floating-point arithmetic touches money. Percentages shown in the UI (share
  of spending, savings rate) are display-only ratios.
- **Explicit currency.** Each account has an ISO 4217 currency, fixed at creation. Supported:
  INR (default), USD, EUR, GBP, AED, SGD, AUD, CAD, CHF (2 decimals), and JPY (0). Each
  transaction stores its account's currency, and a composite foreign key guarantees they agree.
  Amounts in different currencies are never added together: reports take a `currency` and
  balance totals are per currency. There is no conversion; a transfer between currencies is
  rejected.
- **Range.** Amounts are at most 10^13 minor units (₹10,000 crore), far below the 64-bit limit.

### Data model

```text
workspaces ──< finance_accounts ──< finance_transactions >── finance_categories
     │                 ▲ (account_id, workspace_id, currency)        ▲ (category_id, workspace_id)
     │                 └ (to_account_id, workspace_id, currency)     │
     └──────────────────────────────────────────────────────────────┘  (all ON DELETE CASCADE
                                                                           from workspaces)
```

| Table                  | Holds                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `finance_accounts`     | Name, `type` (bank, savings, cash, wallet, credit_card, investment, other), `currency`, signed `opening_balance`, notes, `archived_at` |
| `finance_categories`   | Name, `type` (income or expense), and `key` for built-in categories (`NULL` for the user's own)                                        |
| `finance_transactions` | `type`, positive `amount`, `currency`, `occurred_on` (a date), description, `category_id`, `account_id`, `to_account_id`, notes        |

- **Transaction types.** `income` (money in), `expense` (money out), `refund` (money back for
  an earlier expense: it reduces spending in its expense category and is never income), and
  `transfer` (money moved from `account_id` to `to_account_id`, never income or spending).
- **Constraints** (CHECKs and keys, tested in `tests/test_migrations.py`): `amount` is 1 to 10^13;
  a transfer has a different destination and no category, and nothing else has a destination;
  composite foreign keys `(account_id, workspace_id, currency)` and
  `(to_account_id, workspace_id, currency)` to `finance_accounts(id, workspace_id, currency)`
  keep both accounts in the transaction's workspace and currency, and
  `(category_id, workspace_id)` keeps the category in the workspace. The category foreign key has
  no `ON DELETE` action, so a category in use can't be deleted. Category names are unique per
  workspace and type (case-insensitively in the service, exactly in the database), and a
  built-in key appears once per workspace.
- **Indexes:** `(workspace_id, occurred_on)` for history and reports, and
  `(workspace_id, account_id)`, `(workspace_id, to_account_id)`, `(workspace_id, category_id)`
  for filters and the in-use check.
- **Accounts are archived, not deleted.** An archived account keeps its history and balance,
  takes no new transactions (422), and still lets its existing transactions be corrected. Its
  type and currency can't change; its name, opening balance, and notes can.
- Migration `0008_create_finance` creates the three tables with RLS on PostgreSQL. Nothing is
  backfilled; default categories are seeded lazily (below).

### Balances

- **Derived, never stored.** `balance = opening_balance + Σ income + Σ refunds − Σ expenses −
Σ transfers out + Σ transfers in`, computed by one grouped `UNION ALL` query over the
  workspace's transactions whenever accounts are read. There is no cached balance column, so
  editing or deleting a past transaction corrects every balance and report at once; there is
  nothing to keep consistent.
- **Signed from the owner's view.** Positive is money held, negative is money owed. A credit
  card with ₹500 outstanding has balance `-50000`; the web app shows "₹500.00 owed" and asks for
  a card's opening balance as the amount owed.
- **Assets and liabilities.** Credit cards and loans are `liability` accounts; every other type
  is an `asset`. `GET …/accounts` returns per-currency `totals`: `assets` (sum of asset balances)
  and `liabilities` (what cards and loans owe, positive), including archived accounts, whose
  balances are still real. The UI labels these "in your accounts" and "owed on cards and loans"
  and states that they are **not net worth**, which is computed separately (see
  [Net worth](#net-worth)) with investments at market value and other assets.
- Balances include every recorded transaction, whatever its date.

### Financial rules

- **Credit cards.** A purchase on the card is an `expense` on the card account, counted as
  spending on its date. Paying the bill is a `transfer` from a bank account to the card: it
  settles the liability and is not spending, so nothing is counted twice.
- **Investments.** Moving money into an investment account is a `transfer`, not spending. The
  investment account's ledger balance is what was moved in, net of income, fees, and
  withdrawals; holdings and their market value are tracked by phase 3 (see
  [Investments and net worth](#investments-and-net-worth-phase-3)).
- **Refunds and corrections.** Refunds are their own transactions, so the original expense stays
  as it happened. Mistakes are corrected by editing (`PATCH`) or deleting the transaction;
  derived balances and reports follow. `updated_at` records the correction.
- **Dates.** `occurred_on` is a calendar date with no time, in the user's own time zone, like a
  task's due date. A month is all dates from its first to its last day inclusive, so month
  boundaries never depend on a server time zone. Report endpoints take `month=YYYY-MM`; without
  it they use the current month in UTC (the web app always sends the user's local month).
- **Validation** (in `FinanceService`, mirrored by database constraints): accounts and categories
  must exist in the workspace (otherwise 422 "…doesn't exist in this workspace.", the same for
  another user's), income takes an income category and expenses and refunds an expense
  category, transfers need two different active accounts in one currency, and the transaction's
  currency is always its account's (a client can't send one).
- **Multi-record operations.** Each request is one database transaction; seeding categories
  inserts all missing defaults and commits once (a concurrent seed's unique-constraint conflict
  rolls back and re-reads).

### Categories

`services/finance/categories.py` lists the defaults, chosen for personal finance in India:
income (Salary, Freelance, Business income, Interest, Dividends, Rental income, Gifts received,
Other income) and expenses (Rent, Groceries, Food and dining, Utilities, Mobile and internet,
Transport, Fuel, Shopping, Healthcare, Entertainment, Travel, Education, Insurance, Personal
care, Household, Taxes, Fees and charges, Loan interest, Gifts and donations, Other expenses).
There is deliberately no category for investments, card bills, or loan principal: those are
transfers. Loan interest is spending, and EMI payments record it in "Loan interest"; existing
workspaces get it the next time their categories are read.

- Categories are rows in each workspace, seeded the first time the workspace's categories are
  read (or before a custom one is created). Seeding adds only defaults whose `key` and name are
  missing, so it is idempotent, never duplicates, and a renamed default isn't re-added.
- Built-in categories can be renamed but not deleted (409). The user's own can be created,
  renamed, and deleted once no transaction uses them (409 otherwise).

### API

All routes are under `/api/v1/workspaces/{workspace_id}/finance` and authorize the workspace
through `WorkspaceDep` first. Another user's workspace is `404 Workspace not found.`; an
account, category, or transaction ID from another workspace is a 404 like a missing one, and
referencing one in a transaction is a 422.

| Method   | Path                     | Purpose                                                                                                                                                                                      |
| -------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/accounts`              | Accounts with derived balances (active first), and per-currency `totals`                                                                                                                     |
| `POST`   | `/accounts`              | Create (`name`, `type`, `currency` = INR, `opening_balance`, `notes`)                                                                                                                        |
| `GET`    | `/accounts/{id}`         | One account with its balance                                                                                                                                                                 |
| `PATCH`  | `/accounts/{id}`         | Change `name`, `opening_balance`, `notes`                                                                                                                                                    |
| `POST`   | `/accounts/{id}/archive` | Archive (idempotent); `/restore` undoes it                                                                                                                                                   |
| `GET`    | `/categories`            | Income then expense categories, seeding defaults                                                                                                                                             |
| `POST`   | `/categories`            | Create (`name`, `type`); 409 on a duplicate name                                                                                                                                             |
| `PATCH`  | `/categories/{id}`       | Rename                                                                                                                                                                                       |
| `DELETE` | `/categories/{id}`       | Delete one of your own, unused categories                                                                                                                                                    |
| `GET`    | `/transactions`          | History: `date_from`, `date_to`, `type` (repeatable), `account_id` (either side), `category_id`, `q`, `sort` (`date`, `amount`), `order`, `limit` (≤ 200), `offset`; `transactions`, `total` |
| `POST`   | `/transactions`          | Record income, an expense, a refund, or a transfer                                                                                                                                           |
| `GET`    | `/transactions/{id}`     | One transaction                                                                                                                                                                              |
| `PATCH`  | `/transactions/{id}`     | Correct any fields; the result is validated like a new one                                                                                                                                   |
| `DELETE` | `/transactions/{id}`     | Delete permanently                                                                                                                                                                           |
| `GET`    | `/transactions/export`   | CSV of the inclusive date range (or everything)                                                                                                                                              |
| `GET`    | `/transfers`             | Transfers only (`date_from`, `date_to`, `limit`, `offset`)                                                                                                                                   |
| `POST`   | `/transfers`             | Transfer with `from_account_id` and `to_account_id`                                                                                                                                          |
| `GET`    | `/summary`               | One month's `income`, `expenses`, `refunds`, `net_expenses`, `net` (cash flow), and count; `month`, `currency`                                                                               |
| `GET`    | `/trend`                 | The same per month for `months` (≤ 24, default 6) ending at `month`, zero-filled                                                                                                             |
| `GET`    | `/spending`              | Net spending per category for `month`, largest first, uncategorized as `null`                                                                                                                |

- Every report is a SQL aggregate (`SUM`/`COUNT` with `CASE`, grouped by category or by
  `EXTRACT(year/month)`), so the web app never downloads transactions to add them up.
- Search is a case-insensitive substring match on descriptions and notes, with `%`, `_`, and `\`
  matched literally (the helper shared with tasks in `utils/text_search.py`).
- Request models forbid unknown fields: a client can't set `currency`, `balance`, `workspace_id`,
  or `id`. Validation errors never echo submitted values. Routes log nothing about transactions.

### CSV export

`GET …/transactions/export` returns `text/csv; charset=utf-8` as an attachment
(`orbit-transactions[-from-to].csv`) with `Cache-Control: no-store`. One row per transaction,
oldest first: Date, Type, Description, Category, Account, To account, Amount (positive decimal
text in the major unit, such as `20000.50`), Currency, Notes, ID. Text starting with `=`, `+`,
`-`, `@`, tab, or carriage return is prefixed with `'` so spreadsheets don't run it as a formula
(CSV injection). There is no byte-order mark; Excel users may need to import the file as UTF-8.

### Web app

- `/finance` (`components/finance/`) has thirteen views. Overview sits on its own; the rest are
  grouped as **Money** (Transactions, Accounts), **Planning** (Budgets, Plan, Goals),
  **Commitments** (Upcoming, Loans, Subscriptions, Bills), and **Wealth** (Investments, Assets,
  Net worth). The list and groups are data in `lib/finance-views`. Wide pages show them as a
  sticky side rail (`finance-nav.tsx`); narrower ones show a picker listing every view plus the
  current group's views as chips. The view is in the URL (`/finance?view=budgets`, kept with the
  History API), so reloads, Back, and links from dashboard widgets land on it.
- The page header's **Record** menu records an expense, income, a transfer, or a refund from any
  view; it's the primary action on Overview and Transactions and a quieter one elsewhere, where
  each view's own "Add …" is primary. Overview, Budgets, and Plan share one month, and every view
  shares one currency, held by `finance-view.tsx`. A workspace without accounts is asked to add
  one first.
- Views share building blocks: `ViewHeader` (heading, controls, one primary action),
  `StatGrid`/`StatTile`, `Panel`/`LoadError`/`EndedSection`, chips in `finance-meta.tsx`, and
  `RowActions`, which shows a row's one inline action and puts the rest in a "More actions" menu,
  asking in place before anything hard to undo. Layout follows container queries
  (`@container/finance`, `/list`, `/rows`), not screen breakpoints.
- When accounts use several currencies the overview offers a currency picker; otherwise it uses
  the only one.
- Lists are rows, not tables, so nothing scrolls sideways on phones. Chart colors are the
  `--chart-1`/`--chart-2` tokens in `styles/tokens.css`, a pair checked for color-vision deficiency and
  contrast in both themes; every chart has a legend or labels, and each month is focusable with
  its figures in its accessible name.
- `hooks/use-finance.ts` binds the queries; keys are `["workspaces", id, "finance", …]`. Every
  change invalidates the workspace's finance queries, because balances and reports are derived
  on the server.

## Financial commitments (phase 2)

Loans and their EMI schedules, subscriptions, recurring bills, a unified view of upcoming
payments, and reminders before each one. Code: `services/commitments/` (`schedule.py` is the
pure arithmetic, `service.py` the rules), `repositories/commitments.py`,
`schemas/commitments.py`, and `api/v1/commitments.py`. Commitments sit **on top of** the phase 1
ledger: every rupee actually paid is an ordinary `finance_transactions` row, and no second
transaction model exists.

### Commitment data model

```text
finance_accounts (type 'loan') ──1:1── finance_loans ──< finance_loan_installments ──┐
                                            │                                        ├─> finance_transactions
finance_recurring_payments ──< finance_recurring_occurrences ───────────────────────┘   (no ON DELETE)
        │ (kind: subscription | bill)
reminders.finance_loan_id / reminders.finance_recurring_payment_id  (unique, ON DELETE CASCADE)
```

| Table                           | Holds                                                                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `finance_loans`                 | Name, lender, type, currency, original `principal`, `interest_rate_bps`, `interest_method`, tenure, EMI and frequency, dates, status, reminder settings, `account_id`, `payment_account_id` |
| `finance_loan_installments`     | One EMI: `sequence`, `due_date`, `principal`, `interest`, `balance_after`, `state` (scheduled, paid, skipped), `paid_on`, and the principal and interest transaction IDs                    |
| `finance_recurring_payments`    | A subscription or bill: amount (an estimate when `amount_varies`), currency, frequency, `anchor_date`, optional end and trial dates, `state`, category, usual account, reminder             |
| `finance_recurring_occurrences` | One **settled** occurrence: `due_date`, `state` (paid or skipped), amount paid, `paid_on`, and the expense's transaction ID (none when marked paid by hand)                                 |

- **Every relationship stays in one workspace**: composite foreign keys tie installments,
  occurrences, accounts, categories, transactions, and reminders to the commitment's
  `workspace_id` (and accounts to its currency), like phase 1.
- **Loans are backed by a `loan` account**, a liability type created only with a loan (`POST
…/accounts` rejects `loan`). Its opening balance is minus the outstanding principal when the
  loan is added. Loan accounts appear in Accounts and in the liabilities totals.
- **Money and rates are integers**: minor units as everywhere in finance, and interest rates in
  basis points (8.5% is `850`). Rates are parsed and formatted as text in the web app.
- **Subscriptions and bills share one table** (`kind`), because they share recurrence, payment
  recording, and reminders; the API and UI present them separately.
- **History is never deleted through the API.** Loans are closed or archived; subscriptions and
  bills are paused or cancelled. Settled history stays. The one exception is a loan entered by
  mistake: `DELETE /loans/{id}` removes it with its account, schedule, and reminder, and is a
  409 while any transaction uses its account or any installment is paid.

### EMI calculation assumptions

All arithmetic is in `services/commitments/schedule.py`, pure and unit-tested
(`tests/test_commitment_schedule.py`). Interest uses `Decimal` (60 significant digits) and is
rounded **half up to the minor unit once per installment**; no floats.

- **Reducing balance** (default): interest = outstanding principal × annual rate ÷ installments
  per year. Standard EMI = `P·r·(1+r)^n / ((1+r)^n − 1)`, or `P / n` at 0%.
- **Flat rate**: total interest = `P × rate × tenure in years`, spread evenly; the rounding
  remainder goes to the last installment.
- **The last installment settles exactly**: whatever principal is left, so the principal
  components always sum to the outstanding principal.
- The lender's EMI can be entered instead of the standard one; an EMI that doesn't cover a
  reducing installment's interest is rejected (422).
- **Loans already being repaid**: give the outstanding principal and the next EMI date; Orbit
  tracks only the installments still ahead (numbered within the full tenure). Earlier history
  isn't reconstructed.
- **Manual adjustments**: a scheduled installment's date, principal, and interest can be edited
  (`adjusted`), skipped (a payment holiday), or the remaining schedule regenerated from what the
  ledger says is owed (`/reschedule`): keeping the number of EMIs (new EMI), or a new EMI
  (new tenure). Prepayments are recorded as a transfer into the loan account, then rescheduled.
- **Projected balances**: a scheduled installment's `balance_after` is recomputed on read from
  today's outstanding principal; a paid one keeps what the ledger said when it was paid.

### Recurrence rules

- Frequencies: weekly, monthly, quarterly, every 6 months, yearly. Due dates repeat from
  `anchor_date` (the "next due date" given when it was added); monthly-based ones keep the
  anchor's day and use the month's last day when shorter (31 Jan → 28 Feb → 31 Mar).
- **Unsettled occurrences are computed, never stored.** Only paid and skipped occurrences are
  rows, with `unique(recurring_payment_id, due_date)`. Generating occurrences is therefore
  idempotent: computing the same window twice yields the same dates, and nothing can be created
  twice. A loan's schedule is generated once, at creation or reschedule.
- **Changing the schedule** (frequency or next due date) moves the anchor; **resuming** after a
  pause or cancellation anchors on the cadence's first date from today, so a backlog isn't
  created. Settled history keeps its dates and amounts either way.
- Status: `active`, `paused`, `cancelled` (stored), and `expired` (derived: active, past its end
  date). Payment status (derived per day): `paid`, `skipped`, `overdue` (before today), `due`
  (today), `upcoming`. "Today" is the date the web app sends, else today in the user's time-zone
  preference, else UTC.

### Payments and accounting

| Payment          | Records                                                                                                                | Counts as spending |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Loan EMI         | `transfer` of the principal from the paying account into the loan account; `expense` of the interest ("Loan interest") | Interest only      |
| Subscription     | `expense` in its category                                                                                              | Yes                |
| Bill             | `expense` in its category, at the actual amount                                                                        | Yes                |
| Marked paid only | Nothing in the ledger (subscriptions and bills)                                                                        | No                 |

- **No double counting.** The EMI itself is never an expense; principal is a transfer (reduces
  the liability, never spending), interest is an expense. The outstanding principal is the loan
  account's derived balance, so it can't drift from the ledger.
- **Expected is not actual.** Scheduled installments, renewals, and bills are never in reports
  until a payment is recorded and its transaction exists.
- **Create or link.** Recording a payment either creates the transactions in the same database
  transaction, or links transactions already recorded (a principal link must be a transfer into
  the loan account; interest and subscription/bill links must be expenses in the same currency).
- **No duplicates.** An installment moves out of `scheduled` with a conditional update (two
  concurrent payments: one wins, the other is 409); an occurrence is unique per due date; each
  transaction pays at most one thing (unique foreign keys, checked first for a clear message).
- **History is protected.** The foreign keys to `finance_transactions` have no `ON DELETE`
  action, so the ledger refuses to delete a transaction that records a payment (409 "Undo that
  payment first"). Undoing a payment unlinks its transactions, and deletes them only when asked.
  Editing a linked transaction later doesn't change the installment's or occurrence's recorded
  amounts (the loan's outstanding principal, being derived, always follows the ledger).
- **Atomic.** Phase 1's `FinanceService.create`, `create_account`, and `delete` take
  `commit=False`, so a payment's transactions, the installment or occurrence, and the reminder
  change commit together.

### Reminder integration

- Reminder settings per commitment: `days_before` (0 to 30), `time_of_day`, and an IANA time
  zone (default: the user's preference, else UTC; the web app sends the browser's).
- **One reminder per commitment**, in the existing `reminders` table, delivered by the existing
  worker as an in-app notification. It is a one-time reminder for the next unsettled payment
  whose reminder time is still ahead ("Rent due 16 Feb 2030", "INR 25000.00").
- **Kept in sync in the same transaction** as every change: creating, editing, paying,
  skipping, undoing, rescheduling, pausing, cancelling, or closing re-points it (or deletes it
  when there is nothing to announce or reminders are turned off). The sync is idempotent and
  the unique link prevents a second reminder.
- **After it fires**, `ReminderDelivery` calls a follow-up hook
  (`ReminderFollowUp.after_delivery`, implemented by `CommitmentService`) inside the delivery
  transaction, which moves it to the next payment. No separate scheduler exists.

### Commitments API

Under `/api/v1/workspaces/{workspace_id}/finance`, authorized through `WorkspaceDep`. Another
workspace's loan, subscription, or installment is a 404; referencing its account, category, or
transaction is a 422.

| Method   | Path                                         | Purpose                                                                                         |
| -------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `GET`    | `/loans`                                     | Loans with derived outstanding principal                                                        |
| `POST`   | `/loans`                                     | Add a loan: its account and remaining schedule                                                  |
| `GET`    | `/loans/{id}`                                | The loan and its installments (`today`)                                                         |
| `PATCH`  | `/loans/{id}`                                | Details, payment account, `status` (active, closed, archived), `reminder`                       |
| `DELETE` | `/loans/{id}`                                | Delete a loan entered by mistake; 409 with recorded payments                                    |
| `POST`   | `/loans/{id}/reschedule`                     | Regenerate unpaid installments (`interest_rate_bps`, `emi_amount`, date)                        |
| `PATCH`  | `/loans/{id}/installments/{iid}`             | Adjust a scheduled installment                                                                  |
| `POST`   | `/loans/{id}/installments/{iid}/pay`         | Pay (`from_account_id`, or link `principal_/interest_transaction_id`)                           |
| `POST`   | `/loans/{id}/installments/{iid}/skip`        | Skip                                                                                            |
| `POST`   | `/loans/{id}/installments/{iid}/undo`        | Undo (`delete_transactions`)                                                                    |
| `GET`    | `/recurring-payments`                        | Subscriptions and bills (`kind`, `today`) with costs and next due date                          |
| `POST`   | `/recurring-payments`                        | Add one                                                                                         |
| `GET`    | `/recurring-payments/{id}`                   | One                                                                                             |
| `PATCH`  | `/recurring-payments/{id}`                   | Change, pause, cancel, or resume (`state`)                                                      |
| `GET`    | `/recurring-payments/{id}/occurrences`       | Payment and renewal history                                                                     |
| `POST`   | `/recurring-payments/{id}/occurrences`       | Record a payment (`mode`: create, link, manual)                                                 |
| `POST`   | `/recurring-payments/{id}/occurrences/skip`  | Skip a due date                                                                                 |
| `DELETE` | `/recurring-payments/{id}/occurrences/{oid}` | Undo (`delete_transaction`)                                                                     |
| `GET`    | `/payments`                                  | Unified list: `today`, `date_from`, `date_to` (≤ 400 days), `kind`, `status`, `include_overdue` |
| `GET`    | `/commitments/summary`                       | Dashboard totals in one `currency`                                                              |

### Commitments in the web app

- `/finance` gains **Upcoming** (overdue, due today, upcoming, recently paid; filters by dates,
  type, and status; record a payment from any row), **Loans** (outstanding, progress, EMI, next
  EMI, the schedule with pay, adjust, skip, and undo; reschedule, close, archive),
  **Subscriptions** and **Bills** (monthly and yearly cost per currency, next due date and
  overdue count, record, skip, pause, resume, cancel with confirmation, history with undo).
- The **Overview** shows a compact Commitments card (loans outstanding and monthly EMIs,
  subscriptions per month, left to pay this month, overdue) only when commitments exist.
- One payment dialog (`payment-dialog.tsx`) records, links, or marks paid; forms use React Hook
  Form with Yup schemas in `lib/commitments`. Queries live under
  `["workspaces", id, "finance", "commitments", …]`, so any finance change refetches them;
  commitment changes also refetch reminders.

## Investments and net worth (phase 3)

Investment accounts, mutual funds, stocks and ETFs, SIPs, fixed and recurring deposits, other
assets, a portfolio summary, net worth, and monthly net worth snapshots. Code:
`services/investments/` (`quantities.py`, `lots.py`, `deposits.py`, and `portfolio.py` are pure
arithmetic; `service.py` and `assets.py` the rules; `valuation.py` the price-feed seam),
`services/networth/` (`calculation.py` pure, `service.py` snapshots),
`repositories/investments.py`, `schemas/investments.py`, `schemas/networth.py`, and
`api/v1/investments.py` and `api/v1/networth.py`. Like phase 2, this sits **on top of** the phase 1
ledger: every rupee that moves is an ordinary `finance_transactions` row, and no second account,
transaction, loan, or reminder model exists.

### Investment data model

```text
finance_accounts (type 'investment') ──1:1── finance_investment_accounts
                                                 ├──< finance_holdings ──< finance_holding_prices
                                                 │          └──< finance_sip_plans
                                                 ├──< finance_deposits ──── reminders.finance_deposit_id
                                                 └──< finance_investment_transactions ──> finance_transactions
                                                                                          (cash, fees; no ON DELETE)
finance_assets ──< finance_asset_valuations
finance_net_worth_snapshots   (unique workspace, currency, month)
```

| Table                             | Holds                                                                                                                                                                 |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `finance_investment_accounts`     | The profile of an `investment` finance account: `kind` (mutual_fund, brokerage, deposit, other), `provider`, optional `linked_account_id`                             |
| `finance_holdings`                | A mutual fund, stock, or ETF: name, symbol or scheme code, exchange, ISIN, AMC, category, folio, and a normalized `identity`, unique per account                      |
| `finance_holding_prices`          | One price per holding and date (scaled), with `source` (`manual`, or `provider` from market data; `import` reserved)                                                  |
| `finance_sip_plans`               | A scheduled SIP: amount, frequency, anchor date, optional end and funding account, `auto_debit` (needs the funding account), state                                    |
| `finance_deposits`                | A fixed or recurring deposit: rate (bps), compounding, start and maturity, RD installment, the bank's stated maturity amount, status, manual value, maturity reminder |
| `finance_investment_transactions` | buy, sell, dividend, interest, fee, deposit, withdrawal: date, amount, units, charges, settlement, SIP due date, and the ledger rows it recorded                      |
| `finance_assets`                  | Gold, property, vehicles, cash, other: purchase date and cost, optional linked account, `include_in_net_worth`, archived                                              |
| `finance_asset_valuations`        | One value per asset and date, with `source`                                                                                                                           |
| `finance_net_worth_snapshots`     | One month's assets, liabilities, net worth, group totals, `source`, and counts of estimated, manual, stale, and missing values                                        |

- **No parallel accounts.** An investment account _is_ a finance account; the profile adds only
  what Phase 1 lacks. Name, currency, notes, and archiving stay on the finance account. An
  existing `investment` account can be **adopted** (`POST …/investment-accounts` with
  `account_id`), so its history carries over instead of a duplicate being created.
- **Quantities, cost, and principal are derived**, never stored: units and FIFO cost from a
  holding's buys and sells, a deposit's principal from its deposits and withdrawals.
- **Keys keep everything in one workspace and currency**: composite foreign keys from holdings,
  deposits, and transactions to `finance_investment_accounts(account_id, workspace_id,
currency)`, and from transactions to their holding's `(id, workspace_id, currency)`.
- **CHECK constraints mirror the service rules** (tested in `tests/test_migrations.py`): each
  type's shape (only trades have units; dividends name a holding; deposit flows name a deposit),
  `settlement` rules, income and fees always having a ledger row, a SIP due date only on a SIP
  buy, and NULL-safe ranges.
- **History is protected.** A holding with transactions can't be deleted; the ledger refuses to
  delete a transaction an investment transaction records (409, like phase 2 payments); one ledger
  row backs at most one investment transaction (unique keys).

### Investment accounting rules

| Event                       | Ledger rows Orbit records                                                             | Counts as                                        |
| --------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Buy from another account    | `transfer` from that account into the investment account                              | Neither income nor spending                      |
| Buy from the account's cash | None: cash becomes a holding inside the investment account                            | Neither                                          |
| Buy bought before Orbit     | None (`settlement = none`): units arrive as already owned                             | Neither                                          |
| Sell into another account   | `transfer` from the investment account to that account                                | Neither; the FIFO gain is investment performance |
| Dividend, interest          | `income` in "Dividends" or "Interest", into the investment account or another account | Income                                           |
| Fee, or charges on a trade  | `expense` in "Fees and charges"                                                       | Spending                                         |
| Deposit, withdrawal (FD/RD) | As buy and sell                                                                       | Neither                                          |
| Deposit closure             | Withdrawal of the principal held; anything above it as `interest` income              | Interest is income                               |

- **No double counting.** A purchase is never an expense; the transfer that funds it moves money
  between two asset accounts, and the purchase then turns the investment account's cash into a
  holding. Realized gains are not income in cash-flow reports; they appear in the portfolio.
- **Investment cash** = the investment account's ledger balance − purchases and deposits + sale
  proceeds and withdrawals, counting only those settled through Orbit. Its ledger balance alone
  (shown in Accounts) still includes what was spent on holdings.
- **Atomic.** Each request commits once: the investment transaction, its transfer, its fee
  expense, a deposit's opening deposit, and its reminder change succeed or fail together.
- **Deleting** an investment transaction keeps its ledger rows as ordinary transactions unless
  `delete_ledger=true`. A buy that later sales depend on can't be deleted (409).
- **SIPs**: a SIP plan is an expectation. Its next due date is the first scheduled date without a
  recorded installment (possibly overdue); recording one creates a buy with `plan = sip` and the
  `sip_due_date` it settles, unique per plan, so an installment can't be recorded twice. Pausing
  stops the schedule; resuming restarts from the next date on or after today.
- **Units from the NAV.** A mutual fund buy (or SIP installment, or a new holding's `opening`
  position) may leave `quantity` out: the units are the amount ÷ the first price dated on or
  within 7 days after the buy (funds allot at the NAV of the day the money arrives, or the next
  business day), fetched from the feed when none is stored, else the latest one in the 7 days
  before. They are rounded half up to 3 decimals, as registrars allot; stamp duty isn't
  deducted. Without a price, the request is a 422 asking for the units. Stocks and ETFs always
  need units.
- **Auto-debit SIPs** (mutual funds with a funding account only) are recorded by the worker
  (every 15 minutes, on the owner's local date): each unrecorded due date in the last 7 days
  whose NAV (on or after it) is known becomes a buy transferred from the funding account, with
  units from that NAV, plus an in-app notification, each in its own commit. A date whose NAV
  isn't published yet is retried on the next run; older missed dates are left overdue for the
  person, so turning auto-debit on never back-fills a SIP's history.

### Cost basis, precision, and rounding

- **FIFO for every holding** (`lots.py`): a sale takes units from the oldest open lot first. The
  cost of a partial lot is its remaining cost × units sold ÷ units remaining, **rounded half up**
  to the minor unit; selling a lot's last units takes its remaining cost exactly, so rounding
  never creates or loses cost. Realized gain = gross proceeds − cost of the units taken. Fees are
  expenses, never part of cost or proceeds. Trades are ordered by date, then as recorded. A sale
  of more units than were held on its date is rejected (422).
- **Units and prices are fixed-point**: integers in millionths (6 decimals) of a unit, and of
  the currency's major unit per unit. The API sends them as decimal strings (`"218.92"`,
  `"45.6789"`); more decimals, signs, or exponents are rejected, never rounded. Money stays in
  integer minor units.
- **Market value** = units × price, converted to minor units and rounded half up once. Average
  cost = FIFO cost ÷ units, rounded half up to 6 decimals.
- **Return** = unrealized + realized + dividends and interest − fees; the percentage is over
  everything ever invested (buys and deposits), simple and not annualized, for display only.
- Deterministic: the same history and date always produce the same values; everything is
  covered by pure unit tests (`tests/test_investment_math.py`).

### Deposits

- Opening a deposit records its first `deposit` (an FD's principal, an RD's first installment) on
  the start date; later RD installments and top-ups are recorded one by one.
- **Estimated value** (`deposits.py`, `Decimal` at 60 digits, rounded half up once per
  contribution): interest compounds every whole period counted in calendar months from each
  contribution; the broken period after the last whole one earns simple interest
  (`rate × days ÷ 365`) on the compounded amount; `simple` deposits earn simple interest only;
  nothing accrues after maturity. An RD's projection assumes every monthly installment is paid.
- These are **estimates, labelled as such** (`value_source = estimate`, `freshness = estimated`).
  The bank's stated maturity amount is stored and shown beside the projection, not instead of
  it. A value entered by hand replaces the estimate from its date (marked stale after a year).
- **Closing** at or after maturity sets `matured`, earlier `closed`. The amount received above the
  principal held is interest income; less than the principal (a penalty) withdraws what was
  received and the rest is lost. `…/reopen` undoes a closure (optionally deleting its ledger rows).
- **Maturity reminders** use the existing reminder engine: one reminder per deposit
  (`reminders.finance_deposit_id`, unique), `days_before` the maturity date, kept in sync on
  every change and deleted when the deposit closes. It fires once. The phase 2 reminder-sync
  step was extracted to `services/reminders/managed.py` and is shared by both.

### Other assets

- Valued by hand with a dated history; the latest valuation on or before a date applies. Without
  one, the purchase cost is used and marked `missing`. Valuations older than a year are `stale`.
- **Duplicates are prevented**: names are unique per workspace (case-insensitively), and an asset
  linked to an **asset account** (bank, cash, investment) is treated as already counted in that
  balance and left out of net worth, with the reason shown. An asset linked to a liability (the
  loan that financed a vehicle) is counted. `include_in_net_worth: false` leaves any asset out;
  archived (sold) assets are history only.

### Net worth

**Net worth = total assets − total liabilities**, per currency (never converted), on any date
(`services/networth/calculation.py`, pure):

| Source                                 | Counted as                                                    | Value source                    |
| -------------------------------------- | ------------------------------------------------------------- | ------------------------------- |
| Bank, savings, cash, wallet, other     | Asset: ledger balance on the date                             | `ledger`                        |
| Investment account with a profile      | Asset: its **cash** only, plus each holding and deposit below | `ledger`                        |
| Holding                                | Asset: units × latest price on or before the date             | `market`, else `cost` (missing) |
| Deposit                                | Asset: estimated or manual value; 0 once closed               | `estimate` or `manual`          |
| `investment` account without a profile | Asset: ledger balance, labelled "at cost"                     | `cost` (missing)                |
| Other asset (counted)                  | Asset: latest valuation                                       | `manual`, else `cost`           |
| Credit card, loan                      | Liability: what the ledger says is owed                       | `ledger`                        |

- **Each source is counted once**: the investment account contributes cash, not its ledger
  balance (which includes money already turned into holdings), so a purchase at cost leaves net
  worth unchanged. Loans use the Phase 2 loan account's balance, the same source of truth as the
  Loans view.
- **Every item carries** its valuation date, `source`, and `freshness` (`current`, `stale`,
  `missing`, `estimated`); the totals report how many counted items are estimated, manual,
  stale, or missing, and the web app lists them. Prices are stale after 7 days.
- **As of a past date**, balances count transactions dated on or before it (FinanceService's
  `accounts(…, as_of)`), holdings replay their trades to that date, and prices and valuations are
  the latest on or before it. Opening balances have no date and always count.

### Net worth snapshots

- **One per workspace, currency, and month** (unique key), valued as of the month's last day, or
  today for the current month. Generating one is **idempotent**: a month that already has one
  returns it (200) instead of adding another; a concurrent insert loses the race and returns the
  winner. Only the current month can be deliberately refreshed (`refresh: true`); past months are
  never changed (409).
- **Source** distinguishes actual from reconstructed values: `scheduled` (taken by the worker at
  month end), `manual` (the current month, saved by the user), or `backfill` (a past month
  rebuilt later from recorded history). Each snapshot also stores how many of its values were
  estimated, manual, stale, or missing. Group totals are stored as JSON.
- **Automation uses the existing worker**: `ReminderWorker` checks at most hourly (after a poll)
  and takes the previous month's snapshot for every workspace with finance data that lacks one,
  each in its own transaction. No other scheduler exists. Month boundaries for the worker are
  UTC dates.
- The dashboard compares today's net worth with the snapshots 1, 3, 6, and 12 months back, and
  charts stored snapshots plus a live point for today.

### Valuation strategy

Prices are **entered by hand** unless the server turns market data on
(`ORBIT_MARKET_DATA_ENABLED`, off by default). Then `providers/prices/feed.py` implements the
`PriceFeed` in `services/investments/valuation.py` with two public, keyless services: mutual
fund NAVs from **mfapi.in** (AMFI's published history, by numeric scheme code) and stock and ETF
closing prices from **Yahoo Finance**'s chart endpoint (an unofficial API that may change or
rate-limit; `price_key` maps `INFY` on `NSE` to `INFY.NS`, `BSE` to `.BO`). Both also back
instrument search. Prices are stored like manual ones, one per holding and date, with `source =
provider`; a price in another currency than the holding's is ignored.

- **What leaves the server**: a scheme code or ticker and a date range, or a search phrase;
  never units, amounts, or names of people. Nothing about holdings is logged.
- **When**: the worker refreshes the last 7 days' prices of every holding with a symbol every
  `ORBIT_MARKET_DATA_REFRESH_HOURS` (6); adding a holding fetches its prices; `POST
…/market-data/refresh` does it on demand; a buy without units fetches the NAV it needs.
- Feed failures never fail a refresh (counted as `failed`) or a buy with units; they only mean
  a buy without units asks for them. Bank and broker statements are not imported.

### Investments API

Under `/api/v1/workspaces/{workspace_id}/finance`, authorized through `WorkspaceDep`. Another
workspace's account, holding, deposit, or transaction is a 404; referencing one in a request is a 422. Date-dependent reads take `today` (the user's local date; defaults as in phase 2).

| Method                   | Path                                            | Purpose                                                                   |
| ------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------- |
| `GET`                    | `/portfolio`                                    | Values, gains, income, fees, allocation (`currency`, `today`, date range) |
| `GET`, `POST`            | `/investment-accounts`                          | List; create or adopt (`account_id`)                                      |
| `GET`, `PATCH`           | `/investment-accounts/{account_id}`             | One; change kind, provider, link, name, notes, `archived`                 |
| `GET`, `POST`            | `/holdings`                                     | List with units, cost, value, gains; add (409 on a duplicate)             |
| `GET`, `PATCH`, `DELETE` | `/holdings/{id}`                                | One; edit; delete one without transactions                                |
| `GET`, `POST`            | `/holdings/{id}/prices`                         | Price history; record a price (replaces that date's)                      |
| `DELETE`                 | `/holdings/{id}/prices/{price_id}`              | Delete a price                                                            |
| `GET`, `POST`            | `/investment-transactions`                      | Activity (filters, paging); record with its ledger rows                   |
| `GET`, `DELETE`          | `/investment-transactions/{id}`                 | One; delete (`delete_ledger`)                                             |
| `GET`                    | `/market-data`                                  | Whether market data is on                                                 |
| `GET`                    | `/market-data/search`                           | Find a fund, stock, or ETF (`kind`, `q`; 409 when off, 503 unreachable)   |
| `POST`                   | `/market-data/refresh`                          | Fetch recent prices of every holding with a symbol (409 when off)         |
| `GET`, `POST`            | `/sip-plans`                                    | List with next due date; schedule                                         |
| `PATCH`                  | `/sip-plans/{id}`                               | Change, pause, cancel, resume                                             |
| `POST`                   | `/sip-plans/{id}/installments`                  | Record an installment (409 if that date is recorded)                      |
| `GET`, `POST`            | `/deposits`                                     | List with estimates and projections; open                                 |
| `GET`, `PATCH`           | `/deposits/{id}`                                | One; edit terms and reminder                                              |
| `POST`                   | `/deposits/{id}/contributions`                  | Record money put in                                                       |
| `PUT`                    | `/deposits/{id}/value`                          | Set (or clear) a manual value                                             |
| `POST`                   | `/deposits/{id}/close`, `/deposits/{id}/reopen` | Close (withdrawal + interest); undo a closure                             |
| `GET`, `POST`            | `/assets`                                       | List; add (409 on a duplicate name)                                       |
| `GET`, `PATCH`           | `/assets/{id}`                                  | One; edit, archive, restore                                               |
| `GET`, `POST`            | `/assets/{id}/valuations`                       | History; record a value (replaces that date's)                            |
| `DELETE`                 | `/assets/{id}/valuations/{valuation_id}`        | Delete a valuation                                                        |
| `GET`                    | `/net-worth`                                    | Totals, groups, items, quality, changes (`currency`, `today`, `as_of`)    |
| `GET`, `POST`            | `/net-worth/snapshots`                          | History; save a month (201 created, 200 already there)                    |

Request models forbid unknown fields; quantities and prices must be decimal strings; amounts
must be JSON integers. Routes log nothing about holdings or values.

### Investments in the web app

- `/finance` gains **Investments** (tiles for current value, cost, unrealized gain, and total
  return with realized gains, income, and fees for this year, the last 12 months, or all time; a
  stale or missing price notice; allocation and category bars; holdings grouped by account with
  units, average cost, cost basis, latest price and date, realized gains, and dividends; SIPs;
  deposits with estimate labels and the bank's stated amount; recent activity with delete
  confirmation; investment accounts with their cash), **Assets** (values, stale and "not in net
  worth" markers, history, update value, archive with confirmation), and **Net worth** (totals,
  a quality notice, changes, a monthly trend from snapshots plus today, asset and liability
  breakdowns, and every item with its source and date, including those not counted).
- **Adding an investment** is one dialog (`add-investment-dialog.tsx`): find the fund or stock
  by name (with market data on; otherwise type its details), choose or name the account it sits
  in (a new one is created first), and enter what is held, sent as the holding's `opening`.
  With market data on, the view offers **Refresh prices**; SIP dialogs offer **Auto-debit** for
  funds.
- Dialogs use React Hook Form with Yup schemas in `lib/investments`, which parses units and
  prices as strings (`parseUnits`) and never uses floats for money. Queries live under
  `["workspaces", id, "finance", "investments", …]`, so any finance change refetches them;
  changes also refetch reminders.
- Charts use the single `--chart-1` token: allocation as labelled proportion bars, the trend as
  one bar per month (reconstructed months outlined, today ringed), each focusable with its
  figures in its accessible name.

### Investment limitations

- **Live prices are opt-in** and come from mfapi.in and Yahoo Finance only; with market data
  off, values are only as current as the prices entered, and stale ones are marked. There are
  no bank, broker, or registrar connections, and no statement (CAS) import.
- **Corporate actions** (splits, bonuses, mergers, dividend reinvestment as units) aren't
  modelled; record them as a sale and buy, or adjust by hand. FIFO is the only cost method;
  there is no tax lot selection, capital gains tax, or grandfathering.
- Investment transactions can't be edited, only deleted and recorded again. Editing a ledger row
  an investment transaction recorded isn't blocked and can make investment cash drift; delete
  the investment transaction instead.
- Deposits don't model periodic interest payouts, TDS, or exact bank day counts; RD installments
  are recorded one by one, and missed ones aren't tracked.
- Net worth is per currency with no conversion. Reconstructed (backfilled) snapshots count
  opening balances whatever the date, and use prices and valuations recorded before that date
  only.
- Return percentages are simple, not annualized (no XIRR).

## Budgets, savings goals, and planning (phase 4)

Budgets per month or custom period, threshold alerts, rollover, savings goals, and a monthly plan
of expected income against everything that leaves it. Code: `services/budgets/`
(`calculation.py` pure, `service.py` the rules), `services/goals/` (`calculation.py`,
`service.py`), `services/planning/` (`calculation.py`, `service.py`), `repositories/budgets.py`,
`repositories/goals.py`, `repositories/planning.py`, `schemas/budgets.py`, `schemas/goals.py`,
`schemas/planning.py`, and `api/v1/budgets.py`, `api/v1/goals.py`, and `api/v1/planning.py`. Like
phases 2 and 3 this sits **on top of** the phase 1 ledger: spending, balances, and transfers are
read from `finance_transactions`, and no second transaction, account, or notification model
exists.

### Budget data model

```text
finance_categories ──< finance_budgets ──< finance_budget_periods ──< finance_budget_alerts ──> notifications
                       (overall or one       (one per month, or the     (unique per period and      (ON DELETE
                        expense category)     custom range; unique       threshold)                  SET NULL)
                                              per budget and start)
finance_accounts ──< finance_savings_goals ──< finance_goal_contributions ──> finance_transactions
                     (optional account,        (unique transaction;           (no ON DELETE)
                      same currency)            contribution or withdrawal)
finance_monthly_plans   (unique workspace, currency, month)
```

| Table                        | Holds                                                                                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `finance_budgets`            | Name, `scope` (overall or category) and `category_id`, currency, `amount`, `period` (monthly or custom), start and end dates, `rollover`, alert settings, state, notes |
| `finance_budget_periods`     | One period of a budget: dates, `base_amount` (the budget's amount then), `rollover_amount` (carried in), and `closed_at` with `spent_at_close`                         |
| `finance_budget_alerts`      | One threshold crossed in one period: the spending and amount available then, and the notification sent (if any)                                                        |
| `finance_savings_goals`      | Name, description, category, priority, currency, target amount, start and target dates, state, optional `account_id`, notes, `completed_at`                            |
| `finance_goal_contributions` | A contribution or withdrawal: amount, date, and the ledger transfer that moved it (if any)                                                                             |
| `finance_monthly_plans`      | A month's expected income in one currency                                                                                                                              |

- **Budgets.** A monthly budget starts on the first of a month and repeats until its end month's
  last day, or without end (`end_date` NULL). A one-month budget ends in its own month. A custom
  budget covers one range of up to a year. `upcoming`, `active`, and `completed` are derived from
  the dates; `archived` is stored.
- **One budget per spending, per period.** Two active budgets in one currency for the same scope
  (overall, or the same category) can't overlap in time (409); a budget for another category,
  currency, or non-overlapping period is fine. An overall budget and category budgets coexist:
  the overall one caps all spending. Archiving frees the period; restoring checks again. The check
  is in the service (date-range overlap can't be a portable unique key), so two simultaneous
  creations could in principle both pass.
- **Subcategories** don't exist in the category model, so budgets are per category only.
- **Constraints** (tested in `tests/test_migrations.py`): amounts 1 to 10^13, a category exactly
  for category budgets, a custom period with an end and no rollover, `end_date ≥ start_date`,
  archived matching `archived_at`, a closed period having both `closed_at` and `spent_at_close`,
  unique `(budget_id, period_start)` and `(period_id, threshold)`, composite foreign keys keeping
  categories, periods, alerts, goal accounts (and their currency), and contribution transactions
  in the row's workspace. The category foreign key has no `ON DELETE`: a category a budget uses
  can't be deleted (409 "A budget limits spending in this category"). A goal account must use the
  goal's currency.

### Spending eligibility

A budget's spending is the **net spending** (expenses minus refunds) dated in its period, in its
currency, overall or in its category. It is read through `FinanceService.spending_by_category`, the
aggregate behind the Overview's "Spending by category", so a budget and the dashboard always agree.
There is no separate eligibility list to drift; the ledger's types decide:

| Ledger row                                       | Counts toward a budget                   |
| ------------------------------------------------ | ---------------------------------------- |
| `expense` (purchases, card purchases, fees)      | Yes, in its category                     |
| `refund`                                         | Reduces its category                     |
| `income`                                         | No                                       |
| `transfer` (card bills, moving money, savings)   | No                                       |
| Investment purchase (a transfer, or nothing)     | No; its charges are an expense and count |
| EMI principal (a transfer into the loan account) | No                                       |
| EMI interest (an expense in "Loan interest")     | Yes                                      |
| Subscription or bill payment (one expense)       | Yes, once                                |
| An expected bill or renewal not yet recorded     | No                                       |

- Uncategorized spending counts only toward an overall budget.
- A period whose refunds exceed its spending (a refund of last month's purchase) has spent
  nothing, never a negative amount.
- Dates are calendar dates in the user's time zone, as everywhere in finance; a month is its
  first to last day inclusive.

### Utilization, statuses, and projections

`services/budgets/calculation.py` is pure and unit-tested (`tests/test_budget_math.py`). Every
figure is an integer: utilization is basis points (`spent × 10000 ÷ available`, rounded down) sent
as two-decimal text (`"87.50"`) for display, and every threshold or status is decided by
cross-multiplying (`spent × 100 ≥ threshold × available`), never by a percentage.

- **Available** = `base_amount + rollover_amount`, never below zero. **Remaining** = available −
  spent (negative when overspent).
- **Status**: `on_track` below 75%, `approaching` from 75%, `near` from 90%, `exceeded` once
  spending is more than what is available. With nothing available, any spending is `exceeded`.
- **Projected** spending = spent × days in the period ÷ days elapsed, rounded half up, once seven
  days have passed (earlier, one large purchase projects nonsense); the actual spending once the
  period is over.

### Periods, edits, and history

- **Periods are stored as they start.** Creating a budget, editing it, and the worker store every
  period from the start through the current one. Reads never write: a period that hasn't been
  stored yet is computed from the budget as it is now, which is exactly what storing it would
  record.
- **Edits apply from the current period on.** Before an edit is applied, every finished period is
  closed with the old amount; the current (open) period then takes the new amount. A budget with
  a finished period can't move its start or end before that period (422), and a finished custom
  period's dates are fixed. Past periods therefore keep the amount they had, and history
  (`…/budgets/{id}`, `…/budgets/history`) reads those stored amounts.
- **History** reports each month's total budget (the overall monthly budget's available amount,
  else the sum of monthly category budgets'), spending, how many budgets stayed within, and
  spending per category against its budget. A custom period overlapping a month is listed but not
  added to the month's total, since it covers other days too.
- **Copying a month** (`…/budgets/copy`) creates one-month budgets in the target month from the
  source month's monthly budgets, with the amounts those periods had. Budgets that already cover
  the target month (a recurring one, or one added there) are skipped, so copying twice adds
  nothing. A recurring monthly budget is the way to repeat a budget every month.

### Rollover

Per budget, for monthly budgets only (a custom period has no next period):

| Mode      | When a month closes, the next month gets                                          |
| --------- | --------------------------------------------------------------------------------- |
| `none`    | Nothing: it starts with its own amount                                            |
| `surplus` | What was left unspent; overspending carries nothing                               |
| `full`    | What was left, positive or negative, but never more negative than its base amount |

- The leftover is `available − spent`, so rollover compounds: ₹2,000 left of ₹10,000 makes the
  next month ₹12,000, and anything left of that carries on.
- **Negative rollover** (with `full`) is capped at the next month's base amount, so a month starts
  at zero at worst. Any deficit beyond that is dropped, not carried twice. Positive rollover is
  capped at 10^15 minor units (a CHECK backs it).
- **Closing happens once.** When a period has ended (the day after its last, in the owner's time
  zone), the worker (or the next edit) records its spending as `spent_at_close`, sets `closed_at`
  with a conditional `UPDATE … WHERE closed_at IS NULL` (of two concurrent closings exactly one
  writes), and writes the rollover into the next period, in one transaction. Closed periods are
  never changed again.
- **Late corrections.** A transaction added or edited in a closed month changes that month's
  spending in history (`spent` follows the ledger), but not the rollover it already passed on
  (`spent_at_close` is what decided it, and the UI shows both when they differ).
- The base amount and the rollover are always reported separately.

### Alerts and deduplication

- Each budget has `alerts_enabled` and up to six thresholds, whole percentages from 1 to 200
  (above 100 alerts on overspending). Defaults: 50, 75, 90, 100.
- **The existing worker checks**: `ReminderWorker` runs `check_budgets` at most every five minutes
  (after a poll, like net worth snapshots). For every workspace with an active budget it closes
  finished periods, then compares each active budget's current period with its thresholds, on
  the owner's local date (`users.timezone`, else UTC). No other scheduler exists.
- **One alert per threshold and period.** A crossed threshold is recorded in
  `finance_budget_alerts`, unique per period and threshold, in the same transaction as the
  notification, so concurrent workers send it once (tested with three workers). Of several
  thresholds crossed at once, only the highest notifies ("75% used" rather than "50%" and "75%").
- **No misleading repeats.** Spending that falls back under a threshold (a refund, a raised
  budget) and rises again never re-sends it. A threshold added below one already sent is recorded
  silently. Changing a budget's amount or rollover doesn't reset what was sent this period.
- **Notifications are ordinary rows** in `notifications` for the workspace's owner, without a
  reminder link, and appear in the bell like reminders: "Groceries: 90% of budget used", "INR
  9000.00 of INR 10000.00 spent (October 2026)." Archived budgets and budgets with alerts off are
  never checked.
- Alerts arrive within about five minutes of the spending being recorded, not instantly.

### Savings goal accounting

- **A goal earmarks money; it is never an account.** Its saved amount is contributions minus
  withdrawals, derived on read. Goals add nothing to balances or net worth, so nothing is counted
  twice.
- **Saving is never spending.** A contribution never creates an expense:
  - `allocate` earmarks money already held (or releases it); no ledger row. This is how a goal is
    tracked without a separate account.
  - `transfer` records an ordinary ledger `transfer` from another account into the goal's linked
    account (or out of it, for a withdrawal), in the same database transaction.
  - `link` records an existing transfer into (or out of) the linked account; its amount and date
    are used.
- **No duplicates.** A transfer backs at most one contribution (unique key, checked first for a
  clear 409), and the ledger refuses to delete a transfer a contribution records (409). Undoing a
  contribution keeps its transfer unless `delete_transaction=true`.
- **Linked accounts** must be bank, savings, cash, wallet, or other accounts in the goal's
  currency. Investment accounts are excluded (the money would appear as both savings and an
  investment in a plan); cards and loans owe money. The account can't change once transfers into
  it are recorded against the goal.
- **What is shown:** the target; the **saved** (allocated) amount; the linked account's
  **balance**; what all active and paused goals in that account have **allocated** (more than the
  balance is flagged); and what is **available to withdraw** (saved, but no more than the
  account holds). Withdrawals can't exceed what was saved (422), and a contribution that later
  withdrawals depend on can't be undone first.
- **Suggested monthly contribution** (`services/goals/calculation.py`, `tests/test_goal_math.py`)
  = remaining ÷ months from this month through the target date's month, inclusive, **rounded up**
  to the minor unit so the target is never missed; everything remaining once the target month has
  passed; none without a target date. Progress is basis points of the target, capped at 100%.
- **States**: `active` (takes contributions), `paused` (withdrawals only), `completed`
  (`completed_at` recorded; reopening clears it), `cancelled`. A goal with contributions can't be
  deleted (cancel it instead), so history is kept. Targets and dates can change at any time.

### Monthly planning

`GET …/plan` brings the month together, planned against actual (`services/planning/calculation.py`,
`tests/test_planning_math.py`, `tests/test_planning.py`):

| Line              | Planned                                                                                                          | Actual                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Income            | Expected income: this month's, else the latest earlier month's                                                   | Income recorded                                        |
| Fixed commitments | Loan EMIs, rent (bills in the built-in Rent category), subscriptions, and bills due in the month, except skipped | Those marked paid                                      |
| Variable spending | An overall budget less the month's planned rent, subscription, bill, and EMI interest; else category budgets     | Net spending less expenses that paid a commitment      |
| Savings goals     | Active goals' suggested monthly contributions                                                                    | Contributions minus withdrawals recorded               |
| Investments       | SIPs due in the month                                                                                            | Transfers into investment accounts from other accounts |
| **Remaining**     | Expected income − every planned line                                                                             | Income − every actual line                             |

- **Cash flow isn't spending.** The lines don't overlap: commitment payments are taken out of
  variable spending, goals can't live in investment accounts, and transfers are never spending.
  The response also reports **spending** (net expenses only: consumption, including interest and
  paid bills) and **allocations** (loan principal, net investments, and goal savings), which are
  money moved to the user's own accounts.
- Only expected income is stored (`PUT …/plan/{month}`), per month and currency; later months use
  it until another is entered. Everything else planned comes from commitments, budgets, goals, and
  SIPs. Commitments are grouped by due date.

### Budgets, goals, and planning API

Under `/api/v1/workspaces/{workspace_id}/finance`, authorized through `WorkspaceDep`. Another
workspace's budget or goal is a 404; referencing its category, account, or transaction is a 422.
Reads take `today` (the user's local date; default: today in their time-zone preference, else
UTC).

| Method                   | Path                                             | Purpose                                                                |
| ------------------------ | ------------------------------------------------ | ---------------------------------------------------------------------- |
| `GET`, `POST`            | `/budgets`                                       | List with each current period; create (409 on an overlap)              |
| `GET`                    | `/budgets/overview`                              | One month (`month`, `currency`): total, spent, per budget and category |
| `GET`                    | `/budgets/history`                               | The overview for `months` (≤ 24) months ending at `month`              |
| `POST`                   | `/budgets/copy`                                  | Copy `from_month`'s monthly budgets into `to_month`                    |
| `GET`, `PATCH`, `DELETE` | `/budgets/{id}`                                  | Detail with every period; edit from the current period on; delete      |
| `POST`                   | `/budgets/{id}/archive`, `/budgets/{id}/restore` | Archive (idempotent); restore                                          |
| `GET`, `POST`            | `/savings-goals`                                 | List with progress; create                                             |
| `GET`, `PATCH`, `DELETE` | `/savings-goals/{id}`                            | One; edit (including `state`); delete one without contributions        |
| `GET`, `POST`            | `/savings-goals/{id}/contributions`              | History; record (`type`, `mode`: allocate, transfer, link)             |
| `DELETE`                 | `/savings-goals/{id}/contributions/{cid}`        | Undo (`delete_transaction`)                                            |
| `GET`                    | `/plan`                                          | The month's plan (`month`, `currency`, `today`)                        |
| `PUT`, `DELETE`          | `/plan/{month}`                                  | Set or clear the month's expected income                               |

Request models forbid unknown fields; amounts must be JSON integers. Routes log nothing about
budgets, goals, or amounts.

### Budgets, goals, and plans in the web app

- `/finance` gains **Budgets** (a month navigator that can look ahead; budget, spent, and
  remaining tiles with the overall bar; budgets ordered by attention with a progress bar, status,
  base and rollover amounts, the projection, and their period history with adherence; spending by
  category against its budget; six months of budget against spending, each month selectable;
  copy last month; archive, restore, and delete with confirmation; archived and finished budgets
  collapsed), **Plan** (planned and actual lines in a table, available to spend and left over,
  expected income, and spending kept apart from allocations), and **Goals** (totals per currency;
  each goal's progress, suggested monthly amount, months left, linked account balance, what's
  available, and over-allocation; add money, withdraw, history with undo, pause, complete, cancel,
  and delete).
- The **Overview** shows the month's budget and the goals in progress when they exist.
- Dialogs use React Hook Form with Yup schemas in `lib/budgets` and `lib/goals`. The web app
  computes no spending, status, or progress: bars and badges show what the API returned.
  Queries live under `["workspaces", id, "finance", "budgets" | "goals" | "plan", …]`, so any
  finance change refetches them.

### Budget and goal limitations

- No subcategory budgets (categories have no hierarchy), no weekly or yearly budget periods, and
  no per-month overrides of a recurring budget's amount (end it and add another, or use a
  one-month budget).
- The overlap check for budgets is in the service, not a database constraint.
- Alerts are in-app only and arrive within the worker's check interval (about five minutes); a
  threshold crossed on a period's last day after the final check is not announced once the period
  has closed.
- Rollover decided at closing ignores later corrections to that month.
- Planned commitments are grouped by due date and actual ones by the same due date; a loan
  prepayment appears in allocations but not in the EMI line; recurring deposit installments are
  not planned. Planned savings assume each goal's suggested amount; there is no per-month savings
  plan.
- Different currencies are never combined; each view shows one currency at a time.
- No AI insights, bank connections, or automatic categorization.

## Finance limitations and extension points (planned, not implemented)

- **Statement imports** (CAS, broker contract notes) would implement `PriceFeed` or record
  buys (see [Valuation strategy](#valuation-strategy)); none is integrated.
- Commitments don't create transactions automatically (only auto-debit SIPs do); each payment is recorded
  or linked. Overdue occurrences of a subscription or bill are listed up to the 60 most recent.
- A loan's earlier history (before it was added) isn't reconstructed, floating rates are
  modelled by rescheduling, and interest is per installment period (no daily-balance interest,
  fees, or insurance bundled into EMIs).
- Editing or retyping a transaction that records a payment isn't blocked; the payment keeps the
  amounts recorded when it was paid.
- Not supported now: currency conversion, split transactions, attachments, imports, bank
  connections, reconciliation, and undo (deletes are confirmed instead).

## Notes and knowledge management

Notes capture, organize, connect, and find a workspace's knowledge: standard notes, quick notes,
and a daily journal, in folders and tags, linked to each other and to tasks.

### Notes data model

```text
workspaces ──< note_folders ──< note_folders            (parent_id, ON DELETE CASCADE)
     │              │
     ├──< notes >───┘ (folder_id: no ON DELETE; the service moves notes out first)
     │      ├──< note_tag_assignments >── note_tags     (both sides cascade)
     │      ├──< note_links >── notes                   (source → target, both cascade)
     │      ├──< note_task_links >── tasks              (both cascade)
     │      └──< note_attachments                       (metadata; files live outside the DB)
```

Every relationship is a composite foreign key on `(id, workspace_id)`, so the database itself
refuses a folder, tag, link, task link, or attachment that crosses workspaces. Migration
`0012_create_notes` creates the tables with RLS on PostgreSQL.

| `notes` column                 | Notes                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| `note_type`                    | `note`, `quick` (captured fast), or `journal` (CHECK)                                 |
| `title`                        | 0 to 200 characters; empty titles show as "Untitled" or the journal date              |
| `content`, `content_format`    | The editor document as ProseMirror JSON (≤ 1,000,000 characters), `prosemirror-v1`    |
| `plain_text`                   | Derived from `content` on every save, for search and previews; never sent by a client |
| `folder_id`                    | `NULL` is the Inbox                                                                   |
| `journal_date`                 | Set exactly for journal entries (CHECK); `unique(workspace_id, journal_date)`         |
| `is_pinned`, `is_favorite`     | Pinned notes sort first in lists                                                      |
| `is_locked`                    | Locked notes show only their title in lists, search, and previews (not encryption)    |
| `archived_at`, `trashed_at`    | Archive and trash are timestamps; archived and trashed notes are read-only            |
| `revision`                     | Starts at 1 and counts title or content changes (optimistic concurrency)              |
| `updated_at`, `last_opened_at` | `updated_at` changes only with the title or content; opening sets `last_opened_at`    |

Indexes: `(workspace_id, updated_at)`, `(workspace_id, folder_id)`, the journal date's unique
index, and lookups by target for backlinks, by tag, and by task.

### Folders and tags

- **Folders** nest up to 8 levels. The service refuses moving a folder into itself or one of its
  subfolders (it walks the tree) and moves that would nest too deeply; a CHECK forbids a folder
  being its own parent. Folder note counts are active notes directly in the folder.
- **Deleting a folder never deletes notes silently.** The caller chooses (`?notes=`): `parent`
  moves the folder's notes and subfolders up a level; `inbox` or `trash` deletes the folder and
  its subfolders after moving every note inside to the Inbox or the trash. `notes.folder_id` has
  no `ON DELETE` action, so a folder with notes can't be deleted by accident.
- **Tags** are unique per workspace by `normalized_name` (whitespace collapsed, trimmed,
  case-folded): "Deep Work", "deep work", and "DEEP WORK" are one tag. Adding a tag by name
  reuses the existing one or creates it; concurrent creation of the same name resolves to one tag.
  Renaming to another tag's name is a 409. Deleting a tag removes it from every note; a note has
  at most 50 tags. Usage counts are active notes.

### Editor content format

- The web editor is [Tiptap](https://tiptap.dev) 3 (ProseMirror) with StarterKit (paragraphs,
  headings 1 to 3, bold, italic, underline, strikethrough, inline code, lists, quotes, dividers,
  links), task lists, tables, and code blocks highlighted by lowlight (highlight.js grammars).
  Extensions are defined once in `lib/note-content` and used by both the editor and Markdown
  conversion.
- **The ProseMirror document is the only source of truth.** Markdown is never stored.
- The API validates every document (`services/notes/content.py`): only the node and mark types
  those extensions produce, a depth limit, a size limit, and links that are `http(s):`,
  `mailto:`, or internal note links (no `javascript:` or other schemes). So a stored document
  always loads in the editor, and content can't smuggle unsafe URLs. The same pass derives
  `plain_text` and the note's outgoing links.

### Markdown conversion

`lib/note-content` uses `@tiptap/markdown`'s `MarkdownManager` with the editor's extensions:

- **Import:** a `.md` or `.txt` file becomes a note; its first heading (or line) becomes the title.
- **Export / copy:** the note menu downloads `<title>.md` or copies Markdown to the clipboard.
- **Paste:** plain-text pastes that look like Markdown (headings, lists, checklists, quotes, code
  fences, tables, links, bold) are converted; pastes with HTML keep the browser's formatting.
- Quick capture accepts Markdown too. Round trips are tested for every supported block and mark;
  underline has no Markdown form and exports as plain text, and Markdown images are dropped
  (there is no image node).

### Autosave strategy

`hooks/use-note-autosave.ts`, tested with a mocked API:

- Typing is saved **800 ms after the last change**; leaving the note (another note, another
  page) saves at once, and the page waits for that save before switching notes.
- **One request at a time.** Edits made while a save is in flight go in the next request.
- A save that would change nothing (the server already has those fields) sends no request.
- Each save sends `expected_revision`. If someone changed the note since (another tab or device),
  the API answers **409** and nothing is overwritten. The editor stops saving and offers "Load
  their version" or "Keep mine" (which saves over the newer revision deliberately).
- Network errors, 5xx, and 429 are **retried** after 1, 3, and 8 seconds; then, and for other
  errors (such as 422), the status shows "Not saved" with a Retry button.
- The status reads **Saved only after the server confirms**. Closing or reloading the tab with
  unsaved or in-flight changes triggers the browser's leave warning.
- Metadata changes (pin, favorite, folder, archive, tags) are separate requests that don't need
  or change the revision.

### Note linking and backlinks

- A link to a note is an ordinary link mark whose `href` is `/notes?note=<uuid>`, inserted from
  the toolbar's note picker. Links name notes by **ID**, so renaming a note never breaks them
  (the link text stays as typed; the panels show current titles).
- On every content save the API replaces the note's rows in `note_links` with the set of linked
  note IDs that exist **in the same workspace** (duplicates collapse to one row; self-links and
  unknown or foreign IDs are ignored). Links to other workspaces stay in the text but relate
  nothing.
- `GET …/notes/{id}/links` returns outgoing links and backlinks, leaving out trashed notes; they
  return when the note is restored. Clicking a note link in the editor opens it in place.
- No graph visualization.

### Task integration

- `note_task_links` relates notes and existing tasks; task data stays in `tasks`. Linking checks
  the task exists in the note's workspace (422 otherwise), is idempotent, and deleting either side
  removes the link.
- The note's details list linked tasks (`GET …/notes/{id}/tasks`, the tasks API's own response
  type) with links to `/tasks?task=<id>`, which opens the task's dialog. The task dialog lists the
  notes linked to it (`GET …/notes?task_id=`), each opening the note.

### Journal behavior

- One entry per day per workspace, a note of type `journal` with `journal_date`; the unique index
  backs the rule. `PUT …/notes/journal/{date}` returns the day's entry, creating it (201) the first
  time; concurrent first opens resolve to the same entry. Opening a trashed day restores it.
  `PUT …/notes/journal/today` uses the user's time zone (Settings → Account), else UTC.
- The web app computes "today" in the user's time zone (else the browser's) and opens it with
  the date. The Journal view lists entries by date with previous/next day, a date picker, and
  Today. Entries are searchable and linkable like any note; their type and date can't change, and
  a duplicate becomes an ordinary note. Journal entries are not in the Inbox or All notes.

### Search architecture

- `GET …/notes?q=` splits the search into words (at most eight); each must appear,
  case-insensitively, in the title, the derived plain text, a tag name, or the folder's name.
  It is an escaped `ILIKE` per word, the same approach as tasks and finance, and runs unchanged on
  SQLite and PostgreSQL. It scans one workspace's notes, which is fine at personal scale;
  PostgreSQL full-text search or SQLite FTS5 can replace `repositories/notes.py`'s filter without
  changing the service or API.
- Results carry an `excerpt`: the start of the text, or the text around the first match. The web
  app highlights matching words with `<mark>` (text split in React, never injected HTML).
- A locked note's `excerpt` is empty everywhere (notes list, dashboard, AI context summaries,
  agent tools), and its text is never matched by notes search or universal search; its title,
  tags, and folder still are. Opening it returns its content as usual.
- Filters: state (`active`, `archived`, `trashed`), folder or Inbox, tag, type, task, favorite,
  pinned; sorts: last edited, created, title, recent (last opened or edited), journal date;
  `pinned_first`; `limit` (≤ 100) and `offset`. The web app pages by 50.
- Views map onto these filters (`lib/notes`): Inbox, All notes, Recent, Favorites, Pinned,
  Journal, Archive, Trash, a folder, or a tag. No vector or semantic search.

### Attachments

- There was no file storage to reuse (profile photos are small and stored in a column), so notes
  added the minimum, which [documents](#document-storage) now share: metadata in `note_attachments`, bytes in files under
  `ORBIT_ATTACHMENTS_PATH/<workspace id>/<attachment id>` (`system/attachment_store.py`). Names on
  disk are server-generated UUIDs; directories are `0700` and files `0600`; writes go to a
  temporary file and are renamed into place; blocking I/O runs in a worker thread.
- Uploads are the raw request body with `?filename=` (a name, not a path), capped by
  `ORBIT_ATTACHMENT_MAX_BYTES` (default 10 MB) while reading. The type comes from the extension
  and is checked against the file's leading bytes (PNG, JPEG, GIF, WebP, PDF, ZIP-based Office and
  OpenDocument files) or, for text formats, the absence of NUL bytes; the declared content type is
  ignored (`utils/file_types.py`, shared with documents). At most 50 per note.
- Downloads require the bearer token, so the web app fetches a blob. Responses always use
  `Content-Disposition: attachment`, the detected type, `nosniff`, and a sandboxing CSP.
- Deleting an attachment, permanently deleting notes (including emptying the trash), and
  deleting a workspace delete the files too. If the metadata can't be saved, the file just
  written is removed.
- **Limitations:** files live on the API's machine. A cloud deployment with several API
  instances needs a shared volume; object storage is not implemented. Attachments are listed in a
  note's details, not shown inline in the document. If a file deletion fails (logged), the file is
  orphaned but unreachable until the worker's [sweep](#document-storage) removes it.

### Notes API

All routes are under `/api/v1/workspaces/{workspace_id}` and authorize the workspace through
`WorkspaceDep` first. An ID from another workspace behaves exactly like a missing one (404 for
the note, folder, tag, or attachment in the path; 422 for a referenced folder or task).

| Method                   | Path                                                   | Purpose                                                                        |
| ------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `GET`, `POST`            | `/notes`                                               | List or search (filters above); create (`content` or `text`)                   |
| `GET`                    | `/notes/counts`                                        | Counts per view                                                                |
| `POST`                   | `/notes/empty-trash`                                   | Delete every trashed note for good                                             |
| `GET`, `PUT`             | `/notes/journal/{date}`, `/notes/journal/today`        | Get, or open (create) a day's entry                                            |
| `GET`, `PATCH`, `DELETE` | `/notes/{id}`                                          | Get; update (409 on a stale `expected_revision`); delete if trashed (else 409) |
| `POST`                   | `/notes/{id}/open`, `/trash`, `/restore`, `/duplicate` | Record an open; trash; restore; copy (same folder and tags)                    |
| `GET`                    | `/notes/{id}/links`                                    | Outgoing links and backlinks                                                   |
| `POST`, `DELETE`         | `/notes/{id}/tags`, `/notes/{id}/tags/{tag}`           | Tag by name (reuse or create); untag                                           |
| `GET`, `PUT`, `DELETE`   | `/notes/{id}/tasks`, `/notes/{id}/tasks/{task}`        | Linked tasks; link; unlink                                                     |
| `GET`, `POST`, `DELETE`  | `/notes/{id}/attachments[/{attachment}]`               | List; upload; download (`GET` one); remove                                     |
| `GET`, `POST`            | `/note-folders`                                        | All folders with counts (flat; the client builds the tree)                     |
| `PATCH`, `DELETE`        | `/note-folders/{id}`                                   | Rename or move; delete with `?notes=parent                                     | inbox | trash` |
| `GET`, `POST`            | `/note-tags`                                           | Tags with usage counts; create                                                 |
| `PATCH`, `DELETE`        | `/note-tags/{id}`                                      | Rename; delete                                                                 |

Request models forbid unknown fields, so `workspace_id`, `revision`, `plain_text`, or
`journal_date` in a body is a 422. Titles reject control characters.

### Notes in the web app

- `/notes` (`components/notes/`): a rail (views with counts, the folder tree with expand,
  collapse, and folder actions, and tags), the list (search, sort, list or grid, per-note actions
  menu, pagination), and the note pane (title, toolbar, editor, save status, and a details panel
  with folder, tags with autocomplete, backlinks and links, tasks, and attachments). The URL holds
  the view, folder or tag, search, and open note, so Back, reloads, and links work.
- Two layouts. Browsing (no note open): the rail beside a list that uses the rest of the page
  (the rail behind **Browse** on narrower screens). Editing (a note open): the note takes the whole
  page, the list opens as a drawer from the left (**Show note list** or `/`), and the details panel
  can be hidden, a choice kept in `localStorage`. The drawer and the details panel stay mounted
  while closed so both slide in and out (no motion with reduced motion).
- **Locking** (pane header or a list item's menu) hides a note's text in lists and the dashboard;
  opening a locked note shows a cover with **Show content** until revealed for that visit. It is a
  privacy screen, not access control or encryption.
- Keyboard: `N` creates a note, `/` focuses search (opening the list drawer when a note is open),
  Escape clears it; the editor supports
  standard shortcuts (Mod+B/I/U, Mod+Shift+S, Mod+E, Mod+Alt+1–3, Mod+Shift+7/8/9, Mod+Shift+B)
  and Markdown input rules; the toolbar is one tab stop with arrow-key navigation.
- **Quick capture** (`QuickCaptureProvider`, in the app shell) opens from the sidebar or the
  command palette on any page and saves a quick note to the Inbox; closing with text typed asks
  first.
- **Command palette:** New note, Quick note, Open today's journal, recent notes, folders, live
  note search as you type, and "Search notes for …", using the existing palette.
- Query keys: `["workspaces", id, "notes", …]`. An open note's query never refetches on its own,
  so the editor owns it while open.

### Notes limitations

- Search is substring matching (no stemming, ranking, or fuzzy matching).
- Attachments are files on one machine (see [Attachments](#attachments)); no inline images.
- Conflict resolution is whole-note ("keep mine" or "theirs"), not a merge. Edits are not synced
  live between open tabs; the second tab finds out on its next save.
- Navigating to another page while a save fails can lose the last changes; the save is attempted
  on leave and the browser warns on close or reload, but in-app navigation can't wait.
- No templates, sharing, version history, graph view, AI features, or semantic search.

## Calendar and events

The calendar plans time in a workspace: events and recurring series, alongside the workspace's
tasks and notes. It owns no copy of a task or note; it links to them by ID.

### Event data model

```text
workspaces ──< calendar_categories
     │                │ (category_id: no ON DELETE; the service clears it from events first)
     ├──< calendar_events ──< calendar_event_exceptions   (one per original start, cascade)
     │          ├──< calendar_event_alerts ──1 reminders   (reminders.calendar_event_alert_id)
     │          ├──< calendar_event_notes >── notes        (both sides cascade)
     │          └──< calendar_event_tasks >── tasks        (both sides cascade)
users ──1 calendar_preferences
```

Every relationship is a composite foreign key on `(id, workspace_id)`, so the database refuses a
category, exception, alert, or link that crosses workspaces. Migration `0013_create_calendar`
creates the tables with RLS on PostgreSQL, adds `tasks.scheduled_start` and `scheduled_end`, and
adds the reminders' link to an alert.

| `calendar_events` column   | Notes                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| `title`, `description`     | 1 to 200 characters; at most 5,000                                                            |
| `location`                 | At most 200 characters                                                                        |
| `category_id`              | Optional; a workspace category                                                                |
| `all_day`                  | All-day events run from local midnight on the first day to midnight after the last            |
| `timezone`                 | IANA zone the local times are in; defaults to the user's preference, else UTC                 |
| `start_local`, `end_local` | **The source of truth**: wall-clock times without an offset; `end >= start` (CHECK)           |
| `start_at`, `end_at`       | Derived UTC instants of the first occurrence, for range queries                               |
| `until_at`                 | Derived UTC end of the last occurrence; `NULL` for a series that never ends                   |
| `recurrence`               | `NULL` for a single event; otherwise a versioned JSON rule (below)                            |
| `status`                   | `confirmed` or `cancelled`                                                                    |
| `series_id`                | The series a "this and following" edit split this one from (informational, not a foreign key) |

- **Categories** are per workspace: a name (unique case-insensitively), a color from a fixed
  palette (`blue`, `green`, `amber`, `rose`, `violet`, `teal`, `orange`, `slate`; never CSS), and
  visibility. The first request for a workspace's categories creates Personal, Work, Meeting,
  Appointment, Birthday, Travel, and Other. Hidden categories' events are left out of ranges and
  the agenda, not search. Deleting a category leaves its events without one.
- **Exceptions** (`calendar_event_exceptions`) record one occurrence as `skipped` or `modified`,
  keyed by its **original local start** (`unique(event_id, original_start)`). Override columns
  that are `NULL` follow the series, so renaming a series renames every occurrence that wasn't
  renamed on its own. A moved occurrence also stores its UTC bounds, indexed, so a range finds
  occurrences moved into it from elsewhere.
- **Alerts** (`calendar_event_alerts`): up to five per event, each a number of minutes before the
  occurrence (0 to 40,320, four weeks), unique per event.
- Indexes: `(workspace_id, start_at)` and `(workspace_id, until_at)` on events,
  `(workspace_id, start_at)` on exceptions, `(workspace_id, scheduled_start)` on tasks.

### Recurrence strategy

`services/calendar/recurrence.py` and `occurrences.py` are pure and unit-tested
(`tests/test_calendar_recurrence.py`).

- **Rules, not rows.** A series stores its rule; occurrences are generated for the range a view
  asks for. Nothing is pre-generated, so a series without an end costs one row.
- **RFC 5545 through `python-dateutil`.** The stored rule is a small validated structure
  (`{"version": 1, "frequency", "interval", "weekdays", "count", "until"}`), translated into a
  `dateutil.rrule`. No user-supplied RRULE text is parsed. Frequencies: daily, weekly on chosen
  weekdays (which must include the start's weekday, so the first occurrence is the event's own
  start), monthly on the start's day, and yearly; every 1 to 99; ending after 1 to 999
  occurrences, on a date (inclusive), or never.
- **Month ends and leap years.** Monthly on the 29th to 31st falls on the last day of shorter
  months and returns in longer ones, like reminders: `BYMONTHDAY=28,…,31;BYSETPOS=-1`. Yearly on
  February 29 falls on February 28 in common years.
- **Identity and duplicates.** An occurrence is its event plus its original local start (the
  RFC 5545 `RECURRENCE-ID`), exposed as `OccurrenceResponse.id` and addressed in paths as
  `…/occurrences/2030-01-14T09:00`. Expansion is keyed by it, so an occurrence appears once even
  when an exception moves it, and expanding the same range twice gives the same IDs.
- **Count** counts every generated occurrence, including skipped ones (RFC semantics), so
  skipping never extends a series.
- **Editing scopes.** `this` writes an exception. `following` splits the series: the original
  ends the day before (`until`), and a new series (`series_id` pointing back) continues from that
  occurrence with the change, keeping the remaining count, the alerts, and the note and task
  links; later exceptions are dropped. `series` changes the event; moving an occurrence with
  `series` moves every occurrence by the same amount (weekly weekdays shift with it). Changing a
  whole series' times, time zone, all-day setting, or rule **clears its exceptions**, since their
  original starts may no longer exist. Deleting `this` stores a `skipped` exception; `following`
  truncates; at the first occurrence either deletes the series.
- A repeating event must end before its next occurrence starts, and any event lasts at most a
  year.

### Timezone handling

- **Event time zone.** Local times are stored in the event's IANA zone and converted to UTC one
  occurrence at a time with the same rules as reminders (`local_to_utc`): a daily 09:00 meeting
  stays at 09:00 across daylight-saving changes; a time skipped by a jump (02:30) happens at
  03:30; a repeated time happens once, at the first. An occurrence's end is its local start plus
  the series' local length.
- **Viewer time zone.** `GET …/calendar/range` takes local dates `[start, end)` and the viewer's
  zone (default: the user's preference, else UTC). Timed occurrences and scheduled tasks are
  matched by instant against that zone's day boundaries (so a 23 or 25 hour DST day is right).
  **All-day events are dates**, matched by date in any viewer's zone: a birthday stays on its day
  wherever you are.
- The web app shows times in the user's time zone preference (Settings → Account), else the
  browser's. Dragging converts the drop point from the viewer's clock to the event's zone
  (`zonedTimeToInstant` in `utils/time-zones`, which resolves DST like the API).
- All stored instants are UTC (`UTCDateTime`); local times are naive `DateTime` columns that mean
  nothing without the row's `timezone`.

### Calendar task integration

- Tasks gain an optional **scheduled time block** (`scheduled_start`, `scheduled_end`, UTC, both
  or neither, end after start, at most a week; a CHECK constraint backs the rule). It is separate
  from the **due date**, which stays a calendar date. Existing tasks are unscheduled; existing
  clients that don't send the fields are unaffected.
- `PATCH …/tasks/{id}` sets or clears the block (`null` for both); `GET …/tasks?scheduled=false`
  lists unscheduled tasks. A range returns tasks scheduled in it (`scheduled_tasks`) and
  unscheduled tasks due in it (`due_tasks`), each with its status; completed ones can be left
  out.
- Events can link to tasks (`calendar_event_tasks`); the event's details list them with their
  status and open them at `/tasks?task=<id>`.

### Note integration

- Events link to existing notes by ID (`calendar_event_notes`), so renaming either keeps the
  link; deleting either removes it. `PUT/DELETE …/events/{id}/notes/{note}` link and unlink
  (the note must be in the workspace, 422 otherwise).
- `POST …/events/{id}/notes` creates an ordinary note in the Inbox through the notes service
  (titled with the event and the occurrence's date unless given one) and links it; the web app
  opens it. Meeting and appointment notes are these notes; no note content lives in the
  calendar.

### Calendar reminder integration

- Each alert manages **one reminder** in the existing `reminders` table
  (`reminders.calendar_event_alert_id`, unique, cascading), delivered by the existing worker as an
  in-app notification. There is no second scheduler. The reminder's link reports
  `commitment.kind = "calendar_alert"`; the reminders API refuses to edit or delete it (409), and
  the reminders page marks it "Managed in Calendar".
- The reminder is a one-time reminder (in UTC) for the **next confirmed occurrence whose alert
  time is still ahead**, computed from the expanded occurrences, so skipped, cancelled, and moved
  occurrences are respected. All-day alerts count back from 09:00 on the first day in the event's
  zone.
- It is **re-pointed in the same transaction** as every change: creating, editing the series or
  an occurrence, splitting, deleting occurrences, or cancelling (which removes it). Deleting the
  event deletes its alerts and their reminders (cascade); delivered notifications stay.
- **After it fires**, the worker's follow-up hook (`ManagedFollowUp` in `scheduler/worker.py`)
  hands calendar reminders to `CalendarService.after_delivery`, inside the delivery transaction,
  which points the reminder at the next occurrence. Delivery keeps the worker's guarantees: one
  notification per reminder occurrence, retries, and recovery.
- The next occurrence is looked for up to about 400 days past the later of now and the series'
  start.

### Calendar preferences

`calendar_preferences` holds one row per user (like `dashboard_layouts`): default view, week
start (`null` follows the browser's locale), working hours (shaded on the time grid; the grid
opens scrolled to them), and whether to show completed tasks, tasks on their due dates, and the
unscheduled tasks list. `GET /api/v1/me/calendar-preferences` returns the defaults until the user
saves (`updated_at: null`); `PUT` replaces them. The preferred time zone is the account's existing
`users.timezone`. Category visibility is a workspace setting, on the category.

### Calendar API

Under `/api/v1/workspaces/{workspace_id}/calendar`, authorized through `WorkspaceDep`. Another
workspace's event is `404 Event not found.`; another workspace's category, note, or task in a
body or path link is a 422, like a missing one.

| Method                   | Path                                         | Purpose                                                                      |
| ------------------------ | -------------------------------------------- | ---------------------------------------------------------------------------- |
| `GET`, `POST`            | `/categories`                                | List (creating the defaults the first time); create (`name`, `color`)        |
| `PATCH`, `DELETE`        | `/categories/{id}`                           | Rename, recolor, show or hide; delete (events keep no category)              |
| `GET`                    | `/range`                                     | Occurrences and tasks for `start`, `end` (≤ 92 days), `timezone`             |
| `GET`                    | `/agenda`                                    | What hasn't ended by `start`, in order; `limit` ≤ 100 and an opaque `cursor` |
| `GET`, `POST`            | `/events`                                    | Search series (`q`, `category_id`, `limit` ≤ 100, `offset`); create          |
| `GET`, `PATCH`, `DELETE` | `/events/{id}`                               | Details (alerts, notes, tasks, next occurrence); change or delete the series |
| `POST`                   | `/events/{id}/duplicate`                     | Copy with rule, alerts, and links, not exceptions                            |
| `PATCH`, `DELETE`        | `/events/{id}/occurrences/{original_start}`  | Change or delete with `scope`: `this`, `following`, or `series`              |
| `POST`                   | `/events/{id}/notes`                         | Create a note for the event and link it                                      |
| `PUT`, `DELETE`          | `/events/{id}/notes/{note}`, `/tasks/{task}` | Link (idempotent) or unlink                                                  |
| `GET`, `PUT`             | `/api/v1/me/calendar-preferences`            | The signed-in user's preferences                                             |

- Times in bodies are local, whole minutes, without an offset (`2030-01-14T09:30`), years 2000
  to 2200; the zone is the event's `timezone`. All-day events send midnight to midnight.
- Request models forbid unknown fields, so `workspace_id`, `series_id`, or derived bounds in a
  body are a 422. Invalid times or rules are a 422 with a reason.
- Event search is an escaped substring match on title, description, and location, like tasks.

### Calendar in the web app

- `/calendar` (`components/calendar/`): a toolbar (Today, previous and next, the range's title,
  and a Month, Week, Day, Agenda switch), the view, and a sidebar with category filters (show or
  hide, color, add, delete) and unscheduled tasks. The view and date live in the URL
  (`?view=week&date=2030-01-14`), so Back and links work. Settings (gear) edits preferences.
- **Month**: whole weeks starting on the preferred day; today highlighted; up to three items per
  day with "N more"; dots on small screens; each day has open-day and new-event buttons.
- **Week and Day**: an hourly grid with an all-day row, working hours shaded, a current-time
  line, and overlapping items side by side (`layoutDay`). **Agenda**: upcoming items grouped by
  day, a page at a time.
- **Events and tasks look different**: events are tinted with their category's color and an
  accent edge; tasks are outlined and dashed with a check mark for their status. Accessible names
  say which is which, the time, and the state.
- **Drag and drop** (mouse and pen): move events and scheduled tasks to another time or day,
  resize from the bottom edge, drag across empty time to create, move all-day events in the
  all-day row and any item between days in the month view, and drop unscheduled tasks onto the
  grid. Moves show at once and roll back if the API refuses; a repeating event asks which
  occurrences to change first. Touch keeps native scrolling: a tap opens an item or starts an
  event. **Alternatives without dragging**: the event dialog edits dates and times, the
  Schedule button gives a task a time block, and every item and day is a button.
- Keyboard: `N` new event, `T` today, `M`/`W`/`D`/`A` views, `←`/`→` previous and next.
- The event dialog covers title, all-day, start and end, time zone, category, location,
  description, repeat (frequency, interval, weekdays, end), reminders (presets and custom
  minutes), and a related task. Editing a single occurrence hides what belongs to the series.
- The details dialog shows when, repeat, category, place, description, reminders, linked notes
  (open, create meeting notes, link an existing note, unlink), and linked tasks, with Edit,
  Duplicate, Cancel or Restore, and Delete.
- **Dashboard**: the Agenda widget shows today's events and tasks, what's coming up, the
  overdue-task count, and a New event button. **Command palette**: create event, go to today,
  open month, week, day, or agenda, schedule a task, create meeting notes for the next event,
  and live event search.
- Query keys: `["workspaces", id, "calendar", …]`; preferences under
  `["me", "calendar-preferences"]`. Changes refetch the calendar and reminders (alerts are
  reminders); scheduling a task also refetches tasks.

### Calendar limitations

- Google and Outlook calendars are synchronized by [external integrations](#external-integrations);
  there is no CalDAV and no `.ics` import or export; no attendees, invitations, or free/busy; no
  AI scheduling.
- Recurrence covers daily, weekly on weekdays, monthly by day of month, and yearly by date, with
  intervals, counts, and end dates. No "second Tuesday of the month" or other `BYDAY` ordinals,
  no hourly rules, and no `RDATE`/`EXDATE` beyond skipped occurrences.
- Changing a series' timing or rule clears its single-occurrence changes; "this and following"
  drops later ones. Exceptions moved before the series' first start aren't found by ranges.
- An alert looks for its next occurrence about 400 days ahead; one with nothing in that window
  waits until the series changes. Alerts are in-app notifications only, at the worker's poll
  granularity.
- Conflicting events aren't flagged; overlapping items are shown side by side.
- Drag and drop needs a mouse or pen; touch uses taps and the dialogs. Dragging a task's block
  across midnight on the time grid isn't supported; use the Schedule dialog.
- Event search matches series, not individual occurrences, and opens the series' first date.
- The opt-in PostgreSQL suite covers the calendar's SQL through the service (cloud mode's API
  needs Supabase tokens); the HTTP tests run on SQLite.

## Habits and routines

Habits are things done on a schedule; routines are short sequences of steps run through in one
go. Both live in a workspace and reuse the existing tasks, notes, reminders, and calendar rather
than copying them. Code: `services/habits/` (`schedule.py` and `progress.py` hold the rules as
pure functions, `insights.py` builds views from them, `service.py` and `routines.py` apply
changes), `repositories/habits.py`, `api/v1/habits.py`, migration `0014_create_habits`.

### Habit data model

- `habits`: name, description, icon (a fixed set of names), color (the calendar's palette),
  optional category, kind (`boolean`, `numeric`, `duration`), unit (numeric only), target
  (`NULL` for yes-or-no habits, minutes for duration habits, a float above zero otherwise),
  optional time of day, start and optional end date, an IANA time zone, and status (`active`,
  `paused`, `archived`). The kind can't change once created.
- `habit_schedule_versions`: the schedule, as versions. Each holds a versioned JSON document and
  the date it takes effect (unique per habit and date).
- `habit_pauses`: date ranges `[start, end)` the habit was paused or archived; `end` is `NULL`
  while it still is.
- `habit_logs`: at most one entry per habit and local date (`UNIQUE (habit_id, day)`): the value,
  the target that applied when it was logged, a skipped flag, an optional note, and when it was
  logged.
- `habit_categories`: per-workspace categories with a color and icon. The first read creates
  the defaults (Health, Fitness, Learning, Productivity, Personal, Finance, Lifestyle, Other);
  deleting one leaves its habits and routines uncategorized.
- `habit_tasks`, `habit_notes`: links to existing tasks and notes. Deleting either side removes
  the link.

Relationships inside the module are composite foreign keys on `(id, workspace_id)`, so the
database refuses cross-workspace rows. Every new PostgreSQL table enables Row Level Security with
no policies, like the others.

### Schedule representation

A schedule is one of:

| Type            | Due                                                                 |
| --------------- | ------------------------------------------------------------------- |
| `daily`         | Every `every` days (1 to 365), counted from the version's first day |
| `weekdays`      | On the listed weekdays                                              |
| `monthly`       | On the listed days of the month                                     |
| `weekly_target` | Any `times_per_week` days (1 to 7) in each week                     |

- A day of the month a month lacks (29th to 31st) falls on its last day; two listed days that
  land on the same date (30 and 31 in February) count once, so nothing is due twice. Leap years
  follow the calendar.
- Weeks run Monday to Sunday (ISO weeks) for every habit, whatever the calendar's display
  preference, so weekly numbers never change with a setting.
- Nothing is expanded into rows: whether a day is due is computed from the version in effect on
  that day.
- Changing a schedule adds a version from a date (today by default) and drops versions from that
  date on; earlier days keep theirs, so history never changes after the fact. A change dated on
  or before the start date replaces the whole history. Saving an edit with the same schedule
  adds nothing.

### Completion history

Logging a day upserts its entry: `completed` records the target (or a given value), `progress`
records a value toward it, `skipped` excuses the day. Undoing deletes the entry. Days after
today (in the habit's time zone) and outside the habit's dates are refused. A new entry stores
the habit's current target; editing an entry keeps the target it was logged with, so raising a
target later doesn't turn finished days into partial ones. An entry is _completed_ when its value
reaches its stored target, _partial_ when it's above zero but below it.

### Streak calculation rules

Everything below is derived on read from versions, pauses, and entries (`progress.py`).

- **Periods.** Fixed-day schedules have one period per due day: _met_ when completed, _skipped_
  when skipped, _pending_ while it's today and not met, otherwise _missed_ (a past partial day
  shows its progress but counts as missed). Weekly targets have one period per week, needing
  `min(times_per_week, tracked days in the week that weren't skipped)` completed days; a week
  shortened by the start date, end date, a pause, or skips asks for less, and one that needs
  nothing is skipped. The current week is pending until met. When a schedule changes mid-week
  under a weekly target, each part of the week is its own period.
- **Streaks** count consecutive met periods in the current schedule's unit: days for fixed-day
  schedules, weeks for weekly targets. Skipped periods and paused days neither break nor extend a
  streak, a missed period ends it, and a pending one (today, or this week) doesn't end it yet.
  Changing between a fixed-day schedule and a weekly target ends the run, because days and weeks
  can't be added; changes within one unit carry it on. The longest streak is the longest such
  run in the current unit.
- **Rates** are met periods over met plus missed. Skipped, pending, paused, and not-due days are
  never counted, so days off can't lower a rate; a range with nothing due has no rate (`null`),
  not 0%. Detail pages show all-time, last 7 days, and last 30 days.
- Days completed when not due are shown as extra and count toward total completions, not
  streaks.

### Routine execution model

- `routines` and `routine_steps`: name, description, icon, color, optional category, optional
  time of day, applicable weekdays (empty means every day), time zone, and status; steps are
  ordered, with an optional duration and optional links to a habit, task, or note. Step links
  are plain foreign keys that clear when the item is deleted; the service checks they're in the
  routine's workspace. The estimated duration is the sum of step durations.
- Editing replaces the ordered step list: steps sent with their ID are kept, new ones are added,
  and the rest are removed.
- `routine_sessions` and `routine_session_steps`: starting a session copies the steps, so editing
  or deleting steps later never changes past sessions. Each step is `pending`, `completed`, or
  `skipped`; the session is `active`, then `completed` or `abandoned`, with optional notes and a
  linked note. A partial unique index allows one active session per routine; a second start gets 409.
- Completing a step linked to a yes-or-no habit also completes that habit for the session's day,
  in the same transaction, unless the day is already logged. Other habit kinds and linked tasks
  are left for the user to update, since there's no single right value to record.

### Reminder and calendar integration

- **Reminders.** `habit_reminders` holds up to five times per habit or routine (unique per
  owner and time), each optionally limited to weekdays. Each manages one reminder through the
  existing reminder system (`reminders.habit_reminder_id`, link kind `habit_reminder`), exactly
  like calendar alerts: the habit or routine points it at its next due day that isn't done or
  skipped (for weekly targets, each day of a week until the week's target is met), at the
  reminder time in its time zone, re-pointing it in the same transaction as every change and
  logged day. The reminder worker delivers it as an in-app notification and calls back
  (`ManagedFollowUp`) to move it on. Pausing or archiving cancels it; removing a time deletes it.
  There is no second scheduler. Such reminders can't be edited through the reminders API (409).
- **Calendar.** `GET …/habits/calendar` returns habits and routines with a time of day on the
  days they're due, computed on read; no calendar event rows are created. Weekly targets have no
  fixed days, so they aren't shown. The calendar shows them with a dotted outline and a repeat
  mark, labels them "Habit" or "Routine", doesn't let them be dragged, and opens their page under
  Habits instead of event details. `calendar_preferences.show_habits` (on by default) turns them
  off.
- **Tasks and notes.** A habit can create a task (an ordinary task, linked) or link existing
  ones, and can create a reflection note (an ordinary note in the Inbox, linked). A routine
  session can create or link a note. Nothing is copied.

### Timezone behavior

Log entries are keyed by local date in the habit's time zone (defaulting to the user's
preference, else UTC). "Today" for logging, pending states, and reminders is today in that zone.
Changing a habit's time zone doesn't rewrite history: past entries keep their dates, and only
what counts as today moves. The Today view takes the viewer's time zone. Reminder times are wall
clock times in the habit's or routine's zone, converted to UTC one occurrence at a time, so they
keep their local time across daylight-saving changes.

### Habits API

Under `/workspaces/{workspace_id}`, all behind `WorkspaceDep`:

- `GET|POST /habits/categories`, `PATCH|DELETE /habits/categories/{id}`.
- `GET /habits?status=active|paused|archived|all`, `POST /habits`, `GET|PATCH|DELETE
/habits/{id}` (`PATCH` takes `schedule` with optional `schedule_from`, and `status` to pause,
  archive, or restore).
- `GET /habits/today?date=&timezone=`: every habit that isn't archived with its state, entry,
  period, streaks, and rates, this week's heatmap, and the next seven days' due habits.
- `GET /habits/{id}/history?start=&end=` (at most 366 days): each day's state and entry, and the
  periods.
- `PUT|DELETE /habits/{id}/log/{date}`: record or undo a day.
- `PUT /habits/{id}/reminders`: replace the reminder times.
- `POST /habits/{id}/tasks`, `PUT|DELETE /habits/{id}/tasks/{task_id}`; `POST
/habits/{id}/notes`, `PUT|DELETE /habits/{id}/notes/{note_id}`.
- `GET /habits/analytics?start=&end=&timezone=&category_id=` (at most 366 days): a heatmap,
  weekly and monthly trends, each habit's met, missed, completions, streaks, and trend (the
  rate's change between the range's halves), and rates by category.
- `GET /habits/calendar?start=&end=&timezone=` (`end` exclusive).
- `GET|POST /routines`, `GET|PATCH|DELETE /routines/{id}`, `PUT /routines/{id}/reminders`.
- `GET|POST /routines/{id}/sessions`, `GET|PATCH /routines/{id}/sessions/{session_id}` (finish,
  abandon, notes, linked note), `PATCH …/steps/{step_id}`, `POST …/note`.

Errors: 404 for anything outside the workspace, 422 for invalid fields, future days, or links to
items not in the workspace, and 409 for a second active session, an ended session, or a taken
category name. The OpenAPI document (`packages/contracts/openapi.json`) is the reference for
fields.

### Habits in the web app

- `/habits`, with views in the URL: Today (`/habits`), All habits, Routines, Analytics,
  Templates, and Archived (`?view=`), and detail pages (`?habit=`, `?routine=`). The views sit in
  a sticky side rail when the page is wide (`@5xl/habits`) and a row of chips below that, like
  Automation. One primary action, a New menu for a habit, a routine, or a template.
- Templates (`src/lib/habits/templates.ts`): ready-made habits by theme (health, mind, learning,
  home and money) and routines with their steps. Choosing one opens the New habit or New routine
  form filled in; nothing is saved until it's created. Templates whose name is already in use say
  so. Today's empty state offers three starters.
- Today groups habits into To do, Done, and others (skipped, resting, paused, or a weekly target
  already met), with one-tap check-offs that show at once and roll back on failure, inline
  progress for amounts and durations, skip and clear in a row menu, this week's dots, today's
  routines with Start or Continue, and the days ahead.
- A habit's page has its progress, streaks and rates, a six-month heatmap (not-due days drawn as
  outlines), recent entries, recording a past day, reminders, related tasks, reflections, and the
  schedule history. A routine's page runs the active session (complete, skip, or bring back
  steps; notes; finish or stop) and lists past sessions.
- Analytics: a date range and category filter, totals, a completion calendar, weekly and
  monthly consistency bars, what's going well and what could use attention, rates by category,
  and a table of every habit.
- Wording stays encouraging: missed days are "Not done", streaks are shown quietly, and there
  are no points or badges.
- Checking a habit off on Today pops its check, and a short toast with confetti cheers when the
  API reports the target met (`cheerFor`): a varied everyday cheer, a bigger one on streak
  milestones (3, 7, 14, 21, 30… days), and the biggest when the last habit of the day is done.
  Undoing or partial progress stays quiet. Reduced-motion settings drop the movement.
- Code: `src/api/habits`, `src/hooks/use-habits.ts`, `src/lib/habits`, `src/components/habits`.
  Query keys start `["workspaces", id, "habits", …]`; changes refetch habits, reminders, and the
  calendar.

### Habit limitations

- Weekly targets use Monday-to-Sunday weeks only; there are no monthly targets ("10 times a
  month") or "every other week" schedules.
- A habit's kind can't change after creation; delete and recreate it instead.
- Snoozing isn't supported, because the reminder system has none; notifications can be read or
  dismissed as usual. Reminders look about 400 days ahead (routines two weeks), at the worker's
  poll granularity.
- Calendar entries can't be dragged to reschedule; set the time on the habit or routine.
- Routine steps complete linked yes-or-no habits only, and never complete linked tasks.
- Streak and rate history is computed on read from the whole log. That's fast at personal scale
  (years of daily entries), but there's no cached summary.
- The opt-in PostgreSQL suite covers the habit and routine SQL through the services; the HTTP
  tests run on SQLite.

## Documents and the personal vault

Documents keep a workspace's important records: identity documents, payslips, tax papers,
policies, vehicle and property papers, medical records, certificates, receipts, and warranties.
A document is a record first and a file second: it can exist without a file, and its file can be
replaced while earlier versions are kept.

### Document data model

```text
workspaces ──< document_folders ──< document_folders     (parent_id, ON DELETE CASCADE)
     │               │
     ├──< document_categories                           (unique normalized name)
     │               │
     ├──< documents >┘ (folder_id, category_id: no ON DELETE; the service moves or clears first)
     │      ├──< document_versions                      (one per stored file; cascade)
     │      ├──< document_tags                          (free text, unique per document; cascade)
     │      ├──< document_renewals                      (dates before and after; cascade)
     │      ├──< document_links >── a note, task, event, transaction, loan, subscription or
     │      │                       bill, deposit, holding, or asset (both sides cascade)
     │      └──  reminders.document_id                  (one managed reminder; cascade)
```

Every relationship is a composite foreign key on `(id, workspace_id)`, so the database refuses a
folder, category, version, tag, renewal, or link that crosses workspaces. Migration
`0015_create_documents` creates the tables with RLS on PostgreSQL.

What belongs where:

| Logical document (`documents`)                                           | File version (`document_versions`)              |
| ------------------------------------------------------------------------ | ----------------------------------------------- |
| Title, description, folder, category, tags, favorite, archive, trash     | Version number (from 1; the highest is current) |
| Document number, issuer, provider, amount and currency, notes            | Original file name and extension                |
| Issue, effective, expiry, renewal, and review dates                      | Detected content type, size, SHA-256            |
| Up to 20 custom `{label, value}` details (category-specific information) | `blob_id`: the file's name in the store         |
| Reminder days (0 to 365 before, at most 6), time of day, time zone       | Upload time, an optional note, `restored_from`  |

- `documents` also copies the current version's file name, type, size, and upload time
  (`file_*`, `current_version_id`), updated in the same transaction as every version change, so
  lists sort and filter by them without a join. A CHECK keeps `current_version_id` and
  `file_size` set together.
- Archive and trash are timestamps. Trashed documents are read-only (409) and only they can be
  deleted permanently. Archived documents stay editable but their reminders stop.
- Custom details are text only; there are no typed per-category schemas. The web app shows the
  common fields for every document and lets people add their own.
- Default categories (Identity Documents, Employment, Salary & Payslips, Tax & Compliance,
  Banking, Insurance, Vehicle Documents, Property, Medical Records, Education & Certificates,
  Receipts & Invoices, Warranties, Travel, Other) are created the first time a workspace lists
  them; a concurrent first request resolves to one set. Categories are optional; deleting one
  leaves its documents unclassified.

### Folders

Folders nest up to 8 levels. The service walks the tree to refuse moving a folder into itself or
a subfolder; a CHECK forbids a folder being its own parent. Deleting a folder never deletes
documents (`?documents=`): `parent` moves its documents and subfolders up a level; `unfiled`
deletes its subfolders too and leaves every document inside without a folder; `folder` does the
same but moves them to `target_id`, which can't be inside the folder being deleted. Trashed and
archived documents move as well, because `documents.folder_id` has no `ON DELETE` action.

### Document storage

- **One file store.** Documents reuse the note attachments' store
  (`system/attachment_store.py`, `ORBIT_ATTACHMENTS_PATH/<workspace id>/<blob id>`): names on disk
  are server-generated UUIDs, never upload names; directories are `0700`, files `0600`; writes go
  to a `.partial` file and are renamed into place; blocking I/O runs in a worker thread. The
  service depends on a small `FileStore` protocol, so object storage could replace the folder
  later without changing it.
- **Upload order.** The body is read with the size limit enforced as it streams
  (`ORBIT_DOCUMENT_MAX_BYTES`, 25 MB by default), then the type is checked, then the file is
  written, then the metadata is saved. If saving fails, the transaction is rolled back and the
  file deleted, so no record points at a missing file and no file is left for nobody. An upload
  interrupted mid-body fails before anything is written.
- **Deduplication.** Within one document, restoring an earlier version or uploading bytes a
  version already has reuses that version's blob; re-uploading the current file under the same
  name is a no-op. Files are not shared across documents, so deleting one document can never
  remove another's file.
- **Deleting files.** Permanently deleting documents (one, or emptying the trash), deleting an
  earlier version, and deleting a workspace delete files after the metadata commits, and only
  blobs no remaining version references.
- **Orphan sweep.** Every six hours the reminder worker lists every blob ID the database
  references (note attachments and document versions) and deletes files in the store that none
  references, plus leftover `.partial` files, but only ones last modified more than an hour ago,
  so uploads in progress are safe. Names that aren't canonical UUIDs are never touched.

### File validation

- Accepted: PDF, JPEG, PNG, WebP, DOCX, XLSX, PPTX, TXT, and CSV. HTML, SVG, executables, and
  archives are refused (415). The extension chooses the type; the file's leading bytes must
  match it (`%PDF-`, PNG and JPEG signatures, `RIFF…WEBP`), Office files must be ZIP archives
  containing `word/document.xml`, `xl/workbook.xml`, or `ppt/presentation.xml` (read from the
  archive's directory only, so nothing is decompressed), and text files must not contain NUL
  bytes. The type the browser declared is ignored.
- The file name is reduced to its last path segment, stripped of control characters and leading
  dots, and capped at 255 characters (keeping the extension). It's shown and exported, never used
  as a path.
- The web app checks the extension and size before uploading (from `GET …/documents/settings`)
  to give an immediate message; the API checks again.

### Security and privacy

- **Authorization.** Every route takes `WorkspaceDep` first; repositories filter every query by
  that workspace. An ID from another workspace behaves like a missing one: 404 in the path, 422
  as a reference (a folder, category, or record to link).
- **Downloads.** Files are served only by `GET …/documents/{id}/file` and
  `…/versions/{version}/file`, which need the bearer token. There are no public, signed, or
  guessable URLs, and responses never contain storage paths or blob IDs. Downloads are always
  `Content-Disposition: attachment` with the detected type, `X-Content-Type-Options: nosniff`,
  `Content-Security-Policy: default-src 'none'; sandbox`, and `Cache-Control: private,
no-store`.
- **Previews** fetch the file with the token and show it from a local object URL created with the
  detected type, revoked when the preview closes. Only PDFs (the browser's PDF viewer in an
  iframe), PNG, JPEG, and WebP images (`<img>`), and TXT and CSV (as React text, first 100,000
  characters) are previewed; nothing uploaded is ever rendered as HTML, and SVG isn't accepted.
- **Sensitive fields.** Lists, search results, the overview, and reminders use
  `DocumentSummaryResponse`, which leaves out the document number, amount, notes, and custom
  details; only a single document's response includes them. Search never matches document
  numbers. Logs carry IDs and counts only; error messages never include file contents.
- **Local-first.** Files stay on the API's machine; nothing is sent to an external service.

### Encryption

Orbit does **not** encrypt documents at rest, and the vault is **not** end-to-end encrypted.
Files are protected by file permissions (`0600`), the API's authorization, and whatever disk
encryption the machine has (FileVault, BitLocker, LUKS), like the SQLite database.

Application-level encryption was evaluated and deferred. With the key on the same machine as the
files (an environment variable or a key file), it would protect only copies of the attachments
folder made without the key, while adding key generation, rotation (re-encrypting every file),
and recovery (a lost key loses every document) that need their own design, and a new dependency
(`cryptography`, for AES-GCM). Doing it properly means: authenticated encryption per file with a
random nonce, a key identifier on each version, keys outside the database and outside the
attachments folder, a documented rotation command, and exports decrypting through the API. Until
then, use full-disk encryption and treat backups and exports as sensitive.

### Versioning

Uploading to an existing document (`POST …/versions`) adds the next version and makes it
current; nothing is overwritten. `POST …/versions/{id}/restore` adds a new version that copies an
earlier one (sharing its file) and records `restored_from`, so restoring never loses a version.
`DELETE …/versions/{id}` removes an earlier version; the current one can't be deleted (422).
Concurrent uploads to one document race on the unique `(document_id, number)` and the loser
gets 409. There is no merging.

### Expiry tracking

- `expiry_status` is derived on read from the expiry date and today in the user's time zone:
  `none`, `expired` (before today), `expiring` (within 30 days), or `valid`.
- Views: expiring within 7, 30, or 90 days (`expires_within`), expired (`expired=true`), and
  renewals within 90 days (`renewal_within`). Documents with a review date ("check this every
  year") get review reminders.
- **Renewals** (`POST …/renew`) replace the expiry date (and optionally the issue and renewal
  dates) and record the old and new dates in `document_renewals`, so earlier expiry information
  is kept. The renewed copy is uploaded as a new version.

### Reminder integration

- Each document manages **at most one reminder** in the existing `reminders` table
  (`reminders.document_id`, unique, cascading; link kind `document`), delivered by the existing
  worker as an in-app notification. There is no second scheduler.
- For each tracked date (expiry, renewal, review) and reminder day, an alert falls at the
  reminder time (09:00 by default) on that day in the document's time zone (the user's when it
  was created). The reminder points at the **earliest alert still ahead**; alerts whose time has
  passed are never sent late. Titles say what and when ("Passport expires in 30 days"); the
  description carries only the date, never the document number.
- It is re-pointed in the same transaction as every change: creating, editing dates or reminder
  days, renewing, archiving or trashing (which removes it), and restoring. Permanent deletion
  removes it by cascade; delivered notifications stay.
- After it fires, the worker's `ManagedFollowUp` hands it to `DocumentReminders.after_delivery`,
  inside the delivery transaction, which points it at the next alert or removes it when none is
  left. The reminders API refuses to edit or delete it (409); the reminders page marks it
  "Managed in Documents", and its title links to the document.

### Cross-module links

`document_links` relates a document to existing records without copying them: a note, task,
calendar event, finance transaction (receipts, tax records), loan, subscription or bill
(insurance premiums), deposit, holding, or asset. One nullable column per kind, each a cascading
composite foreign key, and a CHECK that exactly one is set. Linking checks the record exists in
the workspace (422 otherwise) and is idempotent; deleting either side removes the link.

- The document's page lists its links with current titles, opening each where it lives, and
  links more through `GET …/documents/link-candidates?kind=&q=` (records of one kind, by title).
- Notes (details panel), tasks (edit dialog), calendar events (details), loans (expanded card),
  and transactions (edit dialog) show a **Documents** section: `GET …/documents?linked_kind=&
linked_id=`, open, link from the vault, unlink.

### Search and filters

`GET …/documents?q=` splits the search into words (at most eight); each must appear,
case-insensitively, in the title, description, current file name, issuer, provider, notes, a
tag, the category name, or the folder name: escaped `ILIKE`, the same approach as notes, on both
SQLite and PostgreSQL. File contents are never indexed (no OCR or text extraction).

Filters: state (`active`, `archived`, `trashed`, `any`), folder (optionally with subfolders) or
unfiled, category or unclassified, tag, file kind (`pdf`, `image`, `text`, `office`, `none`),
favorite, date added, expiry range or window, expired, renewal window, linked record. Sorts:
name, date added, last modified, recent (opened or modified), expiry date, file size, category.
`limit` (≤ 100) and `offset`; the web app pages by 50.

### Export and backup

`POST …/documents/export` with `document_ids`, a `folder_id` (with subfolders), a `category_id`,
or nothing (every document not in the trash), optionally `include_versions`, returns a ZIP built
in a private temporary file (deleted after it's sent):

```text
Orbit documents/
├── metadata.json                         every document's fields, tags, versions, checksums
├── <folder>/<subfolder>/<original name>  current files, in their folders
├── Unfiled/<original name>
└── …/<name> (versions)/v<n> <name>       earlier versions, when asked for
```

Original file names are kept; collisions in one folder get " (2)", and path segments are cleaned
so they can't escape the archive. Metadata-only documents appear in `metadata.json` only. The
export includes document numbers, since it's the owner's backup. Backups of a whole
installation copy the database and the attachments folder together
([development.md](development.md#backups)), or use a workspace backup, which includes the files
and can be restored (see [Backup, restore, and data portability](#backup-restore-and-data-portability)).

### Documents API

All routes are under `/api/v1/workspaces/{workspace_id}`, behind `WorkspaceDep`.

| Method                   | Path                                                                | Purpose                                                       |
| ------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------- |
| `GET`, `POST`            | `/documents`                                                        | List or search; create without a file                         |
| `POST`                   | `/documents/upload?filename=&title=&folder_id=&category_id=`        | Upload a file (raw body) as a new document                    |
| `GET`                    | `/documents/overview`, `/counts`, `/settings`, `/tags`              | Dashboard, counts per view, upload limits, tags               |
| `GET`                    | `/documents/link-candidates?kind=&q=`                               | Records that can be linked                                    |
| `POST`                   | `/documents/export`, `/documents/empty-trash`                       | ZIP export; delete every trashed document                     |
| `GET`, `PATCH`, `DELETE` | `/documents/{id}`                                                   | Detail (versions, renewals, links); update; delete if trashed |
| `POST`                   | `/documents/{id}/open`, `/trash`, `/restore`, `/renew`              | Record an open; trash; restore; renewal                       |
| `GET`                    | `/documents/{id}/file`, `/versions/{version}/file`                  | Download                                                      |
| `POST`                   | `/documents/{id}/versions?filename=&note=`                          | Upload a new version                                          |
| `POST`, `DELETE`         | `/documents/{id}/versions/{version}/restore`, `/versions/{version}` | Restore; delete an earlier version                            |
| `PUT`, `DELETE`          | `/documents/{id}/links/{kind}/{record}`                             | Link; unlink                                                  |
| `GET`, `POST`            | `/document-folders`                                                 | Folders with counts (flat); create                            |
| `PATCH`, `DELETE`        | `/document-folders/{id}`                                            | Rename or move; delete with `?documents=`                     |
| `GET`, `POST`            | `/document-categories`                                              | Categories with counts (defaults created first); create       |
| `PATCH`, `DELETE`        | `/document-categories/{id}`                                         | Rename or change icon; delete                                 |

Errors: 404 for anything outside the workspace, 413 for files over the limit, 415 for refused
types, 422 for invalid fields, references, or moves, and 409 for trashed documents, a taken
category name, or a concurrent version upload. Request models forbid unknown fields. The OpenAPI
document is the reference for fields.

### Documents in the web app

- `/documents` (`components/documents/`), with the view, folder, category, tag, search, file
  kind, expiry window, and open document in the URL. A rail (Overview, All documents, Recent,
  Favorites, Expiring soon, Expired, Renewals, Archived, Trash with counts; the folder tree with
  expand, collapse, and folder actions; categories; tags) beside the main column (behind
  **Browse** on narrower screens).
- **Overview**: totals and storage used, expiring in 30 days, expired, renewals, then expiring
  and expired documents, recently added and modified, favorites, and documents by category.
- **Library**: search, file type, sort, list or grid, per-document menu (download, favorite,
  move, archive, trash; restore and delete forever in the Trash, after confirming), selection
  with Export, pagination, and empty, loading, and error states.
- **Upload**: one primary **Add** menu (upload files, or a record without a file), multiple
  files from the picker or dropped on the library, each uploaded in turn with its own status
  (waiting, uploading, uploaded, or the reason it failed, with Retry). Progress is per file;
  `fetch` doesn't report bytes sent.
- **Document page**: preview, version history (download, make current, delete), organize
  (category, folder, tags), the details form (React Hook Form and Yup; amounts with
  `AmountField`), expiry dates and reminder days with the next reminder's time, linked records,
  and renewal history; header actions download, replace the file, renew, archive, and trash.
- **Command palette**: Upload document, Search documents for …, matching documents as you type,
  recent documents, expiring and expired documents, and categories.
- Code: `src/api/documents`, `src/hooks/use-documents.ts`, `src/hooks/use-document-commands.ts`,
  `src/lib/documents`, `src/components/documents`; folder trees are shared with notes in
  `src/utils/folders`. Query keys start `["workspaces", id, "documents", …]`; changes refresh
  documents and reminders.

### Document limitations

- No encryption at rest by Orbit (see [Encryption](#encryption)), no OCR or content search, no
  AI extraction, no import of exports, no sharing.
- Files live on one machine; several API instances need a shared volume. No object storage.
- Uploads are read into memory up to the limit (25 MB by default, 200 MB at most).
- Previews load the whole file; Office files can't be previewed. PDF previews rely on the
  browser's viewer.
- Custom details are untyped text. Reminder times use the document's stored time zone, which
  doesn't follow later changes to the user's time zone.
- Deduplication is within one document only.
- Exports are built on the API's disk before being sent; very large exports need the space.
- The opt-in PostgreSQL suite covers the document SQL through the service; the HTTP tests run on
  SQLite.

## Health and fitness

A personal wellness tracker: workouts, an exercise library and templates, body measurements and
progress photos, nutrition and water, activity, and fitness goals. It isn't a medical
application: nothing is diagnosed, prescribed, recommended by AI, imported from devices, or sent
to another service. Code: `services/fitness/` (`records.py` and `calculations.py` hold the rules
as pure functions; `service.py` covers the profile, library, and templates; `workouts.py`,
`body.py`, `nutrition.py`, `tracking.py`, and `integrations.py` the rest; `overview.py` the
dashboard), `repositories/fitness.py`, `api/v1/fitness.py`, migration `0016_create_fitness`. The
module is called `fitness` in code because `health` already names the health-check endpoints; the
web page is **Health** (`/health`).

### Health data privacy

- **Private to its owner.** Every top-level row carries the owner's `user_id` as well as its
  `workspace_id`, and the repository filters every query by both (`Owner` in the services). Today
  a workspace has one member, but if workspaces are ever shared, health records stay private to
  whoever recorded them. Another person's record behaves like a missing one: 404.
- Routes take `WorkspaceDep` first, then build the owner from the signed-in user; IDs in bodies
  are only references, checked against the owner's records (422 when they aren't theirs).
- Little is collected: height and date of birth are optional, and nothing is computed from the
  date of birth. Body fat is stored only when the person measured it.
- **Progress photos** use the attachment store (no second file store): server-generated names,
  `0700`/`0600` permissions, written before the metadata and deleted if saving fails, and kept by
  the worker's orphan sweep (`referenced_photo_blob_ids`). Only PNG, JPEG, and WebP whose bytes
  match the extension are accepted (415 otherwise), up to `ORBIT_ATTACHMENT_MAX_BYTES`. They're
  served only by `GET …/fitness/photos/{id}/file` with the owner's token, as downloads with
  `nosniff`, a sandboxing CSP, and `private, no-store`; there are no public or signed URLs, and
  responses never include blob IDs. The web app shows them through object URLs.
- Health data isn't encrypted by Orbit beyond the database and the disk (see
  [Encryption](#encryption)), and appears in no notification text.

### Measurement units

The API stores and exchanges **integers in canonical units**, named by their suffix, so nothing
accumulates floating-point error: grams (`_g`) for body and lifted weight, millimetres (`_mm`)
for height and circumferences, metres (`_m`) for distances, seconds (`_s`), millilitres (`_ml`),
milligrams (`_mg`) for nutrients, small calories (`_cal`; 1 kcal = 1,000 cal) for energy, and
thousandths (`_milli`) for serving quantities. Body fat is a percentage to one decimal and effort
(RPE) 1 to 10 in halves.

The profile holds the person's units (kg or lb, cm or in, km or mi, kcal or kJ, ml, L, or US
fl oz; metric or imperial presets). The web app (`lib/fitness/units.ts`) converts at the edges
with exact factors (1 lb = 453.59237 g, 1 in = 25.4 mm, 1 mi = 1,609.344 m, 1 kcal = 4.184 kJ,
1 fl oz = 29.5735295625 ml), rounding input to the nearest canonical unit and display to a few
decimals, so a typed 225 lb is stored as 102,058 g and shown as 225 lb again. Changing units
never rewrites data.

### Workout data model

```text
fitness_exercises (library: built-ins created per person on first use, plus custom)
fitness_templates ──< fitness_template_exercises >── fitness_exercises   (ordered; defaults)
fitness_sessions  ──< fitness_session_exercises  (snapshot of the exercise) ──< fitness_sets
      │                       └── exercise_id: plain FK, SET NULL
      ├── template_id, calendar_event_id: plain FKs, SET NULL
      └── at most one unfinished (active or paused) per person: partial unique index
```

- **Exercises** have a category (strength, cardio, bodyweight, mobility, flexibility, other),
  equipment, primary and secondary muscles, instructions, and a type that decides what a set
  records: weight and reps, reps, time, or distance and time. About 55 built-ins (no images) are
  created per person the first time the library is read (`builtin_key`, unique; a concurrent
  first request resolves to one set). Built-ins can be archived but not edited or deleted;
  custom exercises can be edited, archived, or deleted while no template or workout uses them
  (409, "archive it instead").
- **Templates** hold ordered exercises with default sets, a rep range, a target weight, and
  rest. Editing replaces the list; duplicate, archive, and delete are available.
- **Sessions** record the day (local date), time zone, start, end, time paused, duration, status
  (`active`, `paused`, `completed`, `abandoned`), notes, and the template or calendar event they
  came from. Every set change is saved as it's made, so a refresh or a closed app never loses a
  workout in progress (`GET …/sessions/active`).
- **Exercise history snapshots.** Adding an exercise to a workout copies its name, type,
  category, and primary muscles into `fitness_session_exercises`; starting from a template copies
  the template's exercises and targets into sets. History, records, and analytics read the
  copies, so renaming, retyping, or archiving an exercise, or editing a template, never changes a
  past workout. A deleted custom exercise leaves its workouts intact (`exercise_id` becomes null).
- **Sets** have a type (warm-up, working, drop, failure), reps, weight, duration, distance, RPE,
  and a completed flag with its time. A new set without values copies the previous set (not yet
  done). The rest timer counts down from the last completed set's time and the exercise's rest
  (90 seconds by default), so it survives a refresh.
- **Duration** is end minus start minus time paused. Ended workouts can be renamed, annotated, and
  have their times corrected; the duration follows. A finished workout can also be logged after
  the fact (`POST …/sessions/log`), with its sets done.

### Workout calculations

`services/fitness/records.py`; formulas are the same everywhere.

- Only **completed** sets count, and **warm-up sets never count**; working, drop, and failure sets
  do. Abandoned and unfinished workouts count toward nothing.
- **Volume** is reps × weight summed over counted sets (gram-reps, shown in kg or lb). Only
  weight-and-reps exercises have volume; bodyweight, timed, and distance exercises don't, because
  their load isn't recorded.
- **Estimated one-rep max** uses the Epley formula, weight × (1 + reps / 30), only for sets of 1
  to 10 reps (a single is the weight itself), and is always marked as an estimate.
- **Personal records** depend on the exercise type recorded with the workout: weight and reps give
  heaviest weight (ties broken by more reps), most reps (ties by more weight), estimated 1RM, and
  best set volume; reps give most reps; time gives longest time; distance and time give longest
  distance and longest time. No strength figures are computed for exercises they don't apply to.
  The first workout to reach a value holds the record.
- **Analytics** for a range of up to two years: workouts, time, volume, workouts and volume per
  ISO week and per month, completed sets per primary muscle, weeks with a workout over all weeks,
  and the streak of consecutive weeks with a workout (the current week doesn't break it while
  it's still going).
- **Previous performance**: each exercise in a workout shows the sets from the most recent earlier
  completed workout with the same exercise.

### Body measurements

`fitness_measurements` are dated entries with any subset of weight, body fat, height, and waist,
chest, hips, arm, thigh, and neck circumferences (at least one; CHECKs keep values plausible).
Corrections replace an entry; deleting removes one; every other entry stays as history. **BMI**
is weight (kg) / height (m)², to one decimal, from the latest weight and the latest height (a
measurement's, else the profile's), and only when both are plausible; it's labelled as a general
measure that doesn't account for muscle, frame, age, or sex. No body-fat figure is ever estimated.

### Nutrition calculations

- **Foods** hold nutrients (energy, protein, carbohydrates, fat, optional fiber) for one serving
  of a given quantity and unit (100 g, 1 slice). There's no food database; everything is entered
  by hand.
- **Food entries** are a portion on a date and meal (breakfast, lunch, dinner, snacks, other):
  either a saved food, whose nutrients are scaled by quantity / serving quantity with integer
  round-half-up to the canonical unit, or typed-in nutrients for the whole quantity. Entries copy
  their nutrients, so editing or deleting a food never changes what was logged. Logging a saved
  food counts it as used ("frequent foods" sort by use).
- **Saved meals** are named lists of portions; logging one adds an entry per item. The web app
  saves a day's meal as one.
- **Daily totals** are exact integer sums, per meal and for the day, beside the profile's targets.
- **Water** is its own log in millilitres with a daily target, quick-add amounts, and history.
  Food entries never count as water.

### Activity

`fitness_activities` are entries recorded by hand (`source = manual`; a later import would use
another value): steps, walks, runs, rides, swims, and other cardio (distance and/or time), sleep
(time), and rest days (no values). A CHECK ties values to the kind. Nothing is estimated.

### Goal tracking

- **Goals** (`fitness_goals`) have a category (body weight, strength, workouts per week, running
  distance, running time, daily energy, daily water, or custom with its own unit), start and
  target values in canonical units, start and optional target dates, a status (`active`,
  `paused`, `completed`), and optional links to an exercise and a habit. Reaching the target
  doesn't complete a goal; the person does. Paused and completed goals can be resumed or reopened.
- **Progress** comes from manual check-ins (`fitness_goal_progress`), except under an explicit,
  opt-in rule (`auto_track`): body-weight goals read weight measurements from the start date, and
  strength goals read the linked exercise's heaviest counted set per completed workout from the
  start date (the current value is the best so far). Auto-tracked goals refuse manual check-ins
  (409). Nothing else updates a goal.
- **Calculations** (`calculations.py`): the fraction is (current − start) / (target − start),
  clamped to 0–1, so losing and gaining both work. Milestones sit at 25, 50, 75, and 100 percent,
  each with the first check-in that reached it and, with a target date, when a straight line from
  the start puts it. Pace compares progress with that line: ahead or behind by more than 5
  points, else on track; or reached, or no target date.

### Integration behavior

- **Habits.** A habit can be linked (`fitness_habit_links`, one per habit) to workouts, water, or
  one kind of activity. Only with **Count toward the habit** on (off by default) does saving such
  a record record progress on the habit, through `HabitService.contribute` in the same
  transaction: a yes-or-no habit is completed by a completed workout, by reaching the water target
  (any water without one), or by an entry of that activity; duration habits get the minutes;
  amount habits get the number of workouts, the water total in the profile's unit, the steps, the
  distance in km or mi, sleep hours, or cardio minutes. Contributions only raise a day: a skipped
  day, a completed one, or one with as much progress is left alone, nothing is lowered or removed
  (deleting a record keeps the habit's day), and the habit log's one entry per day means nothing
  is counted twice. Completing a habit never creates a health record.
- **Calendar and reminders.** Scheduling a workout (`POST …/fitness/schedule`) creates an ordinary
  calendar event through `CalendarService` (its alerts are managed reminders delivered by the
  existing worker) and links it in `fitness_workout_events` (keyed by event, so never twice); an
  existing event can be marked as a workout instead (`PUT …/schedule/{event}`), so there's no
  second event. Workouts started from the event record it. The calendar's event details show a
  **Workout** section (start, open the workouts started from it, mark or unmark), and the Health
  overview lists today's scheduled workouts. Deleting the event removes the link and keeps the
  workouts.
- **Notes and documents.** `fitness_links` relates notes and documents to workouts and goals
  (composite foreign keys, cascading on both sides; trashed records can't be linked). A workout
  can create a training note (an ordinary note in the Inbox, linked). The records stay in Notes
  and Documents.

### Health and fitness API

All under `/api/v1/workspaces/{workspace_id}/fitness`, behind `WorkspaceDep`, acting as the
signed-in person.

| Method                         | Path                                                       | Purpose                                            |
| ------------------------------ | ---------------------------------------------------------- | -------------------------------------------------- |
| `GET`                          | `/overview?date=&timezone=`                                | Dashboard sections                                 |
| `GET`, `PUT`                   | `/profile`                                                 | Units, height, targets, quick amounts, sections    |
| `GET`, `POST`                  | `/exercises`                                               | Library (built-ins on first read); create          |
| `GET`, `PUT`, `DELETE`         | `/exercises/{id}`                                          | Get; edit custom; delete unused custom             |
| `POST`, `GET`                  | `/exercises/{id}/archive`, `/exercises/{id}/history`       | Archive or restore; history and records            |
| `GET`, `POST`                  | `/templates`                                               | List; create                                       |
| `GET`, `PUT`, `DELETE`         | `/templates/{id}`                                          | Get; replace; delete                               |
| `POST`                         | `/templates/{id}/duplicate`, `/templates/{id}/archive`     | Duplicate; archive or restore                      |
| `GET`, `POST`                  | `/sessions`, `/sessions/log`, `/sessions/active`           | History; start (409 if one is unfinished); log     |
| `GET`, `PATCH`, `DELETE`       | `/sessions/{id}`                                           | Detail; rename, notes, times; delete               |
| `POST`                         | `/sessions/{id}/pause`, `/resume`, `/complete`, `/abandon` | Status changes                                     |
| `POST`, `PATCH`, `DELETE`      | `/sessions/{id}/exercises`, `/sessions/{id}/exercises/{e}` | Add; rest and notes; remove                        |
| `PUT`                          | `/sessions/{id}/order`                                     | Reorder exercises                                  |
| `POST`, `PUT`, `DELETE`        | `/sessions/{id}/exercises/{e}/sets`, `…/sets/{set}`        | Add (copies the last without values); save; remove |
| `POST`, `PUT`, `DELETE`        | `/sessions/{id}/note`, `/sessions/{id}/links/{kind}/{id}`  | Training note; link or unlink a note or document   |
| `GET`                          | `/records`, `/analytics?start=&end=&date=`                 | Personal records; analytics                        |
| `GET`, `POST`                  | `/measurements`                                            | History with BMI; record                           |
| `PUT`, `DELETE`                | `/measurements/{id}`                                       | Correct; delete                                    |
| `GET`, `POST`                  | `/photos`, `/photos?filename=&day=&note=` (raw body)       | List; upload                                       |
| `GET`, `DELETE`                | `/photos/{id}/file`, `/photos/{id}`                        | Download; delete                                   |
| `GET`, `POST`, `PUT`, `DELETE` | `/foods`, `/foods/{id}`, `/meals`, `/meals/{id}`           | Saved foods and meals                              |
| `POST`                         | `/meals/{id}/log`                                          | Log a saved meal                                   |
| `GET`                          | `/nutrition?date=`, `/nutrition/history?start=&end=`       | A day's entries and totals; daily totals           |
| `POST`, `PUT`, `DELETE`        | `/food-entries`, `/food-entries/{id}`                      | Log, edit, delete food                             |
| `GET`, `POST`, `DELETE`        | `/water?date=`, `/water/history`, `/water`, `/water/{id}`  | Water day and history; add; remove                 |
| `GET`, `POST`, `PUT`, `DELETE` | `/activities`, `/activities/{id}`                          | Activity entries                                   |
| `GET`, `POST`, `PUT`, `DELETE` | `/goals?date=`, `/goals/{id}?date=`                        | Goals with progress                                |
| `POST`, `DELETE`               | `/goals/{id}/status`, `/goals/{id}/check-ins[/{id}]`       | Status; check-ins                                  |
| `PUT`, `DELETE`                | `/goals/{id}/links/{kind}/{id}`                            | Link a note or document                            |
| `GET`, `PUT`, `DELETE`         | `/habit-links`, `/habit-links/{habit}`                     | Habit links                                        |
| `GET`, `POST`                  | `/schedule?start=&end=`, `/schedule`                       | Scheduled workouts; schedule one                   |
| `GET`, `PUT`, `DELETE`         | `/schedule/{event}`                                        | The workout an event schedules; mark; unmark       |

Errors: 404 for anything that isn't the person's, 422 for invalid values or references, 409 for a
second unfinished workout, an ended workout's status change, a built-in or used exercise, or a
check-in on an auto-tracked goal, 413 and 415 for photos. Request models forbid unknown fields.
The OpenAPI document is the reference for fields.

### Health in the web app

- `/health` (`components/fitness/`), with views in the URL (`?view=` overview, workouts,
  exercises, templates, body, nutrition, water, activity, goals, progress, settings) and detail
  pages (`?workout=`, `?exercise=`, `?goal=`). Like Habits, a sticky side rail from `@5xl/health`
  (chips below that) groups the views: Today; Train (Workouts, Templates, Exercises); Track daily
  (Food, Water, Body, Activity, each marked optional); Review (Goals, Progress); and Settings.
  Each view opens with a one-line hint of what it's for (`FITNESS_VIEW_HINTS`).
- **Today** (overview): a three-step getting-started card until the first workout; today's
  workout (in progress, scheduled, or done, with one-tap starts for up to four templates); food
  and water against targets (water quick-add); weight trend; active goals; recent workouts and
  activity; and the latest records. Its **Log** menu starts a workout (the first template) or logs
  a past workout, food, water, measurements, or activity. Sections can be hidden in Settings.
- **Workouts**: a start card per template plus an empty workout (or a link to the starter
  templates when there are none), hidden while a workout is in progress; history by month.
- **Workout logger** (mobile-first): a header that sticks below the mobile app bar, with the
  elapsed clock, sets done, Finish, Pause or Resume, a rest countdown, and a menu to stop early or
  delete; each exercise shows last time's sets, then one row per set with large inputs in the
  person's units (saved when a field loses focus), last time's matching set (tap to copy it, on
  wider screens), and a check to mark it done; add a set (copying the last), set types, rest time,
  reorder, remove, add exercises from a searchable picker, notes, training notes, and linked
  documents.
- **Starter templates** (`src/lib/fitness/starter-templates.ts`): nine ready-made plans (full
  body, home bodyweight, push/pull/legs, upper/lower, cardio, mobility) listed by built-in
  exercise key. Adding one saves an ordinary template with the person's copies of those
  exercises, matched by the exercise response's `builtin_key` (archived ones are skipped).
- **Exercises** (search, category and equipment filters, archived, custom exercises, and each
  exercise's records, estimated 1RM chart, and history), **Templates** (ordered editor, start,
  duplicate, archive, schedule on the calendar with a reminder), **Body** (measurements, weight
  trend, BMI with its caveat, progress photos with side-by-side comparison), **Food** (a day
  by meal, totals and targets, saved foods and meals, 14-day history), **Water**, **Activity**,
  **Goals** (progress, pace, milestones, check-ins, related habit, notes and documents),
  **Progress** (analytics and records), and **Settings** (units, height, targets, quick amounts,
  overview sections, and linked habits).
- Charts are small SVGs with the same values in a visually hidden table.
- Code: `src/api/fitness`, `src/hooks/use-fitness.ts`, `src/lib/fitness` (units, display, forms),
  `src/components/fitness`. Query keys start `["workspaces", id, "fitness", …]`; every change
  refetches the module (records affect each other) plus habits, the calendar, reminders, or notes
  when it touches them. A saved workout is written into the cache at once.

### Health limitations

- No external integrations (Apple Health, Google Fit, wearables, food databases, barcodes), no
  AI recommendations, and no medical features.
- Contributions to habits apply to records saved after the link is turned on; they never lower a
  day, so deleting a workout leaves its habit day done.
- Goals track themselves only for body weight and strength; other kinds use check-ins.
  Workouts-per-week goals don't count workouts automatically.
- The rest timer runs in the browser; there's no notification when it ends.
- Exercises have no images or videos; muscle groups use a fixed list.
- Progress photos share the attachment limit (`ORBIT_ATTACHMENT_MAX_BYTES`) and aren't resized.
- Documents don't show the workouts and goals linked to them; the link is visible from Health.
- Records and analytics are computed on read from every completed workout; fast at personal
  scale, with no cached summaries.
- The opt-in PostgreSQL suite covers the fitness SQL through the services; the HTTP tests run on
  SQLite.

## Daily dashboard and command center

The dashboard (`/`) is the landing page: one place to see and act on today across every
module. It owns no data. Each widget reads its module's own API and changes records through
that module's own mutations, so there is one source of truth and one set of rules per record.

### Aggregation architecture

```text
Dashboard grid (apps/web, components/dashboard/)
 ├─ Today, Needs attention ─► GET …/dashboard/today ─► DailyOverviewService
 │                                                      ├─ TaskService.summarize / find
 │                                                      ├─ CalendarService.range / agenda
 │                                                      ├─ ReminderService.upcoming
 │                                                      ├─ HabitService.today
 │                                                      ├─ DocumentService.counts / find
 │                                                      └─ CommitmentService.payments
 ├─ Agenda, Tasks, Habits, Notes, Documents, Finance, Health widgets
 │     └─ each module's existing endpoints (tasks list, calendar range, habits today, …)
 └─ Quick actions ─► QuickActionsProvider ─► each module's own dialog and mutation
```

- **One lightweight aggregate, everything else reused.** Only the daily overview needed a new
  endpoint: `GET /api/v1/workspaces/{workspace_id}/dashboard/today`
  (`services/dashboard/today.py`). It depends on small protocols that the modules' existing
  services already satisfy, and asks each for a bounded slice: counts, and at most five items.
  It recomputes nothing a module already decides (overdue, habit states, expiry, payment
  status); habits' "still to do" rule (`habit_is_remaining`) mirrors the web's `isRemaining`.
- **Sections fail on their own.** Each section (`tasks`, `events`, `reminders`, `habits`,
  `documents`, `payments`) loads inside a deliberate boundary: an exception is logged with its
  traceback, the request's session is rolled back (so a failed statement can't poison the next
  section on PostgreSQL), and the section is returned as `null` and listed in `unavailable`.
  The rest of the overview still answers with 200.
- **Sequential on the server, parallel in the browser.** Sections share the request's
  `AsyncSession`, which can't run concurrent queries, so they run one after another (a handful
  of indexed or bounded queries each). Parallelism comes from the browser: every widget is its
  own TanStack Query, fetched concurrently, and widgets that need the same data share one
  cached request (Today and Needs attention share the overview; the five health widgets share
  the Health overview).
- **Time zones.** "Today" is the user's date: the `timezone` parameter, else the profile's
  time zone, else UTC. Overdue tasks are due before that date; reminders are pending when their
  next occurrence is before the next local midnight; the next appointment is the first timed
  occurrence that hasn't started, within 7 days. The web passes the viewer's zone (the profile
  preference, else the browser's) everywhere, so the overview and the widgets agree.
- **Storage modes.** The overview and search only call existing services, so they run
  unchanged on SQLite and PostgreSQL.
- **Small additions to modules, not copies.** Tasks gained `due_from` and `due_to` filters and a
  `completed_at` sort (for Today, Upcoming, and Completed); habits gained
  `HabitService.search`; the calendar widget's in-place event dialog is exported
  (`NewEventDialog`) for quick actions; `useDocumentOverview` accepts a missing workspace.

### Widget data contracts

`TodayOverviewResponse` has `date`, `timezone`, `generated_at`, one object per section, and
`unavailable`. `section=` (repeatable) loads only some sections.

| Section     | Fields                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------- |
| `tasks`     | `open`, `overdue`, `due_today`, and up to 5 `overdue_items` and `due_today_items` (tasks) |
| `events`    | `today` (non-cancelled occurrences, all-day first) and `next` (an occurrence or `null`)   |
| `reminders` | `pending` (counted over the soonest 50) and up to 5 items: id, title, time, task          |
| `habits`    | `remaining`, `done`, `total`                                                              |
| `documents` | `expired`, `expiring` (30 days), and up to 5 items with only id, title, and expiry date   |
| `payments`  | `overdue`, `due_soon` (7 days), and up to 5 items: kind, name, due date, status           |

Payments carry no amounts, documents no metadata beyond the expiry date, and the overview has
no health data.

The other widgets use existing contracts: tasks lists and summaries, calendar ranges and
agenda, habits today and routines, notes lists, the documents overview and list, finance
accounts, monthly summary, payments, budgets, savings goals, and net worth, and the Health
overview and profile.

| Widget          | Data                                                              | Interactions                                                          |
| --------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------- |
| Today           | Daily overview                                                    | Links to each module; refresh                                         |
| Quick actions   | Routines (for the routine menu)                                   | Task, note, event, reminder, expense, workout, water, routine, upload |
| Agenda          | Calendar range (today) and agenda                                 | Open an event or task; create an event in place                       |
| Tasks           | One small task list per tab: Today, Priority, Upcoming, Completed | Add (due today from Today), complete, reopen, change priority, open   |
| Habits          | Habits today, routines                                            | Check in, record amounts, skip, undo; start or continue a routine     |
| Needs attention | Daily overview                                                    | Each item opens its module                                            |
| Notes           | Notes list (recent, pinned, favorites), latest journal            | Quick note; open or write today's journal; open a note                |
| Documents       | Documents overview; recent list on demand                         | Upload; open a document                                               |
| Finance (5)     | Existing finance widgets, plus savings goals                      | Open the matching Finance view                                        |
| Health (5)      | Health overview and profile                                       | Start or continue a workout, add water, open nutrition and body       |

### Widget loading strategy

- Each widget renders its own loading, error (with Try again), empty, and success states
  (`WidgetBody`), so a failing module shows one card's error and nothing else.
- Widgets removed from the layout are not rendered, so they make no requests. Tabs load only
  the selected tab's list.
- Query keys start with `["workspaces", workspaceId, …]`, so data is never shared across
  workspaces, and the cache is cleared when the user changes.
- **Invalidation.** Module mutations already refresh their own data. The overview and search
  summarize other modules, so the query client marks them stale after every successful
  mutation (`isSummaryQueryKey` in `api/query-client.ts`; dashboard layout saves are skipped).
  Only those on screen refetch.
- **No aggressive polling.** The overview refreshes every 5 minutes while the tab is visible,
  so "today" and "overdue" roll over past midnight; Today has a manual refresh button.
  Everything else uses the default 30-second stale time.

### Customization model

- The layout is one row per user in `dashboard_layouts`: an ordered JSON list of `{ id, size }`
  widgets, plus `density` (`comfortable` or `compact`) and `hide_amounts`. It holds no workspace
  data and is never shared with other users, so the same arrangement follows the user across
  workspaces, browsers, and devices.
  - `GET /api/v1/me/dashboard` returns it, or 204 when the user hasn't arranged their
    dashboard. `PUT` replaces it (`density` and `hide_amounts` default to `comfortable` and
    `false`); `DELETE` resets to the default. Widget IDs and sizes are enums in the contract
    (`DashboardWidgetId`, `DashboardWidgetSize`, `DashboardDensity`). Unknown fields, unknown
    widgets, repeats, and bad preferences are rejected (422). On read, stored widgets this
    version doesn't know are skipped, so retiring a widget can't break the response.
  - The web app (`hooks/use-dashboard-layout.ts`) caches the layout and preferences in
    `localStorage` (`orbit:dashboard:<user id>`, validated on read) so the page shows them
    before the API answers. The account copy (a TanStack Query, `["me", "dashboard"]`) wins when
    it loads, unless the user has already changed something. A layout cached before the account
    had one is uploaded once. Changes show at once and save in order, one request at a time (a
    shared mutation scope); a change overtaken by a newer one is skipped, since each save sends
    the whole layout. A failed save keeps the change in this browser and offers a retry.
- **Customize** adds (grouped: Today, Plan and track, Money, Health, Orbit), removes, reorders
  (move earlier/later buttons, so it works from the keyboard), and resizes widgets (narrow or
  wide), sets the density, hides amounts, and resets to the default. Changes are announced
  through a polite status region, and focus is kept on the control.
- **Defaults** (`lib/dashboard/dashboard.ts`, `defaultVisible`): Today, Quick actions, Agenda,
  Tasks, Habits, Needs attention, Notes, Documents, This month, and Budget. Health widgets,
  net worth, upcoming payments, savings goals, reminders, shopping, and the Orbit widgets are
  opt-in. Users with a saved layout keep it.
- **Layout.** The page is a container (`@container/dashboard`): one column on phones (Today,
  Quick actions, Agenda, and Tasks come first), two from `@3xl`, three from `110rem`. Narrow
  widgets take one column, wide ones the whole row. Compact density tightens the grid gap and,
  through one unlayered rule in `styles/utilities.css`, the shared card padding.
- There is no free-form drag-and-drop builder or per-widget settings; a side panel layout is not
  built (the grid's third column serves very wide screens).

### Global command center

The command palette (Cmd/Ctrl+K, `components/command-palette/`) now covers:

- **Navigation:** every module (from `lib/navigation`), today's calendar and its views, Notes
  views and folders, document views and categories, and the theme.
- **Creation:** Create task, Create reminder, Record expense, Log workout, Record water, and
  Start a routine (the "Create" group, through quick actions), alongside the existing New note,
  Quick note, today's journal, Create event, meeting notes, and Upload document commands.
- **Search:** as you type, after a 200 ms pause, one request to
  [universal search](#universal-search) (8 best hits); results are grouped by module (Matching
  tasks, notes, events, reminders, finance records, habits and routines, documents, health
  records), each opening the record in its module, plus "See all results" for the search page.
  With an empty field the palette offers recent searches. While a search runs the palette says
  "Searching…"; a failed search shows a notice and leaves pages and actions working. Arrow keys,
  Enter, and Escape work as before. (Phase 10's grouped `…/search` endpoint is kept for the AI
  layer's keyword retrieval; the palette no longer calls it.)

**Quick actions** (`components/quick-actions/quick-actions.tsx`, mounted in the app shell)
are the one way both the dashboard and the palette create things: the Tasks quick-entry bar in a
small dialog, the calendar's event dialog, the reminder dialog, the Finance transaction dialog
(for an expense), quick capture, starting an empty workout, adding the person's first quick
water amount, and the vault's upload. Nothing is created by new code paths.

### Search composition

`GET /api/v1/workspaces/{workspace_id}/search?q=&limit=&module=` (`services/search/`) runs each
module's existing case-insensitive substring search, one after another on the request's
session, and returns one group per module in a fixed order (`tasks`, `notes`, `events`,
`documents`, `habits`, `transactions`), each with up to `limit` hits (default 5, at most 10)
and the module's total. `q` must be 2 to 200 characters. A module that fails is logged, rolled
back, and returned with `unavailable: true`. There is no index, no ranking across modules, and
no semantic search; the AI layer adds hybrid semantic search as a separate endpoint
(`…/ai/search`) that reuses this one for its keyword half.

What each module matches is what it already matched: task titles and descriptions; note words
in titles, text, tags, and folder names; event titles, descriptions, and places; document
titles, descriptions, file names, issuers, providers, notes, tags, categories, and folders
(never reference numbers or file contents); habit names; transaction descriptions and notes.

### Privacy and authorization

- Both new endpoints are workspace-scoped through `WorkspaceDep`: another user's workspace is
  `404 Workspace not found.`, and every module call receives the authorized workspace ID.
  Isolation is tested for the overview, search, and the per-user layout.
- **Health data** is personal: the health widgets are opt-in and read the Health overview,
  which the API scopes to the signed-in person, so shared workspaces in future wouldn't show one
  person's health to another. Health records are not searched and not in the daily overview.
- **Finance:** the overview and search carry no amounts. Hide money amounts replaces every
  amount in the dashboard's finance widgets with dots (`HiddenAmountsProvider`); net worth is
  opt-in. The Finance page itself is unchanged.
- **Documents:** the overview returns only id, title, and expiry date; search hits carry only the
  title and state. Opening a document goes through the vault's own routes.
- Caching is per workspace and cleared on sign-out or user change; nothing is cached across
  users or workspaces.

### Dashboard limitations

- Sections and modules are queried one after another on the server; at personal scale that is
  tens of milliseconds, but the overview is not parallelized in the database.
- Pending reminders are counted over the soonest 50 enabled reminders.
- Transaction search hits open the Transactions view, not the transaction itself (Finance has
  no per-transaction URL yet).
- The old `TaskOverview` component (`components/tasks/task-overview.tsx`) is no longer used by
  the dashboard; it is left in place for removal in a follow-up.
- Widgets are covered by component tests with a mocked API; the browser journeys in
  `apps/web/e2e/` load the dashboard but don't exercise each widget.

## Universal search

One search across every module: the command palette's results and a dedicated `/search` page
with module tabs, filters, paging, and recent and saved searches. It extends Phase 10's search
rather than replacing it: the grouped `GET …/search` endpoint and `SearchService` stay as they
were, because the AI layer's keyword retrieval depends on their shape.

### Provider architecture

- **Sources** (`repositories/search/catalog.py`): one declarative `EntitySource` per record type
  (22 types). A source names its table, joins, scope (the workspace; for health also the owner),
  title, searched fields and their role (`metadata`, `description`, `content`), which fields may
  be previewed, its own date, when a record is active or archived, the type-specific filters it
  supports, and extra columns for the facts shown with a hit. Adding a type is one declaration.
- **Query builder** (`repositories/search/sources.py`, `search_source`): turns a source and a query
  into a single SQL statement: every word must appear in some field; tier and score are `CASE`
  expressions; rows are sorted and limited in the database; `COUNT(*) OVER ()` gives the total in
  the same statement. Snippets are cut in Python from the few rows returned (reusing the notes
  `excerpt`).
- **Module providers** (`repositories/search/providers.py`): one per module, running its sources
  in turn and merging them.
- **Service** (`services/search/universal.py`, framework-free): asks every provider for its first
  `offset + limit` hits, merges by the ranking strategy, pages, and builds per-module facets. Each
  provider runs inside a deliberate boundary: a failing module is logged (module name only, never
  the query), the session is rolled back, and the module is reported in `unavailable`.

| Module    | Types (searched fields)                                                                                                                                                                                                                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tasks     | task (title, description; filters: status, priority; date: due)                                                                                                                                                                                                                  |
| Notes     | note (title, tags, folder, plain text; date: journal day); trashed never                                                                                                                                                                                                         |
| Calendar  | event series (title, place, category, description, changed occurrences' title/description/place; date: range overlap)                                                                                                                                                            |
| Reminders | reminder (title, description, its task's title, its event's title; date: start)                                                                                                                                                                                                  |
| Finance   | account, transaction (description, category, account, notes; filter: type; date), loan (lender), subscription and bill (provider), holding (symbol, ISIN, issuer, category, account), deposit (institution; date: maturity), asset, budget, savings goal (category, description) |
| Habits    | habit (description, category; filter: kind), routine (description, steps)                                                                                                                                                                                                        |
| Documents | document (category, folder, tags, file name, issuer, provider, description, notes; filter: category; date: expiry); trashed never                                                                                                                                                |
| Health    | exercise, workout (notes, exercise names), workout template, fitness goal, body measurement (note only); all scoped to the signed-in person                                                                                                                                      |

### Database strategy

The same escaped, case-insensitive `LIKE` the modules already use (`ILIKE` on PostgreSQL), so it
runs unchanged on SQLite and PostgreSQL. Evaluated and not used in this phase:

- **SQLite FTS5 / PostgreSQL `tsvector`:** token-based, so partial words and codes ("INV-20",
  "0%") stop matching, the two engines tokenize and rank differently, and each needs a derived
  index kept in step with 25 tables by triggers or application hooks in two dialects. At personal
  scale the scan is fast, and substring matching is what every module's own search already does.
- **`pg_trgm` indexes:** would speed `ILIKE` on PostgreSQL only, and only if every OR-ed field were
  indexed; not worth an extension dependency yet.

Every scan is bounded by a workspace-leading index the tables already had (and the owner for
health); correlated `EXISTS` lookups (tags, steps, changed occurrences, workout exercises) use
existing indexes. One query per record type, never per record: about 22 small queries per search,
counts included. Offsets are capped at 500 and pages at 50.

### Index lifecycle

There is no search index, so there is nothing to build, update, rebuild, or let go stale: each
search reads the live tables in the request's transaction. Edits, deletes, trash and restore,
archive, integration imports, and workspace deletion show up in the next search; tests cover it
(`TestFreshness`). No rebuild or maintenance endpoint is needed.

### Ranking strategy

`services/search/ranking.py`. Each hit gets the first tier that applies: exact title (1000),
title prefix (800), title contains the phrase (600), title contains every word (500), a metadata
field contains the phrase (400), a description field (300), content (200), else words spread
across fields (100). Inactive records (completed, archived, cancelled, disabled) lose 50, less
than a tier gap. Ties break by most recently updated, then ID, so recency only orders hits within
a tier. `sort=recent` orders by update time instead. The weights live in a `RankingStrategy` that
the SQL `CASE` is built from, so another strategy changes weights in one place and per-source
limits stay exact.

### API

All under `/api/v1/workspaces/{workspace_id}/search`, behind `WorkspaceDep` and `CurrentUserDep`.

| Method                 | Path           | Purpose                                                       |
| ---------------------- | -------------- | ------------------------------------------------------------- |
| `GET`                  | `/results`     | Universal search: ranked hits, total, `has_more`, facets      |
| `GET`, `POST`,`DELETE` | `/recent`      | List (10, newest first), remember one, clear all              |
| `DELETE`               | `/recent/{id}` | Forget one (idempotent)                                       |
| `GET`, `POST`          | `/saved`       | List by name, save (name, query, filters; 409 on a duplicate) |
| `PATCH`, `DELETE`      | `/saved/{id}`  | Rename or change, delete                                      |

`/results` takes `q` (2 to 200 characters), `module` and `type` (repeatable), `date_from`/
`date_to` (the record's own date), `updated_from`/`updated_to`, `created_from`/`created_to` (UTC
days), `task_status`, `task_priority`, `document_category`, `transaction_type`, `habit_kind`,
`include_archived`, `sort`, `offset`, `limit`. Unknown parameters, bad values, and reversed
ranges are 422. A type-specific filter limits results to the types that support it (a priority
filter returns only tasks). Facets ignore the module filter, so tabs show what each module would
add. A hit carries module, entity type, ID, title, snippet, matched fields, tier, score, active,
status, labelled details, its date (a series' next occurrence), parent ID, and update time; the
web derives the destination from type, ID, and date (`lib/search`, `searchResultHref`). No
separate autocomplete endpoint: the palette calls `/results` with a small limit.

### Recent and saved searches

Migration `0020_create_search_history`: `recent_searches` and `saved_searches`, each row owned by
one user in one workspace (both foreign keys cascade), with RLS enabled on PostgreSQL. Recent
searches keep only the text, only when the person commits to a search (Enter, opening a result,
"See all results"; never per keystroke), deduplicated case-insensitively, the last 10 kept.
Saved searches hold a name (unique per person and workspace, case-insensitively), the query, and
the validated filters (at most 50). Every query filters by both user and workspace, so nobody
else, including another member of a shared workspace, can see them.

### Authorization and privacy

- Workspace scoping in every source's `scope`; health sources also filter by the owner, like the
  health repository, so health records never appear in another person's results, counts, or
  facets (tested by searching the same workspace as someone else).
- Hits never carry amounts, balances, prices, or measurement values. Finance notes, document
  notes, issuers, providers, and file names can match but are never previewed; document reference
  numbers, custom fields, and file contents are not searched. Trashed notes and documents never
  match; archived records only with `include_archived`.
- Responses and history lists are `Cache-Control: private, no-store`; the web caches per
  workspace under `["workspaces", id, "search", …]`, cleared on user change. Queries are never
  logged.

### Web

- `/search` (`components/search/`): the field (combobox with `aria-activedescendant`; arrow keys,
  Enter opens, Escape clears), module tabs with counts, a Filters panel showing only what the
  tab supports (status and priority on Tasks, type on Finance, kind on Habits, category on
  Documents; dates, last update, archived, and sort everywhere), results with highlighted titles
  and snippets (text split in React, never injected HTML), "Matched in …", last-updated dates,
  "Load more", and loading, empty, error-with-retry, and partly-unavailable states. Query, tab, and
  filters live in the URL (`parseSearchState` drops values the tab doesn't support). Before typing
  it lists recent searches (forget, clear) and saved searches (open, rename, delete).
- Data: `useUniversalSearch` (`hooks/use-universal-search.ts`) debounces 200 ms and pages with an
  infinite query; requests carry abort signals and results are keyed by query, so stale responses
  never replace newer ones.
- Entry points: the palette, Cmd/Ctrl+Shift+F from anywhere, and "Search everything" in the
  palette. Module pages keep their own search fields; no new search bars were added.
- Navigation reuses each module's pages and dialogs. New deep links `?transaction=` (Finance) and
  `?reminder=` (Reminders) open the existing edit dialogs through `useLinkedRecord`; a record that
  is gone opens nothing.

### Search limitations

- Substring matching only: no stemming, typo tolerance, or Unicode case folding on SQLite (its
  `LIKE` folds ASCII only).
- Every source scans its workspace's rows; fine at personal scale (tested with hundreds of
  records), but not tuned for very large workspaces. Deep pages cost more, hence the offset cap.
- Date filters use UTC days; event date filters use series bounds, and a series' shown date is its
  next occurrence without considering skipped occurrences.
- Built-in exercises appear only once used (they are created on first use).
- Accounts, loans, subscriptions, bills, holdings, deposits, assets, budgets, goals, workout
  templates, and measurements open their view, not the record itself.
- The web's `useWorkspaceSearch` hook and `searchOptions` for the grouped endpoint are no longer
  used by the palette and can be removed in a follow-up.

### Future semantic search extension points

The AI layer's hybrid search (`…/ai/search`) stays separate. A later phase could add an
`EntitySource` field matcher backed by FTS or embeddings, a `RankingStrategy` that blends a
semantic score into tiers, or a provider that merges AI retrieval hits into the same
`UniversalHit` shape, without changing the API or the web.

## AI intelligence layer

An optional layer that answers questions about a person's own Orbit data, finds records by
meaning, drafts and summarizes in the modules, and proposes actions that run only with approval.
It owns no personal data: it reads through the modules' own services and acts through them.
It is off by default, per person, and Orbit works the same with it off.

### What existed before, and what didn't

- **Search** was Phase 10's per-module substring search (`services/search/`), with no index or
  ranking. It is unchanged; semantic search is a separate, additional endpoint that reuses it.
- **Background jobs**: the database-backed reminder worker (leases, retries, periodic jobs).
  Indexing runs as one more periodic job in it; there is no second job system.
- **Files**: the attachment store (`system/attachment_store.py`) with document versions carrying a
  SHA-256. Indexing reads files through `DocumentService.open_file`, never modifies them.
- **Not present, so not built on**: multi-device sync, an external integration framework, OCR,
  and any AI library or SDK. (Integrations were added later; see
  [External integrations](#external-integrations). Imported events and documents are ordinary
  records, so AI reads them under the calendar and documents permissions; mail is never stored,
  so it isn't indexed.)

### Layout

```text
services/ai/            framework-free domain logic
├── models.py           settings, connections, index, conversations, proposals, usage, insights
├── providers.py        AiProvider protocol, capabilities per kind, provider errors, local/cloud
├── configuration.py    settings and connections; resolves providers and enforces policy
├── usage.py            usage records, monthly limit, MeteredProvider wrapper
├── chunking.py         structure-aware chunking; note headings from ProseMirror JSON
├── extraction.py       PDF, DOCX, PPTX, XLSX, TXT, CSV, Markdown text (no OCR)
├── sources.py          SourceCatalog: lists, loads, and re-checks indexable records
├── indexing.py         reconcile and process the index (the worker's job)
├── vectors.py          float32 encoding, normalization, top-k
├── retrieval.py        hybrid keyword + semantic retrieval with rank fusion
├── routing.py          deterministic question routing: modules, dates, action intent
├── context.py          structured context from module services (exact figures)
├── prompts.py          prompt assembly, record fencing, citation and proposal checks
├── assistant.py        conversations, grounding, streaming turns
├── assist.py           contextual features (summaries, extraction, drafts)
├── actions.py          proposal lifecycle; validator and executor protocols
└── insights.py         deterministic insights and dismissals
providers/ai/           HTTP adapters (openai.py, anthropic.py, gemini.py, ollama.py, registry.py)
repositories/ai.py      SQL for the nine AI tables; ai_services.py builds the services on a session
api/ai_actions.py       proposals validated by module request schemas, run by module services
api/v1/ai.py            routes
system/secrets.py       Fernet encryption of API keys; system/network.py resolves hosts
```

### Provider abstraction and capabilities

Every adapter implements `AiProvider` (`services/ai/providers.py`): `complete`, `stream`,
`embed`, `list_models`, plus `capabilities` (chat, streaming, structured output, embeddings,
model listing, usage reporting). Adapters are plain HTTP over the shared `httpx2.AsyncClient`
(no vendor SDKs), built only by `providers/ai/registry.py`.

| Kind                | Endpoint (default)                          | Embeddings | Notes                                               |
| ------------------- | ------------------------------------------- | ---------- | --------------------------------------------------- |
| `ollama`            | `http://localhost:11434` (native API)       | Yes        | Local; NDJSON streaming; usage from eval counts     |
| `openai_compatible` | Person's server (LM Studio, llama.cpp, …)   | Attempted  | No vendor-only options sent; usage if reported      |
| `openai`            | `https://api.openai.com/v1`                 | Yes        | Bearer key; JSON mode; stream usage                 |
| `anthropic`         | `https://api.anthropic.com` (Messages API)  | **No**     | `UnsupportedCapabilityError`; pick another embedder |
| `gemini`            | `https://generativelanguage.googleapis.com` | Yes        | Key in `x-goog-api-key`, never the URL              |

- **Structured output** is uniform: JSON mode where the provider has one (`response_format`,
  `responseMimeType`, `format: json`), an instruction otherwise (Anthropic), then parsing and
  validation in Orbit with one retry. Model output is never trusted to be well formed.
- **Errors** map to `ProviderAuthError`, `ProviderRateLimitError`, `ProviderUnavailableError`,
  `ProviderRequestError`, `ProviderResponseError`, `UnsupportedCapabilityError`. Messages are
  safe to show: authentication errors use fixed text (some providers echo part of the key), and
  provider detail is passed on only for request errors, truncated, with the key redacted.
- **Model discovery** lists the provider's models; Gemini says which support embeddings, others
  are classified by name. The settings UI falls back to typing a model name.
- Redirects are not followed, so an endpoint can't bounce requests somewhere unchecked.

### Configuration, credentials, and consent

- `ai_settings` (one row per person): on/off, chat provider and model, embedding provider and
  model, an optional fallback, `allow_cloud`, readable modules, response style, a monthly token
  limit, and whether to keep an index. Defaults: off; tasks, notes, calendar, reminders, and
  habits readable; documents, finance, and health off (sensitive); no cloud processing.
- `ai_providers` (per person): kind, name, optional endpoint, optional user-entered prices (for
  cost estimates; Orbit ships no price list), and the API key encrypted with Fernet. The key is
  never returned (responses say `has_api_key`), never logged, and decrypted only to build an
  adapter. The encryption key is `ORBIT_AI_SECRET_KEY`, or in local mode a `0600` key file beside
  the database; in cloud mode without it, keys can't be stored (keyless local providers work).
- **Local versus cloud** is decided from the endpoint's host: loopback, private, link-local, and
  `.local` names are `local`; anything else is `cloud`. It is shown on every provider, answer,
  and connection test.
- **Policy in code** (`AiConfigService`): nothing runs unless the server (`ORBIT_AI_ENABLED`) and
  the person allow it; a cloud provider is refused (409) without `allow_cloud`; the fallback is
  used only if chosen, only for unreachable or rate-limited providers, only before any text was
  shown, and passes the same checks. Orbit never switches providers on its own.
- **Endpoints** are checked when saved or tested: `http`/`https` only, no credentials in the URL,
  plain `http` only to private hosts, and (cloud mode by default) no endpoint that is or resolves
  to a private address, so a hosted Orbit can't be used to reach its internal network.

### Embeddings, vector storage, and the index

**Decision: portable storage, brute-force scoring.** Chunks are stored in `ai_chunks` with
normalized float32 embeddings as little-endian bytes (`LargeBinary`: BLOB on SQLite, BYTEA on
PostgreSQL), and similarity is a dot product computed in Python (`vectors.py`) over the chunks of
allowed modules embedded by the current model.

| Option                   | Why not now                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| pgvector                 | Cloud only; needs the extension and a fixed dimension per column, while models vary in dimension |
| sqlite-vec / SQLite VSS  | A native extension to ship and load per platform; local mode stays a plain SQLite file           |
| A vector database server | A second server to run, secure, and back up; local-first can't depend on it                      |

At personal scale (thousands to tens of thousands of chunks) scoring takes milliseconds to a
fraction of a second, on both databases, with identical behavior. The `ChunkStore` protocol in
`retrieval.py` is the seam for a pgvector adapter if an index outgrows this.

**What is indexed** (`sources.py`): notes (active; text split at headings), documents (active or
archived; descriptive metadata, without reference numbers, plus the file's text by page, heading,
or slide), tasks, calendar events (series), and habits. Finance, reminders, and health are not
embedded: questions about them are answered from structured queries, so their figures are
exact.

**Chunking** (`chunking.py`) never crosses a section, so every chunk keeps an accurate location
(`Page 3`, a heading). Paragraphs are packed up to 1,200 characters with 150 characters of
overlap; long paragraphs split at sentences, and only an over-long sentence between words. The
embedding input is `title`, `location`, and the chunk, so short chunks keep their context. At most
200,000 characters per record are indexed.

**Lifecycle** (`indexing.py`, run by the worker every `ORBIT_AI_INDEX_INTERVAL_SECONDS` for people
with AI and indexing on and an embedding model):

1. **Reconcile:** list allowed records with fingerprints (a note's revision, title, and tags; a
   document's metadata and current version; the full text of small records). New, changed, or
   embedded-by-another-model records become `pending`; records gone, trashed, archived (notes),
   or in a module switched off are deleted with their chunks. Unchanged records are untouched,
   so nothing is embedded twice.
2. **Process:** claim up to 20 pending records with a 5-minute lease (a conditional update, so
   several workers never take the same one), load, chunk, embed in batches of 32, replace the
   chunks, mark `indexed`.
3. **Failures** retry with backoff (2^n minutes, up to 6 hours, 5 attempts), then stay `failed`
   until **Retry failed**. An unreachable, rate-limiting, or misconfigured provider stops the
   run so the rest wait for the backoff.

**Rebuild** marks everything pending; **Delete index** removes it (records untouched). Changing the
embedding model re-indexes, since chunks carry their model key (`provider id:model`) and search
only compares chunks of the current one. Switching a module off removes its chunks at once.
Restarts lose nothing (all state is stored). Restoring a backup restores the index with it, and
reconcile corrects anything stale; deleting the index is always safe. There is no multi-device
sync, so there is nothing to reconcile across devices.

**Stale data can't leak:** every indexed match is re-checked against its module
(`SourceCatalog.exists`) before it is returned or shown to a model, so a deleted or trashed record
disappears from results immediately, before the index catches up.

### Semantic and hybrid search

`GET /api/v1/workspaces/{id}/ai/search?q=&module=&date_from=&date_to=&limit=` (`retrieval.py`):
the keyword half runs the existing workspace search for the query's most distinctive words (it
matches substrings, not whole questions); the semantic half embeds the query and ranks chunks.
Results merge by reciprocal rank fusion (`1 / (60 + rank)` per list), so records found both ways
rank first without comparing incomparable scores; each result says whether it matched by
keyword, meaning, or both. Without an embedding model the response says `semantic: false` and is
keyword only. Modules the person hasn't allowed are never searched. The existing `/search`
endpoint and the command palette's search are unchanged.

### Assistant and RAG orchestration

One turn (`assistant.py`):

1. **Prepare** before the response starts (so problems are ordinary HTTP errors): AI on, chat
   provider chosen, cloud consent if needed, limit not reached; the question is saved; a new
   conversation is titled from it (no extra model call).
2. **Route** (`routing.py`): keywords and date phrases ("tomorrow", "last month", "next 3 days",
   "on Friday") are resolved deterministically in the viewer's time zone into modules and a date
   range, and whether the person asked for something to be created. Keyword routing is
   predictable and works with small local models that can't plan tool calls.
3. **Ground**: routed modules the person allows answer with structured data from their own
   services (`context.py`): task counts and due lists, calendar ranges with overlaps found by
   Orbit, upcoming reminders, spending by category and income from `FinanceService`, payments
   from `CommitmentService`, budget use from `BudgetService`, habit streaks and rates from
   `HabitService`, the health overview (owner-scoped), and expiring documents. Hybrid retrieval
   adds the most relevant notes, documents, and other records. Each item becomes a numbered
   source `[S1]…`, within a 16,000-character budget. If nothing is found, the context says so.
4. **Generate**: the system rules, at most 8 recent messages (6,000 characters, long ones
   shortened; never the whole conversation), the sources, and the question. The answer streams
   back as server-sent events (`start`, `sources`, `delta`, `error`, `done`).
5. **Check and save**: citations to sources that don't exist are removed and the rest marked
   cited; the answer is saved with its sources, provider, model, local or cloud, and tokens.

Closing the connection stops generation; what was written is saved as `stopped`. Provider
failures are saved as an `error` message with a safe reason. The streaming response opens its
own database session, since the request's may close first.

### Grounded answers and citations

- Sources are created only from records Orbit retrieved; the model can't add any. The UI shows
  each answer's sources with links into their modules (a task opens the task, an event its day,
  a summary its module), cited ones first, and says when an answer used no Orbit data.
- "Calculated by Orbit" sources hold figures the app computed: totals and counts come from the
  modules' services (or, for a total of listed category amounts, integer arithmetic in
  `context.py`), formatted exactly from minor units. The model is told to repeat them and not to
  compute its own; there is no LLM arithmetic in any figure Orbit supplies.
- The model is told to label inferences and general knowledge as such, and to say plainly when
  Orbit has no answer.

### Contextual features and insights

`POST …/ai/assist` (`assist.py`) runs one feature on one record or range, checking the module's
permission first: note summary, key takeaways, action items (→ task proposals), tag suggestions
(→ a tag proposal), rewriting (→ "save as a new note", never overwriting), related notes
(retrieval only, no model); document summary and detail extraction (→ a proposal that fills only
empty fields; files are never modified; unreadable files are reported, since there is no OCR);
task drafts from text and task breakdowns (→ task proposals); schedule summaries with overlaps
and busiest day computed by Orbit, and event drafts; spending summaries with category changes
computed by Orbit, budget explanations, upcoming payments, and category suggestions with
confidence (shown for review only: financial records are never changed by AI); habit and health
summaries (descriptive, no diagnosis or advice). The web exposes these through a small "AI" menu
in Notes, Documents, Calendar, Finance, Habits, and Health, shown only when AI is on and allowed
to read that module.

`GET …/ai/insights` (`insights.py`) is deterministic, with no model involved: spending changes
against the same days last month, budgets near or over, payments due within a week, habit
consistency against the 30-day rate, task completion and overdue counts, calendar workload, and
documents expiring within 30 days. Each has a period, the records behind it, and a key that
includes the period, so dismissing it hides it until the period changes. Insights appear on the
assistant's start page and create no notifications.

### Action approval model

1. The model proposes an action as a fenced `orbit-action` block (hidden from the stream), or a
   feature builds one.
2. Kept only if the person's message asked for an action (`routing.wants_action`), only for
   allowlisted kinds (`create_task`, `create_reminder`, `create_event`, `create_note`,
   `append_to_note`, `add_note_tags`, `update_document_details`), at most three per answer, and
   only after validation by the target module's own request schema (`api/ai_actions.py`).
3. Stored as `pending` and shown as a preview of every field; proposals made while reading
   records are flagged for extra care.
4. **Approve** moves `pending` to `executing` with a conditional update (a second approval, a
   double click, or another tab finds nothing to claim: 409), re-validates, and runs the
   module's own service; the result (or the module's safe refusal) is recorded. **Reject**
   changes nothing.

There is no generic query or update action, no deletion, and no financial action. Multi-step
work is the [personal agent](#personal-agent-and-automation)'s, which reuses this validator and
executor.

### Prompt injection and untrusted content

Retrieved notes, document text, and every other record are untrusted. Defenses, mostly in code:

- Records are fenced as `<orbit-record>` data and the system rules say content inside is never an
  instruction; fence markers inside records are neutralized, so a record can't close the fence or
  forge an action block.
- The model has no tools and can't run anything. A proposal from text the person didn't ask for
  is dropped, so instructions planted in a document can't make the assistant propose actions on
  its own; anything proposed still needs approval and passes the module's validation.
- Permissions are applied before retrieval, so text from modules the person didn't allow never
  reaches a model, and workspace and owner filters apply to every query (conversations,
  proposals, dismissals, and index rows are scoped to the workspace and person).
- Citations are checked against the sources Orbit supplied; answers render as Markdown parsed
  into React elements, never as HTML, with links limited to web, mail, and in-app addresses.
- Health data is read only with the health permission and only for its owner.

### Usage tracking

Every provider call is recorded in `ai_usage` by `MeteredProvider`: person, workspace, provider,
model, kind of request (chat, assist, embedding, test), input and output tokens where the provider
reports them, estimated cost from the person's own prices, duration, and success or error type.
Prompts and answers are never stored there. `GET /api/v1/me/ai/usage` aggregates the last N days;
the optional monthly token limit is checked before each call (429 when reached), with a warning
at 80%.

### Privacy and authorization

- AI settings, providers, and usage are per person (`/me/ai`); conversations, proposals, insight
  dismissals, and the index are per workspace and person, through `WorkspaceDep`. Another
  person's workspace is 404; another person's provider, conversation, or proposal is 404.
- On PostgreSQL the nine tables have Row Level Security enabled with no policies, like the rest.
- Conversations keep the person's questions and answers (like notes) until deleted. Index rows
  are derived copies of record text, deleted with their records or modules.

### API

| Method and path                                          | Purpose                                       |
| -------------------------------------------------------- | --------------------------------------------- |
| `GET`, `PATCH /me/ai/settings`                           | Settings, permissions, consent, limits        |
| `GET`, `POST /me/ai/providers`                           | List and add provider connections             |
| `PATCH`, `DELETE /me/ai/providers/{id}`                  | Edit (name, endpoint, key, prices) and delete |
| `POST /me/ai/providers/test`                             | Test a connection without saving it           |
| `GET /me/ai/providers/{id}/models`                       | The provider's models                         |
| `GET /me/ai/usage`                                       | Usage by provider, model, and kind            |
| `GET …/ai/conversations`, `GET`, `PATCH`, `DELETE /{id}` | Conversations: list, open, rename, delete     |
| `POST …/ai/messages`                                     | Ask (server-sent events)                      |
| `POST …/ai/proposals/{id}/approve`, `/reject`            | Decide a proposal                             |
| `POST …/ai/assist`                                       | Run a contextual feature                      |
| `GET …/ai/search`                                        | Hybrid semantic search                        |
| `GET …/ai/insights`, `POST …/ai/insights/dismiss`        | Insights                                      |
| `GET …/ai/index`, `POST /rebuild`, `/retry`, `DELETE`    | Index status and maintenance                  |

The stream's event payloads are described in `packages/contracts/src/index.ts` (`AiTurnStarted`,
`AiStreamDone`), since OpenAPI can't describe event streams.

### In the web app

- `/assistant`: conversations beside the open one (in the URL as `?c=`), suggested questions for
  allowed modules, insights, streaming answers with numbered source links, the provider and
  whether it ran locally, stop, rename, delete, and proposal cards with approve and reject. The
  command palette's **Ask Orbit** opens it with the question (`?q=`).
- **Settings → AI**: on/off, providers (with connection test and stored-key status), answer,
  embedding, and fallback models, where data is processed, cloud consent, module permissions,
  response style, token limit, index status and maintenance, and usage.
- Insights and AI search are marked stale after any mutation, like the dashboard overview.

### Known limitations

- Routing is keyword based; unusual phrasings may miss a module (retrieval still runs).
- Vector scoring is brute force in Python: fine for a personal index, not for millions of chunks.
- No OCR: scanned PDFs and images contribute only their metadata.
- Endpoint DNS is checked when saved or tested, not on every request (DNS rebinding).
- The model can still misstate a provided figure; sources let the person check.
- Rewrites save as a new note; there's no in-place AI edit of note content.
- Token counts depend on the provider; OpenAI-compatible servers may report none.
- Agents, schedules, and automation are in [Personal agent and automation](#personal-agent-and-automation); there is no multi-device sync.
- Stopping a stream is covered by design but not by an automated test (TestClient can't
  disconnect mid-stream).

## External integrations

Google and Microsoft accounts connected per person and workspace. They feed the existing
modules rather than parallel ones: calendars become ordinary calendar events, files become
ordinary documents, and email becomes the tasks, notes, and reminders people make from it.
Setup, scopes, and operator guidance: [integrations.md](integrations.md).

### What existed, and what didn't

- **Reused:** workspace authorization (`WorkspaceDep`), the reminder worker (leases, retries,
  periodic jobs), Fernet encryption (`system/secrets.py`), the shared `httpx2` client pattern of
  the AI adapters, `CalendarService` (series, exceptions, alerts), `DocumentService` (content
  validation, versions, the file store), the task, note, and reminder services, in-app
  notifications, and search (imported records are found by the existing substring search and
  indexed by the AI layer like any other record).
- **Not present, and still not built:** multi-device sync of Orbit's own data. (Backup and
  restore came later; see [Backup, restore, and data portability](#backup-restore-and-data-portability).) There was no sync engine to
  plug into, so integrations have their own synchronization runs inside the existing worker,
  scoped to external accounts. They don't synchronize Orbit between devices.

### Layout

```text
services/integrations/     framework-free domain logic
├── models.py              connections, resources, links, runs, OAuth states, errors
├── connectors.py          the connector contract: OAuth, calendar, mail, files; normalized types
├── store.py               repository protocol and secret box protocol
├── oauth.py               state, PKCE (S256), digests
├── tokens.py              TokenManager: decrypt, refresh with locking, revoked consent
├── mapping.py             RRULE translation, field limits, snapshots, change fingerprints
├── service.py             IntegrationService: providers, authorization, connections, calendars,
│                          sync requests, conflicts, origins, webhooks, disconnect
├── calendar_sync.py       CalendarSync: pull, reconcile, push, conflicts, push channels
├── mail.py                MailService: labels, on-demand messages, records from email
├── files.py               FileService: browse, import into Documents, change checks
└── runner.py              SyncRunner: schedule, claim, process, retry with backoff
providers/integrations/    http.py (timeouts, retries, error mapping), google.py, microsoft.py,
                           text.py (email HTML to text), registry.py (the one place that knows vendors)
repositories/integrations.py   SQL for the five tables; build_integrations() wires the services
api/v1/integrations.py     routes; schemas/integrations.py the contract
```

### Connector contract

A `ProviderConnector` bundles an `OAuthClient` and the capability connectors it supports
(`CalendarConnector`, `MailConnector`, `FilesConnector`), with the scopes per capability.
`HttpConnectorRegistry` builds one per provider whose OAuth client ID is configured; services
ask `ConnectorRegistry.get(provider)` and never import a vendor module. Adapters translate the
vendor's JSON into normalized types (`RemoteEvent`, `RemoteDeletion`, `ChangePage`,
`MessageSummary`, `RemoteFile`, …) and its failures into connector errors: `ReauthRequiredError`
(401 or `invalid_grant`), `AccessDeniedError` (403), `RateLimitedError` (429, Google's quota
403s, with `Retry-After`), `ProviderUnavailableError` (5xx, network), `RemoteNotFoundError`,
`CursorExpiredError` (410 on a sync token or delta link), and `VersionConflictError` (412).
Errors carry fixed, safe messages: never tokens or response bodies. Adding a provider means
writing its adapter and registering it; nothing else changes. Tests swap in an in-memory
provider (`tests/integration_fakes.py`).

`ApiClient` gives every call a 30-second timeout (10 to connect), retries idempotent requests
twice with exponential backoff when the wait is short, and never follows redirects with a token
attached. Graph's paging links are followed only on `graph.microsoft.com`; Drive and OneDrive
IDs are checked against their character sets, and Drive query literals are escaped.

### Data model

```text
users, workspaces ──< integration_connections ──< integration_resources   (calendars, mail labels)
                              │       └──< integration_sync_runs
                              ├──< integration_links ──> (event | document | task | note | reminder)
                              └──< integration_oauth_states                (also per user, workspace)
```

- **`integration_connections`:** provider, the account's stable ID, email, and display name,
  granted scopes and the capabilities they cover, status (`active`, `reauth_required`,
  `error`), encrypted access and refresh tokens with their expiry and a `token_version`, the
  mail period, and the last sync and error. Unique per workspace, provider, and account, so
  reconnecting the same account updates it and several accounts per provider are possible.
- **`integration_resources`:** each calendar (and selected mail label): whether selected,
  writable at the provider, direction, interval, the Orbit category for its events, its time
  zone, and synchronization state (cursor, checkpoint page, window start, next sync, push
  channel with its secret's SHA-256).
- **`integration_links`:** where an Orbit record came from. External kind and ID (with parent:
  a series, a thread, a folder), the Orbit entity type and ID, origin (`external`, `orbit`,
  `linked`), the provider's version, a normalized snapshot of what it last sent, a fingerprint
  of the Orbit record as last synchronized, and status (`synced`, `conflict`, `local_changes`,
  `update_available`, `missing`, `deleted_locally`). A partial unique index allows one link per
  external event or file per connection, so nothing is imported twice. Orbit's own tables
  gain no provider columns; `entity_id` is checked when the link is used (a deleted record is
  noticed, not cascaded).
- **`integration_sync_runs`:** kind (`calendar`, `files`), trigger, status, whether full,
  counts (imported, updated, deleted, skipped, conflicts, exported, failed), a safe error,
  attempts, cancellation, and the lease. No record content.
- **`integration_oauth_states`:** single-use, ten-minute authorizations (below).

Every table carries `workspace_id` and cascades with the workspace; RLS is enabled on
PostgreSQL. Person-facing queries filter by workspace and the connection's owner.

### OAuth and tokens

```text
browser ──POST …/integrations/authorize──► API: state (SHA-256 stored), PKCE verifier (encrypted)
   ◄── provider consent URL (state, S256 challenge, chosen scopes, fixed redirect URI)
browser ──► provider consent ──► web /integrations/callback?code&state
callback page ──POST /integrations/oauth/complete (Bearer session)──► API
   API: take state (delete, once) → same person? unexpired? → exchange code + verifier
        → keep only fully granted capabilities → account ID → encrypt and store tokens
```

- **Authorization Code with PKCE** for both providers; Google also gets `access_type=offline`
  and `prompt=consent` so a refresh token is issued on reconnecting.
- **CSRF and login CSRF:** the state is 256 random bits, bound to the person, workspace,
  provider, and capabilities, used once, and valid for ten minutes. Completing requires the
  same person's session, so a crafted link can't attach someone else's account. The callback
  page clears the code from the address and history immediately and sends no referrer.
- **Redirect URI** is configuration (`ORBIT_INTEGRATIONS_REDIRECT_URL`), never taken from a
  request, and must be `https` in production (loopback excepted).
- **Scope validation:** the token response's scopes decide the connection's capabilities; a
  capability whose scopes weren't all granted is absent, and consent that granted none of the
  requested ones connects nothing.
- **Storage:** tokens are Fernet-encrypted with `ORBIT_INTEGRATIONS_SECRET_KEY`, or in local
  mode a `0600` key file beside the database, separate from the AI key. Cloud mode without a
  key refuses to connect. Tokens are decrypted only inside `TokenManager` and never returned,
  logged, exported, or sent to the browser.
- **Refresh** happens two minutes before expiry, and once more if the provider refuses a token
  early (revoked consent). An in-process lock per connection and an optimistic `token_version`
  update serialize refreshes; a loser uses the winner's tokens. A refused refresh marks the
  connection `reauth_required`, stops its synchronization, and sends the owner an in-app
  notification; imported data is kept.
- **Revocation** on disconnect: Google's revoke endpoint; Microsoft has none for a single app,
  which the UI says before confirming. Tokens are deleted either way, with the connection, its
  resources, runs, and links. Imported records stay as Orbit-only records unless the person asks
  to remove them (events deleted, documents moved to the trash).

### Synchronization protocol

```text
API (select calendar, Sync now, webhook) ──► integration_sync_runs (queued)
worker poll ──► schedule due calendars ──► claim runs (conditional UPDATE, 5-min lease)
  per run, own session:  page ← provider changes(cursor | checkpoint | window)
                         apply page via CalendarService (flush-only) + links + checkpoint → COMMIT
                         … up to 20 pages, then yield and continue next poll
                         full sync? reconcile unseen links → push Orbit changes → push channel
                         finish: cursor, next sync, counts → COMMIT
```

- **No long work in requests.** Routes queue runs and return 202; the worker does the work. A
  request may make one short provider call (listing calendars, a page of mail, one file import
  within Documents' size limit, exporting one event).
- **Incremental:** Google `syncToken` (full list with `showDeleted`, series as masters);
  Microsoft `calendarView/delta` over a window a month back to a year ahead, moved monthly. A 410
  restarts a full synchronization.
- **Checkpoints and recovery:** each page commits with its links and the next page token, so a
  crash loses at most the page in progress, and a restarted worker reclaims the run once its
  lease expires and continues from the checkpoint. Every write is an idempotent upsert by
  external ID, so a repeated page changes nothing.
- **Atomic with the module:** module services are built on a `FlushTransaction` (their commit
  flushes), so an event or document and the link that prevents re-importing it commit together.
- **Retries:** rate limits and outages requeue the run with backoff (30 s doubling to 30 min,
  or the provider's `Retry-After`), five attempts at most. Unexpected errors are recorded by
  type only and retried the same way. A refused token fails the run and pauses the connection.
- **Isolation:** each run and each scheduled check has its own session, so one provider or
  account failing never blocks another, or reminder delivery.
- **Cancellation:** a queued run is cancelled at once; a running one stops before its next page.
- **Schedules:** each calendar's interval (15 min to daily, or manual) sets `next_sync_at`;
  imported files are checked every six hours. Webhooks queue a run immediately.
- **Push:** with `ORBIT_INTEGRATIONS_WEBHOOK_URL`, a Google watch channel or Graph subscription
  is registered after each sync and renewed 12 hours before expiry. Notifications are verified
  by the channel's secret (constant-time against its SHA-256) and only queue a run.

### Calendar mapping

| Provider item                                    | Orbit                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| Single event                                     | An event (title ≤ 200, description ≤ 5,000, location ≤ 200)        |
| Google series with a representable RRULE         | A series (`EventRecurrence`); `EXDATE`s become skipped occurrences |
| Changed or cancelled instance of such a series   | A `modified` or `skipped` exception, keyed by its original start   |
| Google series with another rule (`BYDAY=2TU`, …) | Its instances a month back to a year ahead, as single events       |
| Outlook occurrence, exception, or single event   | A single event (Graph's delta works on expanded views)             |
| Cancelled or removed                             | The event deleted (unless changed in Orbit; see conflicts)         |

- Times are kept in the event's IANA zone (Google), or converted from UTC to the Outlook event's
  original zone where its Windows name is known (else UTC). All-day events stay dates.
- Occurrences that arrive before their series (on an earlier page) are imported standalone and
  adopted as exceptions when the series arrives. Changing a series' timing re-applies its
  remembered exceptions, as Orbit clears them on such changes.
- Imported events get the calendar's chosen Orbit category, have no alerts, and are indexed,
  searched, and shown like any event. The event details say where an event came from and
  whether Orbit changes go back (`GET …/integrations/origins`).

### Conflict resolution

Each link stores the provider's version and a fingerprint of the Orbit event as last
synchronized, so either side's changes can be told apart:

| Provider          | Orbit     | Result                                                                                                          |
| ----------------- | --------- | --------------------------------------------------------------------------------------------------------------- |
| changed           | unchanged | Applied                                                                                                         |
| unchanged         | changed   | Two-way single event: sent with the known version (`If-Match`); otherwise kept in Orbit, marked `local_changes` |
| changed           | changed   | **Conflict** (`both_changed`): nothing overwritten; the provider's version is kept on the link                  |
| deleted           | unchanged | Deleted in Orbit                                                                                                |
| deleted           | changed   | **Conflict** (`deleted_remotely`): the Orbit event is kept                                                      |
| any               | deleted   | `deleted_locally`: never re-imported, never deleted at the provider                                             |
| changed meanwhile | sending   | 412: not sent; the next pull sees both changes and records a conflict                                           |

Resolving (`POST …/conflicts/{link}/resolve`): **keep external** applies the provider's
version (or deletes the Orbit event); **keep Orbit** sends Orbit's version on two-way calendars,
or otherwise keeps it locally (later provider changes conflict again), or for a deletion keeps
the event as Orbit-only. Files never conflict: a changed file is `update_available`, and
updating adds a document version; a deleted or inaccessible one is `missing`, and the document
stays. Revoked permission pauses the connection; nothing imported is removed.

### Mail and files

- **Mail** is never ingested. Messages are listed from the labels (Gmail) or folders (Outlook)
  the person selected, within their chosen period (7 to 365 days), checked again server-side
  for every message opened or acted on. Bodies are reduced to plain text (no HTML is
  rendered). Creating a task, note, or reminder from a message goes through that module's
  service and links the record to the message and thread ID, storing only the subject as the
  link's title. Nothing is sent.
- **Files** are browsed and searched at the provider; importing downloads one file (capped at
  `ORBIT_DOCUMENT_MAX_BYTES`, Google Docs exported as PDF) into `DocumentService.upload`, which
  validates it like any upload. OneDrive's pre-authenticated download redirect is fetched
  without Orbit's token.

### API

Under `/api/v1/workspaces/{workspace_id}/integrations`, authorized by `WorkspaceDep` and the
connection's owner. Another person's connection is a 404.

| Method            | Path                                                   | Purpose                                                 |
| ----------------- | ------------------------------------------------------ | ------------------------------------------------------- |
| `GET`             | `/providers`                                           | Providers, whether configured, capabilities and why     |
| `POST`            | `/authorize`                                           | Start connecting (or reconnecting); returns consent URL |
| `POST`            | `/api/v1/integrations/oauth/complete`                  | Finish connecting (state, code or error)                |
| `GET`             | `/connections`, `/connections/{id}`                    | Connections; one with calendars, recent runs, counts    |
| `PATCH`, `DELETE` | `/connections/{id}`                                    | Mail period; disconnect (`remove_imported`)             |
| `POST`            | `/connections/{id}/check`                              | Health check                                            |
| `POST`, `PATCH`   | `/connections/{id}/calendars/refresh`, `…/{calendar}`  | List again; select, direction, interval, category       |
| `POST`            | `/connections/{id}/calendars/{calendar}/events`        | Add an Orbit event to the calendar                      |
| `POST`, `GET`     | `/connections/{id}/sync`, `/connections/{id}/runs`     | Queue synchronization (202); history                    |
| `POST`            | `/connections/{id}/runs/{run}/cancel`, `…/retry`       | Cancel or retry                                         |
| `GET`, `POST`     | `/conflicts`, `/conflicts/{link}/resolve`              | Conflicts; resolve                                      |
| `GET`             | `/origins?entity_type&entity_id`                       | Where an Orbit record came from                         |
| `GET`, `PUT`      | `/connections/{id}/mail/labels`                        | Labels; choose which may be shown                       |
| `GET`             | `/connections/{id}/mail/messages`, `…/{message}`       | List or search; read one (with its links)               |
| `POST`            | `…/mail/messages/{message}/task`, `/note`, `/reminder` | Create a linked record (the module's own request body)  |
| `DELETE`          | `/connections/{id}/links/{link}`                       | Unlink a message                                        |
| `GET`, `POST`     | `/connections/{id}/files`, `…/files/{file}/import`     | Browse or search; import into Documents                 |
| `POST`            | `/connections/{id}/files/links/{link}/update`          | Import the file's new version                           |
| `POST`            | `/api/v1/integrations/webhooks/google`, `/microsoft`   | Push notifications (verified by channel secret)         |

### In the web app

- **Settings → Integrations** (`components/integrations/`): conflicts needing a choice,
  connected accounts with status and services, connecting (provider, then what Orbit may access,
  each with why; read-only calendars by default; editing implies reading), and a privacy note.
- **A connection's page** (`?connection=<id>`): status with Sync now and a health check, a
  reconnect warning, calendars (select, direction, interval, category, last sync and errors,
  what happens to Orbit edits), mail (labels, period, list, search, plain-text reading, Create
  task, Save as note, Remind me), files (folders, search, import, new versions), sync activity
  (counts, errors, retry, cancel), permissions with reconnecting to add more, and disconnecting.
- **`/integrations/callback`** completes the authorization and opens the connection.
- **Origins** appear in calendar event details and document details.
- Query keys: `["workspaces", id, "integrations", …]`; a connection polls while a run is in
  progress. Tokens and client secrets never reach the browser.

### Known limitations

- Google and Microsoft only; no CalDAV, iCal, or other providers yet.
- Outlook series come in as separate occurrences in a moving window; Google rules Orbit can't
  represent are expanded over a window. Edits of imported repeating series stay in Orbit.
- Deleting in Orbit isn't sent to providers. Attendees, invitations, and alerts aren't imported.
- Outlook time zones outside the mapped Windows names fall back to UTC.
- Mail: chosen labels or folders only (not subfolders), the 20 most recent matches, plain text,
  no attachments, no sending.
- Files: one at a time, within Documents' size limit; Drive versions may change on renames.
- Push notifications need a public HTTPS API; local installs poll.
- The opt-in PostgreSQL suite checks RLS on the new tables; integration HTTP tests run on SQLite
  against an in-memory provider and mocked HTTP, not real accounts.

## Backup, restore, and data portability

Workspace backups, restores, exports, and imports, for both storage modes.

### What existed, and what was reused

- **Reused:** workspace authorization (`WorkspaceDep`), the attachment store (two streaming
  methods added: `write_stream` and `checksum`), the ORM metadata (the backup engine is driven by
  it rather than by per-module code), the reminder worker (scheduled backups and housekeeping,
  no second scheduler), `argon2-cffi` and `cryptography` (already dependencies), the calendar's
  recurrence rules, the shared CSV-injection guard (moved to `utils/spreadsheet.py` and used by
  the finance CSV too), and the workspace-deletion route (which now also deletes the workspace's
  backups).
- **Not present before:** any restore or import. Backups were the deployment guide's file copies
  and the Documents export.

### Layout

```text
services/backup/
├── catalog.py     # every table: in a module, or excluded with the reason; file columns; match keys
├── rows.py        # records ↔ portable JSON; ID remapping (columns, text, JSON); parents first
├── archive.py     # the ZIP format: writer, manifest, and a reader that treats archives as hostile
├── sources.py     # where restored rows come from: a backup archive or a JSON export
├── encryption.py  # password-protected archives (Argon2id, X25519, HKDF, AES-256-GCM STREAM)
├── writer.py      # snapshot dump into an archive, or into JSON tables
├── restore.py     # restore and import: ID plan, conflicts, inserts, files, verification
├── formats.py     # module exports (CSV, Markdown ZIP, .ics); ics.py and markdown.py
├── schedule.py    # next runs, retries, and the stale-run cutoff
├── ports.py       # protocols for data, records, the archive store, and the file store
└── service.py     # BackupService: what routes and the worker call
repositories/backup.py   # SqlBackupData (generic, metadata-driven) and SqlBackupRecords
system/backup_store.py   # FileArchiveStore: archives and staged uploads on disk
api/v1/backups.py        # routes
```

### Data model

`0021_create_backups` adds, with RLS on PostgreSQL:

- `backups`: a workspace's backup history: kind (`manual`, `scheduled`, `pre_restore`), status
  (`running`, `succeeded`, `failed`), whether files and encryption were used, size and SHA-256 of
  the stored archive, record and file counts per module, warnings, a safe error message, and the
  format, schema, and app versions. A partial unique index on `workspace_id WHERE status =
'running'` allows one running backup per workspace across every API process and worker.
- `backup_settings`: frequency, retention count (1 to 50), files, encryption, the backup key
  (public key and password-sealed private key, never the password), and the next and last run.
- `backup_uploads`: uploaded archives staged for inspection, with status (`uploaded`,
  `restoring`, `completed`, `failed`, `expired`, `discarded`), checksum, and the restore report.

### Backup format and versioning

A backup is a ZIP (`orbit-backup/manifest.json`, `README.txt`, `database/<table>.jsonl`,
`files/<id>`). The manifest records `format: "orbit-backup"`, `format_version` (1), the Orbit
version, the Alembic `schema_revision`, the creation time, the workspace's ID and name, the
owner's ID, the modules, every table's row count, size, and SHA-256, every file's size and
SHA-256, and files that were already missing from storage.

Records are one JSON object per line, every column included: canonical UUID strings (so IDs and
relationships survive), UTC timestamps with `+00:00`, calendar wall-clock times without an offset
(beside the event's IANA zone), dates and times in ISO 8601, money as JSON integers in minor
units with the currency in its own column (never floats), floats as Python's round-tripping
repr, and JSON columns (recurrence rules, note content) nested as stored.

**Included:** every table of every module (`catalog.py`). **Excluded, with reasons in code:**
users, credentials and sessions, avatars, per-person preferences, AI provider keys and settings,
the AI retrieval index (rebuilt by the worker), pending AI action proposals, AI usage, recent
searches, all integration tables (tokens and sync state; accounts are reconnected), and the
backup tables. A test fails if a new table is in neither list, if a column named `blob_id` isn't
declared as a file column, or if a column type isn't supported.

A JSON export (`format: "orbit-export"`) is the same records in one document,
`{"tables": {"tasks": [...]}}`, for one module or all, without files.

### Database provider strategy

One application-level engine serves both databases; there is no database dump, because a dump
can't be scoped to one workspace, would carry other users' rows and secrets, and isn't portable
between SQLite and PostgreSQL. `SqlBackupData` reads every table generically from the ORM
metadata, filtered by `workspace_id` (reminder occurrences through their reminder), and, for
tables with an owner column (health records, notifications), by the person.

- **SQLite:** Python's driver begins a transaction only before a write, so the dump issues an
  explicit `BEGIN`. In WAL mode that read transaction sees one snapshot of every table and
  doesn't block writers (tested by writing from another connection between two tables' reads).
  The live database file is never copied.
- **PostgreSQL / Supabase:** `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`, so all
  tables come from one snapshot. Nothing needs filesystem access to the database server, and no
  Supabase credential is involved.

The snapshot ends before files are copied. Stored files never change (a new version is a new
file), so the files a snapshot names are the ones it meant; one deleted in between is recorded as
missing. Because the format is application-level, a backup made in local mode restores in cloud
mode and the reverse: this is the supported way to move a workspace between installations.

### Restore strategy

`POST …/backup-uploads` streams the file to disk with a size limit (`ORBIT_BACKUP_UPLOAD_MAX_BYTES`)
and checks its structure. `…/inspect` (with the password, for encrypted ones) verifies every
checksum, checks compatibility, and runs a **dry run**: the full restore in a transaction that's
rolled back. `…/restore` runs it with an explicit strategy:

| Strategy        | Target                                        | Guard                                                                                        |
| --------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `new_workspace` | A new workspace (name chosen or "(restored)") | None; nothing existing changes                                                               |
| `into_empty`    | This workspace                                | Refused unless it has no records                                                             |
| `replace`       | This workspace, after deleting its data       | Typed workspace name; refused while integrations are connected; a `pre_restore` backup first |

- **IDs:** kept when none exists anywhere in the database (a fresh installation, a deleted
  workspace, or the workspace being replaced); otherwise **every** ID and file name in the backup
  is replaced, consistently, so a copy beside its original never shares a record. Remapping
  rewrites ID columns and UUIDs inside text and JSON (note links, `series_id`,
  `current_version_id`). The workspace and owner IDs map to the target workspace and the person
  restoring, so a backup can be restored by another account or installation.
- **Atomicity:** all inserts run in one transaction (savepoints nest in it). Files are written
  into the attachment store just before commit, each checked against the manifest's checksum, and
  deleted again on any failure. After inserting, the restore verifies that every table has
  exactly the manifest's row count. Constraints enforce every relationship.
- **Interruption:** if the process dies, the transaction never commits, the upload stays
  `restoring` until its deadline and is then marked failed ("interrupted; nothing was changed"),
  and the orphan sweep removes the unreferenced files. A failed restore can be retried.
- **Replace** deletes the workspace's rows table by table (children first), keeping the workspace
  row, its backup history, settings, the upload, and usage records. Files the replaced data used
  are removed by the existing orphan sweep (within six hours); the pre-restore backup holds them.

### Import architecture

Imports take Orbit JSON exports (from any module, or all) and merge into the current workspace
with the same engine in lenient mode:

- A record whose ID is already in this workspace is a **duplicate** and skipped: importing the
  same file twice adds nothing. A completed upload with the same SHA-256 is also reported, and a
  second use needs `allow_repeat`.
- A record whose ID exists in another workspace gets a new ID, with references updated.
- Categories, tags, built-in exercises, and the default shopping list are **matched** to
  existing ones by natural key (`MATCH_KEYS`) instead of duplicated.
- Records that break a rule or refer to records in neither the file nor the workspace are
  **skipped** (each failing batch is retried row by row in savepoints) and counted per table.
  Nothing is overwritten.

CSV, Markdown, and `.ics` files are export formats only; importing them would need per-format
mapping and is not implemented.

### Export architecture

`POST …/exports` builds a module export from one snapshot into a temporary file, streams it,
and deletes it: JSON for every module; CSV (one table, or a ZIP of one CSV per table) for tasks,
shopping, reminders, habits, and health; Markdown (a ZIP of `.md` files with YAML front matter in
their folders, archived and trashed notes in `Archive/` and `Trash/`) for notes; and iCalendar
for the calendar (`TZID` times with generated `VTIMEZONE`s, Orbit's month-end and leap-day rules
as `BYMONTHDAY…;BYSETPOS=-1`, `EXDATE`s for skipped occurrences, `RECURRENCE-ID` overrides,
`VALARM`s, folded lines). `POST …/exports/archive` builds a full backup archive for download
without keeping it. Finance's transaction CSV and the documents ZIP keep their own endpoints.

### Encryption approach

Optional, per backup (`encryption.py`), from standard primitives only: Argon2id (64 MiB, three
passes, four lanes, random 16-byte salt) derives a key from the password; it seals an X25519
private key with AES-256-GCM. Each archive gets a random 256-bit file key, wrapped for that key
pair (ephemeral X25519, HKDF-SHA256, AES-256-GCM), and the archive is encrypted in 64 KiB
AES-256-GCM chunks with the STREAM nonce construction and the header as associated data, so
chunks can't be reordered, truncated, or swapped. The sealed private key travels in each archive,
so it opens with its password alone, anywhere. Automatic backups use the workspace's stored
public key, so the server encrypts them without the password; the password is never stored,
logged, or put in a URL. A wrong password fails on the sealed key; tampering fails on the first
bad chunk; a header can't demand more than 1 GiB of Argon2 memory. Encryption protects backup
files only: Orbit's live data still relies on disk encryption.

### Scheduling behavior

The reminder worker checks for due automatic backups every minute and tidies up hourly. A run
is claimed by moving `next_run_at` with a conditional update, so concurrent workers never run
the same backup, and the running-backup index prevents overlap with a manual one. The next run is
the previous scheduled time plus the interval, moved past now: a server that was off runs one
backup on start, not one per missed interval. A failure is recorded on the backup (status and a
safe message) and retried an hour later. After a success, successful automatic backups beyond
the retention count are deleted (manual and pre-restore backups are kept until deleted).
Housekeeping fails backups running for more than six hours and restores past their deadline,
expires uploads after 24 hours, and deletes temporary files left by a crash.

### Security

- Every route is workspace-scoped through `WorkspaceDep`; another person's backup or upload IDs
  are 404s. Archives are downloaded only through authorized routes with `private, no-store`
  headers; there are no public or signed URLs. Archive files are `0600` in `0700` folders.
- Uploaded archives are untrusted: only exact entry names are accepted (no `..`, absolute paths,
  or extra entries), names are never used as paths, encrypted ZIP entries and unusual compression
  are refused, the total declared size is bounded (`ORBIT_BACKUP_MAX_EXTRACTED_BYTES`) before
  anything is decompressed, each entry's compression ratio is capped, every entry must match the
  manifest's size, lines are length-limited, and content must match the checksums. JSON exports
  are capped at 256 MB. Errors never echo archive contents or passwords; logs carry IDs and error
  types only.

### Migration and compatibility rules

- `format_version` changes only when the archive layout changes; a newer one is refused.
- `schema_revision` must be one this version knows (newer: "update Orbit"). An older revision is
  accepted and checked record by record: a column this version lacks is refused (its data would
  be lost), a column the backup lacks is filled from its default, or refused if it has none.
- When a migration changes the meaning of existing data (a rename, a unit change), add an
  upgrade step for older backups keyed by revision, alongside the migration. Adding a table means
  classifying it in `catalog.py` (the test fails otherwise).

### Limitations

- Backups are stored on the API's machine (`ORBIT_BACKUPS_PATH`); there are no cloud-storage
  targets. Download copies to keep them elsewhere.
- Restores and imports run within the request; very large backups take as long as their files
  take to copy. JSON exports are parsed whole (up to 256 MB).
- A dry run inserts and rolls back every record, so inspecting a large backup takes a while and
  holds SQLite's write lock meanwhile.
- Per-person preferences, AI settings, and integrations aren't backed up; a restored workspace
  is reindexed for AI by the worker.
- Replacing a workspace with connected integrations is refused; restoring as a new workspace
  isn't.
- Monthly schedules started on the 29th to 31st run on the 28th after the first short month.
- Importing CSV, Markdown, or `.ics` isn't supported.

## Personal agent and automation

A personal agent and workflow engine built on the AI layer, the modules' own services, and the
existing worker. People configure what it may do; workflows run steps that Orbit's code orders and
checks; the agent plans one tool call at a time; and anything that changes a record either needs
an approval bound to that exact action or is a low-risk action the person explicitly allowed. It
is off by default, per person and workspace, and deterministic workflows and monitoring work
without any AI provider.

### What existed, and what was reused

- **Reused:** the AI layer's provider resolution and policy (`AiConfigService`: on/off, cloud
  consent, monthly token limit, `MeteredProvider` usage records), its structured module sources
  (`ContextBuilder`, so figures are Orbit's), `AssistService` (note and document summaries and
  extraction), the record fencing in `prompts.py`, and the proposal validator and executor in
  `api/ai_actions.py` (writes are validated by the target module's request schema and run by its
  service); the reminder worker as the only scheduler (leases, conditional claims, periodic jobs);
  `FlushTransaction` from integrations; in-app notifications; `WorkspaceDep` authorization.
- **Not present, so not built on:** an event bus (modules publish no events), an audit log, and
  multi-device sync. Event triggers are found by checking the modules' own rows; the execution
  history is the agent's audit trail; concurrency between API processes and `orbit-worker`
  processes on one database is handled by leases, which is the only "multiple devices" case Orbit
  has.

### Layout

```text
services/agent/          framework-free
├── models.py            agent, workflow, trigger, execution, step, approval, memory, finding types
├── tools.py             ToolSpec, ToolHandler, ToolRegistry, call fingerprints, mail contract
├── policy.py            decide(): permissions and autonomy for one call
├── triggers.py          schedules (DST-safe), conditions, templates, workflow validation
├── planner.py           the planner's rules, reading its replies, fencing tool results
├── engine.py            the execution engine and state machine
├── service.py           what the person does: settings, workflows, runs, history, approvals, memory
├── signals.py           event and condition signals from the modules' data
├── monitoring.py        deterministic monitoring findings
├── automation.py        the worker's jobs: schedules, triggers, expiry, monitoring, claims, recovery
└── safety.py            redaction and size limits for history
api/agent_tools.py       the concrete tools (module request schemas and services)
repositories/agent.py    SQL for the seven agent tables, the change feed, the AI gateway
repositories/agent_services.py  builds it all on one session
api/v1/agent.py          routes
```

### Agent model

`agents` holds one primary agent per person and workspace (a partial unique index; the table
allows more for later specialized agents): name, description, enabled, standing instructions,
an optional model override on the AI layer's chat provider, autonomy level, allowed modules,
per-tool modes, allowed action types (`create`, `update`; reading is always allowed), triggers
whose runs may act automatically, limits, memory, notification, and monitoring settings. It is
created turned off the first time it is asked for. Only `PATCH …/agent` changes it.

### Tool registry

Every tool declares a name, description, input schema (a Pydantic model with `extra="forbid"`),
output schema (one envelope: `text`, `records`, `data` with `count`), module, access (`read`,
`create`, `update`), risk, idempotency, whether it always asks, whether it sends record content
to the AI provider, and whether workflows may use it. `GET …/agent/tools` lists them with what the
agent would do with each right now.

| Module              | Read                                                                                                             | Write (risk)                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Tasks               | `search_tasks`                                                                                                   | `create_task` (low), `complete_task` (low), `update_task` (medium)           |
| Reminders           | `get_reminders`                                                                                                  | `create_reminder` (low), `send_notification` (low, in-app to the owner only) |
| Calendar            | `search_calendar` (overlaps found by Orbit)                                                                      | `create_event` (medium)                                                      |
| Notes               | `search_notes`, `summarize_note` (AI)                                                                            | `create_note` (low), `append_to_note` (medium), `add_note_tags` (low)        |
| Documents           | `search_documents`, `get_document` (no reference numbers), `summarize_document`, `extract_document_details` (AI) | `update_document_details` (medium; descriptive fields only)                  |
| Finance (read only) | `get_accounts`, `get_transactions`, `get_finance_summary`, `get_budgets`, `get_upcoming_payments`                | none                                                                         |
| Habits, health      | `get_habit_progress`, `get_workout_history`, `get_health_summary` (owner only)                                   | none                                                                         |
| Mail (read only)    | `search_email` (the labels chosen for Orbit, through the integrations' mail service)                             | none                                                                         |
| The agent's own     |                                                                                                                  | `remember_preference`, `run_workflow` (agent runs only; both always ask)     |

There is no tool that deletes, pays, transfers, invests, sends email or messages, shares
documents, changes connected accounts, or changes settings or permissions, and none that runs
code, SQL, shell commands, or HTTP requests. Every call is prepared (arguments validated by the
tool's model, then by the module's request schema for writes, and the target looked up) before
it can run or be proposed, and prepared again when an approval is acted on.

### Permission and autonomy model

`policy.decide` runs in code for every call, from the agent's stored settings, the tool's spec,
and what started the run. Nothing a model writes is an input to it.

1. Agent off → deny. Tool set to `off` → deny. Tool's module not allowed → deny.
2. When a model will see the result (agent runs) or the tool summarizes with AI, the AI layer must
   also allow the module (mail and the agent's own records excepted).
3. Reads → allow. Writes need their action type allowed, then:

| Level         | Writes                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 0 `read_only` | Refused                                                                                                                               |
| 1 `suggest`   | Recorded as a suggestion; never run                                                                                                   |
| 2 `approval`  | Run only after the person approves that exact call                                                                                    |
| 3 `limited`   | Runs on its own only if low risk, set to `auto`, from an allowed trigger, within the daily quota of automatic actions; otherwise asks |

High-risk and `always_confirm` tools ask at every level that can write. A permission revoked
after an approval was requested makes the approval fail when acted on.

### Workflows

A workflow has a name, description, trigger, conditions (checked against the trigger's values
before a run is created), up to 20 ordered steps, a daily run limit, and an on/off switch. Steps:

| Kind        | What Orbit does                                                                                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tool`      | Renders `{{trigger.x}}` / `{{steps.id.x}}` placeholders as plain text, then calls the tool through the policy; optional `continue_on_error`                            |
| `condition` | Compares a named value with a constant (`eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `contains`, `not_contains`, `exists`); when false, jumps forward to a later step or ends |
| `delay`     | Waits 1 minute to 7 days (the execution sleeps as `waiting`)                                                                                                           |
| `approval`  | A checkpoint the person approves before the rest runs                                                                                                                  |
| `ai`        | Writes text with the AI provider from earlier outputs, fenced as data; no tools                                                                                        |

Definitions are validated on save: known tools workflows may use, unique step IDs, forward-only
jumps (no loops), placeholders that name earlier steps, and a complete trigger. Workflows can't
start other workflows.

### Triggers

| Trigger   | How it is detected                                                                                                                                                                                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schedule  | Daily, weekly (days), monthly (day, clamped to the month), or once, at a wall-clock time in a time zone; `next_run_at` stored and claimed                                                                                                                               |
| Event     | Task created or completed, reminder delivered, imported calendar event changed, budget alert sent: rows changed since the workflow's cursor. Event approaching (lead time), document expiring (days ahead), habit missed yesterday: a window from the modules' services |
| Condition | A metric (overdue tasks, tasks or payments due soon, highest budget use, documents expiring, unread notifications) checked every N minutes; fires when it becomes true, not while it stays true                                                                         |
| Manual    | `POST …/workflows/{id}/run`, or the agent's `run_workflow` tool after approval                                                                                                                                                                                          |

Each signal has a stable key (a record with its date or time), and an execution's
`trigger_key` is unique per agent, so a slot, an event, or a manual run's idempotency key
starts at most one execution however many workers see it. Event triggers check every minute;
"new email received" isn't a trigger, because mail is read on demand and never synchronized.

### Execution engine and state machine

```text
queued ──claim──▶ running ──▶ succeeded | failed | cancelled
   ▲                 │
   ├── approved ◀── waiting_approval
   └── resume_at ◀─ waiting (delay, retry backoff)
```

- **Agent runs** (`POST …/agent/runs`) send the planner the rules, the tools it may use, the
  person's standing instructions, saved preferences, recent runs, and the request; it replies
  with one JSON step at a time. Unknown tools, unpermitted tools, and invalid arguments are
  refused and the reason is given back; unreadable replies are retried twice, then fail the run.
- **Bounds:** steps, tool calls, time per active stretch (waiting for a delay, a retry, or a
  person doesn't count), tokens per run (and the AI layer's monthly limit), runs per day per agent
  and per workflow, automatic actions per day. Read and model failures retry with backoff (30 s,
  doubling) up to the retry limit; writes are never retried automatically.
- **Checkpoints:** after every step, the cursor and state (step outputs, the planner's
  transcript, retry counts) are saved with the step's record in one transaction. Write tools run
  on module services with a flush-only transaction, so a write commits together with its step:
  a crash before the commit leaves neither, so resuming can't duplicate it.
- **Cancellation** is checked before every step; cancelling a waiting run ends it at once and
  cancels its approvals.
- **Retry** (`POST …/executions/{id}/retry`) resumes a failed run from the failed step, which by
  construction changed nothing.

### Approval lifecycle

An approval stores the exact normalized call, a SHA-256 fingerprint of it (`arguments_hash`), a
summary, the reason, the run it belongs to, the target record, the expected effect, risk,
whether it followed untrusted content, and an expiry (24 hours by default).

`pending` → `executing` → `executed` | `failed`; or `rejected`, `expired`, `cancelled`.

- Approving requires the `arguments_hash` the person was shown; a different one is 409.
- Before running: the agent must be on, the policy must still allow the call, the call is
  prepared again (the record must still exist and the module's rules still pass), and its
  fingerprint must still match. If preparing it again gives a different call, the approval is
  cancelled and a new one is requested for the action as it is now.
- `pending` → `executing` is a conditional update, so a double click or a second tab runs
  nothing twice (409).
- The action runs in the request, its step and the approval are recorded, and the run is queued
  to continue. Rejecting a workflow's step cancels the run; rejecting an agent's proposal tells
  the planner, which continues.
- Expired approvals cancel their run; the worker and the approvals list both expire them.

### Memory

- **Working memory:** the execution's state (step outputs, transcript), deleted with it.
- **Conversation memory:** the agent's last five runs (request and outcome), for the planner.
- **Saved preferences:** written by the person, or proposed by the agent with
  `remember_preference`, which always asks; listed, edited, and deleted under Settings.
- **Workflow memory:** each workflow's last five outcomes, available to its `ai` steps as
  `{{workflow.last_outcome}}`.

Each category can be turned off. Finished executions and workflow memory older than the retention
period (90 days by default) are purged hourly. Retrieved records, documents, and emails are never
stored as memory.

### Monitoring

Off by default. Chosen categories (overdue tasks, upcoming deadlines, calendar conflicts,
upcoming events, bills, budget warnings, unusual spending, expiring documents, documents missing
details, missed habits, workout consistency) are checked hourly, every 6 hours, or daily by
code reading the modules' services, with configurable look-ahead and thresholds. Each finding
item has a key with its record and date, stored in `agent_monitor_alerts`, so it notifies once.
Categories need their module's permission; health data is read only for its owner.

### Notifications

In-app notifications only, per the person's choices: approval requests, failed runs, completed
runs (off by default), and monitoring findings. Each is sent from a state transition that happens
once, so none repeat. Orbit never emails or messages anyone on the agent's behalf.

### Scheduling, local and cloud execution

The agent's jobs run on every poll of the reminder worker (`ORBIT_SCHEDULER_POLL_SECONDS`): expire
approvals, start due schedules, check event and condition triggers, monitor, purge (hourly), then
claim and advance up to five executions with a five-minute lease.

- **Local mode:** automations run while Orbit's API (with its embedded worker) or `orbit-worker`
  runs. Nothing runs while it's closed; a missed schedule runs once when it starts again if the
  slot is less than a day old (later slots are skipped, never replayed one by one); events that
  happened while closed are found from their timestamps. The UI says this.
- **Cloud mode:** the same worker runs on the server, so automations don't depend on a browser.
- **Several processes on one database** (API replicas, standalone workers) never duplicate work:
  schedule slots and trigger checks are claimed by conditional updates, executions by lease, and
  trigger keys are unique. A worker that dies mid-run leaves a lease that expires; another worker
  resumes from the last checkpoint. Three unexpected crashes fail the run.
- `ORBIT_AGENT_ENABLED=false` turns the agent off for everyone: runs can't start or be turned on,
  approvals can't be acted on, and the worker skips agent jobs.

### Security boundaries and prompt injection

- Tool results are fenced as `<orbit-tool-result>` data; the planner's rules say their content is
  never an instruction; fence markers inside results are neutralized so a record can't close the
  fence or open another. The real controls are in code: tool allowlists, schema validation,
  `policy.decide` for every call, approvals bound to fingerprints, quotas and limits.
- Approvals proposed after reading records, emails, or trigger data are flagged so the person
  looks twice. Untrusted text reaches tools only as template values, validated by the tool's
  schema.
- There is no path from a model to settings, permissions, limits, or memory without approval.
- Every query is scoped to the workspace and owner; another person's workflow, run, approval, or
  memory is 404.
- Step arguments, outputs, reasons, and errors are redacted (credential-like keys and values
  masked) and size-limited before they are stored; errors are safe messages, never exception
  text; logs carry IDs only.
- On PostgreSQL the seven tables have Row Level Security enabled with no policies, like the rest.
- Backups leave the agent tables out on purpose: restoring must not start automations, replay
  approvals, or resume runs.

### API

| Method and path                                               | Purpose                                        |
| ------------------------------------------------------------- | ---------------------------------------------- |
| `GET`, `PATCH …/agent`                                        | Overview and runtime; settings and permissions |
| `GET …/agent/tools`                                           | The registry, with current decisions           |
| `POST …/agent/runs`                                           | Ask the agent (202, idempotency key)           |
| `GET …/agent/executions`, `GET …/{id}`                        | History; one run with its steps and approvals  |
| `POST …/agent/executions/{id}/cancel`, `/retry`               | Cancel; retry a failed run                     |
| `GET`, `POST …/agent/workflows`; `GET`, `PUT`, `DELETE /{id}` | Workflows                                      |
| `POST …/agent/workflows/{id}/enabled`, `/run`                 | Turn on or off; run now                        |
| `GET …/agent/approvals`; `POST /{id}/approve`, `/reject`      | The approval center                            |
| `GET`, `POST …/agent/memories`; `PATCH`, `DELETE /{id}`       | Memory                                         |

`…` is `/api/v1/workspaces/{workspace_id}`.

### In the web app

**Automation** (`/automation`, five sections in a side rail, as chips when narrow, and in the
URL): Home (on/off and level, ask the agent, approvals waiting, templates to try before any
workflow exists, recent runs); Workflows (each with its trigger, next run, on/off, and a menu to
run, edit, or delete; below them a template gallery filtered by category that notes modules the
agent isn't allowed yet; a template opens the editor filled in, and `?template=<id>` opens it
from a link; the old `?tab=templates` lands here); Approvals (each action's effect, reason,
risk when not low, untrusted-content warning, arguments under Details, expiry; earlier decisions
as a short list); History (all, running, or failed runs; each run's steps with reasons, details,
outputs, linked records, failures, cancel and retry); and Settings (autonomy, modules, record
types, instructions, notifications, monitoring, the memory list, and where automations run;
per-action modes, limits, memory settings, and the model sit under Advanced). Views with runs in progress refresh every five seconds.

### Known limitations

- Event triggers are detected by polling the modules' timestamps every minute, not pushed.
- "New email received" isn't a trigger: mail is read on demand and never synchronized.
- No tool writes to external calendars or files; imported events change only through sync.
- Agent planning uses JSON replies rather than native function calling, so small local models may
  produce invalid steps (refused and retried, then the run fails).
- A run in a single worker isn't interrupted mid-model-call by cancellation; it stops before its
  next step.
- Model calls are recorded in AI usage as `assist`.
- Agent configuration, workflows, and memory are not in backups; set them up again after a restore.
- Tested on SQLite; the PostgreSQL path is covered by the shared migration and RLS conventions but
  not by agent-specific PostgreSQL tests.

## Configuration

| App | Source                                                    | Validation                                    | Visibility  |
| --- | --------------------------------------------------------- | --------------------------------------------- | ----------- |
| API | `ORBIT_*` environment variables, optional `apps/api/.env` | `Settings` in `config.py` (pydantic-settings) | Server-only |
| Web | `NEXT_PUBLIC_*` variables, optional `apps/web/.env.local` | `src/lib/env/env.ts`                          | Public      |

- Configuration is read in exactly one place per app. Other modules receive it from there
  (`get_settings()` or `publicEnv`).
- Invalid configuration fails at startup with a clear error. Production rejects wildcard CORS
  origins and disables interactive API docs.
- Only `.env.example` files with placeholder values are committed. Variable reference:
  [development.md](development.md#environment-variables).

## Testing strategy

| Layer                    | Tool                                             | Location                                                                                                                        | Current coverage                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web units and components | Vitest, Testing Library, jsdom                   | `apps/web/src/**/*.test.ts(x)`, co-located                                                                                      | Shell, API client, auth flows, route guard, workspace switching and stale data, tasks, reminders, notifications, finance, investments, net worth, budgets, goals, plans, notes (views, autosave, Markdown, palette), calendar (views, dialogs, drag, scopes, palette), documents (views, uploads, details, links), health (units, forms, overview, workout logging, water, event workouts), dashboard (widgets, preferences, partial failures, quick actions, palette search), universal search (page, keyboard, tabs, filters, paging, history, deep links), AI (assistant streaming and sources, proposals, settings, contextual menu, Markdown, stream parsing), integrations (connecting, calendars, conflicts, mail, files, callback, origins), backup and restore (overview, history, encrypted backups, deletion, restore strategies and confirmation, passwords, imports, incompatible files, schedule, exports)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| API routes and config    | Pytest, FastAPI `TestClient`                     | `apps/api/tests/`                                                                                                               | Health, CORS, settings, local auth, Supabase tokens (mocked keys), workspaces, tasks, reminders, notifications, finance, budgets, goals, plans, notes, calendar, documents (uploads, validation, versions, export, sweep), health and fitness (library, templates, workouts and sets, records, measurements, photos, nutrition, goals, habit, calendar, note, and document integrations, per-person privacy), daily overview (time zones, sections, partial failures), cross-module search, universal search (every type, tiers, filters, paging, freshness, health owner scoping, partial failures, recent and saved searches, PostgreSQL), dashboard preferences, AI (settings, encrypted keys, cloud consent, grounded streaming answers and citations, permissions, proposals and single approval, prompt injection, isolation, indexing and semantic search, assist, insights, usage and limits; provider adapters over mocked HTTP; chunking, extraction, routing, prompts), integrations (OAuth state and PKCE, encrypted tokens, refresh and revocation, calendar import, recurrence, duplicates, pagination and checkpoints, rate limits, conflicts, two-way, webhooks, mail scope, file import and changes; Google and Graph adapters over mocked HTTP), backups (round trips across every module, restore strategies, ID remapping, encryption and wrong passwords, tampered, truncated, traversing, and oversized archives, incompatible schemas, interrupted restores and rollback, imports with duplicates and matching, exports, scheduling, retention, snapshot consistency; catalog, encryption, ICS, and Markdown units), cross-user isolation |
| Scheduling               | Pytest, pure functions and a controllable clock  | `tests/test_recurrence.py`, `tests/test_calendar_recurrence.py`, `tests/test_reminder_worker.py`, `tests/test_budget_alerts.py` | Recurrence, DST, month ends, leap years, exceptions; delivery, concurrency, leases, retries, restarts; event alerts; budget alerts and period closing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Services                 | Pytest, in-memory fake repositories              | `apps/api/tests/test_*_service.py`                                                                                              | Onboarding, concurrent provisioning, ownership checks, task completion rules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Database (SQLite)        | Pytest, temporary SQLite files                   | `apps/api/tests/test_database.py`, etc.                                                                                         | Startup checks, sessions, migrations, constraints, 503 errors                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Database (PostgreSQL)    | Pytest, opt-in (`-m postgres`)                   | `apps/api/tests/test_postgres.py`                                                                                               | Migrations, connectivity, RLS, feature SQL (including the AI layer and a backup and restore round trip); skipped by default                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Contract freshness       | Pytest + `openapi-typescript --check`            | `tests/test_openapi.py`, contracts `lint`                                                                                       | Generated contract matches the API                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Authorization matrix     | Pytest, every OpenAPI operation                  | `tests/test_authorization_matrix.py`                                                                                            | 401 without a valid session outside an explicit public allowlist; the same 404 for another person's or an unknown workspace on every workspace route; nothing changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Concurrent devices       | Pytest, `httpx` ASGI client, concurrent requests | `tests/test_concurrent_devices.py`                                                                                              | Two sessions writing at once: no lost or duplicated transactions, exact balances, one winner for simultaneous note saves, independent sign-out                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Observability            | Pytest                                           | `tests/test_health.py`                                                                                                          | Liveness, readiness (database and schema), request IDs, security headers, no query strings in logs, JSON log format                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| End-to-end               | Playwright (Chromium)                            | `apps/web/e2e/`                                                                                                                 | Sign-up, signed-out redirect, adding and completing a task, quick capture found by universal search, password change and sign-in; real API on a throwaway SQLite database, no external services                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

Unit tests cover logic, route tests cover HTTP behavior and validation, and E2E tests cover a few
critical journeys in a real browser. CI runs every layer on each pull request, including the
PostgreSQL tests against a `postgres:17` service and a dependency audit.

API tests share one database migrated per test run: the `migrated_settings` fixture copies it,
so each test still gets its own fully migrated database without re-running every migration
(which took most of the suite's time). Migration tests that need an unmigrated or downgraded
database use `settings` and run the migrations themselves.

## Observability

- `orbit_api/observability.py` holds an ASGI middleware, outermost in the stack, that gives each
  request an ID (a caller's plain `X-Request-ID` of up to 64 characters is kept, anything else
  replaced), returns it in `X-Request-ID`, and stamps it on every `orbit_api` log record through
  a context variable. It logs one line per request: method, path without the query string,
  status, and duration. Successful `/api/v1/health*` probes aren't logged.
- Uvicorn's access log is off (`__main__.py`): it prints query strings, which carry search
  terms and, for Microsoft webhooks, validation tokens.
- `ORBIT_LOG_FORMAT=json` switches `orbit_api` logs to one JSON object per line, with extra
  fields (`http_status`, `duration_ms`, and so on) as keys.
- The same middleware adds `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, and `Cache-Control: no-store` to responses that don't set
  their own (file downloads and the profile photo do).
- Health: `/health/live` (process), `/health/ready` (database reachable and at this version's
  schema revision, else 503), `/health/database` (connectivity and storage mode).
- The web app sends `X-Frame-Options`, `nosniff`, a referrer policy, a permissions policy, and
  a partial Content-Security-Policy (`frame-ancestors`, `object-src`, `base-uri`,
  `form-action`) from `next.config.ts` (`src/lib/security-headers`). Scripts and connections
  aren't restricted: that needs per-request nonces and the deployment's API and Supabase URLs.

## Planned architecture

> **Not implemented.** This section records intended direction so that early features don't
> block it. Build each piece only when a feature needs it, and update this document when it
> lands.

### Backend layering

Storage layers are described under [Backend layers](#backend-layers). External services live in
`providers/` (AI providers in `providers/ai/`, Google and Microsoft in
`providers/integrations/`), behind interfaces, so services don't import vendor SDKs.

### Storage

The database foundation is implemented (see [Storage](#storage)). Still planned:

- More product tables (later [finance](#finance) phases), following the pattern
  [tasks](#tasks) established.
- Shared workspaces (a membership table, invitations, roles), if the product needs them.
- Any synchronization or migration between local and cloud storage. This is undecided and
  needs its own design.
- Object storage for attachment and document files, behind the existing `FileStore` protocol,
  and application-level encryption at rest with a real key-management design (see
  [Encryption](#encryption)).

### AI

The provider interface, retrieval, and the assistant are implemented; see
[AI intelligence layer](#ai-intelligence-layer). Still planned: a pgvector adapter behind the
same chunk store for large cloud indexes. The agent and workflows are implemented; see
[Personal agent and automation](#personal-agent-and-automation).

### Evolution

Workspace-scoped [tasks](#tasks), [reminders](#reminders-and-notifications) (with a
database-backed worker), and four phases of [finance](#finance) (ledger, commitments,
[investments and net worth](#investments-and-net-worth-phase-3), and
[budgets, savings goals, and planning](#budgets-savings-goals-and-planning-phase-4)), and
[notes](#notes-and-knowledge-management), the [calendar](#calendar-and-events), [habits](#habits-and-routines), [documents](#documents-and-the-personal-vault), [health](#health-and-fitness), and the
[daily dashboard and command center](#daily-dashboard-and-command-center), the
[AI intelligence layer](#ai-intelligence-layer), and
[external integrations](#external-integrations), and
[backup, restore, and data portability](#backup-restore-and-data-portability) are in place.
Next: more modules on the same pattern, then optional sync and extension points.
Each step should leave the boundaries above intact.

## Continuous integration

`.github/workflows/ci.yml` runs on pull requests and on pushes to `main`:

- **Web:** frozen pnpm install, ESLint, Prettier check, contract freshness, `tsc`, Vitest, and
  `next build`.
- **API:** locked uv sync, Ruff lint and format check, Pyright, and Pytest (including the
  contract freshness test).
- **Commit messages (PRs only):** commitlint over the PR's commits.

CI requires no secrets. API tests use temporary SQLite databases. The PostgreSQL tests are
skipped unless `ORBIT_TEST_DATABASE_URL` is set.

`.github/workflows/containers.yml` builds both container images and smoke-tests the Docker
Compose stack (migrate, API, web) on every pull request. On pushes to `main` and `v*` tags it
publishes multi-architecture images to the GitHub Container Registry, using only the workflow's
own `GITHUB_TOKEN`.

## Deployment

Each app has a Dockerfile built from the repository root: `apps/api/Dockerfile` (uv, a
non-editable install in a slim Python image, data in a `/data` volume) and `apps/web/Dockerfile`
(Next.js `output: "standalone"`, so the image carries only traced dependencies). Both run as
unprivileged users. `compose.yaml` runs a one-shot migration, then the API and web app, and an
optional Caddy profile serves both on one HTTPS origin. Images change no application behavior:
configuration still flows through `ORBIT_*` settings and `NEXT_PUBLIC_API_URL`, which is inlined
at build time. Operator guide: [deployment.md](deployment.md).
