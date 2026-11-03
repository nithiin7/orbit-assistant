# Releasing Orbit

How Orbit is versioned, how changes are recorded, and what to check before tagging a release.
Nothing here publishes anything by itself: tagging and publishing are deliberate, manual steps
taken by a maintainer.

## Versioning

Orbit uses [Semantic Versioning](https://semver.org/) for the product as a whole: one version for
the API and the web app, which are released together.

- The version lives in `apps/api/pyproject.toml` (`version`, also served by
  `GET /api/v1/health`) and `apps/web/package.json`. Change both in the same commit.
- Internal packages (`packages/*`) and the root `package.json` are private and stay `0.0.0`.
- A release is a Git tag `vX.Y.Z` on `main`. Pushing it makes the Containers workflow publish
  `ghcr.io/<owner>/orbit-api` and `orbit-web` images tagged `X.Y.Z`, `X.Y`, and `latest`.

Before 1.0, a **minor** version (`0.2.0`) may contain breaking changes to the API, configuration,
or data; a **patch** version (`0.1.1`) contains only fixes. From 1.0:

| Change                                                                                                          | Bump  |
| --------------------------------------------------------------------------------------------------------------- | ----- |
| Removing or renaming an API field or route, or a setting; a backup format change that older versions can't read | major |
| New features, routes, settings, or migrations that upgrade existing data in place                               | minor |
| Fixes, documentation, and dependency updates without behavior changes                                           | patch |

Database migrations are forward-only in practice: each release's `migrate` step upgrades the
schema, and the API refuses to start on a schema it doesn't expect. Restoring an older version
means restoring a backup taken before the upgrade.

Backups record their format version and schema revision. A release must keep reading backups
from every earlier release; a backup from a newer release is refused with a clear message.

## Changelog

[`CHANGELOG.md`](../CHANGELOG.md) follows [Keep a Changelog](https://keepachangelog.com/). Add an
entry under **Unreleased** in the pull request that makes a user-visible change, in one of:
Added, Changed, Deprecated, Removed, Fixed, Security. Write for someone running Orbit, not for
contributors: what changed and what, if anything, they need to do. At release time the
Unreleased section becomes the version's section, dated.

Conventional Commit types map roughly: `feat` → Added or Changed, `fix` → Fixed, security fixes
→ Security. Internal refactors, tests, and CI changes don't need entries.

## Release checklist

Copy this list into the release pull request (the one that bumps the version) and check each
item. "Verified" means someone ran it for this release, not that it passed last time.

### Code and tests

- [ ] `main` is green: Web, API, API on PostgreSQL, End-to-end journeys, Dependency audit,
      Containers.
- [ ] `pnpm check` and `pnpm build` pass locally on a clean checkout (`pnpm install`,
      `uv sync --all-packages`).
- [ ] `pnpm test:e2e` passes locally.
- [ ] `uv run pytest -m postgres` passes against a disposable PostgreSQL database.
- [ ] `pnpm contracts:check` passes.

### Installation and upgrade

- [ ] **Clean install, local mode:** `docker compose up -d --build` on a machine with no
      `orbit-data` volume; create an account; add a task, a transaction, a note, an event, a
      document, and a habit entry.
- [ ] **Upgrade:** start the previous release's images with data in them, then switch to this
      release's images (`docker compose up -d`); the `migrate` service succeeds, the data is
      intact, and `/api/v1/health/ready` reports `ok`.
- [ ] **Cloud mode:** migrations apply to a fresh Supabase (or plain PostgreSQL) database, and
      every table has Row Level Security enabled (`test_postgres.py` checks this).
- [ ] **Backup and restore:** make a backup with a password from the upgraded installation,
      download it, restore it into a new workspace, and spot-check records and files. Restore a
      backup made by the previous release.
- [ ] Data survives `docker compose down` and `up` (the `orbit-data` volume).

### Security and dependencies

- [ ] Dependency audit job is green; open Dependabot alerts are triaged.
- [ ] No secrets in the diff since the last release (`git log -p vPREVIOUS..` reviewed, or a
      secret scanner run).
- [ ] Security-relevant changes since the last release are listed under **Security** in the
      changelog, and [`SECURITY.md`](../SECURITY.md)'s known limitations are still accurate.
- [ ] Production defaults hold: `/docs` returns 404, containers run as non-root, CORS lists
      explicit origins (the Containers smoke test checks the first two).

### Documentation

- [ ] README, [deployment](deployment.md), and [development](development.md) guides match the
      release (commands, settings, ports).
- [ ] New settings appear in `apps/api/.env.example` and, if Compose users need them,
      `.env.example`.
- [ ] [`assessment.md`](assessment.md) lists any new known risk.
- [ ] The changelog's Unreleased section is complete; move it under the new version and date.

### Tag and publish (maintainer, with explicit approval)

- [ ] Bump the version in `apps/api/pyproject.toml` and `apps/web/package.json`, run
      `uv lock`, and merge.
- [ ] Tag `main`: `git tag -a vX.Y.Z -m "Orbit X.Y.Z"` and push the tag.
- [ ] Check that the Containers workflow published both images, then create the GitHub release
      from the changelog section.
