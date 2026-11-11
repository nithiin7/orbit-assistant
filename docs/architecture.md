# Architecture

How the Orbit repo is organized and why. Sections describe the **current implementation** unless
marked **planned** (planned code does not exist yet); coding-agent rules live in
[`AGENTS.md`](../AGENTS.md).

## Overview

```text
Browser ──► apps/web (Next.js, :3000) ──HTTP/JSON──► apps/api (FastAPI, :8000) ──► database
                                              local mode: SQLite file on this machine
                                              cloud mode: PostgreSQL (Supabase)
```

- **apps/web** renders the UI; **apps/api** owns data access and business logic: health, sign-in
  config and local accounts, profile, workspaces, and the product modules ([tasks](#tasks),
  shopping, [reminders](#reminders-and-notifications), [finance](#finance),
  [notes](#notes-and-knowledge-management), [calendar](#calendar-and-events),
  [habits](#habits-and-routines), [documents](#documents-and-the-personal-vault),
  [health and fitness](#health-and-fitness),
  [dashboard](#daily-dashboard-and-command-center), [search](#universal-search),
  [AI](#ai-intelligence-layer) and the [agent](#personal-agent-and-automation) (both off until
  each person turns them on), [integrations](#external-integrations), and
  [backup](#backup-restore-and-data-portability)).
- The apps share no runtime code, only the contract in `packages/contracts`.

## Dependency boundaries

- `apps/web` may use `@orbit/contracts` (types only) and its own packages; never `apps/api`
  code, Python, server secrets, or a database. `apps/api` depends on nothing in `apps/web` or
  `packages/`. `packages/contracts` has no runtime deps; the config packages hold no app code.
- The web app never connects to a database or holds DB credentials.
- Web layers: `src/app` → `src/components` → `src/hooks` → `src/providers` → `src/api`,
  `src/lib` → `src/utils` (enforced in `apps/web/eslint.config.mjs`). `src/providers` (auth,
  workspaces, avatar, query client, theme) may use other providers, never components or hooks.
  `src/api` depends only on `@orbit/contracts`, `@tanstack/react-query`, `src/lib/env`, and pure
  `src/lib` helpers (e.g. `src/lib/shopping`). `src/components/ui` depends only on
  `src/utils/common`.
- The TanStack Query cache is cleared whenever the signed-in user changes.
- Yup schemas mirror API validation for instant feedback; the API still validates everything.
- `Select`, date picker, and money input are custom controls in `src/components/ui/`; popups use
  the Popover API so they sit above modal dialogs. Money groups per currency: lakhs/crores for
  INR, thousands otherwise.

## Shared API contract

`apps/api` Pydantic models → `pnpm contracts:generate` → `packages/contracts/openapi.json` and
`src/schema.ts` (generated, committed) + `src/index.ts` (hand-written aliases) → `import type` in
`apps/web/src/api/`.

- Pydantic is the only schema language. Generated files are committed so reviewers see contract
  diffs and web builds need no Python.
- Drift checks (both in CI): `tests/test_openapi.py` fails on stale `openapi.json`;
  `openapi-typescript --check` (contracts `lint` script) fails on stale `schema.ts`; `tsc` then
  flags mismatched web code.
- The schema is exported with fixed test settings so local `.env` values never leak into it.
- `@orbit/contracts` is type-only: no runtime code, no build step.

## Monorepo tooling

pnpm workspaces + `pnpm-lock.yaml` / uv workspace + `uv.lock`; ESLint (flat) / Ruff; Prettier
(+ Tailwind plugin) / Ruff formatter; `tsc` strict / Pyright strict; Vitest + Testing Library /
Pytest + TestClient. One tool per concern per language: `eslint-config-prettier` disables
stylistic rules, Prettier ignores Python.

### Driving Python from pnpm

`apps/api/package.json` scripts are each a single `uv run …`, so root `pnpm -r` scripts fan out
across both stacks; `uv` still works directly in `apps/api`.

### Python workspace

Root `pyproject.toml` is a _virtual_ uv workspace root (member list + shared Ruff config only).
`apps/api/pyproject.toml` holds deps, the `dev` group, and Pyright/Pytest settings. One `.venv`
at the repo root.

### Shared JS packages

`@orbit/typescript-config` (`base.json`, `nextjs.json`) and `@orbit/eslint-config/next`
(`eslint-config-next` + deterministic import sorting + Prettier compat); consumed via
`workspace:*`, no build step.

## Web app

Non-obvious locations in `apps/web/src/`: `app/(app)/` (signed-in: `RequireAuth` +
`WorkspaceProvider` + shell; `[section]/` placeholder for unbuilt nav sections), `app/(auth)/`,
standalone `app/not-found.tsx`; `components/markdown/` (model output, no HTML);
`lib/navigation.ts` and `lib/settings.ts` (sources of truth for nav and settings panels).

Design decisions:

- **Navigation is data.** `lib/navigation.ts` drives sidebar, mobile drawer, dashboard module
  list, and the statically generated `[section]` routes (`dynamicParams = false`, so unknown
  sections 404). A dedicated route folder takes precedence over `[section]`.
- **Mobile navigation uses native `<dialog>`** for focus containment, Escape, and inert
  background without a library.
- **Theming:** `next-themes`, `class` strategy, CSS variables, shadcn/ui-compatible
  (`components.json`).
- **Server Components by default**; `"use client"` only where needed.
- **Route groups:** `RequireAuth` shows a loading screen until the session is confirmed and
  redirects to `/sign-in?next=…` (validated against open redirects by `lib/auth/redirect.ts`).

## API

Non-obvious locations in `apps/api/src/orbit_api/`: `api/auth.py` (the single auth gate),
`api/ai_actions.py` (AI proposals validated by module schemas, run by module services),
`system/` (OS file manager, file store, ZIPs), `scheduler/` (reminder worker, embedded or
`orbit-worker`), `db/columns.py` (`UTCDateTime`), `db/base.py` (constraint naming convention).

Design decisions:

- **Application factory:** `create_app(settings)` lets tests build isolated apps without the
  process environment.
- **Config:** `ORBIT_*` env vars (plus optional `apps/api/.env`), type-validated at startup.
  Production rejects wildcard CORS and disables interactive docs.
- **Versioned routes** under `/api/v1`; breaking changes go to `/api/v2` alongside.
- **Fail-fast startup:** opens the DB for `ORBIT_STORAGE_MODE`, checks connectivity and head
  migration, logs mode and target; any failure exits, never falls back.
- **Safe DB errors:** `OperationalError`, `InterfaceError`, pool timeouts, and driver connection
  errors are logged server-side and returned as `503 {"detail": "The database is unavailable."}`
  without paths, hosts, or SQL.
- **Safe validation errors:** 422s say where and why but never echo submitted values (so
  passwords aren't reflected or logged by proxies).
- **Auth everywhere but health and sign-in**; see
  [Identity and authorization](#identity-and-authorization).

## Storage

Two **storage modes** per deployment via `ORBIT_STORAGE_MODE`: `local` (SQLite file, default,
`aiosqlite`, single user, data stays on the machine) and `cloud` (PostgreSQL on Supabase,
`asyncpg`, hosted). Both use async SQLAlchemy 2.x and the same Alembic migrations; SQLite is
embedded, no DB server.

### Selecting a mode

- Explicit, validated at startup:
  - `local` uses `ORBIT_SQLITE_PATH` (default `apps/api/.data/orbit.sqlite3`, git-ignored).
    Setting `ORBIT_DATABASE_URL` in local mode is a config error (suggests cloud was intended).
  - `cloud` requires `ORBIT_DATABASE_URL`; `postgres://`/`postgresql://` are normalized to
    `asyncpg`, other drivers rejected. Production requires TLS (`?ssl=require`, `verify-ca`, or
    `verify-full`).
- The web shows the mode (`GET /api/v1/health/database`) as a badge and a Settings card but can't
  change it: switching is `apps/api/.env` plus restart, since it's installation-wide and the URL
  is a secret that must never pass through the browser.
- Local mode outside production only: Settings → Storage shows the SQLite path
  (`GET /api/v1/storage`, signed-in) and `POST /api/v1/storage/reveal` opens its folder on the
  API's machine via a fixed command, no shell, configured path only (`system/file_manager.py`).
  Production and cloud never return the path or open anything; health endpoints never report
  paths.
- Backups folder works the same way: `GET …/backups` carries `folder` and `can_reveal_folder`;
  `POST …/backups/reveal` creates and opens it. Path comes from `ORBIT_BACKUPS_PATH` + workspace
  ID, never from the request.
- Startup logs mode and a credential-free target.
- **No fallback:** silently using local when cloud was configured would make users think data
  was saved remotely. **One database at a time:** no dual writes, no sync.

### Engines, pooling, and sessions

- **SQLite:** per connection `foreign_keys` on, WAL (`synchronous=NORMAL`), busy timeout;
  default async queue pool.
- **PostgreSQL:** bounded pool (`ORBIT_DATABASE_POOL_SIZE`, `ORBIT_DATABASE_MAX_OVERFLOW`),
  `pool_pre_ping`, 30-minute recycle, 10 s connect timeout. Use Supabase direct or **session**
  pooler; the transaction pooler (port 6543) doesn't support `asyncpg` prepared statements.
- Both set `hide_parameters=True` so user data never appears in errors or logs.
- One `AsyncSession` per request (`SessionDep`), `expire_on_commit=False`; services commit
  explicitly and anything uncommitted rolls back at request end.

### Migrations

- Alembic in `src/orbit_api/db/migrations/versions/`, shipped with the package; runs on SQLite
  (batch mode, rebuilds tables for `ALTER`) and PostgreSQL. Every table-creating revision enables
  RLS on PostgreSQL.
- Revisions with non-obvious changes (each module's tables are in its own revision; see
  `versions/`): `0001_baseline` creates nothing. `0007` adds `users.timezone`. `0009` adds the
  `loan` account type, unique `finance_transactions(id, workspace_id)`, and reminder links to
  commitments. `0010`, `0013`, `0014`, `0015` add reminders' unique links to a deposit, event
  alert, habit reminder time, and document. `0013` adds `tasks.scheduled_start`/`scheduled_end`;
  `0014` adds `calendar_preferences.show_habits` and a partial unique index (one active session
  per routine); `0015` adds unique `finance_holdings(id, workspace_id)` (holding-link target).
  `0016` creates twenty `fitness_*` tables, each top-level row with an owning `user_id`, and a
  partial unique index (one unfinished workout per person). `0017` adds
  `dashboard_layouts.density` (CHECK) and `hide_amounts`. `0021` has a partial unique index (one
  running backup per workspace). `0028` creates `watch_items` and
  `workspaces.watchlist_lookup_enabled`; `0029` moves it to `watchlist_settings` (with the
  encrypted TMDB key) and drops the column.
- **Migrations run with SQLite foreign keys off.** Batch mode copies a table and drops the
  original; with FKs on, the drop runs `ON DELETE CASCADE`, so rebuilding `users` or
  `workspaces` (0007, 0026, 0029) wiped every workspace's data. `env.py` uses
  `enforce_foreign_keys=False` and runs `PRAGMA foreign_key_check` before committing;
  `test_upgrades_keep_existing_data` upgrades seeded data one revision at a time.
- Applied **explicitly** (`pnpm db:migrate`), never at startup; startup only checks head, so
  shared cloud schema changes stay deliberate.
- `tests/test_migrations.py`: linear history, upgrade/downgrade, models match (`alembic check`).

### Backend layers

Routes (`api/v1/<feature>.py`; SQLAlchemy only for the `SessionDep` type) → schemas
(`schemas/<feature>.py`) → services (`services/<feature>/`: domain rules, authorization
decisions, transaction boundaries; no SQLAlchemy) → repositories (`repositories/<feature>.py`:
one aggregate, always owner-scoped) → ORM models (`db/models/<feature>.py`) → `db/` (no FastAPI).

- Services depend on a `Protocol` per repository so they're unit-testable without a DB
  (`tests/test_account_service.py`). Repositories take an `AsyncSession` and exchange frozen
  dataclasses, never ORM objects. Per feature: domain types and errors in `models.py`, protocols
  and service in `service.py`.
- Services commit via a `Transaction` protocol (`services/transactions.py`). Uniqueness
  violations surface as `ConflictError`, so services handle races (e.g. two first requests for
  one Supabase user) without SQLAlchemy.
- Schemas and ORM models stay separate so API and storage shapes evolve independently.
- Shared helpers: plain Python (`UNSET` partial-update sentinel, `SortOrder`, `utc_now`, LIKE
  patterns) in `utils/` (imports nothing else from Orbit); `flush`, `SqlTransaction` in
  `repositories/transaction.py`; Pydantic field types (`Name`, `SearchText`, …) in
  `schemas/common.py`. Web counterpart: a helper used by more than one feature gets its own
  `src/utils` module rather than being borrowed from a feature.
- No generic repository base or unit-of-work framework is planned; add one only if several
  features demonstrably repeat code.

### Local security

- Orbit creates the SQLite file `0600` and its directory `0700` (`-wal`/`-shm` inherit);
  existing files keep their permissions; little effect on Windows (rely on profile ACLs).
- **Not encrypted at rest** by Orbit; use full-disk encryption.
- `apps/api/.data/` is for development; `.data/`, `*.sqlite*`, `*.db*` are git-ignored. For real
  use point `ORBIT_SQLITE_PATH` at a user data dir, never under `apps/web` (esp. `public/`) or an
  untrusted synced folder.
- API binds `127.0.0.1` by default (`ORBIT_API_HOST`). `0.0.0.0` exposes the API and local
  sign-in over plain HTTP (passwords and tokens visible); only in trusted isolated networks,
  otherwise HTTPS ([deployment.md](deployment.md#https-on-your-own-domain)).
- Local sign-in throttle (`services/local_auth/throttle.py`, in-process memory): 10 failed
  sign-ins per account and 50 per client address per sliding 15 min (success clears the
  account's count); failed password changes counted the same; 10 sign-ups per address per hour.
  Over a limit: 429 with `Retry-After` even for the right password, so it can't confirm a guess.
  Counts reset on restart and aren't shared across processes; behind a proxy set
  `ORBIT_FORWARDED_ALLOW_IPS` so the client address is the visitor's.
- `POST /api/v1/auth/local/password` checks the current password and deletes the account's
  other sessions in the same transaction; a wrong current password is 403 (401 would sign out).
- Backups: see [Backup, restore, and data portability](#backup-restore-and-data-portability)
  and [development.md](development.md#backups).

### Cloud security and Supabase

- `ORBIT_DATABASE_URL` is a `SecretStr`: never sent to the browser, never logged (startup logs
  only host and DB name), never echoed in validation errors.
- The browser uses `@supabase/supabase-js` (project URL + publishable key) for sign-in only; all
  data goes through the API.
- The API needs **no Supabase secret**: it verifies tokens against the project's public signing
  keys. The service-role key is unused and must not be configured anywhere.
- **Ownership:** see [Identity and authorization](#identity-and-authorization).
- **Row Level Security (defense in depth):** the API connects as table owner (not restricted by
  RLS), so **application-level authorization is the primary control**. RLS guards other paths,
  chiefly Supabase's Data API, which exposes `public` tables to anyone with the anon key.
  1. Every table-creating migration enables RLS in the same revision.
  2. **No policies exist**, deliberately, so `anon` and `authenticated` get no rows. Add
     `authenticated` policies (e.g. `owner_id = auth.uid()`) only if a client ever gets direct
     access.
  3. `tests/test_postgres.py` (opt-in) checks RLS on every table and that a non-owner role sees
     no rows. Verified on PostgreSQL 17, not a live Supabase project (its roles are ordinary
     non-owner roles).
  4. Still worth considering: a dedicated non-superuser API role, and a schema not exposed by the
     Data API.

### Not implemented in this phase

- **Sync or local↔cloud migration** (needs stable record identity, conflict resolution,
  tombstones); a deployment uses exactly one mode.
- **Shared workspaces**, invitations, roles other than owner.
- **Linking local and cloud identities**: same email, unrelated accounts.
- **Encryption at rest beyond the OS**, a desktop wrapper, a bundled local DB server.

## Identity and authorization

### Identity model

```text
users ──< workspaces ──< tasks, reminders, finance_*, note*, calendar_*, …
  │                      (owner_id → users.id, workspace_id → workspaces.id, ON DELETE CASCADE)
  ├──< notifications      (in-app inbox, per recipient)
  ├── user_avatars        (1:1)
  ├── user_covers         (1:1)
  ├── dashboard_layouts   (1:1)
  ├── local_credentials   (local mode: email + Argon2id hash, 1:1)
  └──< local_sessions     (local mode: SHA-256 of the bearer token, expiry)
```

- **`users`:** optional IANA `timezone` (default for new reminders); unique
  `(auth_provider, auth_subject)`. `auth_provider` is `local` or `supabase` (CHECK);
  `auth_subject` is the JWT `sub` for Supabase, the profile ID for local.
- **`workspaces`:** one owner; `is_personal` with a partial unique index (one per user); names
  1-100 chars (API + CHECK). `DELETE /api/v1/workspaces/{id}` is permanent and cascades; the
  personal workspace can't be deleted (409).
- **`user_avatars`:** kept out of `users` so profile loads never load bytes. The browser crops to
  256 px; `PUT /api/v1/me/avatar` takes raw bytes, detects PNG/JPEG/WebP by signature (never SVG,
  never the declared type), max 512 KB. `GET` serves with `nosniff` and a locked-down CSP, or 204
  if none. The web fetches it as a blob (bearer token needed) and uses an object URL.
- **`user_covers`:** the profile cover photo, same rules through the same repository and
  service with its own table and a 1.5 MB limit (`/api/v1/me/cover`). The browser keeps the
  photo's shape, crops taller than 4:3 around the middle, and scales to at most 1600 px wide.
  Shown on `/profile` in place of the store banner; not in backups (belongs to the account).
- **Extensibility:** user data carries a non-null `workspace_id` FK. Shared workspaces would add
  `workspace_members` and change only the authorization check; the API already reports
  `role` (`owner`).
- **`dashboard_layouts`** is per user, not workspace, since it holds no workspace data.
- No general preferences table; the active workspace is a per-browser preference.

### Local and cloud identities

The storage mode decides the identity provider; no mixing, no fallback.

- **Local:** Orbit accounts in SQLite via `POST /api/v1/auth/local/*`; Argon2id (argon2-cffi),
  rehashed on sign-in when params change; opaque 256-bit token, only its SHA-256 stored,
  rejected if missing or expired; fixed lifetime `ORBIT_LOCAL_SESSION_TTL_HOURS` (default 14
  days); sign-out deletes the session row (immediate); registration open outside production,
  first account only in production (configurable); no password reset (no email); profile created
  in the sign-up transaction.
- **Cloud:** Supabase Auth via `@supabase/supabase-js` in the browser; JWT verified for signature
  (JWKS, ES256/RS256), `exp`, `iss`, `aud=authenticated`, `role`, UUID `sub`; client refreshes;
  sign-out ends the browser's Supabase session; reset via Supabase email → `/reset-password`
  (recovery session) → `updateUser`; profile created on the first authenticated request.
- `GET /api/v1/auth/config` returns only public values (`registration_open` locally; Supabase URL
  and publishable key in cloud). The web holds no Supabase config of its own.
- **Local accounts:** first person creates the owner; more accounts can be allowed, each with
  isolated workspaces. Sign-in errors don't reveal whether an email exists (dummy hash verified
  for unknown emails). No secrets stored or configured.
- **Supabase onboarding:** first valid request creates the profile and Personal workspace;
  display name from sign-up `display_name` metadata, else the email's local part. The loser of a
  concurrent unique-constraint race uses the winner's profile. Profile email follows the token's
  `email` claim.
- **Supabase revocation:** tokens are verified locally, so they stay valid until expiry (1 h
  default) after sign-out elsewhere; Supabase revokes the refresh token.
- If signing keys can't be fetched, protected requests are 503 (never granted) and the browser
  keeps its session.

### Authorization

Rules live in `api/auth.py` and `services/workspaces/service.py`:

- **`CurrentUserDep`** reads only `Authorization: Bearer`. Missing, malformed, oversized,
  expired, or unknown tokens → `401 {"detail": "Sign in to continue."}` with
  `WWW-Authenticate: Bearer`. Request models forbid unknown fields, so a submitted `user_id` or
  `owner_id` is 422.
- **`WorkspaceDep`** authorizes `{workspace_id}` via `WorkspaceService.authorize()` (by ID and
  owner). Missing and foreign workspaces both give `404 Workspace not found.`
- Features add cross-user isolation tests like `tests/test_workspaces.py`, `tests/test_tasks.py`.
- DB constraints back the checks: cascading FKs, unique identities, one personal workspace per
  user, CHECKs on names, providers, and normalized emails.
- No RBAC framework; owner is the only role.

### Sessions in the browser

- Bearer header in both modes; no cookies, credential-free CORS. Local token in `localStorage`
  `orbit:session`; Supabase session in `orbit:supabase-auth`. Page scripts could read either, so
  XSS prevention protects sessions: no `dangerouslySetInnerHTML` with untrusted data, safe link
  schemes and in-app paths only, and a partial CSP (see [Observability](#observability)) that
  doesn't yet restrict scripts.
- `AuthProvider` confirms the session with `GET /api/v1/me` before private pages. Any 401
  discards the session; other failures (API down, 503) show retry and keep it. Sign-in/out in
  another tab is picked up.
- **Route protection is browser-side** (`RequireAuth`) because the Next.js server can't see
  tokens; it's a UX guard, since pages hold no private data and the API validates every request.

### Workspace selection

- Active workspace per user in `localStorage` `orbit:workspace:<user id>`; a selector, never a
  credential. A remembered workspace the user no longer has falls back to personal.
- Switching cancels the previous workspace's requests; deleting a workspace drops its cache. A
  404 with detail "Workspace not found." re-validates the workspace list.

### Dashboard layout

Saved per user; see [Customization model](#customization-model) and
[Daily dashboard and command center](#daily-dashboard-and-command-center).

### First-run setup guide

Optional guide at `/welcome` (outside the shell): profile (name, photo, time zone), appearance,
then for chosen areas finance accounts and live prices, health profile, Google/Microsoft
connections, and AI provider/model/switch. Steps reuse the Settings APIs and forms (no drafts);
any step can be skipped.

- `users.setup_status`: `pending` (new), `deferred` (opened or left for later), `done` (finished
  or dismissed); changed via `PATCH /api/v1/me`. Migration `0026` set existing users to `done`.
- While `pending`, the app layout redirects to `/welcome` once (opening sets `deferred`). While
  `deferred`, the dashboard shows a "Finish setting up" card. Settings → Account "Run setup
  again" never moves a `done` user back.
- Before leaving for OAuth consent, the guide stores `/welcome?step=connect` in
  `sessionStorage`; the callback returns there once (same-origin paths only), else opens the
  connection's settings.

## Tasks

To-dos inside a workspace.

### Data model

`tasks` (`db/models/tasks.py`, migration `0004`):

- `title` 1-200 chars, single line; `description` ≤ 5,000 chars, empty when unset (CHECKs).
- `status` `open`/`completed`; `completed_at` set exactly when completed (CHECK).
- `priority` rank 0-3 (none, low, medium, high), so priority sort is a column order.
- `due_date`: calendar date, no time or zone.
- `scheduled_start`/`scheduled_end`: optional UTC calendar block, both or neither, end after
  start (CHECK).
- `list_id`: composite FK `(list_id, workspace_id)` (`0027`).
- `updated_at` changes only when a field actually changes.
- Indexes `(workspace_id, status, due_date)` and `(workspace_id, status, priority)`. Search is
  `ILIKE` substring (`%`, `_`, `\` literal), unindexed, scanning one workspace (fine at personal
  scale; PostgreSQL full-text/trigram could replace it).

`task_lists` (`0027`): named, colored lists (Work, Personal). A task is on at most one list.
`name` 1-50 chars; `normalized_name` (whitespace collapsed, case-folded) unique per workspace;
`color` from the calendar's eight-color palette; `position` = creation order. Max 50 lists per
workspace. Tasks FK has no `ON DELETE` (like calendar categories): deleting a list first unlinks
its tasks, never deletes them. Backups: Tasks module, matched on import by `normalized_name`.

### API

CRUD under `/api/v1/workspaces/{workspace_id}/tasks`. Another user's workspace is
`404 Workspace not found.`; a task from another workspace is `404 Task not found.` like a missing
one.

- `GET /` filters: `status`, `priority` (repeatable), `q`, `list_id` or `unlisted=true` (not
  both), `scheduled`; `limit` ≤ 500; returns `tasks`, `total`. `sort` = `due_date`, `priority`,
  or `created_at` (default), each with a natural direction without `order` (soonest, highest,
  newest); no-due-date tasks always last; ties fall back to priority, due date, creation time.
- `GET /summary?today=`: open, completed, overdue, due-today counts. Overdue depends on the
  user's zone; the web sends its local date, the API falls back to UTC.
- `POST /{id}/complete` (idempotent, keeps first completion time) and `/reopen` are the only
  way to change status. Request models forbid unknown fields (`status`, `completed_at`,
  `workspace_id`, `id` → 422). `PATCH` with `due_date: null` clears it.
- `list_id` on `POST`/`PATCH` (`null` unlists); missing or other-workspace list → `422`.
- `scheduled_start`/`scheduled_end` together, aware datetimes, ≤ a week apart, both `null`
  unschedules. See [Calendar task integration](#calendar-task-integration).
- Lists: `/api/v1/workspaces/{workspace_id}/task-lists` — `GET` (oldest first, with
  `open_tasks`), `POST` (`name`, `color` default `blue`), `PATCH`, `DELETE` (tasks stay,
  unlisted). Taken name or 51st list → `409`. Reminders about a task include `task.list` (name,
  color).
- Titles and descriptions reject control characters (descriptions allow line breaks and tabs);
  emoji sequences and non-breaking spaces are fine.

### Web app

- `/tasks` (`components/tasks/`), hooks `useTaskList`/`useTaskMutations` in
  `src/hooks/use-tasks.ts`. Keyboard: `N` composer, `/` search, Escape clears search or cancels a
  delete confirmation.
- Keeps previous results while a new filter loads; mutations update cached lists in place and
  mark the dashboard summary stale.
- Complete/reopen is optimistic (reverts with an error); a completed task stays, struck through,
  until reload. Create/edit reloads in the background to land in sorted position.
- Loads at most 200 tasks and says when more match (no pagination).
- Side rail Lists section (All lists, each with open count, No list, New list); the composer adds
  to the selected list; rows show a list chip except in that list's own view.
- Dashboard card: summary counts and next five open tasks by due date.

### Not implemented

Recurring tasks, subtasks, tags (one list per task), reordering lists, sharing, drag-and-drop
ordering. Scheduled time blocks ([calendar](#calendar-task-integration)) are separate from the
due date; [reminders](#reminders-and-notifications) are a separate feature.

## Reminders and notifications

Reminders fire at a chosen time, once or on a schedule, optionally about a task. A worker
delivers each as an **in-app notification** (sidebar/top-bar bell), the only channel; see
[Limitations](#reminder-limitations).

### Data model

FKs: `reminders` and `reminder_occurrences` cascade from workspaces and reminders;
`(task_id, workspace_id)` → `tasks(id, workspace_id)` `ON DELETE CASCADE` (`NULL` for standalone
reminders); `notifications.occurrence_id`/`reminder_id` `ON DELETE SET NULL`, `user_id` and
`workspace_id` cascade.

- `reminders`: schedule in local terms (`start_date`, `time_of_day`, IANA `timezone`,
  `recurrence`), `enabled`, last outcome. `reminder_occurrences`: one firing — `scheduled_for`
  (UTC), status, `attempts`, `available_at` (backoff), lease (`claim_token`, `claimed_until`),
  `last_error`. `notifications`: one delivered occurrence per recipient, with a copy of title and
  description, `read_at`, and an optional in-app `link` (agent runs, approvals, budgets, SIPs,
  integrations, reminders; the bell opens it, falling back to Reminders for older reminder
  rows, and shows the Markdown body as a plain-text preview). `users.timezone`: optional IANA preference for new reminders.
- Why three tables: reminder = what the user edits; occurrence = the worker's unit of work
  (claims, retries, outcome), keeping delivery state observable; notification = what the user
  reads, outliving edits and deletion of its reminder.
- **One pending occurrence per reminder.** Create, schedule change, or enable replaces it in the
  same transaction; disable deletes it; delivery schedules the next.
- **Constraints:** `unique(reminder_id, scheduled_for)`; `unique(occurrence_id, user_id)` on
  notifications; CHECKs tie the lease to `processing` and `finished_at` to final statuses; the
  composite FK keeps a reminder in its task's workspace.
- **Indexes:** `(status, available_at)` (worker poll), `(reminder_id, status)`,
  `(user_id, created_at)`, `(user_id, read_at)` (inbox, unread count).
- **Status** is derived in SQL, never stored: `disabled` when off; `completed` when the task is
  completed or nothing is left to fire; `overdue` when due but undelivered or the last delivery
  failed; else `scheduled`.
- Migration `0007_create_reminders`: three tables with RLS, `users.timezone`, and the unique
  `tasks(id, workspace_id)` key for the composite FK.

### Time zones and recurrence

`services/reminders/recurrence.py` is pure (`tests/test_recurrence.py`).

- A schedule is a local date and time in an IANA zone, converted to UTC one occurrence at a
  time, so 09:00 stays 09:00 local across DST. All stored timestamps are UTC.
- Each reminder stores its own zone; default: user preference (Settings → Account), else browser
  zone (web), else UTC (API). Never the server's zone. Names validated against IANA (`tzdata`
  ships it where missing, e.g. Windows).
- **Skipped times** (02:30 on spring-forward) fire at 03:30; **repeated times** (fall-back
  01:30) fire once, at the first.
- **Recurrence** is versioned JSON (`{"version": 1, "frequency": …, "weekdays": […]}`),
  validated in (Pydantic) and out (repository): `daily`, `weekly` on weekdays (Mon-Fri = "every
  weekday" preset), `monthly`. No cron strings or RRULEs.
- **Monthly on the 29th-31st** clamps to the last day of shorter months and returns to the
  original day (Jan 31, Feb 28/29, Mar 31, Apr 30).
- A one-time reminder must be in the future when created or re-enabled (422); a recurring one
  may start in the past and continues from now.

### Tasks and reminders

- Reminder time is **independent of the task's due date**.
- While the task is **completed**, due occurrences are recorded `cancelled` and recurring
  schedules continue, so **reopening** resumes them. These show as `completed` and are excluded
  from "upcoming".
- **Deleting** the task cascades to its reminders and pending occurrences; delivered
  notifications stay, unlinked.
- **Finance-managed reminders.** A loan, subscription, or bill with reminders owns one reminder
  (`reminders.finance_loan_id` or `finance_recurring_payment_id`, unique), marked "Managed in
  Finance"; the reminders API refuses edit/delete (409). See
  [Reminder integration](#reminder-integration). A deposit's maturity reminder
  (`reminders.finance_deposit_id`) works the same and fires once.
- **Calendar-managed reminders.** Each calendar event alert owns one
  (`reminders.calendar_event_alert_id`, unique; a CHECK forbids also having a finance link),
  "Managed in Calendar", 409 from the reminders API. See
  [Reminder integration](#calendar-reminder-integration).

### Scheduling and delivery

Per occurrence, one transaction: confirm claim → lock reminder → notification(s) → occurrence
delivered → `reminder.last_outcome` → next pending occurrence → commit.

`scheduler/worker.py` holds no schedule in memory; each poll reads the database. Runs inside each
API process by default (lifespan asyncio task; `ORBIT_SCHEDULER_IN_API`) and/or standalone
(`pnpm worker` = `uv run orbit-worker`). Any number of workers can share a database.

- **Claiming:** one conditional `UPDATE … WHERE id IN (SELECT … LIMIT n) AND <still claimable>
RETURNING` moves due `pending` rows (and expired-lease `processing` rows) to `processing` with a
  fresh `claim_token`/`claimed_until`. PostgreSQL uses `FOR UPDATE SKIP LOCKED`; the re-checked
  condition makes a racing worker skip. SQLite serializes writers.
- **Delivering:** one transaction per occurrence. Its first statement re-confirms the claim token
  (taking the row lock on PostgreSQL, write lock on SQLite); then the reminder row is locked
  (`FOR UPDATE`) so an in-flight edit finishes first. Notification, `delivered` status, and next
  occurrence commit together: `delivered` exactly when its notification exists. `processing` only
  means a lease is held.
- **Retries:** failure rolls back, then returns to `pending` with backoff (30 s, 1 min, 2 min, …
  up to 30 min). After 5 attempts: `failed`; reminder shows `overdue` ("the last delivery
  failed"); a recurring reminder's next occurrence is still scheduled. `last_error` stores only
  the exception class name, never content.
- **Recovery:** `orbit-worker status` counts by status; `orbit-worker retry-failed` re-pends
  failed ones. Editing or re-enabling also reschedules.
- **Downtime:** each reminder fires **once** for its oldest missed occurrence (late, original
  `scheduled_for`); the next is the first still in the future. No replay.
- **Shutdown:** finishes the poll in progress (lifespan, SIGINT, SIGTERM). A killed worker's
  claims are recovered after the 2-minute lease.
- Same code on SQLite and PostgreSQL. Local mode: embedded worker in the single API process.
  Cloud: embedded in every instance, standalone, or both.

**Tested** (`tests/test_reminder_worker.py`, real SQLite files, controllable clock): exactly-once
delivery incl. three concurrent workers; crashed-claim recovery after lease; a worker whose lease
was taken over writes nothing; DB rejects a second notification; pending work survives restart;
backoff, final failure, `retry-failed`; late delivery after downtime; completed tasks, disabling,
rescheduling, deletion during delivery.

**Not yet tested:** PostgreSQL concurrency (relies on `SKIP LOCKED`/row locks as documented; the
opt-in PostgreSQL suite checks RLS but runs no concurrent workers). Delivery is at the next poll
(default 15 s), not to the second.

### API

Reminders: `/api/v1/workspaces/{workspace_id}/reminders` (CRUD, `WorkspaceDep`). Notifications:
`/api/v1/me/notifications` (`CurrentUserDep`), per user across workspaces.

- `GET …/reminders`: soonest first; `status`, `task_id`, `limit` ≤ 200.
  `GET …/reminders/upcoming`: enabled, with an active occurrence and an open (or no) task;
  `limit` ≤ 50. `PATCH` schedule changes replace the pending occurrence. `DELETE` removes
  occurrences; notifications stay.
- `GET /me/notifications`: newest first, `unread` filter, `limit` ≤ 100; returns `total` and
  `unread`. `GET /me/notifications/unread-count` → `{"unread": n}` (cheap to poll).
  `PATCH /me/notifications/{id}` `{"read": bool}` (re-marking keeps the first read time).
  `POST /me/notifications/read-all` returns how many changed.
- A task from another workspace or user is 422 "That task doesn't exist in this workspace."
  (same as missing). Another user's reminder or notification is 404.
- Unknown fields forbidden (`status`, `workspace_id`, occurrence data). Times are whole minutes
  without an offset; dates are years 2000-2200.
- `PATCH /api/v1/me` accepts `timezone` (IANA or `null`) alongside `display_name`.

### Web app

- `/reminders` (`components/reminders/`): status tabs (Upcoming, Overdue, Completed, Disabled,
  All); a reminder's zone is shown only when it differs from the viewer's.
- The bell (`components/notifications/`) polls the unread count every 30 s; opening loads the 20
  newest. A rising count marks reminder lists stale; reminder lists also refetch every minute
  while shown.
- Dashboard Reminders widget: next five from `…/upcoming`.
- Keys: `["workspaces", id, "reminders", …]`; notifications under `["notifications", …]` (per
  user, cleared on sign-out).

### Reminder limitations

- **In-app only.** No browser push, email, SMS, or mobile; seen only while Orbit is open. The
  polling bell stands in for push.
- Delivery granularity is the poll interval; `overdue` until delivered.
- Notifications go to the workspace owner (its only member). Shared workspaces would need
  per-member delivery and membership checks.
- No snooze, recurrence end date/count, "every N days/weeks", or history beyond the inbox.

## Finance

Phase 1: manual accounts, transactions (in, out, between), categories, monthly reports, CSV
export. Phase 2 adds commitments ([Financial commitments](#financial-commitments-phase-2));
phase 3 investments and net worth; phase 4 budgets, goals, and monthly plans, all on the same
ledger. Never asks for bank credentials or connects to banks; no imports or sync.

### Money and currency

- **Integer minor units everywhere** (paise: ₹1,234.50 = `123450`), `BIGINT`, summed in SQL,
  JSON integers. PostgreSQL `SUM(bigint)` is `NUMERIC`, so repository sums cast back to `BIGINT`.
  Request amounts are `Strict` ints: `12.5`, `100.0`, `"100"` are rejected, not rounded.
- **Decimal text only at the edges:** `services/finance/money.py` `to_decimal_string` (`divmod`);
  the web (`lib/finance`) parses text like `1,00,000.50` and formats with string ops and
  `Intl.NumberFormat` on the exact decimal string. No floats touch money; UI percentages are
  display-only.
- **Explicit currency:** ISO 4217 per account, fixed at creation. Supported: INR (default), USD,
  EUR, GBP, AED, SGD, AUD, CAD, CHF (2 decimals), JPY (0). Transactions store their account's
  currency, enforced by composite FK. Never summed across currencies: reports take `currency`,
  totals are per currency, no conversion, cross-currency transfers rejected.
- **Range:** ≤ 10^13 minor units (₹10,000 crore).

### Data model

All three tables cascade from workspaces.

- `finance_accounts.type`: bank, savings, cash, wallet, credit_card, investment, other (plus
  `loan`, phase 2); signed `opening_balance`; `archived_at`. `finance_categories`: `type` income
  or expense; `key` for built-ins (`NULL` for user's own). `finance_transactions`: positive
  `amount`, `occurred_on` date, `category_id`, `account_id`, `to_account_id`.
- **Transaction types:** `income`; `expense`; `refund` (reduces spending in its expense category,
  never income); `transfer` (`account_id` → `to_account_id`, never income or spending).
- **Constraints** (tested in `tests/test_migrations.py`): `amount` 1 to 10^13; a transfer has a
  different destination and no category, nothing else has a destination; composite FKs
  `(account_id|to_account_id, workspace_id, currency)` → `finance_accounts(id, workspace_id,
currency)` and `(category_id, workspace_id)`. Category FK has no `ON DELETE`, so an in-use
  category can't be deleted. Category names unique per workspace and type (case-insensitive in
  the service, exact in the DB); a built-in key once per workspace.
- **Indexes:** `(workspace_id, occurred_on)`; `(workspace_id, X)` for `account_id`,
  `to_account_id`, `category_id`.
- **Accounts are archived, not deleted:** keep history and balance, take no new transactions
  (422), existing ones still correctable. Type and currency immutable; name, opening balance,
  notes editable.
- Migration `0008_create_finance` (RLS on PostgreSQL). No backfill; categories seeded lazily.

### Balances

- **Derived, never stored:** `opening_balance + Σ income + Σ refunds − Σ expenses − Σ transfers
out + Σ transfers in`, one grouped `UNION ALL` query on every accounts read. No cached column,
  so edits/deletes of past transactions fix every balance and report at once. Includes all
  transactions regardless of date.
- **Signed from the owner's view:** positive held, negative owed (card with ₹500 outstanding =
  `-50000`; the web shows "₹500.00 owed" and asks a card's opening balance as amount owed).
- Credit cards and loans are `liability`; all else `asset`. `GET …/accounts` returns per-currency
  `totals` `assets` and `liabilities` (positive), including archived accounts. The UI says these
  are **not net worth** (see [Net worth](#net-worth)).

### Financial rules

- **Credit cards:** a purchase is an `expense` on the card account (spending on its date); paying
  the bill is a `transfer` bank → card, not spending, so nothing counts twice.
- **Investments:** money in is a `transfer`, not spending; the account's ledger balance is net
  moved in. Holdings and market value: phase 3 (see
  [Investments and net worth](#investments-and-net-worth-phase-3)).
- **Refunds** are their own transactions (original expense stays). Corrections are `PATCH` or
  delete; derived figures follow.
- **Dates:** `occurred_on` is a calendar date in the user's zone. A month is first to last day
  inclusive, never server-zone dependent. Reports take `month=YYYY-MM`, default current UTC month
  (the web always sends the local month).
- **Validation** (`FinanceService`, mirrored by constraints): accounts/categories must be in the
  workspace (else 422 "…doesn't exist in this workspace.", same for another user's); income needs
  an income category, expenses and refunds an expense category; transfers need two different
  active accounts in one currency; currency always comes from the account (client can't send it).
- Each request is one DB transaction. Seeding inserts all missing defaults and commits once; a
  concurrent seed's unique conflict rolls back and re-reads.

### Categories

Defaults in `services/finance/categories.py`, chosen for India (income: Salary, Freelance,
Business income, Interest, Dividends, Rental income, Gifts received, Other income; ~20 expense
categories incl. Rent, Groceries, Taxes, Fees and charges, Loan interest). Deliberately no
category for investments, card bills, or loan principal: those are transfers. Loan interest is
spending; EMI payments record it in "Loan interest" (existing workspaces get it on next read).

- Seeded per workspace on first categories read (or before a custom create). Adds only defaults
  whose `key` and name are both missing: idempotent, and a renamed default isn't re-added.
- Built-ins can be renamed, not deleted (409). Custom ones can be deleted once unused (409
  otherwise).

### API

CRUD under `/api/v1/workspaces/{workspace_id}/finance` for `/accounts`, `/categories`,
`/transactions`. Another user's workspace is `404 Workspace not found.`; another workspace's
account, category, or transaction ID is 404, and referencing one in a transaction is 422.

- `GET /accounts`: active first, derived balances, per-currency `totals`. `POST /accounts`
  `currency` defaults INR; `PATCH` only `name`, `opening_balance`, `notes`.
  `POST /accounts/{id}/archive` (idempotent) and `/restore`. No account delete.
- `GET /categories` lists income then expense, seeding defaults; `POST` 409 on duplicate name;
  `DELETE` only own, unused.
- `GET /transactions`: `date_from`, `date_to`, `type` (repeatable), `account_id` (either side),
  `category_id`, `q`, `sort` (`date`, `amount`), `limit` ≤ 200. `PATCH` re-validates the result
  like a new one.
- `GET|POST /transfers` (`from_account_id`, `to_account_id`).
- Reports: `GET /summary` (one month: `income`, `expenses`, `refunds`, `net_expenses`, `net`,
  count; `month`, `currency`); `GET /trend` (same per month, `months` ≤ 24, default 6, ending at
  `month`, zero-filled); `GET /spending` (net per category, largest first, uncategorized `null`).
  All SQL aggregates (`SUM`/`COUNT` with `CASE`, grouped by category or `EXTRACT(year/month)`);
  the web never sums transactions.
- Search: case-insensitive substring on descriptions and notes (`utils/text_search.py`, shared
  with tasks).
- Unknown fields forbidden (`currency`, `balance`, `workspace_id`, `id`). Validation errors never
  echo submitted values; routes log nothing about transactions.

### CSV export

`GET …/transactions/export` (optional inclusive date range): `text/csv; charset=utf-8`
attachment `orbit-transactions[-from-to].csv`, `Cache-Control: no-store`, oldest first. Columns:
Date, Type, Description, Category, Account, To account, Amount (positive major-unit decimal,
`20000.50`), Currency, Notes, ID. Text starting with `=`, `+`, `-`, `@`, tab, or CR gets a `'`
prefix (CSV injection). No BOM; Excel users may need to import as UTF-8.

### Web app

- `/finance` (`components/finance/`), thirteen views in `lib/finance-views`: Overview; **Money**
  (Transactions, Accounts); **Planning** (Budgets, Plan, Goals); **Commitments** (Upcoming, Loans,
  Subscriptions, Bills); **Wealth** (Investments, Assets, Net worth). Side rail `finance-nav.tsx`;
  view in `?view=` (kept with the History API).
- Header **Record** menu (expense, income, transfer, refund) on every view: primary on Overview
  and Transactions, quieter elsewhere. Overview, Budgets, and Plan share one month; all views share
  one currency (`finance-view.tsx`; picker only with several currencies). No accounts → prompt to
  add one first.
- Shared blocks: `ViewHeader`, `StatGrid`/`StatTile`, `Panel`/`LoadError`/`EndedSection`,
  `finance-meta.tsx` chips, `RowActions` (one inline action, rest in "More actions", confirms in
  place). Container queries `@container/finance`, `/list`, `/rows`.
- Rows, not tables. Charts use `--chart-1`/`--chart-2` (`styles/tokens.css`, CVD- and
  contrast-checked); each month is focusable with figures in its accessible name.
- `hooks/use-finance.ts`; keys `["workspaces", id, "finance", …]`. Every change invalidates all
  the workspace's finance queries, since balances and reports are server-derived.

## Financial commitments (phase 2)

Loans with EMI schedules, subscriptions, recurring bills, unified upcoming payments, and
reminders. Code: `services/commitments/` (`schedule.py` pure arithmetic, `service.py` rules),
`repositories/commitments.py`, `schemas/commitments.py`, `api/v1/commitments.py`. Built **on top
of** the ledger: every payment is an ordinary `finance_transactions` row; no second transaction
model.

### Commitment data model

`finance_loans` is 1:1 with a `loan`-type account. Installment and occurrence links to
`finance_transactions` have no `ON DELETE`. `reminders.finance_loan_id` /
`finance_recurring_payment_id` are unique, `ON DELETE CASCADE`.

- `finance_loans`: `principal`, `interest_rate_bps`, `interest_method`, tenure, EMI, frequency,
  status, reminder settings, `account_id`, `payment_account_id`.
  `finance_loan_installments`: `sequence`, `due_date`, `principal`, `interest`, `balance_after`,
  `state` (scheduled, paid, skipped), `paid_on`, principal and interest transaction IDs.
  `finance_recurring_payments`: `kind`, amount (estimate when `amount_varies`), frequency,
  `anchor_date`, optional end and trial dates, `state`. `finance_recurring_occurrences`: **settled**
  only — `state` paid/skipped, amount, `paid_on`, expense transaction ID (none when marked paid by
  hand).
- Composite FKs keep installments, occurrences, accounts (and their currency), categories,
  transactions, and reminders in the commitment's workspace.
- **Loans are backed by a `loan` account** (liability), created only with a loan (`POST
…/accounts` rejects `loan`); opening balance = minus outstanding principal. Appears in Accounts
  and liabilities totals.
- Rates in basis points (8.5% = `850`), parsed and formatted as text in the web.
- Subscriptions and bills share one table (`kind`): same recurrence, payments, reminders;
  presented separately.
- **History is never deleted through the API:** loans closed/archived; subscriptions and bills
  paused/cancelled. Exception: `DELETE /loans/{id}` for a mistaken loan removes it with account,
  schedule, and reminder; 409 if any transaction uses its account or any installment is paid.

### EMI calculation assumptions

`services/commitments/schedule.py` (`tests/test_commitment_schedule.py`): `Decimal` (60
significant digits), rounded **half up to the minor unit once per installment**; no floats.

- **Reducing balance** (default): interest = outstanding × annual rate ÷ installments per year.
  EMI = `P·r·(1+r)^n / ((1+r)^n − 1)`, or `P / n` at 0%.
- **Flat rate**: total interest = `P × rate × years`, spread evenly; remainder to the last
  installment.
- **Last installment settles exactly** whatever principal is left.
- A lender's EMI may replace the standard one; one that doesn't cover a reducing installment's
  interest is 422.
- **Loans already being repaid:** give outstanding principal and next EMI date; only remaining
  installments are tracked (numbered within full tenure); history isn't reconstructed.
- **Manual adjustments:** edit a scheduled installment's date/principal/interest (`adjusted`),
  skip it (payment holiday), or `/reschedule` the rest from what the ledger says is owed, keeping
  the EMI count (new EMI) or a new EMI (new tenure). Prepayment = transfer into the loan account,
  then reschedule.
- `balance_after` for scheduled installments is recomputed on read from today's outstanding; a
  paid one keeps the value at payment time.

### Recurrence rules

- Frequencies: weekly, monthly, quarterly, every 6 months, yearly, from `anchor_date` (the next
  due date when added). Month-based ones keep the anchor's day, clamping to month end (31 Jan →
  28 Feb → 31 Mar).
- **Unsettled occurrences are computed, never stored;** settled rows have
  `unique(recurring_payment_id, due_date)`, so generation is idempotent. A loan's schedule is
  generated once, at creation or reschedule.
- Changing frequency or next due date moves the anchor; **resuming** anchors on the cadence's
  first date from today (no backlog). Settled history keeps its dates and amounts.
- Status: `active`, `paused`, `cancelled` (stored), `expired` (derived: active past end date).
  Payment status (derived per day): `paid`, `skipped`, `overdue`, `due` (today), `upcoming`.
  "Today" = date the web sends, else today in the user's zone preference, else UTC.

### Payments and accounting

| Payment          | Records                                                    | Spending      |
| ---------------- | ---------------------------------------------------------- | ------------- |
| Loan EMI         | Principal `transfer` into loan account; interest `expense` | Interest only |
| Subscription     | `expense` in its category                                  | Yes           |
| Bill             | `expense` in its category, at the actual amount            | Yes           |
| Marked paid only | Nothing in the ledger (subscriptions and bills)            | No            |

- **No double counting:** the EMI is never an expense. Outstanding principal is the loan
  account's derived balance, so it can't drift.
- **Expected is not actual:** scheduled items never appear in reports until a transaction exists.
- **Create or link:** recording creates transactions in the same DB transaction, or links
  existing ones (principal link must be a transfer into the loan account; interest and
  subscription/bill links must be same-currency expenses).
- **No duplicates:** installments leave `scheduled` via conditional update (concurrent payment
  loses with 409); occurrences unique per due date; each transaction pays at most one thing
  (unique FKs, pre-checked for a clear message).
- **History is protected:** FKs to `finance_transactions` have no `ON DELETE`, so deleting a
  payment's transaction is 409 "Undo that payment first". Undo unlinks, and deletes the
  transactions only when asked. Later edits to a linked transaction don't change recorded
  installment/occurrence amounts.
- **Atomic:** `FinanceService.create`, `create_account`, `delete` take `commit=False`, so
  transactions, installment/occurrence, and reminder change commit together.

### Reminder integration

- Per commitment: `days_before` (0-30), `time_of_day`, IANA zone (default user preference, else
  UTC; the web sends the browser's).
- **One reminder per commitment** in `reminders`, delivered by the normal worker: a one-time
  reminder for the next unsettled payment whose reminder time is still ahead ("Rent due 16 Feb
  2030", "INR 25000.00").
- **Synced in the same transaction** as every change (create, edit, pay, skip, undo, reschedule,
  pause, cancel, close): re-pointed, or deleted when nothing to announce or reminders are off.
  Idempotent; the unique link prevents a second reminder.
- **After it fires**, `ReminderDelivery` calls `ReminderFollowUp.after_delivery` (implemented by
  `CommitmentService`) inside the delivery transaction to move it to the next payment. No separate
  scheduler.

### Commitments API

Under `/api/v1/workspaces/{workspace_id}/finance`. Another workspace's loan, subscription, or
installment is 404; referencing its account, category, or transaction is 422. Routes with rules:

- `/loans` CRUD (`PATCH`: details, payment account, `status` active/closed/archived, `reminder`;
  `DELETE` see above). `GET /loans/{id}?today=` includes installments.
- `POST /loans/{id}/reschedule` (`interest_rate_bps`, `emi_amount`, date) regenerates unpaid
  installments.
- `/loans/{id}/installments/{iid}`: `PATCH` (adjust), `POST …/pay` (`from_account_id`, or link
  `principal_/interest_transaction_id`), `…/skip`, `…/undo` (`delete_transactions`).
- `/recurring-payments` (`kind`, `today`) with costs and next due; `PATCH` changes, pauses,
  cancels, or resumes (`state`). `…/{id}/occurrences`: `GET` history, `POST` record (`mode`:
  create, link, manual), `POST …/skip`, `DELETE …/{oid}` undo (`delete_transaction`).
- `GET /payments`: unified list; `today`, `date_from`, `date_to` (≤ 400 days), `kind`, `status`,
  `include_overdue`.
- `GET /commitments/summary`: dashboard totals in one `currency`.

### Commitments in the web app

- Views Upcoming, Loans, Subscriptions, Bills in `/finance`. The Overview shows a Commitments card
  only when commitments exist.
- One `payment-dialog.tsx` records, links, or marks paid; Yup schemas in `lib/commitments`. Keys
  `["workspaces", id, "finance", "commitments", …]`, so any finance change refetches them;
  commitment changes also refetch reminders.

## Investments and net worth (phase 3)

Code: `services/investments/` (`quantities.py`, `lots.py`, `deposits.py`, `portfolio.py` pure;
`service.py`, `assets.py` rules; `valuation.py` price-feed seam), `services/networth/`
(`calculation.py` pure, `service.py` snapshots), `repositories/investments.py`,
`schemas/investments.py`, `schemas/networth.py`, `api/v1/investments.py`, `api/v1/networth.py`.
Sits on the phase 1 ledger: every rupee moved is a `finance_transactions` row; no second account,
transaction, loan, or reminder model.

### Investment data model

Tables: `finance_investment_accounts` (1:1 profile of a `finance_accounts` row of type
`investment`; `kind` mutual_fund/brokerage/deposit/other, `provider`, optional
`linked_account_id`) → `finance_holdings` (normalized `identity` unique per account) →
`finance_holding_prices` (one per holding and date, scaled; `source` `manual` or `provider`,
`import` reserved) and `finance_sip_plans` (`auto_debit` needs a funding account);
`finance_deposits` (rate in bps, bank's stated maturity amount, manual value; linked from
`reminders.finance_deposit_id`); `finance_investment_transactions` (buy, sell, dividend, interest,
fee, deposit, withdrawal; `settlement`, SIP due date; references `finance_transactions` for cash
and fees, no ON DELETE); `finance_assets` (`include_in_net_worth`) → `finance_asset_valuations`;
`finance_net_worth_snapshots` (unique workspace, currency, month; quality counts).

- **No parallel accounts**: the profile adds only what phase 1 lacks. An existing `investment`
  account can be adopted (`POST …/investment-accounts` with `account_id`) to keep its history.
- **Quantities, cost, principal are derived**, never stored.
- Composite FKs keep holdings, deposits, transactions in one workspace and currency
  (`(account_id, workspace_id, currency)`; transactions also to the holding's
  `(id, workspace_id, currency)`).
- **CHECKs mirror service rules** (`tests/test_migrations.py`): only trades have units; dividends
  name a holding; deposit flows name a deposit; income and fees always have a ledger row; SIP due
  date only on a SIP buy.
- **History protected**: a holding with transactions can't be deleted; the ledger refuses (409) to
  delete a row an investment transaction records; one ledger row backs at most one investment
  transaction.

### Investment accounting rules

- Buy from another account: `transfer` in. Buy from the account's cash: no row. Bought before
  Orbit: no row (`settlement = none`). Sell to another account: `transfer` out. None are income or
  spending; FIFO gain is performance, not cash-flow income.
- Dividend/interest: `income` in "Dividends"/"Interest" (into any account). Fee or trade charges:
  `expense` in "Fees and charges". FD/RD deposit/withdrawal: as buy/sell. Closure: withdrawal of
  principal held, excess as interest income.
- **Investment cash** = ledger balance − purchases and deposits + sales and withdrawals settled
  through Orbit. The ledger balance (Accounts) still includes money spent on holdings.
- **Atomic**: one commit for the investment transaction, transfer, fee, opening deposit, reminder.
- Deleting keeps ledger rows unless `delete_ledger=true`; a buy later sales depend on → 409.
- **SIPs** are expectations: next due = first scheduled date without an installment (may be
  overdue). Recording creates a buy with `plan = sip` and `sip_due_date`, unique per plan. Resume
  restarts from the next date on or after today.
- **Units from NAV**: a fund buy, SIP installment, or new holding's `opening` may omit `quantity`;
  units = amount ÷ first price dated on or within 7 days after (fetched if none stored), else the
  latest in the 7 days before; rounded half up to 3 decimals; stamp duty not deducted. No price → 422. Stocks and ETFs always need units.
- **Auto-debit SIPs** (funds with a funding account): worker every 15 min on the owner's local
  date records each unrecorded due date in the last 7 days whose NAV (on or after) is known, as a
  transfer-funded buy plus in-app notification, each in its own commit. Missing NAV retries; older
  dates stay overdue, so enabling never back-fills.

### Cost basis, precision, and rounding

- **FIFO** (`lots.py`): partial-lot cost = remaining cost × sold ÷ remaining, rounded half up to the
  minor unit; a lot's last units take its remaining cost exactly. Gain = gross proceeds − cost.
  Fees never in cost or proceeds. Order: date, then as recorded. Overselling on a date → 422.
- Units and prices are integers in millionths, sent as decimal strings; extra decimals, signs, or
  exponents are rejected, never rounded. Money is integer minor units.
- Market value = units × price, rounded half up once; average cost half up to 6 decimals.
- Return = unrealized + realized + dividends and interest − fees; percentage over all buys and
  deposits, simple, display only. Tests: `tests/test_investment_math.py`.

### Deposits

- Opening records the first `deposit` on the start date; later RD installments and top-ups one by
  one.
- **Estimate** (`deposits.py`, `Decimal` 60 digits, half up once per contribution): compounds per
  whole period in calendar months from each contribution; broken period simple
  (`rate × days ÷ 365`); `simple` deposits simple only; nothing after maturity; RDs assume every
  installment paid. Labelled `value_source = estimate`, `freshness = estimated`; bank's amount
  shown beside. A manual value replaces it from its date (stale after a year).
- Closing at/after maturity → `matured`, earlier → `closed`. Excess over principal is interest;
  shortfall (penalty) is lost. `…/reopen` undoes (optionally deleting ledger rows).
- Maturity reminder: one per deposit (unique `reminders.finance_deposit_id`), `days_before`, synced
  on change, deleted on close, fires once; sync shared with phase 2 in
  `services/reminders/managed.py`.

### Other assets

- Latest valuation on or before a date; none → purchase cost (`missing`); older than a year →
  `stale`.
- Names unique per workspace (case-insensitive). Linked to an asset account (bank, cash,
  investment) → treated as counted there and excluded from net worth (reason shown); linked to a
  liability → counted. `include_in_net_worth: false` excludes; archived = history only.

### Net worth

Assets − liabilities per currency (never converted), any date (`services/networth/calculation.py`):

- Bank/savings/cash/wallet/other: ledger balance (`ledger`). Profiled investment account: its
  **cash** only (so a purchase at cost leaves net worth unchanged). Holding: units × latest price
  (`market`, else `cost`/missing). Deposit: estimate or manual, 0 once closed. Unprofiled
  `investment` account: ledger balance "at cost" (`cost`/missing). Counted other asset: latest
  valuation (`manual`, else `cost`). Card and loan: owed per ledger (loans use the phase 2 loan
  account balance).
- Every item has date, `source`, `freshness` (`current`, `stale`, `missing`, `estimated`); totals
  count each. Prices stale after 7 days.
- Past dates: balances count transactions on or before (`accounts(…, as_of)`), holdings replay
  trades, latest prices/valuations on or before. Undated opening balances always count.

### Net worth snapshots

- One per workspace, currency, month, valued at month end (today for the current month).
  Idempotent: existing → 200; a concurrent insert returns the winner. Only the current month can
  `refresh: true`; past months → 409.
- `source`: `scheduled` (worker), `manual`, `backfill` (rebuilt). Group totals as JSON.
- `ReminderWorker` at most hourly (after a poll) takes the previous month's snapshot for workspaces
  with finance data lacking one, each in its own transaction; month boundaries in UTC. No other
  scheduler.
- Dashboard compares with 1, 3, 6, 12 months back.

### Valuation strategy

Manual prices unless the workspace opts in (Settings → Finance) and `ORBIT_MARKET_DATA_ENABLED`
(default on) allows. `providers/prices/feed.py` implements `PriceFeed`
(`services/investments/valuation.py`) via keyless **mfapi.in** (AMFI NAVs by numeric scheme code)
and **Yahoo Finance** chart endpoint (unofficial, may change or rate-limit; `price_key`: `NSE` →
`.NS`, `BSE` → `.BO`); both back search. Stored with `source = provider`; other-currency prices
ignored.

- Leaves the server: scheme code or ticker and date range, or a search phrase; never units,
  amounts, or names. Nothing about holdings is logged.
- Worker refreshes the last 7 days for symbol holdings every `ORBIT_MARKET_DATA_REFRESH_HOURS` (6);
  also on adding a holding, `POST …/market-data/refresh`, and a buy without units.
- Feed failures never fail a refresh (counted `failed`) or a buy with units.

### Investments API

Under `/api/v1/workspaces/{workspace_id}/finance`; foreign IDs 404 in path, 422 referenced; reads
take `today`. CRUD for `/investment-accounts`, `/holdings` (+ `/prices`),
`/investment-transactions`, `/sip-plans`, `/deposits`, `/assets` (+ `/valuations`). Notable:
`GET /portfolio`, `GET /net-worth` (`as_of`); duplicate holding or asset → 409; delete holding only
without transactions; a price or valuation replaces that date's; transactions not editable,
`DELETE` takes `delete_ledger`; `GET`/`PUT /market-data` toggle, `GET /market-data/search`
(`kind`, `q`; 409 off, 503 unreachable), `POST /market-data/refresh` (409 off);
`POST /sip-plans/{id}/installments` (409 if recorded); `POST /deposits/{id}/contributions`,
`PUT …/value` (set/clear), `POST …/close`, `…/reopen`; `POST /net-worth/snapshots` 201 or 200.
Unknown fields forbidden; quantities and prices decimal strings; amounts JSON integers; routes log
nothing about holdings or values.

### Investments in the web app

- `/finance` views: Investments, Assets, Net worth. `add-investment-dialog.tsx` finds the
  instrument (market data on) or takes typed details, creates the account if new, and sends the
  holding's `opening`. SIP dialogs offer Auto-debit for funds.
- `lib/investments` parses units/prices as strings (`parseUnits`), never floats. Queries under
  `["workspaces", id, "finance", "investments", …]`; changes also refetch reminders. Charts use
  `--chart-1`.
- **AI review** tab (`portfolio-review.tsx`): `POST …/ai/finance/portfolio-review`
  (`services/ai/portfolio_review.py`) with the currency and optional context (horizon, risk).
  Needs AI on and the `finance` AI module, else the tab links to Settings → AI. Orbit measures
  the facts (allocation, largest and top-five shares, overlapping fund categories, fund houses,
  active SIPs, unpriced holdings) and returns them beside the model's score (0 to 100, or null),
  headline, summary, strengths, improvements (high priority first), and per-holding verdicts
  (`keep`/`watch`/`review`, by `H1…` reference; unknown refs dropped). The model sees names,
  kinds, categories, fund houses, weights, and returns; never amounts, folios, ISINs, account
  names, or notes. Nothing is saved; the result lives in the Investments view while it's open.

### Investment limitations

- Live prices opt-in per workspace, mfapi.in and Yahoo only; no bank, broker, registrar, or CAS
  import.
- No corporate actions (splits, bonuses, mergers, reinvested dividends); FIFO only; no tax lots,
  capital gains tax, or grandfathering.
- Investment transactions can't be edited. Editing their ledger rows isn't blocked and can drift
  investment cash.
- Deposits: no periodic payouts, TDS, exact bank day counts, or missed-RD tracking.
- Backfilled snapshots count opening balances regardless of date and use only prior prices.
- Returns not annualized (no XIRR).

## Budgets, savings goals, and planning (phase 4)

Code: `services/budgets/`, `services/goals/`, `services/planning/` (`calculation.py` pure,
`service.py`), plus matching `repositories/`, `schemas/`, `api/v1/` files. Reads spending and
transfers from `finance_transactions`; no second transaction, account, or notification model.

### Budget data model

- `finance_budgets`: `scope` overall or one expense category (`category_id`), `amount`, `period`
  monthly or custom, `rollover`, alert settings.
- `finance_budget_periods`: unique `(budget_id, period_start)`; `base_amount`, `rollover_amount`,
  `closed_at` + `spent_at_close`.
- `finance_budget_alerts`: unique `(period_id, threshold)`; FK to `notifications` ON DELETE SET
  NULL.
- `finance_savings_goals` (optional `account_id`, same currency, `completed_at`) →
  `finance_goal_contributions` (contribution or withdrawal; unique transaction; FK to
  `finance_transactions`, no ON DELETE).
- `finance_monthly_plans`: expected income, unique workspace, currency, month.

Rules:

- Monthly budgets start on the 1st and repeat until the end month or forever (`end_date` NULL);
  custom covers one range ≤ a year. `upcoming`/`active`/`completed` derived; `archived` stored.
- Two active same-currency, same-scope budgets can't overlap (409); overall and category budgets
  coexist. Archiving frees the period; restoring re-checks. Check is in the service, so simultaneous
  creations could both pass.
- No subcategories, so budgets are per category.
- CHECKs (`tests/test_migrations.py`): amounts 1 to 10^13; custom period has an end and no
  rollover; archived matches `archived_at`; closed periods have both close fields. Composite FKs
  keep everything in the workspace. Category FK has no ON DELETE: a used category → 409 "A budget
  limits spending in this category".

### Spending eligibility

Net spending (expenses − refunds) in the period, currency, and scope, via
`FinanceService.spending_by_category` (same aggregate as the Overview, so they agree). Counts:
`expense` (incl. fees, trade charges, EMI interest in "Loan interest", a subscription or bill
payment once); `refund` reduces. Never counts: `income`, `transfer` (card bills, savings,
investment purchases, EMI principal), expected but unrecorded bills.

- Uncategorized counts only toward overall budgets.
- Refunds above spending → 0, never negative.
- Calendar dates in the user's time zone; months inclusive.

### Utilization, statuses, and projections

`services/budgets/calculation.py` (`tests/test_budget_math.py`), integers only: utilization in
basis points (`spent × 10000 ÷ available`, floor) sent as `"87.50"`; thresholds by
cross-multiplying (`spent × 100 ≥ threshold × available`).

- Available = base + rollover, ≥ 0. Remaining may be negative.
- Status: `on_track` < 75%, `approaching` ≥ 75%, `near` ≥ 90%, `exceeded` when spent > available
  (any spending if nothing available).
- Projected = spent × period days ÷ days elapsed, half up, only after 7 days; actual once over.

### Periods, edits, and history

- Periods are stored as they start (on create, edit, worker). Reads never write; unstored periods
  are computed from the current budget.
- Edits apply from the current period: finished periods close with the old amount first. Can't
  move start/end before a finished period (422); finished custom dates fixed.
- History per month: total (overall monthly budget, else sum of monthly category budgets),
  spending, how many stayed within, per category. Overlapping custom periods listed, not totalled.
- `…/budgets/copy` makes one-month budgets from the source month's monthly budgets at those
  periods' amounts, skipping budgets already covering the target, so it's idempotent.

### Rollover

Monthly only. `none`: nothing. `surplus`: leftover if positive. `full`: leftover either sign,
negative capped at the next base (month starts at 0 at worst; excess dropped). Leftover =
available − spent, so it compounds. Positive capped at 10^15 minor units (CHECK).

- Closing happens once, after the period ends in the owner's time zone: worker (or next edit)
  stores `spent_at_close`, sets `closed_at` via `UPDATE … WHERE closed_at IS NULL`, and writes the
  next period's rollover, in one transaction. Closed periods never change.
- Late corrections change history `spent` but not the rollover passed on; UI shows both.
- Base and rollover always reported separately.

### Alerts and deduplication

- `alerts_enabled`, up to six thresholds 1–200% (defaults 50, 75, 90, 100).
- `ReminderWorker` runs `check_budgets` at most every 5 min (after a poll): closes finished
  periods, then checks thresholds on the owner's local date (`users.timezone`, else UTC).
- One alert per threshold and period, written with the notification in one transaction (tested
  with three workers). Several crossed at once → only the highest notifies.
- Never re-sent after dipping below; a new threshold below one already sent is recorded silently;
  amount or rollover changes don't reset.
- Notifications are plain `notifications` rows for the owner, no reminder link. Archived or
  alerts-off budgets are skipped.

### Savings goal accounting

- A goal earmarks money; never an account or in net worth. Saved = contributions − withdrawals,
  derived.
- Modes, none an expense: `allocate` (no ledger row), `transfer` (creates a ledger transfer to or
  from the linked account in the same transaction), `link` (uses an existing transfer's amount and
  date).
- A transfer backs ≤ 1 contribution (409); the ledger refuses to delete it (409); undo keeps it
  unless `delete_transaction=true`.
- Linked account: bank, savings, cash, wallet, or other in the goal's currency (not investment, to
  avoid counting as both; not cards or loans). Fixed once transfers are recorded.
- Over-allocation across active and paused goals in one account is flagged; available to withdraw
  = saved capped at balance. Over-withdrawal → 422; a contribution later withdrawals depend on
  can't be undone first.
- Suggested monthly (`services/goals/calculation.py`, `tests/test_goal_math.py`) = remaining ÷
  months through the target month inclusive, rounded **up**; all remaining once past; none without
  a date. Progress in bps, capped at 100%.
- States: `active`, `paused` (withdrawals only), `completed` (reopen clears `completed_at`),
  `cancelled`. Goals with contributions can't be deleted.

### Monthly planning

`GET …/plan` (`services/planning/calculation.py`, `tests/test_planning_math.py`,
`tests/test_planning.py`), planned vs actual:

- Income: this month's expected, else latest earlier month's / recorded.
- Fixed commitments: EMIs, rent (bills in built-in Rent category), subscriptions, bills due,
  except skipped / those paid.
- Variable spending: overall budget less planned rent, subscription, bill, EMI interest, else
  category budgets / net spending less commitment payments.
- Savings goals: suggested contributions / net contributions.
- Investments: SIPs due / transfers into investment accounts from others.
- Remaining: income − all lines.
- Lines never overlap. Response also splits **spending** (net expenses) from **allocations** (loan
  principal, net investments, goal savings).
- Only expected income is stored (`PUT …/plan/{month}`); carries forward until replaced.

### Budgets, goals, and planning API

Under `/api/v1/workspaces/{workspace_id}/finance`; foreign budget or goal 404, referenced
category, account, or transaction 422; `today` defaults to the user's time zone, else UTC. CRUD for
`/budgets`, `/savings-goals`, `…/contributions`. Notable: `/budgets/overview` (`month`,
`currency`), `/budgets/history` (`months` ≤ 24), `POST /budgets/copy` (`from_month`, `to_month`),
`/budgets/{id}/archive` (idempotent) and `/restore`; goal `PATCH` sets `state`, `DELETE` only
without contributions; contributions take `type` and `mode`; `DELETE …/contributions/{cid}` takes
`delete_transaction`; `GET /plan`, `PUT`/`DELETE /plan/{month}`. Unknown fields forbidden; amounts
JSON integers; nothing logged about amounts.

### Budgets, goals, and plans in the web app

- `/finance` views Budgets, Plan, Goals; Overview shows budget and goals when present. Yup in
  `lib/budgets`, `lib/goals`. The web computes no spending, status, or progress. Keys
  `["workspaces", id, "finance", "budgets" | "goals" | "plan", …]`.

### Budget and goal limitations

- No subcategory, weekly, or yearly budgets; no per-month overrides of a recurring budget.
- Overlap check isn't a DB constraint.
- Alerts in-app, ~5 min delay; a last-day crossing after the final check isn't announced.
- Rollover ignores later corrections.
- Loan prepayments show in allocations, not the EMI line; RD installments not planned; no
  per-month savings plan.
- Currencies never combined. No AI insights, bank connections, or auto-categorization.

## Finance limitations and extension points (planned, not implemented)

- **Statement imports** (CAS, contract notes) would implement `PriceFeed` or record buys (see
  [Valuation strategy](#valuation-strategy)); none integrated.
- Only auto-debit SIPs create transactions automatically. Overdue subscription or bill occurrences
  are listed up to the 60 most recent.
- No loan history before it was added; floating rates via rescheduling; interest per installment
  period (no daily-balance interest, fees, or bundled insurance).
- Editing a transaction that records a payment isn't blocked; the payment keeps its amounts.
- Not supported: conversion, split transactions, attachments, imports, bank connections,
  reconciliation, undo.

## Notes and knowledge management

Notes, quick notes, and a daily journal in folders and tags, linked to each other and to tasks.

### Notes data model

Tables (migration `0012_create_notes`): `note_folders` (`parent_id` cascade), `notes`
(`folder_id` no ON DELETE; service moves notes out first), `note_tags` + `note_tag_assignments`,
`note_links` (source → target), `note_task_links`, `note_attachments` (metadata only). All links
cascade and use composite FKs on `(id, workspace_id)`, so the DB refuses cross-workspace rows.

`notes` columns with rules:

- `note_type` `note`/`quick`/`journal`; `title` 0–200 chars ("Untitled" or journal date when
  empty).
- `content`: ProseMirror JSON ≤ 1,000,000 chars, `content_format = prosemirror-v1`; `plain_text`
  derived on save, never client-sent.
- `folder_id` NULL = Inbox. `journal_date` set exactly for journals,
  `unique(workspace_id, journal_date)`.
- `is_locked` shows only the title in lists, search, previews (not encryption). Archived and
  trashed (timestamps) are read-only.
- `revision` from 1, counts title/content changes (optimistic concurrency). `updated_at` changes
  only with title/content; opening sets `last_opened_at`.

### Folders and tags

- Folders nest ≤ 8 levels; service refuses cycles (walks the tree), CHECK forbids self-parent.
- Folder delete requires `?notes=`: `parent` moves notes and subfolders up; `inbox`/`trash` moves
  every note inside there, then deletes the subtree.
- Tags unique per workspace by `normalized_name` (collapsed whitespace, trimmed, case-folded);
  tagging by name reuses or creates (concurrent-safe); rename onto another → 409; ≤ 50 per note.

### Editor content format

- Tiptap 3 with StarterKit, task lists, tables, lowlight code blocks; extensions defined once in
  `lib/note-content` for editor and Markdown.
- ProseMirror JSON is the only source of truth; Markdown never stored.
- `services/notes/content.py` validates node/mark types, depth, size, and links (`http(s):`,
  `mailto:`, internal note links only), and derives `plain_text` and outgoing links.

### Markdown conversion

`@tiptap/markdown` `MarkdownManager`: import `.md`/`.txt` (first heading or line is the title),
export or copy, Markdown-looking plain-text paste (HTML pastes keep browser formatting), quick
capture. Round trips tested; underline exports as plain text; images dropped (no image node).

### Autosave strategy

`hooks/use-note-autosave.ts`:

- Saves 800 ms after the last change; leaving saves at once and switching waits for it.
- One request at a time; no-op saves skipped.
- Sends `expected_revision`; stale → 409, nothing overwritten; user picks "Load their version" or
  "Keep mine".
- Network errors, 5xx, 429 retry after 1, 3, 8 s; then "Not saved" with Retry.
- "Saved" only after server confirms; leave warning on close/reload with pending changes.
- Metadata changes (pin, favorite, folder, archive, tags) don't touch the revision.

### Note linking and backlinks

- Note links are link marks with `href` `/notes?note=<uuid>`, so renames never break them.
- Each content save replaces `note_links` with existing same-workspace targets (deduped; self and
  foreign or unknown IDs ignored).
- `GET …/notes/{id}/links` excludes trashed notes. No graph view.

### Task integration

- `note_task_links`: task must be in the workspace (422), idempotent, removed with either side.
- `GET …/notes/{id}/tasks` uses the tasks API response type; tasks open via `/tasks?task=<id>`;
  the task dialog lists notes via `GET …/notes?task_id=`.

### Journal behavior

- One entry per day per workspace. `PUT …/notes/journal/{date}` gets or creates (201); concurrent
  first opens resolve to one entry; opening a trashed day restores it. `…/journal/today` uses the
  user's time zone, else UTC.
- Type and date are immutable; duplicating makes an ordinary note. Journals aren't in Inbox or All
  notes.

### Search architecture

- `GET …/notes?q=`: ≤ 8 words, each must match (case-insensitive) title, plain text, a tag, or the
  folder name; escaped `ILIKE` per word on SQLite and PostgreSQL. FTS could replace
  `repositories/notes.py`'s filter without API changes.
- `excerpt` is the start or text around the first match; the web highlights with `<mark>` by
  splitting text, never injected HTML.
- Locked notes: empty `excerpt` everywhere (list, dashboard, AI context, agent tools) and text
  never matched by notes or universal search; title, tags, folder still match.
- Filters: state, folder or Inbox, tag, type, task, favorite, pinned; sorts incl. recent and
  journal date; `pinned_first`; `limit` ≤ 100, `offset`. Views map to filters in `lib/notes`. No
  semantic search.

### Attachments

- Shared with [documents](#document-storage): metadata in `note_attachments`, bytes at
  `ORBIT_ATTACHMENTS_PATH/<workspace id>/<attachment id>` (`system/attachment_store.py`); UUID
  names, dirs `0700`, files `0600`, temp-file-then-rename, I/O in a worker thread.
- Upload: raw body with `?filename=` (name, not path), capped by `ORBIT_ATTACHMENT_MAX_BYTES`
  (10 MB) while reading. Type from extension, verified by leading bytes (PNG, JPEG, GIF, WebP, PDF,
  ZIP-based Office/OpenDocument) or no NUL bytes for text; declared type ignored
  (`utils/file_types.py`). ≤ 50 per note.
- Download needs the bearer token (web fetches a blob); always `Content-Disposition: attachment`,
  detected type, `nosniff`, sandboxing CSP.
- Files are deleted with the attachment, permanent note deletion (incl. empty trash), or the
  workspace; removed if metadata fails to save.
- Limits: local disk only (multi-instance cloud needs a shared volume; no object storage); not
  inline. Failed deletions (logged) leave orphans until the worker's [sweep](#document-storage).

### Notes API

Under `/api/v1/workspaces/{workspace_id}`; foreign IDs 404 in path, 422 referenced (folder, task).
CRUD for `/notes`, `/note-folders` (flat list), `/note-tags`. Notable: `POST /notes` takes `content`
or `text`; `GET /notes/counts`; `PATCH /notes/{id}` 409 on stale `expected_revision`; `DELETE` only
if trashed (else 409); `POST /notes/empty-trash`; `POST /notes/{id}/open`, `/trash`, `/restore`,
`/duplicate` (same folder and tags); `/notes/{id}/links`, `/tags` (by name), `/tasks`,
`/attachments`; folder `DELETE` takes `?notes=parent|inbox|trash`. Unknown fields forbidden
(`workspace_id`, `revision`, `plain_text`, `journal_date` in a body → 422); titles reject control
characters.

### Notes in the web app

- `components/notes/`; the URL holds view, folder or tag, search, and open note. With a note open
  the list is a drawer; details-panel visibility is in `localStorage`.
- Locking is a privacy cover (**Show content** per visit), not access control.
- Keys: `N` new note, `/` search. `QuickCaptureProvider` (app shell) saves quick notes to the Inbox
  and confirms before discarding text. Palette: new, quick, today's journal, recent, live search.
- Keys `["workspaces", id, "notes", …]`; an open note's query never refetches on its own (the
  editor owns it).

### Notes limitations

- Substring search only. Attachments on one machine, not inline.
- Whole-note conflict resolution; no live tab sync.
- In-app navigation while a save fails can lose the last changes.
- No templates, sharing, version history, graph view, AI features, or semantic search.

## Calendar and events

Events and recurring series per workspace; tasks and notes are linked by ID, never copied.

### Event data model

- Tables: `calendar_categories`, `calendar_events`, `calendar_event_exceptions` (cascade),
  `calendar_event_alerts` (each 1:1 with a reminder via `reminders.calendar_event_alert_id`),
  `calendar_event_notes`/`calendar_event_tasks` (both sides cascade), `calendar_preferences` (per
  user). `category_id` has no `ON DELETE`; the service clears it first. All FKs are composite on
  `(id, workspace_id)`. Migration `0013_create_calendar` also adds `tasks.scheduled_start`/
  `scheduled_end`.
- `calendar_events`: `start_local`/`end_local` are **the source of truth** (naive wall-clock,
  `end >= start` CHECK) in `timezone` (IANA; default user preference, else UTC). `start_at`/
  `end_at` = derived UTC bounds of the first occurrence; `until_at` = derived UTC end of the last
  (`NULL` = never ends). `all_day` = local midnight to midnight after the last day. `recurrence`
  `NULL` or versioned JSON. `status` `confirmed`|`cancelled`. `series_id` = series a split came
  from (not an FK).
- **Categories**: name unique case-insensitively; color from a fixed palette (`blue`, `green`,
  `amber`, `rose`, `violet`, `teal`, `orange`, `slate`; never CSS). First list creates Personal,
  Work, Meeting, Appointment, Birthday, Travel, Other. Hidden categories are excluded from ranges
  and agenda, not search.
- **Exceptions**: `skipped` or `modified`, keyed by **original local start**
  (`unique(event_id, original_start)`); `NULL` overrides follow the series. Moved ones store
  indexed UTC bounds so ranges find occurrences moved in.
- **Alerts**: ≤ 5 per event, 0-40,320 minutes before, unique per event.

### Recurrence strategy

Pure and unit-tested: `services/calendar/recurrence.py`, `occurrences.py`.

- **Rules, not rows**: occurrences generated per requested range; never pre-generated.
- Stored rule `{"version": 1, "frequency", "interval", "weekdays", "count", "until"}` →
  `dateutil.rrule`; no user RRULE text parsed. Daily; weekly (weekdays must include the start's);
  monthly on the start's day; yearly. Interval 1-99; 1-999 occurrences, until date (inclusive), or
  never.
- Monthly 29th-31st → last day of shorter months (`BYMONTHDAY=28,…,31;BYSETPOS=-1`); Feb 29 →
  Feb 28 in common years.
- **Identity** = event + original local start (`RECURRENCE-ID`): `OccurrenceResponse.id`, path
  `…/occurrences/2030-01-14T09:00`. Stable and deduplicated when moved.
- **Count** includes skipped occurrences; skipping never extends a series.
- **Scopes**: `this` writes an exception. `following` splits: original gets `until` the day
  before; new series (`series_id` back) keeps remaining count, alerts, links; later exceptions
  dropped. `series` edits the event; moving shifts all occurrences (weekdays too). Changing a
  series' times, zone, all-day, or rule **clears its exceptions**. Delete `this` = `skipped`
  exception; `following` truncates; at the first occurrence either deletes the series.
- A repeating event must end before its next occurrence; any event ≤ a year.

### Timezone handling

- Per-occurrence `local_to_utc` (same as reminders): stable across DST; skipped 02:30 → 03:30;
  repeated time → first. End = local start + local length.
- `GET …/calendar/range`: local dates `[start, end)` + viewer zone. Timed items match by instant
  against that zone's day bounds; **all-day events match by date** in any zone.
- Web drag converts viewer clock → event zone with `zonedTimeToInstant` (`utils/time-zones`).

### Calendar task integration

- Tasks' optional **scheduled block** (UTC, both or neither, end > start, ≤ a week, CHECK) is
  separate from the **due date**. `PATCH …/tasks/{id}` (`null` clears);
  `GET …/tasks?scheduled=false`. Ranges return `scheduled_tasks` and unscheduled `due_tasks`.

### Note integration

- `PUT/DELETE …/events/{id}/notes/{note}` (foreign note 422). `POST …/events/{id}/notes` creates
  an ordinary Inbox note via the notes service and links it; no note content in the calendar.

### Calendar reminder integration

- Each alert manages **one reminder** (unique, cascade) on the existing worker; no second
  scheduler. `commitment.kind = "calendar_alert"`; reminders API refuses edit/delete (409).
- Targets the **next confirmed occurrence whose alert time is still ahead** (respects skips,
  cancels, moves). All-day alerts count back from 09:00 on day one in the event's zone.
- **Re-pointed in the same transaction** as every change; cancel removes it.
- After firing, `ManagedFollowUp` (`scheduler/worker.py`) → `CalendarService.after_delivery` in
  the delivery transaction re-points it. Lookahead ≈ 400 days past max(now, series start).

### Calendar preferences

`calendar_preferences`, one row per user: default view, week start (`null` = browser locale),
working hours, task display toggles. `GET|PUT /api/v1/me/calendar-preferences` (defaults with
`updated_at: null` until saved). Zone is `users.timezone`; category visibility is per workspace.

### Calendar API

Under `/api/v1/workspaces/{workspace_id}/calendar`. Foreign event → `404 Event not found.`;
foreign category/note/task reference → 422.

- `GET /range` (`end` ≤ 92 days after `start`); `GET /agenda` (`limit` ≤ 100, opaque `cursor`);
  `GET /events` search (`q`, `category_id`, `limit` ≤ 100); `POST /events/{id}/duplicate` (no
  exceptions); `PATCH|DELETE /events/{id}/occurrences/{original_start}` with `scope`; link routes
  idempotent.
- Body times: local, whole minutes, no offset, years 2000-2200. Unknown fields (`workspace_id`,
  `series_id`, derived bounds) → 422. Search: escaped substring on title, description, location.

### Calendar in the web app

- `components/calendar/`; Month/Week/Day/Agenda in `?view=week&date=…`; overlap layout
  `layoutDay`. Drag and drop (mouse/pen only) is optimistic with rollback; repeating events ask
  scope first; touch uses taps; dialogs are the non-drag alternative. Keys `N`, `T`, `M`/`W`/`D`/
  `A`, arrows. Query keys `["workspaces", id, "calendar", …]`, `["me", "calendar-preferences"]`;
  changes refetch reminders too.

### Calendar limitations

- Google/Outlook via [external integrations](#external-integrations); no CalDAV, `.ics`,
  attendees, free/busy, or AI scheduling.
- No `BYDAY` ordinals, hourly rules, or `RDATE`/`EXDATE` beyond skips.
- Exceptions moved before the series' first start aren't found by ranges.
- Alerts with nothing in ≈ 400 days wait for a series change; in-app only, poll granularity.
- No conflict flags; no dragging a task block across midnight. Search matches series only.
- Opt-in PostgreSQL suite covers SQL through the service; HTTP tests run on SQLite.

## Habits and routines

Habits run on a schedule; routines are step sequences run in one go. Code: `services/habits/`
(`schedule.py`, `progress.py` pure rules; `insights.py`; `service.py`, `routines.py`),
`repositories/habits.py`, `api/v1/habits.py`, migration `0014_create_habits`.

### Habit data model

- `habits`: kind `boolean`|`numeric`|`duration` (**immutable**); target `NULL` for yes/no,
  minutes for duration, float > 0 otherwise; unit numeric only; IANA zone; status `active`|
  `paused`|`archived`; icon from a fixed set, color from the calendar palette.
- `habit_schedule_versions` (JSON + effective date, unique per habit/date); `habit_pauses`
  (`[start, end)`, `end NULL` while ongoing); `habit_logs` (`UNIQUE (habit_id, day)`, stores the
  target in effect when logged); `habit_categories` (defaults Health, Fitness, Learning,
  Productivity, Personal, Finance, Lifestyle, Other on first read); `habit_tasks`, `habit_notes`.
  Composite FKs on `(id, workspace_id)`.

### Schedule representation

- `daily` (every 1-365 days from the version's first day), `weekdays`, `monthly` (listed days),
  `weekly_target` (`times_per_week` 1-7).
- Missing month days fall on the last day; days landing on one date count once.
- Weeks are always ISO Monday-Sunday, regardless of display preference.
- Changing a schedule adds a version from a date (default today), dropping versions from that
  date on; history never changes. Dated on/before start → replaces all. Same schedule → no-op.

### Completion history

Upsert per day: `completed` (target or value), `progress`, `skipped`; undo deletes. Future days
(habit's zone) and days outside the habit's dates are refused. Edits keep the logged target, so
raising a target doesn't make done days partial. _Completed_ = value ≥ stored target;
_partial_ = 0 < value < target.

### Streak calculation rules

Derived on read (`progress.py`).

- **Periods**: fixed-day: per due day _met_, _skipped_, _pending_ (today), else _missed_ (past
  partial = missed). Weekly target: per week, needs `min(times_per_week, tracked non-skipped
days)`; needing nothing = skipped; mid-week schedule change splits the week.
- **Streaks**: consecutive met periods in the current unit (days or weeks). Skipped/paused are
  neutral, missed ends, pending doesn't yet. Switching between fixed-day and weekly ends the run.
- **Rates**: met / (met + missed); nothing due → `null`, not 0%.
- Non-due completions count toward totals, not streaks.

### Routine execution model

- `routines`/`routine_steps`: weekdays (empty = every day); step links to habit/task/note are
  plain FKs that clear on delete (service checks workspace). Edits replace the step list by ID.
- `routine_sessions`/`routine_session_steps` copy steps at start, so past sessions never change.
  Session `active` → `completed`|`abandoned`; partial unique index allows one active session
  (second start 409). Settling the last pending step (with at least one completed) finishes the
  session as `completed`; notes stay editable after.
- Completing a step linked to a yes/no habit logs that habit for the session's day in the same
  transaction unless already logged; other kinds and tasks are left to the user.

### Reminder and calendar integration

- `habit_reminders`: ≤ 5 times per habit/routine, optional weekdays; each manages one reminder
  (`reminders.habit_reminder_id`, kind `habit_reminder`) like calendar alerts: next due day not
  done or skipped (weekly: each day until met), re-pointed in the same transaction, moved on by
  `ManagedFollowUp`. Pause/archive cancels. Reminders API refuses edits (409).
- `GET …/habits/calendar` computes timed habits/routines on due days (no event rows; weekly
  targets omitted; not draggable). `calendar_preferences.show_habits` (default on).
- Tasks and notes created from habits are ordinary, linked records.

### Timezone behavior

Entries keyed by local date in the habit's zone (default user preference, else UTC); "today" uses
it. Changing the zone doesn't rewrite history. Today view takes the viewer's zone. Reminders are
wall-clock, converted per occurrence.

### Habits API

Under `/workspaces/{workspace_id}`; CRUD for `/habits/categories`, `/habits`, `/routines`.

- `PATCH /habits/{id}`: `schedule` + optional `schedule_from`; `status` pauses/archives/restores.
- `GET /habits/today?date=&timezone=`; `GET /habits/{id}/history` and `GET /habits/analytics`
  (≤ 366 days; trend = rate change between halves); `GET /habits/calendar` (`end` exclusive).
- `PUT|DELETE /habits/{id}/log/{date}`; `PUT …/reminders` replaces times.
- Sessions: `/routines/{id}/sessions[/{session_id}]`, `PATCH …/steps/{step_id}`, `POST …/note`.
- Errors: 404 outside workspace; 422 invalid, future days, foreign links; 409 second active
  session, ended session, taken category name.

### Habits in the web app

- `components/habits/`, side rail `@5xl/habits`; `?view=` Today (default), All habits, Routines,
  Analytics, Templates, Archived; details `?habit=`, `?routine=`.
- Templates (`src/lib/habits/templates.ts`) only prefill forms. Check-offs optimistic with
  rollback. Encouraging wording; no points or badges in Habits.
- `cheerFor`: celebration when the API reports the target met; bigger on streak milestones (3, 7,
  14, 21, 30…) and the day's last habit; respects reduced motion.

### Habit limitations

- No monthly targets or "every other week"; kind immutable; no snoozing.
- Reminder lookahead ≈ 400 days (routines two weeks), poll granularity.
- Calendar entries not draggable; steps complete only yes/no habits, never tasks.
- Streaks and rates computed from the whole log on read; no cached summary.
- Opt-in PostgreSQL suite covers SQL through services; HTTP tests on SQLite.

## Documents and the personal vault

A document is a record first: it can exist without a file, and replacing the file keeps versions.

### Document data model

- Tables: `document_folders` (self `parent_id`, `ON DELETE CASCADE`), `document_categories`
  (unique normalized name), `documents` (`folder_id`, `category_id` no `ON DELETE`; service
  moves/clears first), cascading `document_versions`, `document_tags` (unique per document),
  `document_renewals`, `document_links`, and `reminders.document_id`. Composite FKs on
  `(id, workspace_id)`; migration `0015_create_documents`.
- `documents`: up to 20 custom `{label, value}` text details (no typed schemas); reminder days
  0-365 before (≤ 6), time, zone. Denormalized current version (`file_*`, `current_version_id`)
  updated in the same transaction; CHECK keeps `current_version_id` and `file_size` together.
- `document_versions`: number from 1 (highest current), SHA-256, `blob_id`, `restored_from`.
- Archive/trash are timestamps. Trashed = read-only (409), only they can be permanently deleted.
  Archived stays editable; reminders stop.
- Default categories (Identity Documents, Employment, Salary & Payslips, Tax & Compliance,
  Banking, Insurance, Vehicle Documents, Property, Medical Records, Education & Certificates,
  Receipts & Invoices, Warranties, Travel, Other) on first list; concurrent first requests
  resolve to one set.

### Folders

≤ 8 levels; moves into self or a descendant refused (CHECK forbids self-parent). Delete
`?documents=`: `parent` moves contents up; `unfiled` deletes subfolders, documents folderless;
`folder` moves to `target_id` (not inside). Never deletes documents, including trashed/archived.

### Document storage

- Shared with note attachments: `system/attachment_store.py`,
  `ORBIT_ATTACHMENTS_PATH/<workspace id>/<blob id>`; UUID names, dirs `0700`, files `0600`,
  `.partial` then rename, I/O in a worker thread, behind a `FileStore` protocol.
- Upload: stream with limit (`ORBIT_DOCUMENT_MAX_BYTES`, 25 MB default) → type check → write →
  metadata; on failure roll back and delete the file.
- Dedup within one document only; files never shared across documents.
- Blobs are deleted after metadata commits, only when no version references them.
- Orphan sweep every 6 h (reminder worker): unreferenced blobs and `.partial` files older than
  1 h; non-UUID names never touched.

### File validation

- Accepted: PDF, JPEG, PNG, WebP, DOCX, XLSX, PPTX, TXT, CSV; others (HTML, SVG, executables,
  archives) 415. Extension picks the type; magic bytes must match; Office ZIPs must contain
  `word/document.xml`/`xl/workbook.xml`/`ppt/presentation.xml` (directory only, no
  decompression); text has no NUL. Declared type ignored.
- File names: last segment, no control chars or leading dots, ≤ 255 chars; never used as a path.

### Security and privacy

- Foreign IDs: 404 in path, 422 as reference.
- Downloads only via `…/documents/{id}/file`, `…/versions/{version}/file` with the bearer token;
  no public/signed URLs, no paths or blob IDs in responses. Headers: `Content-Disposition:
attachment`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none';
sandbox`, `Cache-Control: private, no-store`.
- Previews via object URLs with the detected type: PDF (iframe), PNG/JPEG/WebP, TXT/CSV (first
  100,000 chars as React text). Never rendered as HTML.
- `DocumentSummaryResponse` (lists, search, overview, reminders) omits number, amount, notes,
  custom details. Search never matches numbers. Logs: IDs and counts only.
- Files never leave the API's machine.

### Encryption

Orbit does **not** encrypt documents at rest; not end-to-end encrypted. Rely on `0600`, API
authorization, and full-disk encryption. App-level encryption was deferred: with the key on the
same machine it adds key rotation, recovery risk, and `cryptography` for little gain. A proper
design: per-file AES-GCM with random nonce, key ID per version, keys outside DB and attachments,
rotation command, exports decrypting via the API. Treat backups and exports as sensitive.

### Versioning

`POST …/versions` adds a new current version. `…/versions/{id}/restore` adds a copy sharing the
blob (`restored_from`). Current version can't be deleted (422). Concurrent uploads race on unique
`(document_id, number)`; loser 409.

### Expiry tracking

- `expiry_status` derived on read (today in user's zone): `none`, `expired`, `expiring` (≤ 30
  days), `valid`. Filters `expires_within`, `expired=true`, `renewal_within`.
- `POST …/renew` replaces dates and records old/new in `document_renewals`; the new copy is a new
  version.

### Reminder integration

- ≤ 1 reminder per document (`reminders.document_id`, unique, cascade, kind `document`).
- Alerts per tracked date (expiry, renewal, review) × reminder day at the reminder time (09:00
  default) in the document's zone; points at the **earliest alert still ahead**; never sent late.
  Description carries only the date, never the document number.
- Re-pointed in the same transaction as every change; archive/trash removes it.
  `DocumentReminders.after_delivery` via `ManagedFollowUp`. Reminders API refuses edit (409).

### Cross-module links

`document_links`: one nullable cascading composite FK per kind (note, task, event, transaction,
loan, subscription/bill, deposit, holding, asset); CHECK exactly one set. Linking is idempotent;
foreign records 422. `GET …/documents/link-candidates?kind=&q=`;
`GET …/documents?linked_kind=&linked_id=` powers other modules' Documents sections.

### Search and filters

`q`: ≤ 8 words, all must match (escaped `ILIKE`) title, description, file name, issuer,
provider, notes, tag, category, or folder name. No content indexing. Filters include state
(`active`, `archived`, `trashed`, `any`), file kind (`pdf`, `image`, `text`, `office`, `none`),
folder with subfolders, unfiled, unclassified. `limit` ≤ 100.

### Export and backup

`POST …/documents/export` (`document_ids`, `folder_id`, `category_id`, or all not trashed;
`include_versions`): ZIP in a private temp file with `metadata.json`, folder paths, `Unfiled/`,
and `<name> (versions)/v<n> <name>`. Collisions get " (2)"; segments sanitized. Includes
document numbers. Full backups copy DB and attachments together
([development.md](development.md#backups)); see
[Backup, restore, and data portability](#backup-restore-and-data-portability).

### Documents API

Under `/api/v1/workspaces/{workspace_id}`; CRUD for `/documents`, `/document-folders`,
`/document-categories`.

- `POST /documents/upload?filename=&title=&folder_id=&category_id=` (raw body);
  `POST /documents/{id}/versions?filename=&note=`.
- `GET /documents/overview`, `/counts`, `/settings` (limits), `/tags`.
- `POST /documents/empty-trash`, `/documents/{id}/open`, `/trash`, `/restore`, `/renew`.
- `PUT|DELETE /documents/{id}/links/{kind}/{record}`.
- Errors: 404, 413 over limit, 415 type, 422 invalid, 409 trashed, taken name, version race.
  Unknown fields forbidden.

### Documents in the web app

- `components/documents/`; state in the URL; rail with views, folder tree, categories, tags.
- Uploads one at a time with per-file status (`fetch` has no upload progress).
- Code: `src/api/documents`, `src/hooks/use-documents.ts`, `use-document-commands.ts`,
  `src/lib/documents`; folder trees shared with notes in `src/utils/folders`.

### Document limitations

- No encryption at rest, OCR, AI extraction, export import, or sharing.
- Single machine; multiple API instances need a shared volume.
- Uploads read into memory (25 MB default, 200 MB max). Previews load whole files; no Office.
- Reminders use the stored zone, not later user zone changes.
- Exports need temporary disk space.
- Opt-in PostgreSQL suite covers SQL; HTTP tests on SQLite.

## Watchlist

Movies and series at `/watchlist` (Library in the sidebar).

### Data

`watch_items`: `kind` `movie`/`series`; `status` `want`/`watching`/`watched`/`dropped`;
`runtime_minutes` (series: typical episode); `season_episodes` (JSON episode counts per season, no
specials); `progress_season`/`progress_episode` (last watched, series only); `rating` 1-10 = half
stars of five; `source_id` (TMDB ID, unique per workspace and kind); `poster_blob_id` (attachment
store); `position` (queue order).

- Service keeps dates consistent: start sets `started_at`; finish sets `finished_at` (set exactly
  while watched) and, with known seasons, the last episode; back to `want` clears progress and
  dates.
- `POST …/next-episode` walks known seasons and marks watched on the last episode (no counts:
  just counts up). `POST …/move-to-top` puts a title first.

### Title lookup (TMDB)

- Opt-in per workspace (**Settings → Watchlist**, `PUT …/watchlist/lookup/key`, v3 key or v4
  token). Verified via TMDB `/authentication`, stored Fernet-encrypted in `watchlist_settings` with
  the AI key (`ORBIT_AI_SECRET_KEY` or `ai-secret.key`), never returned. `PUT …/lookup`
  pauses/resumes; `DELETE …/lookup/key` forgets.
- `GET …/watchlist/search?q=&kind=&language=` sends only the phrase. `kind` uses
  `/search/{movie,tv}` (≤ 20) instead of `/search/multi` (≤ 12); `language` (ISO 639-1) keeps
  results whose `original_language` matches, filtered by Orbit (display stays English). Adding a match fetches details and a `w342`
  poster once; a failed poster download is skipped, not a failed add. `POST …/items/{id}/refresh`
  refetches (new seasons).
- Browser never contacts TMDB: `GET …/items/{id}/poster`; thumbnails via
  `GET …/watchlist/search/poster?path=` (path validated). Adapter `providers/media/tmdb.py` (shared
  client, catalog per key). UI shows TMDB's required attribution.

### Suggestions

- `GET …/watchlist/suggestions` (lookup on): seeds are up to 6 looked-up titles, liked first
  (rating ≥ 7, weight rating/10), then watching, watched, queued; dropped and low-rated titles
  never seed. Sends only their TMDB IDs (`/{movie,tv}/{id}/recommendations`). Results are scored
  by seed weight and rank, summed across seeds, minus anything on the watchlist (dropped too);
  ≤ 24, each with up to 3 `because` titles. Not cached server-side.
- `POST …/ai/watchlist/suggestions` (`services/ai/watchlist_assist.py`): needs AI on and the
  `watchlist` AI module; checked before any TMDB call. The model sees the watchlist (title, kind,
  year, genres, status, rating; never notes, platform, recommended by) and the candidates by
  reference (`C1…`), and returns ≤ 8 refs with a reason. Unknown or repeated refs are dropped, so
  every pick is a real TMDB title. Nothing is saved; adding uses `POST …/items` with `source_id`.

### Web

`components/watchlist/`, rail `?view=` **Up next**, **For you** (suggestions, "Pick for me" when
AI may read the watchlist), then one per status. A type filter (all, movies, series) applies to
every view; status views also sort by queue order (watched: recently finished) or name.
"Watch tonight" suggests by time and genre; manual entry always possible. Logic in
`lib/watchlist`.

### Backup

Module `watchlist`: `watch_items` + posters (`FILE_COLUMNS`), JSON/CSV export.
`watchlist_settings` excluded (the encrypted key never leaves the server).

### Limitations

Universal search covers title, platform, recommended by, notes, overview (opens
`/watchlist?title=<id>`); optional dashboard widget. The agent has no watchlist tools (its modules
deliberately omit the AI `watchlist` module). No per-episode history or
rewatch log (refinishing replaces `finished_at`), no poster uploads.

## Saved links

`/saved` (Library). Called bookmarks in API, tables, and code; `saved_searches` is unrelated.

### Data

- `bookmark_collections`: names unique per workspace ignoring case and spacing, max 50.
- `bookmarks`: `url` `http`/`https` with host, ≤ 2,048 chars; `kind`
  `link`/`article`/`video`/`reel`/`repo`/`tool`; `status` `reference`/`later`/`done`; `tags` JSON,
  ≤ 10; `collection_id` composite FK `(collection_id, workspace_id)` (deleting a collection
  unfiles its links first).
- One save per URL per workspace (409 with the existing link), checked in the service, not a
  unique index: long non-ASCII URLs can exceed PostgreSQL's index row size.
- Saving never fetches. `services/bookmarks/urls.py` infers missing kind/title/status from the URL
  (reel, video, repo, article hosts and paths); reels, videos, articles start `later`, else
  `reference`; default title host + last path segment.
- `POST …/items/{id}/opened` counts an open without touching `updated_at`.

### Link previews (opt-in)

- Off by default (`bookmark_settings`, **Settings → Saved**, `PUT …/bookmarks/settings`). When on,
  the web calls `POST …/items/{id}/preview` after a save.
- `services/bookmarks/preview.py` parses `<head>` (stdlib parser): OG/Twitter tags, `<title>`,
  icon (else `/favicon.ico`). Sets `preview_description`, `previewed_at`; replaces the title only
  while it is the URL default; upgrades `link` to `video`/`article` per `og:type`.
- Image ≤ 2 MB, icon ≤ 256 KB, kept only if magic bytes are JPEG/PNG/GIF/WebP (icons also ICO),
  never SVG. Rows in `bookmark_previews` (`role` `image`/`icon`; `id` names the attachment file).
  Refresh replaces rows and deletes old files after commit. `GET …/image`, `…/icon` (204 when
  absent) with `nosniff`, `default-src 'none'`.
- SSRF guard `providers/web/link_preview.py`: ports 80/443, no URL credentials; every resolved
  address must be public (`is_global`, not multicast, IPv4-mapped unwrapped); connects to the
  checked IP with real name in `Host` and `sni_hostname` (defeats DNS rebinding); fresh client,
  `trust_env=False`, no cookies, ≤ 4 rechecked redirects, 512 KB HTML, 8 s total.
- Errors: fetch 502, blocked 422, previews off 409. Tests fake `app.state.link_previews`.

### Web

`components/bookmarks/`, rail `?view=` (All links, Pinned, Read & watch later, Reels & videos, Not
in a collection) and `?collection=`. Opens use `noopener noreferrer` and count. Pasting a link
outside a text field saves it into the shown collection; palette paste offers
`/saved?add=<url>`. Logic in `lib/bookmarks`.

### Backup

Module `bookmarks` ("Saved"), preview files via `FILE_COLUMNS` `bookmark_previews.id`; JSON/CSV
(one file per table).

### Limitations

Previews see only what signed-out visitors see (Instagram often nothing). No extension, share
target, dashboard widget, agent tool, or browser-bookmark import.

## Places

`/places` (Library): visited and wishlist on a world map; tally against 195 countries (UN members
and observers), share of world, continents.

### Data

`places`: `country_code` ISO alpha-2 validated by `services/places/countries.py`;
`latitude`/`longitude` both or neither; `status` `visited`/`want_to_visit`; `visited_on` visited
only (CHECK; cleared on moving to wishlist). One row per place, no visits table. `place_settings`
(no row = online maps off).

### Online maps and place search (opt-in)

- Off by default (`PUT …/places/settings`); server can forbid via `ORBIT_ONLINE_MAPS_ENABLED=false`.
- Offline: bundled Natural Earth 1:50m (`world-atlas`, ISO numeric ids mapped in
  `lib/places/countries.ts`) in MapLibre GL, no network.
- Online: tiles from `ORBIT_MAP_STYLE_URL` (OpenFreeMap default, sent in settings response).
  `POST …/places/search` via `providers/geo/nominatim.py` to `ORBIT_GEOCODER_URL`: phrase only,
  generic User-Agent, 1 req/s server-wide (Nominatim policy), 256-entry in-memory cache. Errors
  502; maps off 409. Tests fake `app.state.geocoder`.

### Web

`components/places/`, rail `?view=` Your world, Visited, Want to go. Flags from `flag-icons`
(`country-flag.tsx`, lazy). `world-map.tsx` lazy-loads MapLibre and shapes, points MapLibre 6
at its bundler-emitted worker (`setWorkerUrl`), converts `oklch` tokens for theming; tests mock it (no WebGL in jsdom). Logic in `lib/places`; dashboard widget.

### Backup and search

Module `places`: both tables, JSON/CSV. Universal search: name, city, note.

### Limitations

No reverse geocoding, import, trips/repeat visits, or agent tool. Countries missing from the 1:50m
shapes and pinless places count but don't show on the offline map.

## Achievements and the XP store

Per person: `/me/achievements` routes act on the session user only; web `/profile` (Overview,
Achievements, XP store, Collection).

### Data

- 44 achievements (easy to legendary) and store items (frames, banners, titles, confetti) are a
  code catalog, `services/achievements/catalog.py`. Keys are stored: never rename or reuse; retire.
- `achievement_unlocks`, `reward_purchases` (price paid), `reward_equips` (slot; composite FK to
  the purchase); migration 0034. Not backed up: per person, not per workspace.

### How unlocking works

- No event stream: `SqlAchievementMetrics` counts with plain SQL across workspaces the user owns,
  health tables only for their own `user_id`.
- `POST /check` unlocks all reached targets and returns `new_unlocks`; `GET` is read-only. Unlocks
  are permanent with their XP. Concurrent checks safe: the PK rejects duplicates; the loser
  reports nothing new.
- Web `AchievementWatcher` checks on sign-in and 1.2 s after any successful mutation except
  `ACHIEVEMENT_MUTATION_KEY` ones, then toasts.

### Levels and XP

Level n starts at 50·n·(n-1) XP. Purchases spend the balance (earned − spent), never lower the
level; items may need a minimum level. Item looks in `components/achievements/cosmetics.tsx`,
keyed by item key (frames show on every avatar; confetti in celebrations incl. habit toast).
A cover photo (`user_covers`), when set, replaces the equipped banner on the profile hero.

## Health and fitness

Workouts, exercises, templates, body, photos, nutrition, water, activity, goals. Not medical:
nothing diagnosed, prescribed, or device-imported; nothing leaves the server except opt-in AI
helpers ([Health helpers](#health-helpers)). Code `services/fitness/` (pure rules in `records.py`,
`calculations.py`; `overview.py` dashboard), `repositories/fitness.py`, `api/v1/fitness.py`,
migration `0016_create_fitness`. Named `fitness` because `health` is the health-check endpoints;
web page **Health** (`/health`).

### Health data privacy

- Rows carry `user_id` and `workspace_id`; every query filters both (`Owner`), so records stay
  private if workspaces are ever shared. Others' records: 404. Body IDs are references checked
  against the owner's records (422).
- Height and date of birth optional; nothing computed from DOB; body fat only when measured.
- **Photos** in the attachment store: server names, `0700`/`0600`, written before metadata and
  removed on failure, kept from the orphan sweep by `referenced_photo_blob_ids`. Only PNG/JPEG/WebP
  with matching bytes (415), ≤ `ORBIT_ATTACHMENT_MAX_BYTES`. Served only by
  `GET …/fitness/photos/{id}/file` as downloads with `nosniff`, sandbox CSP, `private, no-store`;
  no public or signed URLs; blob IDs never returned.
- No Orbit encryption beyond DB and disk ([Encryption](#encryption)); never in notification text.

### Measurement units

- Integers in canonical units by suffix: `_g`, `_mm`, `_m`, `_s`, `_ml`, `_mg` (nutrients), `_cal`
  (1 kcal = 1,000 cal), `_milli` (serving quantities). Body fat % to one decimal; RPE 1-10 in
  halves.
- `lib/fitness/units.ts` converts at the edges with exact factors (1 lb = 453.59237 g, 1 in =
  25.4 mm, 1 mi = 1,609.344 m, 1 kcal = 4.184 kJ, 1 fl oz = 29.5735295625 ml), rounding input to
  the canonical unit so values round-trip. Changing profile units never rewrites data.

### Workout data model

```text
fitness_exercises (library: built-ins created per person on first use, plus custom)
fitness_templates ──< fitness_template_exercises >── fitness_exercises   (ordered; defaults)
fitness_sessions  ──< fitness_session_exercises  (snapshot of the exercise) ──< fitness_sets
      │                       └── exercise_id: plain FK, SET NULL
      ├── template_id, calendar_event_id: plain FKs, SET NULL
      └── at most one unfinished (active or paused) per person: partial unique index
```

- Exercise type decides set fields: weight and reps, reps, time, distance and time. ~55 built-ins
  created per person on first library read (`builtin_key`, unique; concurrent first reads yield one
  set); archivable only. Custom ones deletable only while unused (409, "archive it instead").
- Session status `active`/`paused`/`completed`/`abandoned`, with local date and time zone. Every
  set change saves at once (`GET …/sessions/active` resumes).
- Snapshots: session exercises copy name, type, category, primary muscles; template starts copy
  targets into sets. History reads copies, so later edits never change past workouts.
- New empty set copies the previous one (not done). Rest timer = last completed set time + rest
  (default 90 s), so it survives refresh.
- Duration = end − start − paused; follows corrected times. `POST …/sessions/log` logs a past one.

### Workout calculations

`services/fitness/records.py`, same formulas everywhere.

- Only completed sets of completed workouts count; warm-ups never.
- Volume = Σ reps × weight, weight-and-reps exercises only.
- Est. 1RM: Epley weight × (1 + reps/30), 1-10 reps only (single = weight), always labelled.
- PRs by recorded type: weight and reps → heaviest (tie: more reps), most reps (tie: more weight),
  est. 1RM, best set volume; reps → most reps; time → longest; distance and time → longest
  distance and time. Earliest workout to reach a value holds it.
- Analytics ≤ 2 years: per ISO week and month, sets per primary muscle, week consistency, streak of
  consecutive weeks (current week doesn't break it while ongoing).
- Previous performance: sets from the latest earlier completed workout with that exercise.

### Body measurements

`fitness_measurements`: any non-empty subset of weight, body fat, height, circumferences; CHECKs
for plausibility. BMI = kg/m², one decimal, latest weight and latest height (else profile), only
when both plausible, with a caveat label. Body fat never estimated.

### Nutrition calculations

- Foods: nutrients per serving quantity and unit; no database (hand entry, client-side food packs
  `lib/fitness/food-packs.ts`, or AI estimate), all via the same route.
- Entries scale a saved food by quantity / serving quantity, integer round-half-up, or take typed
  totals. Entries copy nutrients, so food edits never change logs. Logging counts a use.
- Saved meals log one entry per item. Totals are exact integer sums. Water is a separate ml log;
  food never counts as water.

### Activity

- `fitness_activities` manual only (`source = manual`); kinds steps, walk, run, ride, swim, other
  cardio, sleep, rest day; a CHECK ties values to kind. Nothing estimated.
- Optional `steps_target`, `active_target_s`, `sleep_target_s` (migration `0032`; web defaults
  10,000 / 30 min / 8 h). Rings: Active (cardio-kind minutes), Steps, Sleep. Streak counts days
  with a ring closed; rest days keep it without adding. Ring math client-side
  (`src/lib/fitness/activity.ts`) over the latest 200 entries.

### Goal tracking

- `fitness_goals`: categories body weight, strength, workouts per week, running distance/time,
  daily energy/water, custom (own unit); canonical-unit values; status
  `active`/`paused`/`completed`. Reaching the target doesn't complete it; the person does.
- Progress from check-ins (`fitness_goal_progress`) unless opt-in `auto_track`: body weight reads
  measurements, strength reads the linked exercise's heaviest counted set per completed workout,
  both from the start date. Auto-tracked goals reject check-ins (409).
- `calculations.py`: fraction (current − start)/(target − start) clamped 0-1. Milestones
  25/50/75/100% with first reaching check-in and straight-line expected date. Pace: within 5
  points of the line = on track, else ahead/behind; or reached / no target date.

### Integration behavior

- **Habits**: `fitness_habit_links` (one per habit) to workouts, water, or an activity kind; only
  with **Count toward the habit** (default off), via `HabitService.contribute` in the same
  transaction. Yes/no habits: completed workout, water target reached (any water if none), or an
  entry. Duration/amount habits get minutes, counts, water in profile unit, steps, km/mi, hours.
  Only raises a day (skipped, done, or higher days untouched; deletes keep it); one log per day
  prevents double counting. Habits never create health records.
- **Calendar**: `POST …/fitness/schedule` creates an ordinary event via `CalendarService` (alerts
  are managed reminders) linked in `fitness_workout_events` (keyed by event);
  `PUT …/schedule/{event}` marks an existing event. Deleting the event unlinks, keeps workouts.
- **Notes/documents**: `fitness_links` to workouts and goals (composite FKs, cascade both sides;
  no trashed records). Training notes are ordinary Inbox notes, linked.

### Health and fitness API

CRUD under `/api/v1/workspaces/{workspace_id}/fitness` as the signed-in person. Notable:
`GET /exercises` seeds built-ins; `POST /sessions` 409 if one is unfinished; `/sessions/log`,
`/sessions/active`, `/sessions/{id}/pause|resume|complete|abandon`, `PUT /sessions/{id}/order`;
`POST /photos?filename=&day=&note=` takes a raw body; `POST /meals/{id}/log`;
`POST /goals/{id}/status`, `/goals/{id}/check-ins`; `/habit-links/{habit}`;
`/schedule/{event}`; `/analytics?start=&end=&date=`. Errors: 404 not the person's; 422 bad values
or references; 409 second unfinished workout, ended workout status change, built-in or used
exercise, auto-tracked check-in; 413/415 photos. Unknown fields forbidden; OpenAPI is the field
reference.

### Health in the web app

- `components/fitness/`, `?view=` overview, workouts, exercises, templates, body, nutrition,
  water, activity, goals, progress, settings; details `?workout=`, `?exercise=`, `?goal=`; rail
  from `@5xl/health`; hints `FITNESS_VIEW_HINTS`. Logger saves set fields on blur.
- Starter templates (`src/lib/fitness/starter-templates.ts`) reference built-in keys, matched via
  `builtin_key` (archived skipped), saved as ordinary templates.
- Charts are SVGs with a visually hidden data table. Every change refetches the whole module plus
  touched habits/calendar/reminders/notes; saved workouts are written to cache at once.

### Health limitations

- No device, app, food-database, or barcode integrations; no medical features; AI only drafts.
- Habit contributions apply only after linking and never lower a day.
- Only body-weight and strength goals self-track (not workouts per week).
- Rest timer browser-only, no end notification. No exercise media; fixed muscle list.
- Photos share `ORBIT_ATTACHMENT_MAX_BYTES`, not resized. Documents don't show their fitness links.
- Records and analytics computed on read, no cached summaries.
- Opt-in PostgreSQL suite covers fitness SQL via services; HTTP tests run on SQLite.

## Daily dashboard and command center

`/` owns no data: widgets read each module's API and use its mutations (one source of truth).

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

- Only new endpoint: `GET …/dashboard/today` (`services/dashboard/today.py`) over protocols the
  services satisfy; counts plus ≤ 5 items each; recomputes no module rule (`habit_is_remaining`
  mirrors web `isRemaining`).
- Sections fail independently: log traceback, roll back the session (else PostgreSQL poisons the
  next query), return `null` and list in `unavailable`; still 200.
- Sections run sequentially (shared `AsyncSession`); parallelism is per-widget queries in the
  browser, with shared requests (Today + Needs attention; five health widgets share the overview).
- "Today": `timezone` param, else profile, else UTC. Overdue = due before today; reminder pending
  if next occurrence before next local midnight; next appointment = first unstarted timed
  occurrence within 7 days. Web passes the viewer's zone everywhere.
- Module additions: tasks `due_from`/`due_to` and `completed_at` sort; `HabitService.search`;
  exported `NewEventDialog`.

### Widget data contracts

`TodayOverviewResponse`: `date`, `timezone`, `generated_at`, sections, `unavailable`; `section=`
repeatable. `tasks` (counts, ≤ 5 overdue/due-today), `events` (today all-day first, `next`),
`reminders` (`pending` over soonest 50), `habits` (counts), `documents` (expired, expiring in 30
days; items only id, title, expiry), `payments` (overdue, due in 7 days; no amounts). No health
data. Other widgets reuse existing contracts.

### Widget loading strategy

- `WidgetBody` gives each widget its own states; removed widgets make no requests.
- Overview and search keys are marked stale after every successful mutation (`isSummaryQueryKey`
  in `api/query-client.ts`; layout saves skipped).
- Overview refetches every 5 min while visible (midnight rollover); others 30 s stale time.

### Customization model

- `dashboard_layouts`, one row per user: JSON `{ id, size }` list, `density`, `hide_amounts`; no
  workspace data, follows the user everywhere. `GET /api/v1/me/dashboard` (204 if unset), `PUT`,
  `DELETE` resets. Enums `DashboardWidgetId`, `DashboardWidgetSize`, `DashboardDensity`; bad input
  422; unknown stored widgets skipped on read so retiring one is safe.
- `hooks/use-dashboard-layout.ts`: `localStorage` `orbit:dashboard:<user id>` for first paint;
  account copy wins unless locally changed; pre-account cache uploaded once; saves serialized in
  one mutation scope, overtaken saves skipped; failed save kept locally with retry.
- Defaults in `lib/dashboard/dashboard.ts` (`defaultVisible`); health, net worth, and others
  opt-in. Compact density also tightens card padding via one unlayered rule in
  `styles/utilities.css`. No drag-and-drop, per-widget settings, or side panel.

### Global command center

Palette (Cmd/Ctrl+K, `components/command-palette/`) navigates, creates via quick actions, and
searches [universal search](#universal-search) after 200 ms (8 hits, grouped, "See all"); a failed
search leaves the rest working. Phase 10's grouped `…/search` stays for AI keyword retrieval; the
palette no longer calls it. **Quick actions** (`components/quick-actions/quick-actions.tsx`) are
the only creation path for dashboard and palette, reusing module dialogs; no new code paths.

### Search composition

- `GET …/search?q=&limit=&module=` (`services/search/`): each module's case-insensitive substring
  search, sequential; fixed order `tasks`, `notes`, `events`, `documents`, `habits`,
  `transactions`; `limit` default 5, max 10, plus totals; `q` 2-200 chars; failing module →
  `unavailable: true`. No index, ranking, or semantics; `…/ai/search` reuses it for keywords.
- Documents match metadata only, never reference numbers or file contents.

### Privacy and authorization

- `WorkspaceDep` on both (`404 Workspace not found.`); isolation tested incl. per-user layout.
- Health widgets opt-in, person-scoped; health is searched only by its owner and is not in the
  overview.
- No amounts in overview or search; `HiddenAmountsProvider` dots dashboard amounts; net worth
  opt-in. Documents expose only id, title, expiry (search: title, state).
- Cache per workspace, cleared on sign-out or user change.

### Dashboard limitations

- Server-side sections run sequentially. Pending reminders counted over the soonest 50.
- Transaction hits open the Transactions view (no per-transaction URL).
- `components/tasks/task-overview.tsx` is unused, pending removal.
- Widgets only component-tested; e2e loads the dashboard without exercising widgets.

## Universal search

Command palette results plus a `/search` page (module tabs, filters, paging, recent and saved
searches). Phase 10's grouped `GET …/search` and `SearchService` are unchanged: the AI layer's
keyword retrieval depends on their shape.

### Provider architecture

- `repositories/search/catalog.py`: one declarative `EntitySource` per type (22): table, joins,
  scope (workspace; health also owner), title, searched fields by role (`metadata`,
  `description`, `content`), previewable fields, own date, active/archived rule, type filters.
  Adding a type is one declaration.
- `repositories/search/sources.py` (`search_source`): one SQL statement per source; every word
  must match some field; tier/score are `CASE`; sort, limit, and `COUNT(*) OVER ()` in the DB.
  Snippets cut in Python (notes `excerpt`).
- `repositories/search/providers.py`: one provider per module. `services/search/universal.py`
  takes each provider's first `offset + limit`, merges, pages, builds facets. A failing module is
  logged (name only, never the query), rolled back, and listed in `unavailable`.
- Searched beyond title: task description (filters status, priority; date due); note tags, folder,
  text (journal day); event series place, category, description, changed occurrences (date: range
  overlap); reminder description, its task/event title; finance account, transaction
  (description, category, account, notes; filter type), loan lender, subscription/bill provider,
  holding (symbol, ISIN, issuer, category, account), deposit institution (maturity), asset,
  budget, savings goal; habit (filter kind), routine steps; document category, folder, tags, file
  name, issuer, provider, description, notes (filter category; date expiry); health exercise,
  workout (notes, exercise names), template, goal, measurement (note only), owner-scoped. Trashed
  notes and documents never match.

### Database strategy

Escaped case-insensitive `LIKE` (`ILIKE` on PostgreSQL), as modules already use. Rejected: FTS5 /
`tsvector` (tokens break partial words and codes like "INV-20", "0%"; engines rank differently;
derived index kept in step with 25 tables in two dialects); `pg_trgm` (PostgreSQL only, needs
every OR-ed field indexed). Scans bounded by existing workspace-leading indexes (plus owner for
health); `EXISTS` lookups use existing indexes. ~22 queries per search, never per record. Offset
cap 500, page cap 50.

### Index lifecycle

No index: reads live tables in the request's transaction, so every change shows at once
(`TestFreshness`). No rebuild endpoint.

### Ranking strategy

`services/search/ranking.py`: exact title 1000, title prefix 800, title phrase 600, title all words
500, metadata phrase 400, description 300, content 200, words across fields 100. Inactive
(completed, archived, cancelled, disabled) −50, less than a tier gap. Ties: newest update, then
ID. `sort=recent` orders by update time. `RankingStrategy` builds the SQL `CASE`, keeping
per-source limits exact.

### API

`/api/v1/workspaces/{workspace_id}/search`: `GET /results`; `/recent` (10 newest; POST remember;
DELETE clear; `DELETE /recent/{id}` idempotent); `/saved` (409 on duplicate name).

- `/results`: `q` 2-200 chars, `module`/`type` repeatable, `date_from`/`date_to` (record's own
  date), `updated_*`, `created_*` (UTC days), `task_status`, `task_priority`,
  `document_category`, `transaction_type`, `habit_kind`, `include_archived`, `sort`, `offset`,
  `limit`. Unknown params, bad values, reversed ranges: 422.
- A type filter limits results to types supporting it. Facets ignore the module filter.
- A hit's date is a series' next occurrence; web builds links in `lib/search`
  (`searchResultHref`). No autocomplete endpoint; the palette calls `/results` with a small limit.

### Recent and saved searches

Migration `0020_create_search_history`: `recent_searches`, `saved_searches`, owned by user and
workspace (both FKs cascade), RLS on PostgreSQL. Recent: text only, recorded on commit (Enter,
opening a result, "See all results"; never per keystroke), case-insensitive dedupe, last 10.
Saved: name unique per person and workspace case-insensitively, validated filters, max 50. Queries
filter by user and workspace, so other workspace members can't see them.

### Authorization and privacy

- Health sources filter by owner: never in another person's results, counts, or facets (tested).
- Hits never carry amounts, balances, prices, or measurements. Finance/document notes, issuers,
  providers, file names match but are never previewed; reference numbers, custom fields, file
  contents not searched. Archived only with `include_archived`.
- `Cache-Control: private, no-store`; web key `["workspaces", id, "search", …]`, cleared on user
  change. Queries never logged.

### Web

- `components/search/`: combobox (`aria-activedescendant`); Filters panel shows only what the tab
  supports; highlighting split in React, never injected HTML; state in the URL
  (`parseSearchState` drops unsupported values).
- `useUniversalSearch`: 200 ms debounce, infinite query, abort signals, keyed by query so stale
  responses never win.
- Entry: palette, Cmd/Ctrl+Shift+F, "Search everything". Deep links `?transaction=` (Finance),
  `?reminder=` (Reminders) open edit dialogs via `useLinkedRecord`; a missing record opens
  nothing.

### Search limitations

- Substring only: no stemming, typos, or Unicode case folding on SQLite (ASCII only).
- Full workspace scans; tested with hundreds of records. Deep pages cost more.
- Date filters use UTC days; event filters use series bounds; shown date ignores skipped
  occurrences.
- Built-in exercises appear only once used.
- Finance non-transaction records, workout templates, measurements open their view, not the
  record.
- Web `useWorkspaceSearch` and `searchOptions` are unused; remove in a follow-up.

### Future semantic search extension points

`…/ai/search` stays separate. Possible later: an FTS/embedding field matcher on `EntitySource`, a
semantic `RankingStrategy`, or a provider merging AI hits into `UniversalHit`, with no API change.

## AI intelligence layer

Optional, off by default, per person. Answers questions about the person's data, semantic search,
drafts and summaries, approval-gated actions. Owns no personal data: reads and acts through module
services.

### What existed before, and what didn't

- Phase 10 substring search unchanged; semantic search is a separate endpoint reusing it.
- Indexing is a periodic job in the reminder worker; no second job system.
- Files read via `DocumentService.open_file` (attachment store, SHA-256 versions), never modified.
- No OCR, no AI SDK, no multi-device sync. Imported integration events/documents are ordinary
  records under calendar/documents permissions; mail is never stored, so never indexed.

### Layout

`services/ai/`: `models`, `providers` (protocol, capabilities, errors, local/cloud),
`configuration` (policy), `usage` (`MeteredProvider`, limit), `chunking` (ProseMirror headings),
`extraction` (PDF, DOCX, PPTX, XLSX, TXT, CSV, Markdown; no OCR), `sources` (`SourceCatalog`),
`indexing`, `vectors`, `retrieval`, `routing`, `context`, `prompts` (fencing, citation and
proposal checks), `assistant`, `assist`, `health_assist`, `actions`, `insights`. Adapters in
`providers/ai/` (`registry.py`); `repositories/ai.py` (nine tables), `ai_services.py`;
`api/ai_actions.py`; `api/v1/ai.py`; `system/secrets.py` (Fernet), `system/network.py`.

### Provider abstraction and capabilities

`AiProvider`: `complete`, `stream`, `embed`, `list_models`, `capabilities`. Plain HTTP over the
shared `httpx2.AsyncClient`, no vendor SDKs, built only by `providers/ai/registry.py`.

- `ollama` (`http://localhost:11434`, native API, NDJSON, usage from eval counts);
  `openai_compatible` (person's server; embeddings attempted; no vendor-only options); `openai`;
  `anthropic` (**no embeddings**: `UnsupportedCapabilityError`); `gemini` (key in
  `x-goog-api-key`, never the URL; reports which models embed, others classified by name).
- Structured output: JSON mode where available, an instruction for Anthropic; Orbit parses and
  validates with one retry.
- Errors: `ProviderAuthError` (fixed text; providers may echo keys), `ProviderRateLimitError`,
  `ProviderUnavailableError`, `ProviderRequestError` (only one passing detail, truncated, key
  redacted), `ProviderResponseError`, `UnsupportedCapabilityError`.
- Redirects never followed. UI falls back to typing a model name.

### Configuration, credentials, and consent

- `ai_settings` (per person): defaults off; tasks, notes, calendar, reminders, habits, watchlist
  readable (watchlist only by watchlist suggestions; settings saved before it existed lack it);
  documents, finance (also gates the portfolio review), health off; `allow_cloud` off; optional fallback, monthly token limit,
  keep-index flag.
- `ai_providers` (per person): optional user-entered prices (no shipped price list); Fernet API
  key, never returned (`has_api_key`) or logged. Key `ORBIT_AI_SECRET_KEY`, or local-mode `0600`
  key file beside the DB; cloud mode without it can't store keys (keyless local providers work).
- Local vs cloud from host: loopback, private, link-local, `.local` are local. Shown everywhere.
- `AiConfigService`: requires `ORBIT_AI_ENABLED` and the person's opt-in; cloud without
  `allow_cloud` is 409; fallback only if chosen, only for unreachable/rate-limited, only before any
  text shown, same checks. Never switches providers on its own.
- Endpoints (on save/test): `http`/`https`, no URL credentials, plain `http` only to private hosts;
  cloud mode by default rejects endpoints resolving to private addresses.

### Embeddings, vector storage, and the index

Normalized float32 little-endian bytes in `ai_chunks` (`LargeBinary`), brute-force Python dot
product (`vectors.py`) over allowed modules' chunks of the current model. Rejected: pgvector
(cloud only, fixed dimension per column), sqlite-vec/VSS (native extension per platform), vector
DB server (another server; breaks local-first). `ChunkStore` in `retrieval.py` is the pgvector
seam.

- Indexed: active notes (split at headings), active or archived documents (metadata without
  reference numbers, plus text by page/heading/slide), tasks, event series, habits. Finance,
  reminders, health not embedded: answered from structured queries for exact figures.
- Chunking never crosses a section (keeps `Page 3`/heading location); 1,200 chars, 150 overlap;
  splits at sentences, then words. Embed input `title`, `location`, chunk. Max 200,000 chars per
  record.
- Worker every `ORBIT_AI_INDEX_INTERVAL_SECONDS`: reconcile by fingerprint (note revision, title,
  tags; document metadata and version; small records' full text) to `pending` or delete; then
  claim ≤ 20 with a 5-minute conditional-update lease, embed in batches of 32, mark `indexed`.
  Failures: backoff 2^n min up to 6 h, 5 attempts, then `failed` until **Retry failed**; provider
  outage, rate limit, or misconfig stops the run.
- Chunks carry `provider id:model`; changing model re-indexes. Module off removes its chunks at
  once. Delete index is always safe; backup restore includes it.
- Every match is re-checked (`SourceCatalog.exists`) before return or prompting, so deleted or
  trashed records never leak.

### Semantic and hybrid search

`GET …/ai/search?q=&module=&date_from=&date_to=&limit=`: keyword half runs workspace search on the
query's most distinctive words; semantic half ranks chunks; merged by reciprocal rank fusion
(`1 / (60 + rank)`). Each result says keyword, meaning, or both. No embedding model:
`semantic: false`. Disallowed modules never searched.

### Assistant and RAG orchestration

`assistant.py`, one turn:

1. Prepare before streaming (so failures are plain HTTP errors); title new conversations from the
   question (no model call).
2. Route (`routing.py`) deterministically: keywords and date phrases in the viewer's time zone to
   modules, range, and create intent; works with small local models that can't plan tool calls.
3. Ground (`context.py`) from module services (`FinanceService`, `CommitmentService`,
   `BudgetService`, `HabitService`, owner-scoped health, calendar overlaps computed by Orbit) plus
   hybrid retrieval; numbered sources `[S1]…`, 16,000-char budget.
4. Generate: ≤ 8 recent messages (6,000 chars). SSE events `start`, `sources`, `delta`, `error`,
   `done`.
5. Drop citations to nonexistent sources; save answer with sources, provider, model, local/cloud,
   tokens.

Disconnect saves the partial answer as `stopped`; provider failure saves an `error` message with a
safe reason. The stream opens its own DB session.

### Grounded answers and citations

- Sources only from records Orbit retrieved. UI says when an answer used no Orbit data.
- "Calculated by Orbit" figures come from module services or integer arithmetic in `context.py`,
  formatted from minor units; no LLM arithmetic in supplied figures.
- Model must label inferences and general knowledge and say when Orbit has no answer.

### Contextual features and insights

`POST …/ai/assist` checks module permission, then: note summary, takeaways, action items and tag
suggestions (→ proposals), rewrite (→ new note, never overwrite), related notes (no model);
document summary and extraction (→ proposal filling only empty fields; files never modified; no
OCR); task drafts and breakdowns; schedule summary and event drafts; spending summary, budget
explanation, upcoming payments, category suggestions (review only: AI never changes financial
records); habit and health summaries (no diagnosis or advice). Web "AI" menu shows only when AI is
on and allowed to read the module.

### Health helpers

`HealthAssistService` returns drafts only; saving goes through fitness routes.

- Nutrient estimate sends only the typed name and serving; food ideas only the typed region or
  cuisine (AI on). Workout idea sends active goals, 14 days of workouts, the library (AI on,
  Health allowed).
- Output clamped to route limits (energy ≤ 10,000 kcal, nutrients ≤ 5 kg per serving, sets 1-20,
  rest ≤ 1 h); incomplete foods dropped; nothing usable is 502. Workouts use only unarchived own
  exercises as `E1`, `E2` references (IDs never reach the model); bad refs dropped; empty library 422.
- Typed text fenced as a record; prompt forbids medical, dietary, treatment advice.
- Without AI, food ideas come from built-in packs (`orbit:food-pack` in browser). Location never
  detected.

`GET …/ai/insights` is deterministic (no model): spending vs same days last month, budgets,
payments within a week, habit vs 30-day rate, tasks, calendar load, documents expiring within 30
days. Dismissal key includes the period. No notifications.

### Action approval model

1. Model emits a fenced `orbit-action` block (hidden from the stream), or a feature builds one.
2. Kept only if the message asked (`routing.wants_action`), kind allowlisted (`create_task`,
   `create_reminder`, `create_event`, `create_note`, `append_to_note`, `add_note_tags`,
   `update_document_details`), ≤ 3 per answer, validated by the module's request schema
   (`api/ai_actions.py`).
3. Stored `pending`; proposals made while reading records are flagged.
4. Approve: conditional update `pending` → `executing` (repeat is 409), re-validate, run the
   module's service, record result. Reject changes nothing.

No generic query/update, deletion, or financial action. The
[personal agent](#personal-agent-and-automation) reuses this validator and executor.

### Prompt injection and untrusted content

- Records fenced as `<orbit-record>`; fence markers inside are neutralized.
- Model has no tools; unrequested proposals dropped; approval and module validation still apply.
- Permissions applied before retrieval; workspace and owner filters on all AI rows.
- Citations checked; Markdown parsed into React, never HTML; links only web, mail, in-app.
- Health read only with permission, only for its owner.

### Usage tracking

`MeteredProvider` writes `ai_usage` per call (kind chat/assist/embedding/test, tokens if reported,
cost from the person's prices, duration, outcome); never prompts or answers. `GET /me/ai/usage`
aggregates N days. Monthly limit checked before each call (429), warning at 80%.

### Privacy and authorization

- Settings, providers, usage per person (`/me/ai`); conversations, proposals, dismissals, index
  per workspace and person. Others' resources are 404.
- Nine tables, RLS enabled with no policies on PostgreSQL.
- Conversations kept until deleted; index rows deleted with records or modules.

### API

`/me/ai/settings`, `/me/ai/providers` (`POST /test` without saving, `GET /{id}/models`),
`/me/ai/usage`. Workspace `…/ai/`: `conversations`, `POST messages` (SSE),
`proposals/{id}/approve|reject`, `assist`, `health/food-estimate|food-ideas|workout-suggestion`,
`search`, `insights` (+ `POST dismiss`), `index` (`POST rebuild`, `retry`, `DELETE`). Stream
payload types are in `packages/contracts/src/index.ts` (`AiTurnStarted`, `AiStreamDone`), since
OpenAPI can't describe event streams.

### In the web app

`/assistant` (`?c=` conversation; palette **Ask Orbit** passes `?q=`); **Settings → AI**. Insights
and AI search are invalidated after any mutation.

### Known limitations

- Keyword routing may miss a module (retrieval still runs). Brute-force vectors.
- No OCR. Endpoint DNS checked only on save/test (DNS rebinding).
- The model can misstate a supplied figure. Rewrites save as new notes.
- OpenAI-compatible servers may report no tokens.
- Stream stop untested automatically (TestClient can't disconnect mid-stream).

## External integrations

Google and Microsoft, per person and workspace, feeding existing modules (events, documents, and
tasks/notes/reminders made from mail). Setup and scopes: [integrations.md](integrations.md).

### What existed, and what didn't

Reuses `WorkspaceDep`, the reminder worker, Fernet, the `httpx2` client pattern, `CalendarService`,
`DocumentService`, module services, notifications, search, and AI indexing. No multi-device sync:
integrations run their own sync inside the worker, scoped to external accounts.

### Layout

`services/integrations/`: `models`, `connectors` (contract, normalized types), `store`, `oauth`
(state, PKCE S256), `tokens` (`TokenManager`), `mapping` (RRULE, limits, fingerprints),
`service` (`IntegrationService`), `calendar_sync`, `mail`, `files`, `runner` (`SyncRunner`).
`providers/integrations/`: `http.py`, `google.py`, `microsoft.py`, `text.py` (HTML to text),
`registry.py` (only place that knows vendors). `repositories/integrations.py` (five tables,
`build_integrations()`), `api/v1/integrations.py`, `schemas/integrations.py`.

### Connector contract

`ProviderConnector` bundles an `OAuthClient` and `CalendarConnector`/`MailConnector`/
`FilesConnector` with scopes. `HttpConnectorRegistry` builds one per provider with a configured
client ID; services use `ConnectorRegistry.get`. Error mapping: `ReauthRequiredError` (401,
`invalid_grant`), `AccessDeniedError` (403), `RateLimitedError` (429 and Google quota 403s,
`Retry-After`), `ProviderUnavailableError`, `RemoteNotFoundError`, `CursorExpiredError` (410),
`VersionConflictError` (412); fixed safe messages. Tests use `tests/integration_fakes.py`.

`ApiClient`: 30 s timeout (10 s connect), two retries for idempotent calls, never follows
redirects with a token. Graph paging only on `graph.microsoft.com`; Drive/OneDrive IDs
charset-checked; Drive query literals escaped.

### Data model

- `integration_connections`: status `active`/`reauth_required`/`error`; encrypted tokens with
  `token_version`; unique per workspace, provider, account (reconnect updates; several accounts
  allowed).
- `integration_resources`: per calendar or mail label: direction, interval, Orbit category, sync
  state (cursor, checkpoint, window, next sync, push channel secret as SHA-256).
- `integration_links`: external kind/ID/parent ↔ Orbit entity; origin `external`/`orbit`/`linked`;
  provider version, snapshot, Orbit fingerprint; status `synced`, `conflict`, `local_changes`,
  `update_available`, `missing`, `deleted_locally`. Partial unique index: one link per external
  event or file per connection. No provider columns on Orbit tables; `entity_id` checked on use,
  not cascaded.
- `integration_sync_runs`: kind `calendar`/`files`, counts, safe error, attempts, lease; no
  content.
- `integration_oauth_states`: single-use, 10 minutes.

All carry `workspace_id`, cascade with it, RLS on PostgreSQL; queries filter by workspace and
owner.

### OAuth and tokens

Flow: `POST …/integrations/authorize` stores state (SHA-256) and encrypted PKCE verifier, returns
the consent URL; provider redirects to web `/integrations/callback`; that page posts to
`/integrations/oauth/complete` with the session; API consumes the state once, checks person and
expiry, exchanges code, keeps only fully granted capabilities, stores encrypted tokens.

- Google also `access_type=offline`, `prompt=consent` (refresh token on reconnect).
- State: 256 bits, bound to person, workspace, provider, capabilities; same session required to
  complete (login CSRF). Callback strips the code from history, no referrer.
- Redirect URI only from `ORBIT_INTEGRATIONS_REDIRECT_URL`; `https` in production (loopback
  excepted).
- Capability absent unless all its scopes granted; none granted connects nothing.
- Key `ORBIT_INTEGRATIONS_SECRET_KEY` or local `0600` file, separate from the AI key; cloud
  without it refuses. Decrypted only in `TokenManager`; never returned, logged, exported.
- Refresh 2 minutes early, once more on early refusal; per-connection lock plus optimistic
  `token_version`. Refused refresh: `reauth_required`, sync stops, in-app notification, data kept.
- Disconnect revokes at Google (Microsoft has no per-app revoke; UI warns) and deletes tokens,
  resources, runs, links. Imported records stay unless `remove_imported` (events deleted,
  documents trashed).

### Synchronization protocol

- Routes queue runs and return 202; at most one short provider call per request. Worker claims runs
  by conditional UPDATE with a 5-minute lease, own session per run, ≤ 20 pages per poll.
- Google `syncToken` (`showDeleted`, series as masters); Microsoft `calendarView/delta` over a
  month back to a year ahead, moved monthly. 410 forces a full sync.
- Each page commits with its links and checkpoint; idempotent upserts by external ID. Module
  services run on `FlushTransaction` so record and link commit together.
- Backoff 30 s doubling to 30 min (or `Retry-After`), 5 attempts; unexpected errors recorded by
  type only. Refused token fails the run and pauses the connection.
- Per-run sessions isolate failures from other accounts and reminders. Cancel: queued at once,
  running before next page.
- Calendar interval 15 min to daily or manual (`next_sync_at`); files rechecked every 6 hours.
- `ORBIT_INTEGRATIONS_WEBHOOK_URL` enables Google channels/Graph subscriptions, renewed 12 h before
  expiry; notifications verified constant-time against the secret's SHA-256 and only queue a run.

### Calendar mapping

- Limits: title ≤ 200, description ≤ 5,000, location ≤ 200.
- Google series with a representable RRULE → `EventRecurrence`; `EXDATE`s skipped; changed or
  cancelled instances → `modified`/`skipped` exceptions keyed by original start. Other rules
  (`BYDAY=2TU`) → single events a month back to a year ahead. Outlook → always single events.
- Google keeps IANA zones; Outlook converts UTC to the original Windows zone if mapped, else UTC.
  All-day stays dates.
- Early-arriving occurrences are adopted as exceptions when their series arrives; series timing
  changes re-apply remembered exceptions.
- Imported events: calendar's category, no alerts. Origin via `GET …/integrations/origins`.

### Conflict resolution

Link stores provider version plus Orbit fingerprint:

- Provider changed only: applied. Orbit changed only: two-way single events sent with `If-Match`,
  else `local_changes`. Both: conflict `both_changed`, nothing overwritten.
- Provider deleted: deleted in Orbit, unless Orbit changed (`deleted_remotely`, kept).
- Orbit deleted: `deleted_locally`, never re-imported or deleted remotely.
- 412 while sending: not sent; next pull records the conflict.
- `POST …/conflicts/{link}/resolve`: keep external, or keep Orbit (pushed on two-way, else kept
  locally and may conflict again; for deletions becomes Orbit-only).
- Files never conflict: `update_available` (update adds a version) or `missing` (document stays).

### Mail and files

- Mail never ingested: listed from chosen labels/folders within 7-365 days, re-checked server-side
  per message, plain text only. Records from mail link message and thread ID, storing only the
  subject. Nothing sent.
- File import: one file, capped at `ORBIT_DOCUMENT_MAX_BYTES`, Google Docs as PDF, through
  `DocumentService.upload` validation. OneDrive download redirect fetched without Orbit's token.

### API

Under `…/integrations`, `WorkspaceDep` plus connection owner (others 404). Notable:
`POST /authorize`; `POST /api/v1/integrations/oauth/complete`; `DELETE /connections/{id}`
(`remove_imported`); `POST …/sync` (202), `…/runs/{run}/cancel|retry`;
`POST …/calendars/{calendar}/events` exports an Orbit event; `PUT …/mail/labels`;
`POST …/mail/messages/{message}/task|note|reminder` (module's own body); `POST …/files/{file}/import`, `…/files/links/{link}/update`;
`POST /api/v1/integrations/webhooks/google|microsoft`.

### In the web app

`components/integrations/` in Settings (`?connection=<id>`); calendars read-only by default. Mail
via `InboxButton` (`/tasks?inbox=<id>`); drives in Documents (`/documents?drive=<id>`);
`/integrations/callback`. Keys `["workspaces", id, "integrations", …]`; polls while a run is
active. Tokens and client secrets never reach the browser.

### Known limitations

- Google and Microsoft only; no CalDAV or iCal.
- Outlook series are occurrences in a moving window; unrepresentable Google rules expanded.
  Imported series edits stay in Orbit.
- Orbit deletes not sent. Attendees, invitations, alerts not imported. Unmapped Outlook zones
  become UTC.
- Mail: chosen labels only (no subfolders), 20 most recent, no attachments or sending.
- Files one at a time; Drive versions may change on rename. Push needs public HTTPS; local polls.
- HTTP tests use an in-memory provider on SQLite, not real accounts; opt-in PostgreSQL suite checks
  RLS.

## Backup, restore, and data portability

Workspace backups, restores, exports, and imports, for both storage modes.

### What existed, and what was reused

- **Reused:** the attachment store (added `write_stream`, `checksum`); ORM metadata (the engine is
  metadata-driven, not per-module code); the reminder worker (scheduled backups and housekeeping,
  no second scheduler); `argon2-cffi`, `cryptography`; calendar recurrence rules; the CSV-injection
  guard (moved to `utils/spreadsheet.py`, shared with finance CSV); workspace deletion (now also
  deletes the workspace's backups).
- **Not present before:** any restore or import.

### Layout

`services/backup/`: `catalog.py` (every table in a module or excluded with a reason; file
columns; match keys), `rows.py` (records ↔ portable JSON, ID remapping in columns/text/JSON,
parents first), `archive.py` (ZIP writer, manifest, hostile-archive reader), `sources.py` (archive
or JSON export), `encryption.py`, `writer.py`, `restore.py` (ID plan, conflicts, inserts, files,
verification), `formats.py` (+ `ics.py`, `markdown.py`), `schedule.py` (next runs, retries,
stale-run cutoff), `ports.py`, `service.py` (`BackupService`). Also `repositories/backup.py`
(`SqlBackupData`, `SqlBackupRecords`), `system/backup_store.py` (`FileArchiveStore`: archives and
staged uploads on disk), `api/v1/backups.py`.

### Data model

`0021_create_backups` (RLS on PostgreSQL):

- `backups`: kind (`manual`, `scheduled`, `pre_restore`), status (`running`, `succeeded`,
  `failed`), files/encryption flags, archive size and SHA-256, per-module record and file counts,
  warnings, safe error message, format/schema/app versions. Partial unique index on
  `workspace_id WHERE status = 'running'`: one running backup per workspace across all API and
  worker processes.
- `backup_settings`: frequency, retention count (1–50), files, encryption, backup key (public key
  and password-sealed private key; never the password), next and last run.
- `backup_uploads`: staged archives; status (`uploaded`, `restoring`, `completed`, `failed`,
  `expired`, `discarded`), checksum, restore report.

### Backup format and versioning

ZIP: `orbit-backup/manifest.json`, `README.txt`, `database/<table>.jsonl`, `files/<id>`. Manifest:
`format: "orbit-backup"`, `format_version` (1), Orbit version, Alembic `schema_revision`, created
time, workspace ID and name, owner ID, modules, per-table row count/size/SHA-256, per-file
size/SHA-256, and files already missing from storage.

Records: one JSON object per line, all columns. Canonical UUID strings; UTC timestamps with
`+00:00`; calendar wall-clock times without offset (beside the event's IANA zone); ISO 8601 dates
and times; money as JSON integers in minor units with currency in its own column (never floats);
floats as Python round-tripping repr; JSON columns nested as stored.

**Included:** every module table (`catalog.py`). **Excluded (reasons in code):** users,
credentials, sessions, avatars, per-person preferences, AI provider keys and settings, the AI
retrieval index (worker rebuilds it), pending AI proposals, AI usage, recent searches, all
integration tables (accounts are reconnected), backup tables. A test fails if a new table is in
neither list, a `blob_id` column isn't a declared file column, or a column type is unsupported.

JSON export (`format: "orbit-export"`): same records in one document, `{"tables": {"tasks":
[...]}}`, one module or all, no files.

### Database provider strategy

One application-level engine for both databases; no database dump (can't be scoped to a
workspace, would carry other users' rows and secrets, not portable SQLite↔PostgreSQL).
`SqlBackupData` reads every table from ORM metadata filtered by `workspace_id` (reminder
occurrences via their reminder) and, for tables with an owner column (health records,
notifications), by the person.

- **SQLite:** the driver only begins a transaction before a write, so the dump issues an explicit
  `BEGIN`; in WAL mode that gives one snapshot without blocking writers (tested). The live file is
  never copied.
- **PostgreSQL:** `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`. No server
  filesystem access or Supabase credential needed.

The snapshot ends before files are copied; stored files are immutable (new version = new file), so
a file deleted in between is recorded as missing. Local-mode backups restore in cloud mode and vice
versa: the supported way to move a workspace between installations.

### Restore strategy

`POST …/backup-uploads` streams to disk with `ORBIT_BACKUP_UPLOAD_MAX_BYTES` and checks structure.
`…/inspect` (password for encrypted) verifies checksums and compatibility and runs a **dry run**
(full restore in a rolled-back transaction). `…/restore` takes a strategy:

| Strategy        | Target                                      | Guard                                                                                  |
| --------------- | ------------------------------------------- | -------------------------------------------------------------------------------------- |
| `new_workspace` | New workspace (chosen name or "(restored)") | None                                                                                   |
| `into_empty`    | This workspace                              | Refused unless it has no records                                                       |
| `replace`       | This workspace, after deleting its data     | Typed workspace name; refused while integrations connected; `pre_restore` backup first |

- **IDs:** kept when none exists anywhere in the database; otherwise **every** ID and file name is
  replaced consistently, so a copy never shares a record with its original. Remapping covers ID
  columns and UUIDs inside text and JSON (note links, `series_id`, `current_version_id`).
  Workspace and owner IDs map to the target workspace and restoring person (cross-account and
  cross-installation restores work).
- **Atomicity:** all inserts in one transaction (savepoints nest). Files are written to the store
  just before commit, checked against manifest checksums, and deleted on any failure. Each table's
  row count must equal the manifest's. Constraints enforce relationships.
- **Interruption:** nothing commits; the upload stays `restoring` until its deadline, then fails
  ("interrupted; nothing was changed"); the orphan sweep removes files. Retryable.
- **Replace** deletes rows children-first, keeping the workspace row, backup history, settings,
  the upload, and usage records. Old files go via the orphan sweep (within six hours); the
  pre-restore backup holds them.

### Import architecture

Orbit JSON exports merge into the current workspace via the same engine in lenient mode:

- Record ID already in this workspace → **duplicate**, skipped (re-import adds nothing). A
  completed upload with the same SHA-256 is reported; reuse needs `allow_repeat`.
- ID exists in another workspace → new ID, references updated.
- Categories, tags, built-in exercises, and the default shopping list are **matched** by natural
  key (`MATCH_KEYS`).
- Rule-breaking or dangling records are **skipped** (failing batches retried row by row in
  savepoints), counted per table. Nothing is overwritten.

CSV, Markdown, and `.ics` are export-only; importing them is not implemented.

### Export architecture

`POST …/exports` builds from one snapshot into a temp file, streams, deletes it. JSON for every
module; CSV (one table or ZIP of CSVs) for tasks, shopping, watchlist, reminders, habits, health;
Markdown ZIP for notes (YAML front matter, folders, archived/trashed in `Archive/`, `Trash/`);
iCalendar for calendar (`TZID` with generated `VTIMEZONE`s, month-end and leap-day rules as
`BYMONTHDAY…;BYSETPOS=-1`, `EXDATE`s for skips, `RECURRENCE-ID` overrides, `VALARM`s, folded
lines). `POST …/exports/archive` builds a full archive for download without keeping it. Finance
transaction CSV and the documents ZIP keep their own endpoints.

### Encryption approach

Optional per backup, standard primitives only. Argon2id (64 MiB, 3 passes, 4 lanes, random 16-byte
salt) derives a key from the password that seals an X25519 private key with AES-256-GCM. Each
archive gets a random 256-bit file key wrapped for that key pair (ephemeral X25519, HKDF-SHA256,
AES-256-GCM); the archive is 64 KiB AES-256-GCM chunks with the STREAM nonce construction and the
header as associated data (no reorder, truncation, or swap). The sealed private key travels in each
archive, so the password alone opens it anywhere. Automatic backups use the stored public key, so
the server encrypts without the password; the password is never stored, logged, or put in a URL.
Wrong password fails on the sealed key; tampering fails on the first bad chunk; a header can't
demand more than 1 GiB of Argon2 memory. Protects backup files only; live data relies on disk
encryption.

### Scheduling behavior

The reminder worker checks due backups every minute and tidies hourly. A run is claimed by moving
`next_run_at` with a conditional update; the running-backup index prevents overlap with manual
runs. Next run = previous scheduled time + interval, moved past now (a server that was off runs
one backup, not one per missed interval). Failures are recorded (status, safe message) and retried
an hour later. After success, successful automatic backups beyond retention are deleted (manual
and pre-restore kept until deleted). Housekeeping fails backups running over six hours and
restores past their deadline, expires uploads after 24 hours, deletes crash temp files.

### Security

- `WorkspaceDep` on every route; another person's backup or upload IDs are 404. Downloads only via
  authorized routes with `private, no-store`; no public or signed URLs. Archive files `0600` in
  `0700` folders.
- Uploads are untrusted: exact entry names only (no `..`, absolute paths, extras), names never
  used as paths, encrypted ZIP entries and unusual compression refused, total declared size bounded
  (`ORBIT_BACKUP_MAX_EXTRACTED_BYTES`) before decompressing, per-entry compression ratio capped,
  entries must match manifest sizes, lines length-limited, checksums enforced. JSON exports capped
  at 256 MB. Errors never echo contents or passwords; logs carry IDs and error types only.

### Migration and compatibility rules

- `format_version` changes only with archive layout; newer is refused.
- `schema_revision` must be known (newer: "update Orbit"). Older is checked per record: a column
  this version lacks is refused (data would be lost); a missing column is filled from its default,
  or refused if none.
- When a migration changes the meaning of data (rename, unit change), add an upgrade step for
  older backups keyed by revision. New tables must be classified in `catalog.py`.

### Limitations

- Backups live on the API machine (`ORBIT_BACKUPS_PATH`); no cloud-storage targets.
- Restores and imports run within the request; JSON exports are parsed whole (≤ 256 MB).
- A dry run inserts and rolls back everything: slow for large backups, holds SQLite's write lock.
- Per-person preferences, AI settings, integrations not backed up; the worker reindexes AI.
- Replace is refused with connected integrations; new-workspace restore isn't.
- Monthly schedules started on the 29th–31st run on the 28th after the first short month.
- No CSV, Markdown, or `.ics` import.

## Personal agent and automation

Agent and workflow engine on the AI layer, module services, and the existing worker. Workflows run
steps Orbit's code orders and checks; the agent plans one tool call at a time; any record change
needs an approval bound to that exact action or is a low-risk action the person explicitly
allowed. Off by default, per person and workspace; deterministic workflows and monitoring need no
AI provider.

### What existed, and what was reused

- **Reused:** `AiConfigService` (on/off, cloud consent, monthly token limit, `MeteredProvider`
  usage), `ContextBuilder` (figures are Orbit's), `AssistService` (summaries, extraction), record
  fencing in `prompts.py`, the proposal validator/executor in `api/ai_actions.py` (writes validated
  by the module's request schema, run by its service); the reminder worker as sole scheduler
  (leases, conditional claims); `FlushTransaction`; in-app notifications.
- **Not present, so not built on:** an event bus, an audit log, multi-device sync. Event triggers
  check modules' rows; execution history is the audit trail; concurrency between API and
  `orbit-worker` processes on one database is handled by leases.

### Layout

`services/agent/` (framework-free): `models.py`, `tools.py` (`ToolSpec`, `ToolHandler`,
`ToolRegistry`, call fingerprints, mail contract), `policy.py` (`decide()`), `triggers.py`
(DST-safe schedules, conditions, templates, workflow validation), `planner.py` (rules, reply
parsing, fencing results), `engine.py` (engine and state machine), `service.py`, `signals.py`
(event and condition signals), `monitoring.py`, `automation.py` (worker jobs: schedules, triggers,
expiry, monitoring, claims, recovery), `safety.py` (redaction, size limits). Also
`api/agent_tools.py` (concrete tools), `repositories/agent.py` (seven agent tables, change feed, AI
gateway), `repositories/agent_services.py` (wires it on one session), `api/v1/agent.py`.

### Agent model

`agents`: one primary agent per person and workspace (partial unique index; table allows more for
future specialized agents). Holds standing instructions, optional model override on the chat
provider, autonomy level, allowed modules, per-tool modes, allowed action types (`create`,
`update`; reads always allowed), triggers whose runs may act automatically, limits, memory,
notification, and monitoring settings. Created off on first request; only `PATCH …/agent`
changes it.

### Tool registry

Each tool declares name, description, input schema (Pydantic, `extra="forbid"`), output envelope
(`text`, `records`, `data` with `count`), module, access (`read`, `create`, `update`), risk,
idempotency, always-asks, whether it sends record content to the AI provider, and workflow use.
`GET …/agent/tools` lists them with current decisions.

| Module              | Read                                                                                                             | Write (risk)                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Tasks               | `search_tasks`                                                                                                   | `create_task` (low), `complete_task` (low), `update_task` (medium)       |
| Reminders           | `get_reminders`                                                                                                  | `create_reminder` (low), `send_notification` (low, in-app to owner only) |
| Calendar            | `search_calendar` (Orbit finds overlaps)                                                                         | `create_event` (medium)                                                  |
| Notes               | `search_notes`, `summarize_note` (AI)                                                                            | `create_note` (low), `append_to_note` (medium), `add_note_tags` (low)    |
| Documents           | `search_documents`, `get_document` (no reference numbers), `summarize_document`, `extract_document_details` (AI) | `update_document_details` (medium; descriptive fields only)              |
| Finance (read only) | `get_accounts`, `get_transactions`, `get_finance_summary`, `get_budgets`, `get_upcoming_payments`                | none                                                                     |
| Habits, health      | `get_habit_progress`, `get_workout_history`, `get_health_summary` (owner only)                                   | none                                                                     |
| Mail (read only)    | `search_email` (labels chosen for Orbit, via the integrations' mail service)                                     | none                                                                     |
| The agent's own     |                                                                                                                  | `remember_preference`, `run_workflow` (agent runs only; both always ask) |

No tool deletes, pays, transfers, invests, sends email or messages, shares documents, changes
connected accounts, settings, or permissions, or runs code, SQL, shell, or HTTP. Every call is
prepared (validated by the tool's model, then the module's request schema for writes, target looked
up) before it runs or is proposed, and again when an approval is acted on.

### Permission and autonomy model

`policy.decide` runs in code for every call from stored settings, the tool spec, and what started
the run; nothing a model writes is an input.

1. Agent off, tool `off`, or module not allowed → deny.
2. If a model sees the result (agent runs) or the tool summarizes with AI, the AI layer must also
   allow the module (mail and the agent's own records excepted).
3. Reads → allow. Writes need their action type allowed, then:

| Level         | Writes                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| 0 `read_only` | Refused                                                                                               |
| 1 `suggest`   | Recorded as a suggestion; never run                                                                   |
| 2 `approval`  | Run only after the person approves that exact call                                                    |
| 3 `limited`   | Auto only if low risk, set to `auto`, from an allowed trigger, within the daily auto quota; else asks |

High-risk and `always_confirm` tools ask at every writing level. A permission revoked after an
approval request makes the approval fail when acted on.

### Workflows

Name, description, trigger, conditions (checked against trigger values before a run is created),
up to 20 ordered steps, daily run limit, on/off. Steps:

| Kind        | What Orbit does                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `tool`      | Renders `{{trigger.x}}` / `{{steps.id.x}}` as plain text, calls the tool through the policy; optional `continue_on_error`                  |
| `condition` | Compares a value with a constant (`eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `contains`, `not_contains`, `exists`); false jumps forward or ends |
| `delay`     | 1 minute to 7 days (execution sleeps as `waiting`)                                                                                         |
| `approval`  | Checkpoint the person approves before the rest runs                                                                                        |
| `ai`        | Writes text from earlier outputs, fenced as data; no tools                                                                                 |

Validated on save: workflow-usable known tools, unique step IDs, forward-only jumps (no loops),
placeholders naming earlier steps, complete trigger. Workflows can't start other workflows.

### Triggers

| Trigger   | Detection                                                                                                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Schedule  | Daily, weekly (days), monthly (day clamped to month), or once, at a wall-clock time in a zone; `next_run_at` stored and claimed                                                                                                      |
| Event     | Task created/completed, reminder delivered, imported calendar event changed, budget alert sent: rows changed since the workflow's cursor. Event approaching, document expiring, habit missed yesterday: windows from module services |
| Condition | Metric (overdue tasks, tasks or payments due soon, highest budget use, documents expiring, unread notifications) checked every N minutes; fires on becoming true, not while true                                                     |
| Manual    | `POST …/workflows/{id}/run`, or `run_workflow` after approval                                                                                                                                                                        |

Each signal has a stable key (record plus date/time); `trigger_key` is unique per agent, so a slot,
event, or manual idempotency key starts at most one execution across workers. Event triggers check
every minute. No "new email received" trigger: mail is read on demand, never synced.

### Execution engine and state machine

```text
queued ──claim──▶ running ──▶ succeeded | failed | cancelled
   ▲                 │
   ├── approved ◀── waiting_approval
   └── resume_at ◀─ waiting (delay, retry backoff)
```

- **Agent runs** (`POST …/agent/runs`): the planner gets rules, permitted tools, standing
  instructions, saved preferences, recent runs, and the request, and replies one JSON step at a
  time. Unknown/unpermitted tools and invalid arguments are refused with the reason fed back;
  unreadable replies retried twice, then the run fails.
- **Bounds:** steps, tool calls, time per active stretch (waiting doesn't count), tokens per run
  (plus the AI monthly limit), runs per day per agent and per workflow, automatic actions per day.
  Read and model failures retry with backoff (30 s, doubling) to the limit; writes are never
  retried automatically.
- **Checkpoints:** after each step, cursor and state (outputs, transcript, retry counts) are saved
  with the step record in one transaction; write tools use a flush-only transaction so the write
  commits with its step. A crash leaves neither, so resume can't duplicate.
- **Cancellation** checked before every step; cancelling a waiting run ends it and cancels its
  approvals.
- **Retry** (`POST …/executions/{id}/retry`) resumes from the failed step, which changed nothing.

### Approval lifecycle

Stores the exact normalized call, its SHA-256 fingerprint (`arguments_hash`), summary, reason, run,
target record, expected effect, risk, an untrusted-content flag, and expiry (24 h default).

`pending` → `executing` → `executed` | `failed`; or `rejected`, `expired`, `cancelled`.

- Approving requires the shown `arguments_hash`; a mismatch is 409.
- Before running: agent on, policy still allows, call re-prepared (record exists, module rules
  pass), fingerprint matches. If re-preparing yields a different call, the approval is cancelled
  and a new one requested.
- `pending` → `executing` is a conditional update: double clicks or second tabs get 409.
- Runs in the request; step and approval recorded; run re-queued. Rejecting a workflow step
  cancels the run; rejecting an agent proposal informs the planner, which continues.
- Expired approvals cancel their run; the worker and the approvals list both expire them.

### Memory

- **Working:** execution state, deleted with it. **Conversation:** last five runs for the planner.
- **Saved preferences:** written by the person, or proposed via `remember_preference` (always
  asks); managed under Settings.
- **Workflow:** last five outcomes, available to `ai` steps as `{{workflow.last_outcome}}`.

Each category can be turned off. Finished executions and workflow memory past retention (90 days
default) are purged hourly. Retrieved records, documents, and emails are never stored as memory.

### Monitoring

Off by default. Categories (overdue tasks, upcoming deadlines, calendar conflicts, upcoming
events, bills, budget warnings, unusual spending, expiring documents, documents missing details,
missed habits, workout consistency) checked hourly, 6-hourly, or daily by code via module
services, with configurable look-ahead and thresholds. Finding keys (record plus date) are stored
in `agent_monitor_alerts`, so each notifies once. Categories need module permission; health is
read only for its owner.

### Notifications

In-app only, per the person's choices: approval requests, failed runs, completed runs (off by
default), monitoring findings. Each comes from a once-only state transition, so none repeat. Orbit
never emails or messages anyone for the agent.

### Scheduling, local and cloud execution

Agent jobs run on every reminder-worker poll (`ORBIT_SCHEDULER_POLL_SECONDS`): expire approvals,
start due schedules, check triggers, monitor, purge (hourly), then claim and advance up to five
executions with a five-minute lease.

- **Local mode:** runs only while the API (embedded worker) or `orbit-worker` runs. A missed
  schedule runs once on start if the slot is under a day old (later slots skipped, never
  replayed); events while closed are found from timestamps. The UI says this.
- **Cloud mode:** the same worker on the server; no browser dependency.
- **Multiple processes:** slots and trigger checks claimed by conditional updates, executions by
  lease, trigger keys unique. A dead worker's lease expires and another resumes from the last
  checkpoint; three unexpected crashes fail the run.
- `ORBIT_AGENT_ENABLED=false` disables it for everyone: runs can't start or be enabled, approvals
  can't be acted on, the worker skips agent jobs.

### Security boundaries and prompt injection

- Tool results fenced as `<orbit-tool-result>` data; fence markers inside results are neutralized.
  Real controls are in code: allowlists, schema validation, `policy.decide`, fingerprint-bound
  approvals, quotas.
- Approvals proposed after reading records, emails, or trigger data are flagged. Untrusted text
  reaches tools only as template values validated by the tool's schema.
- No path from a model to settings, permissions, limits, or memory without approval.
- Queries scoped to workspace and owner; another person's workflow, run, approval, or memory is 404.
- Step arguments, outputs, reasons, errors are redacted (credential-like keys and values masked)
  and size-limited before storage; errors are safe messages; logs carry IDs only.
- PostgreSQL: the seven tables have RLS enabled with no policies.
- Backups exclude agent tables on purpose: a restore must not start automations, replay approvals,
  or resume runs.

### API

Under `/api/v1/workspaces/{workspace_id}/agent`: `GET`/`PATCH` (overview; settings and
permissions), `GET /tools`, `POST /runs` (202, idempotency key), `GET /executions[/{id}]`,
`POST /executions/{id}/cancel|retry`, CRUD `/workflows` plus `POST /workflows/{id}/enabled|run`,
`GET /approvals` plus `POST /approvals/{id}/approve|reject`, `GET`/`POST /memories` plus
`PATCH`/`DELETE /memories/{id}`.

### In the web app

`/automation`, side rail with five views: Home, Workflows (with template gallery; `?template=<id>`
opens the editor prefilled; old `?tab=templates` lands here), Approvals, History, Settings
(per-action modes, limits, memory settings, model under Advanced). Views with runs in progress
refetch every five seconds.

### Known limitations

- Event triggers poll module timestamps every minute; nothing is pushed.
- No "new email received" trigger.
- No tool writes to external calendars or files; imported events change only through sync.
- Planning uses JSON replies, not native function calling; small local models may produce invalid
  steps (refused, retried, then the run fails).
- Cancellation doesn't interrupt an in-flight model call; the run stops before its next step.
- Model calls are recorded in AI usage as `assist`.
- Agent configuration, workflows, and memory aren't backed up.
- Tested on SQLite; no agent-specific PostgreSQL tests.

## Configuration

| App | Source                                                    | Validation                                    | Visibility  |
| --- | --------------------------------------------------------- | --------------------------------------------- | ----------- |
| API | `ORBIT_*` environment variables, optional `apps/api/.env` | `Settings` in `config.py` (pydantic-settings) | Server-only |
| Web | `NEXT_PUBLIC_*` variables, optional `apps/web/.env.local` | `src/lib/env/env.ts`                          | Public      |

- Read in one place per app (`get_settings()`, `publicEnv`). Invalid configuration fails at
  startup. Production rejects wildcard CORS origins and disables interactive API docs.
- Variable reference: [development.md](development.md#environment-variables).

## Testing strategy

| Layer                 | Tool / location                                                                                                                             | Notable coverage                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Web units, components | Vitest, Testing Library, jsdom; co-located `*.test.ts(x)`                                                                                   | Every module's views, forms, and states; auth, route guard, workspace switching and stale data                                                 |
| API routes and config | Pytest, `TestClient`; `apps/api/tests/`                                                                                                     | Every module; AI and integration adapters over mocked HTTP; backup round trips, hostile archives                                               |
| Scheduling            | Pure functions, controllable clock; `test_recurrence.py`, `test_calendar_recurrence.py`, `test_reminder_worker.py`, `test_budget_alerts.py` | DST, month ends, leap years; delivery, concurrency, leases, retries, restarts                                                                  |
| Services              | In-memory fake repositories; `test_*_service.py`                                                                                            | Onboarding, concurrent provisioning, ownership, task completion rules                                                                          |
| Database (SQLite)     | Temporary SQLite files; `test_database.py`, etc.                                                                                            | Startup checks, sessions, migrations, constraints, 503s                                                                                        |
| Database (PostgreSQL) | Opt-in `-m postgres`; `test_postgres.py`                                                                                                    | Migrations, RLS, feature SQL incl. AI and a backup round trip; skipped by default                                                              |
| Contract freshness    | `test_openapi.py`, `openapi-typescript --check`                                                                                             | Generated contract matches the API                                                                                                             |
| Authorization matrix  | `test_authorization_matrix.py`, every OpenAPI operation                                                                                     | 401 outside the public allowlist; same 404 for foreign or unknown workspaces; nothing changed                                                  |
| Concurrent devices    | `httpx` ASGI client; `test_concurrent_devices.py`                                                                                           | No lost or duplicated transactions, exact balances, one winner for simultaneous note saves                                                     |
| Observability         | `test_health.py`                                                                                                                            | Liveness, readiness, request IDs, security headers, no query strings in logs, JSON logs                                                        |
| End-to-end            | Playwright (Chromium); `apps/web/e2e/`                                                                                                      | Sign-up, signed-out redirect, task add/complete, quick capture via search, password change; real API on throwaway SQLite, no external services |

CI runs every layer on each PR, including PostgreSQL tests against a `postgres:17` service and a
dependency audit.

API tests share one database migrated per run: `migrated_settings` copies it per test (re-running
migrations took most of the suite's time). Tests needing an unmigrated or downgraded database use
`settings` and migrate themselves.

## Observability

- `orbit_api/observability.py`: outermost ASGI middleware. Request ID (a caller's plain
  `X-Request-ID` ≤ 64 chars is kept, else replaced), echoed in `X-Request-ID`, stamped on every
  `orbit_api` log record via a context variable. One line per request: method, path without query
  string, status, duration; successful `/api/v1/health*` probes not logged.
- Uvicorn's access log is off (`__main__.py`) because it prints query strings (search terms,
  Microsoft webhook validation tokens).
- `ORBIT_LOG_FORMAT=json`: one JSON object per line, extras (`http_status`, `duration_ms`, …) as
  keys.
- Middleware adds `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, `Cache-Control: no-store` unless the response sets its own (file
  downloads and the profile photo do).
- Health: `/health/live`, `/health/ready` (database reachable and at this version's schema
  revision, else 503), `/health/database` (connectivity, storage mode).
- Web (`next.config.ts`, `src/lib/security-headers`): `X-Frame-Options`, `nosniff`, referrer and
  permissions policies, partial CSP (`frame-ancestors`, `object-src`, `base-uri`, `form-action`).
  Scripts and connections aren't restricted: that needs per-request nonces and the deployment's API
  and Supabase URLs.

## Planned architecture

> **Not implemented.** Intended direction so early features don't block it. Build each piece only
> when a feature needs it, and update this document when it lands.

### Backend layering

See [Backend layers](#backend-layers). External services live in `providers/` (`providers/ai/`,
`providers/integrations/`) behind interfaces; services don't import vendor SDKs.

### Storage

Foundation implemented (see [Storage](#storage)). Still planned:

- More product tables (later [finance](#finance) phases) on the [tasks](#tasks) pattern.
- Shared workspaces (membership, invitations, roles), if needed.
- Any sync or migration between local and cloud storage: undecided, needs its own design.
- Object storage for files behind the existing `FileStore` protocol, and application-level
  encryption at rest with real key management (see [Encryption](#encryption)).

### AI

Provider interface, retrieval, assistant, agent, and workflows are implemented (see
[AI intelligence layer](#ai-intelligence-layer),
[Personal agent and automation](#personal-agent-and-automation)). Still planned: a pgvector adapter
behind the same chunk store for large cloud indexes.

### Evolution

In place: tasks, reminders (database-backed worker), finance phases 1–4, notes, calendar, habits,
documents, health, dashboard, AI layer, integrations, and backup. Next: more modules on the same pattern, then
optional sync and extension points, leaving the boundaries above intact.

## Continuous integration

`.github/workflows/ci.yml` on PRs and pushes to `main`:

- **Web:** frozen pnpm install, ESLint, Prettier check, contract freshness, `tsc`, Vitest,
  `next build`.
- **API:** locked uv sync, Ruff lint and format check, Pyright, Pytest (incl. contract freshness).
- **Commit messages (PRs only):** commitlint.

No secrets required. PostgreSQL tests are skipped unless `ORBIT_TEST_DATABASE_URL` is set.

`.github/workflows/containers.yml` builds both images and smoke-tests the Compose stack (migrate,
API, web) on every PR; on `main` pushes and `v*` tags it publishes multi-arch images to GHCR with
only the workflow's `GITHUB_TOKEN`.

## Deployment

`apps/api/Dockerfile` (uv, non-editable install, slim Python, data in a `/data` volume) and
`apps/web/Dockerfile` (Next.js `output: "standalone"`), built from the repo root, both unprivileged.
`compose.yaml` runs a one-shot migration, then API and web; an optional Caddy profile serves both on
one HTTPS origin. Images change no behavior: config via `ORBIT_*` and `NEXT_PUBLIC_API_URL`
(inlined at build time). Operator guide: [deployment.md](deployment.md).
