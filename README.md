<div align="center">

# 🪐 Orbit

**An open-source, privacy-first personal assistant.**

Tasks, calendar, finances, notes, and an AI assistant in one place, with your data under your
control.

[![CI](https://github.com/nithiin7/orbit-assistant/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/nithiin7/orbit-assistant/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache_2.0-blue.svg)](LICENSE)
![Status: early development](https://img.shields.io/badge/status-early_development-orange)
[![Conventional Commits](https://img.shields.io/badge/commits-conventional-fe5196?logo=conventionalcommits&logoColor=white)](https://www.conventionalcommits.org/)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?logo=tailwindcss&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-local-003B57?logo=sqlite&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-3ECF8E?logo=supabase&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-11-F69220?logo=pnpm&logoColor=white)
![uv](https://img.shields.io/badge/uv-managed-DE5FE9?logo=uv&logoColor=white)

[Getting started](#getting-started) · [Architecture](docs/architecture.md) ·
[Development guide](docs/development.md) · [Contributing](CONTRIBUTING.md)

</div>

> [!NOTE]
> **Early development.** This repository contains the project foundation: the monorepo, tooling,
> an application shell, an API with a database layer, and accounts with workspaces. Tasks,
> shopping lists, reminders (with in-app notifications), and finance (accounts, transactions,
> loans, subscriptions, bills, investments, other assets, net worth, budgets, savings goals, and
> monthly plans) are built; calendar, notes, and the AI assistant are not.

## Scope

### ✅ In scope today

- A Next.js web app with a responsive application shell (collapsible sidebar on Cmd/Ctrl+B,
  mobile drawer, command palette on Cmd/Ctrl+K, light/dark/system themes chosen in Settings) and
  placeholder sections.
- A FastAPI service with centralized configuration, health endpoints, and a database layer:
  SQLite on your machine (local mode) or PostgreSQL on Supabase (cloud mode), with SQLAlchemy and
  Alembic migrations.
- Accounts and workspaces: local accounts (several per machine in local mode) or Supabase Auth
  (cloud mode), profile photos, a default Personal workspace per user, creating, switching, and
  deleting workspaces, server-side authorization, and password reset by email for cloud
  accounts.
- Tasks, shopping lists, and reminders: one-time or recurring (daily, chosen weekdays, monthly),
  time-zone aware, optionally about a task, and delivered as in-app notifications by a
  database-backed worker.
- Finance, phase 1: hand-entered accounts (bank, cash, wallet, credit card, investment),
  income, expenses, refunds, and transfers in exact integer minor units, default categories for
  India, a monthly overview (cash flow, balances, trend, spending by category), filterable
  history, and CSV export. No bank connections.
- Finance, phase 2: loans with EMI schedules (principal paid as a transfer that reduces the
  loan's balance, interest as an expense), subscriptions and recurring bills, a unified view of
  upcoming, due, overdue, and recently paid payments, commitment totals on the overview, and
  reminders before each payment.
- Finance, phase 3: investment accounts; mutual funds, stocks, and ETFs with buys, sales
  (FIFO realized gains), dividends, charges, SIP plans, and prices you enter; fixed and recurring
  deposits with estimated values and maturity reminders; other assets with dated valuations; a
  portfolio dashboard; and net worth with monthly snapshots that mark stale, missing, and
  estimated values. No live market data.
- Finance, phase 4: overall and category budgets (monthly, repeating or not, or custom dates)
  with optional rollover, spending read from the ledger (transfers, investments, savings, and
  loan principal never count), in-app alerts at thresholds you choose, history that keeps past
  amounts, and copying last month; savings goals with contributions, withdrawals, and a suggested
  monthly amount; and a monthly plan of expected income against commitments, budgets, savings,
  and investments.
- Shared tooling for linting, formatting, type checking, testing, commit conventions, and CI.

### 🚫 Explicit non-goals for now

- Calendar or notes functionality; automatically created transactions, live market prices,
  AI financial insights, or bank integrations in finance.
- Shared workspaces, invitations, password recovery for local accounts, and account linking
  between local and cloud.
- Synchronization or data migration between local and cloud storage.
- AI or LLM integration or data synchronization.
- Push, email, SMS, or mobile notifications (reminders notify in the app only).
- Containers or deployment infrastructure.

## Architecture

| Part       | Path                                                       | Stack                                                     |
| ---------- | ---------------------------------------------------------- | --------------------------------------------------------- |
| Web app    | [`apps/web`](apps/web)                                     | Next.js (App Router), React, TypeScript, Tailwind CSS v4  |
| API        | [`apps/api`](apps/api)                                     | Python 3.12, FastAPI, SQLAlchemy, Alembic, Uvicorn        |
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
pnpm db:migrate           # create the local SQLite database (apps/api/.data/, git-ignored)

pnpm dev                  # web on http://localhost:3000, API on http://localhost:8000
```

> [!TIP]
> Check the API with `curl http://localhost:8000/api/v1/health`. Interactive API docs are
> served at <http://localhost:8000/docs> outside production.

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
| `pnpm db:migrate`         | Apply database migrations to the configured database         |

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

| Area                    | Status         |
| ----------------------- | -------------- |
| Monorepo and tooling    | ✅ In place    |
| Web application shell   | ✅ In place    |
| API foundation          | ✅ In place    |
| Database (local/cloud)  | ✅ In place    |
| Accounts and workspaces | ✅ In place    |
| CI                      | ✅ In place    |
| Product features        | ⏳ Not started |
| AI integration          | ⏳ Not started |

## Contributing and security

- [Contributing guide](CONTRIBUTING.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [Security policy](SECURITY.md): please report vulnerabilities privately.

## License

Orbit is licensed under the [Apache License 2.0](LICENSE).
