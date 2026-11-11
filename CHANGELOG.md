# Changelog

All notable changes to Orbit are recorded here. Orbit uses
[Semantic Versioning](https://semver.org/). Each release's entry is written by the
[Release workflow](.github/workflows/release.yml) from the Conventional Commit messages since
the previous release.

## 0.1.0

The baseline every package started from (not tagged). Releases above it are generated.

### Added

- Local-first personal assistant: a Next.js web app and a FastAPI API over SQLite (local mode)
  or PostgreSQL on Supabase (cloud mode), with local accounts or Supabase Auth, and private
  workspaces.
- Tasks, shopping lists, and reminders delivered as in-app notifications.
- Finance: accounts, income, expenses, refunds and transfers, categories, monthly reports, CSV
  export; loans, subscriptions, and bills; investments, deposits, other assets, and net worth;
  budgets, savings goals, and a monthly plan.
- Notes with a rich-text editor, folders, tags, links and backlinks, a journal, attachments,
  and Markdown import and export.
- Calendar with recurring events, task time blocks, and `.ics` export.
- Habits and routines, a documents vault with versions and expiry reminders, and health and
  fitness tracking.
- A customizable daily dashboard, a command palette, and universal search.
- An optional AI layer (off by default) with your choice of provider, grounded answers with
  citations, and actions that run only after approval.
- Google and Microsoft integrations: calendar sync, mail to tasks and notes, and file import.
- Backups (optionally password-encrypted, scheduled or on demand), restore with preview, and
  module exports and imports.
- An optional personal agent and workflows (off by default) with permission-checked tools and
  approvals.
- Docker images, a Compose stack, and an optional Caddy HTTPS proxy.
- Local accounts can change their password in Settings → Account; other sessions are signed out.
- `GET /api/v1/health/live` and `GET /api/v1/health/ready` for monitoring. Ready checks that the
  database answers and is migrated.
- Every API response carries an `X-Request-ID`, which appears in the API's logs.
  `ORBIT_LOG_FORMAT=json` writes JSON log lines.
- `ORBIT_FORWARDED_ALLOW_IPS` for running behind a reverse proxy.

### Security

- Local sign-in is rate limited: repeated failures for an account or from one address are
  refused for up to 15 minutes, and sign-ups per address are limited.
- API logs no longer include query strings, which could contain search terms or provider
  verification tokens.
- API responses send `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and
  `Cache-Control: no-store` by default. The web app sends framing, referrer, and permissions
  policies and a partial Content-Security-Policy.
- Links in rendered Markdown (assistant answers and similar) can no longer leave the app
  through paths like `/\example.com` or ones containing tabs or newlines.

### Changed

- The rich-text editor is downloaded only on the Notes page. Every other signed-in page loads
  about 198 KB less gzipped JavaScript.
- The API container's health check uses `/api/v1/health/ready`.

### Known limitations

See [SECURITY.md](SECURITY.md#security-model).
There is no voice interface, no offline multi-device sync, no shared workspaces, no account
deletion in the app, and no password recovery for local accounts.
