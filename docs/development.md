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
  unless you deliberately need access from another device on a trusted network. The API has no
  authentication yet.

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
   ```

   Production (`ORBIT_ENV=production`) rejects URLs without `ssl=require`, `verify-ca`, or
   `verify-full`.

3. `pnpm db:migrate`, then `pnpm dev:api`. Startup logs the host and database name only.

Supabase Row Level Security is planned but not active, since no tables exist yet. See
[architecture.md](architecture.md#cloud-security-and-supabase).

### Migrations

Alembic manages the schema. Its configuration is `[tool.alembic]` in `apps/api/pyproject.toml`,
and migrations live in `apps/api/src/orbit_api/db/migrations/versions/`. Commands use the
database selected by your `ORBIT_*` settings.

```bash
pnpm db:migrate                       # upgrade to the latest revision (from the repo root)

cd apps/api
uv run alembic current                # revision the database is at
uv run alembic history                # all revisions
uv run alembic revision --autogenerate --rev-id 0002 -m "create tasks table"
uv run alembic downgrade -1           # revert the latest revision
```

- Review every autogenerated migration by hand. It must run on both SQLite and PostgreSQL,
  and any table created on PostgreSQL must enable Row Level Security in the same revision.
- Number revisions sequentially (`--rev-id 0002`, `0003`, …).
- Migrations never run automatically. Running `pnpm db:migrate` with `ORBIT_STORAGE_MODE=cloud`
  changes the shared cloud database.
- `uv run pytest tests/test_migrations.py` fails if ORM models and migrations disagree.

### Database tests

- `pnpm test:api` (or `uv run pytest`) uses a temporary SQLite database per test. It needs no
  database server or credentials, and never touches your real database.
- PostgreSQL integration tests are marked `postgres` and skipped unless
  `ORBIT_TEST_DATABASE_URL` is set. They migrate up and back down to an empty schema, so use a
  **disposable** database:

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
- **Port already in use:** stop the other process, or set `ORBIT_API_PORT` / run
  `pnpm --filter @orbit/web exec next dev --port 3001` and update `ORBIT_CORS_ORIGINS`.
