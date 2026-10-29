# Development guide

## Setup

```bash
pnpm install              # installs JS dependencies and Git hooks (via the `prepare` script)
uv sync --all-packages    # creates .venv with the API and its dev tools
pnpm db:migrate           # creates and migrates the local SQLite database
```

Re-run the first two after pulling changes that touch `pnpm-lock.yaml` or `uv.lock`, and
`pnpm db:migrate` after pulling new migrations. The API refuses to start until the database is
migrated, and its error message says so.

> If your shell has an unrelated `VIRTUAL_ENV` activated (for example from pyenv), uv prints a
> warning and uses the project's `.venv` anyway. Deactivate the other environment to silence it.

## Running the apps

| Command        | URL                             |
| -------------- | ------------------------------- |
| `pnpm dev`     | Both apps, with prefixed output |
| `pnpm dev:web` | <http://localhost:3000>         |
| `pnpm dev:api` | <http://localhost:8000>         |

`pnpm dev` uses [concurrently](https://github.com/open-cli-tools/concurrently) with
`--kill-others`. Ctrl+C, or either app exiting, stops both.

Open <http://localhost:3000>. On a fresh local database you are sent to **Create your Orbit
account**; that first account owns the installation (see [Accounts](#accounts)).

Useful API URLs in development:

- Health: <http://localhost:8000/api/v1/health>
- Database connectivity: <http://localhost:8000/api/v1/health/database>
- OpenAPI docs: <http://localhost:8000/docs>

## Environment variables

### Web (`apps/web/.env.local`)

| Variable              | Default                 | Visibility | Purpose                          |
| --------------------- | ----------------------- | ---------- | -------------------------------- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Public     | API base URL used by the browser |

Anything prefixed `NEXT_PUBLIC_` is inlined into JavaScript sent to every visitor. Server-only
secrets for the web app (none exist yet) must not use that prefix and must only be read in
server code.

### API (`apps/api/.env`)

| Variable             | Default                                             | Purpose                                |
| -------------------- | --------------------------------------------------- | -------------------------------------- |
| `ORBIT_ENV`          | `development`                                       | `development`, `test`, or `production` |
| `ORBIT_API_HOST`     | `127.0.0.1`                                         | Bind address                           |
| `ORBIT_API_PORT`     | `8000`                                              | Bind port                              |
| `ORBIT_LOG_LEVEL`    | `info`                                              | Uvicorn log level                      |
| `ORBIT_CORS_ORIGINS` | `["http://localhost:3000","http://127.0.0.1:3000"]` | Allowed browser origins (JSON list)    |

Storage (see [Database](#database)):

| Variable                      | Default                        | Purpose                                                   |
| ----------------------------- | ------------------------------ | --------------------------------------------------------- |
| `ORBIT_STORAGE_MODE`          | `local`                        | `local` (SQLite) or `cloud` (PostgreSQL)                  |
| `ORBIT_SQLITE_PATH`           | `apps/api/.data/orbit.sqlite3` | Local mode: SQLite file path (`~` is expanded)            |
| `ORBIT_DATABASE_URL`          | unset                          | Cloud mode only: PostgreSQL URL. Secret; server-side only |
| `ORBIT_DATABASE_POOL_SIZE`    | `5`                            | Cloud mode: persistent pooled connections                 |
| `ORBIT_DATABASE_MAX_OVERFLOW` | `5`                            | Cloud mode: extra connections allowed under load          |

Reminders (see [Reminder worker](#reminder-worker)):

| Variable                       | Default | Purpose                                                                  |
| ------------------------------ | ------- | ------------------------------------------------------------------------ |
| `ORBIT_SCHEDULER_IN_API`       | unset   | Run the reminder worker inside the API process. Unset: yes, except tests |
| `ORBIT_SCHEDULER_POLL_SECONDS` | `15`    | How often a worker looks for due reminders (1 to 300)                    |

Accounts (see [Accounts](#accounts)):

| Variable                         | Default | Purpose                                                                 |
| -------------------------------- | ------- | ----------------------------------------------------------------------- |
| `ORBIT_SUPABASE_URL`             | unset   | Cloud mode only (required): Supabase project URL, `https` in production |
| `ORBIT_SUPABASE_PUBLISHABLE_KEY` | unset   | Cloud mode only (required): publishable (anon) key. Public by design    |
| `ORBIT_LOCAL_SESSION_TTL_HOURS`  | `336`   | Local mode: session lifetime in hours (14 days; 1 to 2160)              |
| `ORBIT_LOCAL_OPEN_REGISTRATION`  | unset   | Local mode: allow accounts beyond the first. Unset: open except in prod |

All API variables are server-only. Settings are validated at startup. In production, wildcard
CORS origins are rejected and the interactive docs are disabled. If you change the web app's
port, update `ORBIT_CORS_ORIGINS` to match.

## Database

The API stores data in SQLite (local mode) or PostgreSQL (cloud mode). The design is in
[architecture.md](architecture.md#storage). Only one mode is active at a time, and there is no
fallback between them: if the selected database is unavailable or not migrated, the API exits
with an error that names the mode and target (never the password).

### Local mode (default)

```bash
pnpm db:migrate     # creates apps/api/.data/orbit.sqlite3 and applies migrations
pnpm dev:api        # logs "Storage mode: local. Using the SQLite database at …"
```

- To store data elsewhere, set `ORBIT_SQLITE_PATH` in `apps/api/.env` (for example
  `~/.local/share/orbit/orbit.sqlite3`), then run `pnpm db:migrate`. Never place it under
  `apps/web`.
- Orbit creates a new database file as `0600` and its directory as `0700` (owner-only). It
  doesn't change the permissions of existing files or folders.
- The database, its `-wal`/`-shm` files, and `.data/` are git-ignored. Never commit them.
- The API binds to `127.0.0.1` by default, so only this machine can reach it. Keep it that way
  unless you deliberately need access from another device on a trusted network: local sign-in
  is served over plain HTTP and has no rate limiting.

#### Backups

SQLite runs in WAL mode, so recent writes may sit in `orbit.sqlite3-wal` rather than the main
file. Copying only `orbit.sqlite3` while the API runs can produce an incomplete backup. Use
either approach:

- Stop the API, then copy `orbit.sqlite3` (and any `-wal`/`-shm` files) together.
- Or, while it runs: `sqlite3 path/to/orbit.sqlite3 ".backup 'orbit-backup.sqlite3'"`.

Backups contain all of your data unencrypted. Store them with the same care as the original.

### Cloud mode (Supabase PostgreSQL)

1. In the Supabase dashboard, open **Connect** and copy a **direct** or **session pooler**
   connection string. The transaction pooler (port 6543) is not supported, because `asyncpg`
   uses prepared statements.
2. In `apps/api/.env` (never in `apps/web`):

   ```bash
   ORBIT_STORAGE_MODE=cloud
   ORBIT_DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/postgres?ssl=require
   ORBIT_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   ORBIT_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```

   Production (`ORBIT_ENV=production`) rejects URLs without `ssl=require`, `verify-ca`, or
   `verify-full`. The Supabase URL and publishable key come from **Project Settings → API
   Keys**; they are public and reach the browser through `GET /api/v1/auth/config`. Never
   configure the service-role (secret) key: Orbit doesn't need it.

3. Configure Supabase Auth (see [Cloud accounts](#cloud-accounts-supabase-auth)).
4. `pnpm db:migrate`, then `pnpm dev:api`. Startup logs the host and database name only.

The dashboard shows a **Local · SQLite** or **Cloud · Supabase** badge, and **Settings → Storage**
shows the same status. Neither can change the mode: edit `apps/api/.env` and restart the API.

Migrations enable Row Level Security, with no policies, on every Orbit table in PostgreSQL, so
Supabase's Data API can't read them with the publishable key. The API itself enforces
authorization. See [architecture.md](architecture.md#cloud-security-and-supabase).

## Accounts

Which sign-in Orbit uses follows the storage mode; the web app asks the API
(`GET /api/v1/auth/config`) and needs no configuration of its own. The design is in
[architecture.md](architecture.md#identity-and-authorization).

### Local accounts

- Accounts live in the SQLite database. Passwords are hashed with Argon2id; sessions are random
  tokens stored only as hashes, valid for `ORBIT_LOCAL_SESSION_TTL_HOURS`.
- Several people can create accounts on the same machine; each sees only their own
  workspaces. Sign out, then use **Create account**. In production (`ORBIT_ENV=production`)
  only the first account can register unless `ORBIT_LOCAL_OPEN_REGISTRATION=true`, because a
  reachable server shouldn't accept strangers by default. Set it to `false` to close sign-up
  anywhere.
- **Forgotten password:** there is no email-based recovery in local mode (Orbit doesn't send
  email); `/forgot-password` says so instead of offering a reset. This is a known gap; until a
  recovery design exists, the only way back in is to reset the database, which deletes its data.
- There is no secret to configure for local sessions.

### Cloud accounts (Supabase Auth)

1. **JWT signing keys:** Orbit verifies tokens with the project's public keys and accepts only
   asymmetric signatures (ES256 or RS256), the default for new Supabase projects. If your
   project still signs with the legacy shared secret (HS256), migrate under **Project Settings
   → JWT Keys** first, or every request will be rejected with 401.
2. **Email provider:** keep the Email provider enabled. If **Confirm email** is on (the default),
   sign-up shows "Check your email", and the confirmation link signs the user in.
3. **URL configuration:** set **Site URL** to the web app's origin (for example
   `http://localhost:3000`) and add it to the redirect allow list, so confirmation links return
   to Orbit. Also allow `<origin>/reset-password` (for example
   `http://localhost:3000/reset-password`): password reset emails link there, and Supabase
   refuses redirects that aren't on the list.
4. **Password reset:** "Forgot password?" on the sign-in page sends a Supabase reset email.
   The link opens `/reset-password` with a recovery session, where the user chooses a new
   password. The confirmation always reads "If an account exists…", so it doesn't reveal
   which emails have accounts. Customize the email under **Authentication → Emails**.
5. Password rules, rate limits, and session lifetime are Supabase settings. The web form asks
   for at least 8 characters; keep Supabase's minimum at or below that, or its message is shown.

The first request from a new Supabase user creates their Orbit profile and Personal workspace.
Supabase users and local accounts are separate identities, even with the same email.

### Migrations

Alembic manages the schema. Its configuration is `[tool.alembic]` in `apps/api/pyproject.toml`,
and migrations live in `apps/api/src/orbit_api/db/migrations/versions/`. Commands use the
database selected by your `ORBIT_*` settings.

```bash
pnpm db:migrate                       # upgrade to the latest revision (from the repo root)

cd apps/api
uv run alembic current                # revision the database is at
uv run alembic history                # all revisions
uv run alembic revision --autogenerate --rev-id 0005 -m "create notes table"
uv run alembic downgrade -1           # revert the latest revision
```

- Review every autogenerated migration by hand. It must run on both SQLite and PostgreSQL,
  and any table created on PostgreSQL must enable Row Level Security in the same revision.
- Number revisions sequentially (`--rev-id 0005`, `0006`, …).
- Migrations never run automatically. Running `pnpm db:migrate` with `ORBIT_STORAGE_MODE=cloud`
  changes the shared cloud database.
- `uv run pytest tests/test_migrations.py` fails if ORM models and migrations disagree.

### Database and auth tests

- `pnpm test:api` (or `uv run pytest`) uses a temporary SQLite database per test. It needs no
  database server or credentials, and never touches your real database.
- Supabase Auth is never contacted by tests: `tests/test_supabase_auth.py` signs tokens with a key
  generated in the test and hands the verifier that key in place of the project's JWKS. No
  Supabase credentials are needed.
- PostgreSQL integration tests are marked `postgres` and skipped unless
  `ORBIT_TEST_DATABASE_URL` is set. They migrate up and back down to an empty schema, so use a
  **disposable** database. They also check that RLS is enabled and that a role that doesn't own
  the tables sees no rows (the test creates and rolls back a temporary role, so the database
  user needs `CREATEROLE`):

  ```bash
  createdb orbit_test
  cd apps/api
  ORBIT_TEST_DATABASE_URL=postgresql://localhost/orbit_test uv run pytest -m postgres
  ```

### Why there is no sync yet

Synchronization between local and cloud storage, and migrating data from one mode to the
other, are deliberately not implemented. Both need stable record identity, conflict
resolution, and deletion tracking, which depend on product schemas that don't exist yet. Until
then, choose one mode per installation. Switching modes starts with an empty database; it does
not move data.

## Reminder worker

Due reminders are delivered as in-app notifications by a worker that polls the database. The
design and its guarantees are in
[architecture.md](architecture.md#reminders-and-notifications).

- **Locally, nothing extra is needed:** `pnpm dev` (or `pnpm dev:api`) runs the worker inside
  the API process; startup logs `Reminder worker started; polling every 15 s.` Notifications
  appear in the bell within one poll interval, and the bell checks for them every 30 seconds.
- **Standalone:** set `ORBIT_SCHEDULER_IN_API=false` for the API and run the worker separately.
  It reads the same `ORBIT_*` settings and refuses to start if the database isn't migrated.

  ```bash
  pnpm worker                                 # poll until Ctrl+C or SIGTERM
  cd apps/api
  uv run orbit-worker --once                  # deliver what is due now, then exit
  uv run orbit-worker status                  # occurrences by status (pending, failed, …)
  uv run orbit-worker retry-failed            # make failed occurrences pending again
  ```

- **Several workers are safe** (for example one per API instance in cloud mode, plus a
  standalone one): claims are atomic, so each occurrence is delivered once. In local mode
  SQLite serializes writes, which is plenty for one person's reminders.
- **Stopping** the API or worker lets the poll in progress finish. Pending reminders are rows in
  the database, so nothing is lost; after downtime, each reminder fires once for what it missed,
  then continues on schedule.
- **Failures** are retried with backoff and, after 5 attempts, marked failed. The reminder shows
  as overdue in the app, the worker logs a warning with the occurrence ID (never reminder
  text), and `orbit-worker status` counts them.
- Tests never start the embedded worker; they drive it directly with a controllable clock
  (`tests/test_reminder_worker.py`).

## Quality checks

| Task         | Everything          | Web only                             | API only (from `apps/api`)     |
| ------------ | ------------------- | ------------------------------------ | ------------------------------ |
| Lint         | `pnpm lint`         | `pnpm lint:web`                      | `uv run ruff check .`          |
| Format       | `pnpm format`       | `pnpm exec prettier --write .`       | `uv run ruff format .`         |
| Format check | `pnpm format:check` | `pnpm exec prettier --check .`       | `uv run ruff format --check .` |
| Type check   | `pnpm typecheck`    | `pnpm --filter @orbit/web typecheck` | `uv run pyright`               |
| Test         | `pnpm test`         | `pnpm test:web`                      | `uv run pytest`                |
| Migrate DB   | `pnpm db:migrate`   |                                      | `uv run alembic upgrade head`  |
| All gates    | `pnpm check`        |                                      |                                |
| Build        | `pnpm build`        |                                      |                                |

Watch mode for frontend tests: `pnpm --filter @orbit/web test:watch`.

### Where configuration lives

| Tool          | Config                                                          |
| ------------- | --------------------------------------------------------------- |
| Prettier      | `.prettierrc.json`, `.prettierignore`                           |
| ESLint        | `packages/eslint-config/next.js` → `apps/web/eslint.config.mjs` |
| TypeScript    | `packages/typescript-config/*.json` → `apps/web/tsconfig.json`  |
| Vitest        | `apps/web/vitest.config.mts`                                    |
| Ruff          | `[tool.ruff]` in the root `pyproject.toml`                      |
| Pyright       | `[tool.pyright]` in `apps/api/pyproject.toml`                   |
| Pytest        | `[tool.pytest.ini_options]` in `apps/api/pyproject.toml`        |
| Alembic       | `[tool.alembic]` in `apps/api/pyproject.toml`                   |
| Editor basics | `.editorconfig`                                                 |

## Changing the API contract

The API's Pydantic models define the types shared with the web app. After adding or changing an
endpoint or model:

```bash
pnpm contracts:generate   # writes packages/contracts/openapi.json and src/schema.ts
pnpm typecheck            # the web app now type-checks against the new contract
```

Commit the regenerated files with the API change. To expose a model under a friendly name, add
an alias in `packages/contracts/src/index.ts`:

```ts
export type HealthResponse = Schemas["HealthResponse"];
```

Never edit `openapi.json` or `schema.ts` by hand. `pnpm contracts:check`, `pnpm test:api`, and CI
all fail when they are out of date.

## Git hooks and commits

Hooks are managed by [Husky](https://typicode.github.io/husky/) and installed by `pnpm install`.

- **pre-commit** runs [lint-staged](https://github.com/lint-staged/lint-staged) (`.lintstagedrc.mjs`)
  on staged files only:
  - ESLint `--fix` for web scripts,
  - Prettier for all supported files,
  - Ruff lint `--fix` and Ruff format for Python files.
- **commit-msg** runs [commitlint](https://commitlint.js.org/) with the Conventional Commits
  preset (`.commitlintrc.json`).

The full test suite is not run on commit, to keep commits fast. CI runs it.

### Commit message format

```text
<type>(<optional scope>): <short imperative summary>
```

- **Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`,
  `chore`, `revert`.
- **Suggested scopes:** `web`, `api`, `contracts`, `config`, `ci`, `deps`, `docs`.
- The header must be 72 characters or fewer. Use the body for the "why".
- Breaking changes: add `!` after the type/scope (`feat(api)!: …`) and a `BREAKING CHANGE:`
  footer.

Test a message without committing:

```bash
echo "feat(web): add task list" | pnpm exec commitlint
```

## Dependencies

- JS: `pnpm --filter @orbit/web add <pkg>` (or `add -D` for dev dependencies). Versions are
  pinned exactly.
- Python: run `uv add <pkg>` (or `uv add --dev <pkg>`) from `apps/api`.
- Commit lockfile changes together with the manifest change.
- pnpm 11 blocks dependency install scripts by default. If a new dependency needs one, approve
  it explicitly under `allowBuilds` in `pnpm-workspace.yaml`.

## Troubleshooting

- **`ERR_PNPM_IGNORED_BUILDS` after changing `allowBuilds`:** pnpm caches earlier decisions in
  `node_modules/.modules.yaml`. Remove `node_modules` and run `pnpm install` again.
- **Hooks not running:** run `pnpm install` (which runs `husky`) and check that
  `git config core.hooksPath` prints `.husky/_`.
- **`DatabaseSchemaError … Run pnpm db:migrate` at startup:** the database is missing or
  behind the code. Run `pnpm db:migrate`.
- **`DatabaseUnavailableError` at startup:** the selected database could not be opened or
  reached. Check `ORBIT_SQLITE_PATH` (its folder must be writable), or check that
  `ORBIT_DATABASE_URL` is correct and the server is reachable. Orbit will not fall back to the
  other mode.
- **Every request returns 401 in cloud mode:** check that the project uses asymmetric JWT
  signing keys, and that `ORBIT_SUPABASE_URL` matches the project the web app signs in to.
- **"Orbit can't check your session":** the web app reached neither the API nor its database.
  Start the API (`pnpm dev:api`) and choose **Try again**; your session is kept.
- **Port already in use:** stop the other process, or set `ORBIT_API_PORT` / run
  `pnpm --filter @orbit/web exec next dev --port 3001` and update `ORBIT_CORS_ORIGINS`.
