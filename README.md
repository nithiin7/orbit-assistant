# Orbit

Orbit is an open-source, privacy-first personal assistant. It aims to bring tasks, calendar,
finances, notes, and an AI assistant together in one place, while keeping your data under your
control.

> **Status: early scaffolding.** This repository currently contains the project foundation only:
> the monorepo, tooling, an application shell, and an API skeleton. None of the product features
> are built yet.

## Scope

**In scope today**

- A Next.js web app with a responsive application shell (collapsible sidebar on Cmd/Ctrl+B,
  mobile drawer, command palette on Cmd/Ctrl+K, light/dark/system themes chosen in Settings) and
  placeholder sections.
- A FastAPI service with centralized configuration and a health endpoint.
- Shared tooling for linting, formatting, type checking, testing, commit conventions, and CI.

**Explicit non-goals for now**

- Task, calendar, finance, or notes functionality.
- Authentication, user accounts, or data persistence (no database or ORM).
- AI or LLM integration, data synchronization, or background jobs.
- Containers or deployment infrastructure.

## Architecture

| Part       | Path                                                       | Stack                                                     |
| ---------- | ---------------------------------------------------------- | --------------------------------------------------------- |
| Web app    | [`apps/web`](apps/web)                                     | Next.js (App Router), React, TypeScript, Tailwind CSS v4  |
| API        | [`apps/api`](apps/api)                                     | Python 3.12, FastAPI, Pydantic Settings, Uvicorn          |
| Contracts  | [`packages/contracts`](packages/contracts)                 | OpenAPI schema and TS types generated from the API        |
| TS configs | [`packages/typescript-config`](packages/typescript-config) | Shared strict `tsconfig` presets                          |
| ESLint     | [`packages/eslint-config`](packages/eslint-config)         | Shared flat config (Next.js, TypeScript, import ordering) |

JavaScript packages are managed with **pnpm workspaces**. Python is managed with a **uv
workspace** rooted at the repository. The API also has a small `package.json` that wraps `uv`
commands, so `pnpm` can drive both stacks from the repository root.

**Shared API types.** The Pydantic models in the API are the single source of truth for the API
contract. `pnpm contracts:generate` exports the OpenAPI schema to `packages/contracts` and
generates matching TypeScript types, which the web app imports from `@orbit/contracts`. Tests
and CI fail if the generated contract falls out of date.

See [docs/architecture.md](docs/architecture.md) for details and design decisions.

## Repository structure

```text
.
├── apps/
│   ├── api/                  # FastAPI service (src/ layout, uv-managed)
│   └── web/                  # Next.js web app
├── packages/
│   ├── contracts/            # API contract: openapi.json + generated TS types
│   ├── eslint-config/        # Shared ESLint flat config
│   └── typescript-config/    # Shared tsconfig presets
├── docs/                     # Architecture and development guides
├── .github/                  # CI workflow, issue and PR templates
├── .husky/                   # Git hooks (pre-commit, commit-msg)
├── package.json              # Root scripts and JS tooling
├── pnpm-workspace.yaml
├── pyproject.toml            # uv workspace root and shared Ruff config
└── uv.lock
```

## Prerequisites

- **Node.js 24 LTS** (see [`.nvmrc`](.nvmrc); newer versions generally work)
- **pnpm 11** (`npm install -g pnpm`, or `corepack enable`)
- **Python 3.12** (see [`.python-version`](.python-version); uv can install it for you)
- **uv 0.8+** ([installation guide](https://docs.astral.sh/uv/getting-started/installation/))

## Getting started

```bash
git clone https://github.com/nithiin7/orbit-assistant.git
cd orbit-assistant

pnpm install              # JS dependencies + Git hooks
uv sync --all-packages    # Python virtual environment in .venv

pnpm dev                  # web on http://localhost:3000, API on http://localhost:8000
```

Check the API with `curl http://localhost:8000/api/v1/health`. Interactive API docs are served at
<http://localhost:8000/docs> outside production.

## Configuration

Each app has its own example file. Copy it to configure local overrides. Both apps run with
safe defaults and no configuration.

| File                                             | Copy to               | Visibility                        |
| ------------------------------------------------ | --------------------- | --------------------------------- |
| [`apps/web/.env.example`](apps/web/.env.example) | `apps/web/.env.local` | `NEXT_PUBLIC_*` values are public |
| [`apps/api/.env.example`](apps/api/.env.example) | `apps/api/.env`       | Server-only                       |

- Variables prefixed `NEXT_PUBLIC_` are embedded into the browser bundle. **Never put secrets in
  them.**
- API variables use the `ORBIT_` prefix and are validated at startup by Pydantic Settings. Invalid
  values stop the server with a clear error.
- `.env` files are git-ignored. Only commit `.env.example` files, and only with placeholder values.

## Commands

Run everything from the repository root.

| Command                   | What it does                                                 |
| ------------------------- | ------------------------------------------------------------ |
| `pnpm dev`                | Start the web app and API together (Ctrl+C stops both)       |
| `pnpm dev:web`            | Start only the web app                                       |
| `pnpm dev:api`            | Start only the API (auto-reload in development)              |
| `pnpm lint`               | ESLint (web) and Ruff (API)                                  |
| `pnpm lint:web`           | ESLint only                                                  |
| `pnpm lint:api`           | Ruff lint only                                               |
| `pnpm format`             | Format everything (Prettier + Ruff)                          |
| `pnpm format:check`       | Check formatting without writing                             |
| `pnpm typecheck`          | TypeScript (`tsc`) and Pyright                               |
| `pnpm test`               | Vitest (web) and Pytest (API)                                |
| `pnpm test:web`           | Vitest only                                                  |
| `pnpm test:api`           | Pytest only                                                  |
| `pnpm check`              | All quality gates: lint, format check, type check, tests     |
| `pnpm build`              | Production build of the web app                              |
| `pnpm contracts:generate` | Regenerate the shared API contract after changing API models |
| `pnpm contracts:check`    | Verify the shared API contract is up to date                 |

You can also use `uv` directly inside `apps/api`, for example `uv run pytest -k health`. See
[docs/development.md](docs/development.md) for the full workflow.

## Commit conventions

Commits follow [Conventional Commits](https://www.conventionalcommits.org/). The subject should
be short (72 characters at most) and use the imperative mood:

```text
feat(web): add responsive app shell
fix(api): validate health response
docs: document local development
```

Git hooks (installed by `pnpm install`) format and lint staged files on commit and validate the
commit message. CI runs the full suite. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development status

| Area                  | Status         |
| --------------------- | -------------- |
| Monorepo and tooling  | ✅ In place    |
| Web application shell | ✅ In place    |
| API foundation        | ✅ In place    |
| CI                    | ✅ In place    |
| Product features      | ⏳ Not started |

## Contributing and security

- [Contributing guide](CONTRIBUTING.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [Security policy](SECURITY.md): please report vulnerabilities privately.

## License

Orbit is licensed under the [Apache License 2.0](LICENSE).
