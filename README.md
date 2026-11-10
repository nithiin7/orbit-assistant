<div align="center">

# 🪐 Orbit

**Your personal assistant, on your own server.**

Tasks, calendar, money, notes, habits, documents, and fitness in one calm app,
with an optional AI assistant that only sees what you allow.

[![CI](https://github.com/nithiin7/orbit-assistant/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/nithiin7/orbit-assistant/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache_2.0-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white)](docs/deployment.md)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[Quick start](#quick-start) · [Features](#features) · [Self-hosting](docs/deployment.md) ·
[Contributing](CONTRIBUTING.md)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/dashboard-dark_mode.webp">
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/dashboard-light_mode.webp">
  <img src="docs/screenshots/dashboard-light_mode.webp" alt="Orbit dashboard" width="900">
</picture>

</div>

## Why Orbit

- **Private by design.** Your data stays on the server you run. Nothing leaves it unless you
  connect an AI provider or a Google or Microsoft account.
- **Everything in one place.** One search, one command palette, and one dashboard for your
  whole day.
- **AI on your terms.** Off by default. Use local models with Ollama, or bring your own OpenAI,
  Anthropic, or Gemini key. Answers cite their sources, and actions wait for your approval.
- **Easy to run.** One `docker compose up`, on SQLite or PostgreSQL.

## Features

| Module                  | What you get                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| 🏠 **Dashboard**        | Today at a glance: agenda, due tasks, habits, payments, and customizable widgets         |
| ✅ **Tasks**            | Tasks, shopping lists, and reminders, including recurring ones                           |
| 📅 **Calendar**         | Month, week, day, and agenda views, recurring events, and drag-and-drop scheduling       |
| 💰 **Finance**          | Accounts, budgets, loans, subscriptions, investments, goals, and net worth               |
| 📝 **Notes**            | Rich-text editor, folders, tags, backlinks, a daily journal, and Markdown                |
| 🔁 **Habits**           | Streaks, routines, a Today view, and history heatmaps                                    |
| 📂 **Documents**        | A personal vault with previews, versions, and expiry reminders                           |
| 💪 **Health**           | Workout logging, personal records, body measurements, nutrition, and goals               |
| 🎬 **Watchlist**        | Movies and series to watch, episode tracking, ratings, and a "watch tonight" picker      |
| 🔖 **Saved**            | Links you come back to, plus reels, videos, and articles to get to later, in collections |
| 🔍 **Search**           | One search across every module, from anywhere with <kbd>Cmd/Ctrl</kbd>+<kbd>K</kbd>      |
| ✨ **AI assistant**     | Chat with your data, summaries and drafts, and automations you approve                   |
| 🔗 **Integrations**     | Google and Microsoft calendars, mail, and files                                          |
| 🛡️ **Backup & restore** | Encrypted, scheduled backups and exports to JSON, CSV, iCalendar, and Markdown           |

## Screenshots

<table>
  <tr>
    <td align="center"><img src="docs/screenshots/dashboard-light_mode.webp" alt="Dashboard in light mode"><br><sub>Dashboard, light</sub></td>
    <td align="center"><img src="docs/screenshots/dashboard-dark_mode.webp" alt="Dashboard in dark mode"><br><sub>Dashboard, dark</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/calendar.webp" alt="Calendar"><br><sub>Calendar</sub></td>
    <td align="center"><img src="docs/screenshots/health.webp" alt="Health"><br><sub>Health</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/watchlist.webp" alt="Watchlist"><br><sub>Watchlist</sub></td>
    <td align="center"><img src="docs/screenshots/saved.webp" alt="Saved links"><br><sub>Saved</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/assistant.webp" alt="AI assistant"><br><sub>AI assistant</sub></td>
    <td align="center"><img src="docs/screenshots/automation.webp" alt="Automation"><br><sub>Automation</sub></td>
  </tr>
</table>

## Quick start

### With Docker

```bash
git clone https://github.com/nithiin7/orbit-assistant.git
cd orbit-assistant
docker compose up -d --build
```

Open <http://localhost:3000> and create your account. For HTTPS on your own domain, backups, and
upgrades, see the [deployment guide](docs/deployment.md).

### From source

Requires Node.js 24, pnpm 11, Python 3.12, and [uv](https://docs.astral.sh/uv/).

```bash
pnpm install
uv sync --all-packages
pnpm db:migrate
pnpm dev        # web on :3000, API on :8000
```

## Built with

Next.js 16 · React 19 · TypeScript · Tailwind CSS v4 · FastAPI · Python 3.12 · SQLAlchemy ·
SQLite or PostgreSQL

## Documentation

- [Deployment](docs/deployment.md): self-hosting, HTTPS, and upgrades
- [Integrations](docs/integrations.md): connecting Google and Microsoft
- [Development](docs/development.md): local setup, configuration, and tests
- [Architecture](docs/architecture.md): how Orbit is built

## Contributing

Contributions are welcome. Read the [contributing guide](CONTRIBUTING.md) and the
[code of conduct](CODE_OF_CONDUCT.md). Please report security issues privately as described in
the [security policy](SECURITY.md).

## License

[Apache License 2.0](LICENSE)
