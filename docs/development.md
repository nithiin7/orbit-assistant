# Development guide

## Setup

```bash
pnpm install              # installs JS dependencies and Git hooks (via the `prepare` script)
uv sync --all-packages    # creates .venv with the API and its dev tools
```

Re-run these after pulling changes that touch `pnpm-lock.yaml` or `uv.lock`.

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

All API variables are server-only. Settings are validated at startup. In production, wildcard
CORS origins are rejected and the interactive docs are disabled. If you change the web app's
port, update `ORBIT_CORS_ORIGINS` to match.

## Quality checks

| Task         | Everything          | Web only                             | API only (from `apps/api`)     |
| ------------ | ------------------- | ------------------------------------ | ------------------------------ |
| Lint         | `pnpm lint`         | `pnpm lint:web`                      | `uv run ruff check .`          |
| Format       | `pnpm format`       | `pnpm exec prettier --write .`       | `uv run ruff format .`         |
| Format check | `pnpm format:check` | `pnpm exec prettier --check .`       | `uv run ruff format --check .` |
| Type check   | `pnpm typecheck`    | `pnpm --filter @orbit/web typecheck` | `uv run pyright`               |
| Test         | `pnpm test`         | `pnpm test:web`                      | `uv run pytest`                |
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
- **Suggested scopes:** `web`, `api`, `config`, `ci`, `deps`, `docs`.
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
- **Port already in use:** stop the other process, or set `ORBIT_API_PORT` / run
  `pnpm --filter @orbit/web exec next dev --port 3001` and update `ORBIT_CORS_ORIGINS`.
