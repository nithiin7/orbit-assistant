# Engineering maturity and security assessment

Assessment date: 2026-11-03, at commit `f44a7aa` plus the remediation changes described here.
It is written for maintainers and contributors deciding whether Orbit is ready for a first public
release. It is a self-assessment by the project, **not** an independent security audit or a
certification. Nothing here guarantees the absence of vulnerabilities.

Each finding says whether it was **fixed and verified** (a test or measurement shows it), **documented** (a known
limitation, recorded where users will see it), or a **recommendation** (not done).

## Summary

Orbit is a well-structured, heavily tested pre-1.0 product. The architecture is consistent: thin routes, framework-free services, repositories that
filter by workspace, a generated API contract, and strict typing on both sides. Security
fundamentals were already in place before this review:

- Argon2id password hashes.
- Hashed session tokens.
- One authorization gate.
- Uniform 404s for inaccessible workspaces.
- Content-detected uploads.
- Defensive archive parsing.
- Encrypted provider and OAuth secrets.
- An agent whose permissions are decided in code.

The gaps were in operations and assurance: no sign-in rate limiting, no request correlation, no
readiness probe, PostgreSQL never tested in CI, an RLS test that had fallen behind the schema, a CI
timeout shorter than the test suite, and no browser tests. Those are now fixed. What remains for a
first release is mostly a set of decisions and checks only a maintainer can make: run the
container smoke test, review the licenses below, and decide on account deletion.

**No critical findings.** Five high-severity findings were found and fixed.

## Scope and method

Inspected: every backend layer (configuration, app factory, auth, authorization, repositories,
migrations, files, backups, AI, integrations, agent, worker), the web app's auth, data access,
rendering of untrusted content, bundles, and settings, CI and container configuration, and the
repository's history and metadata.

Verified by running:

- The full test suites, before and after the changes.
- The PostgreSQL suite on a local PostgreSQL 17.
- A real API server in production mode.
- A profiling script over seeded data.
- Production web builds.
- Dependency vulnerability and license scans.
- A secret-pattern scan of the Git history.
- The new browser journeys.

Not verified here:

- **Containers.** Docker isn't available on the machine used, so the image builds and Compose
  smoke test weren't run. CI runs them on every pull request.
- **Real external services.** No real AI provider, Google or Microsoft account, or Supabase
  project was contacted; those paths are tested against fakes.
- **Not in the code.** The phase brief listed a voice interface and multi-device
  synchronization. Neither exists, and neither was built (see Informational).

## Findings

| ID  | Severity | Finding                                                                                                                                                                                                 | Status                                                                                                                                                     |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | High     | Local sign-in had no rate limiting: a server exposed beyond `127.0.0.1` allowed unlimited online password guessing.                                                                                     | **Fixed, verified.** Sliding-window limits per account and per client; 429 with `Retry-After` (`test_local_auth.py`, `test_throttle.py`).                  |
| H2  | High     | CI never ran the PostgreSQL tests (cloud mode, RLS, migrations on PostgreSQL); they skip without `ORBIT_TEST_DATABASE_URL`.                                                                             | **Fixed, verified.** New CI job with a `postgres:17` service; the suite passes on PostgreSQL 17 locally (10 tests).                                        |
| H3  | High     | The RLS test checked a hand-kept list of tables that had fallen behind: tables added later (integrations, search history, agent, and others) weren't checked.                                           | **Fixed, verified.** The test now compares every table in the schema with the models; all tables have RLS enabled.                                         |
| H4  | High     | The CI API job's 10-minute timeout was shorter than the suite (11 min 5 s locally), so CI would fail or flake.                                                                                          | **Fixed, verified.** Tests copy a once-migrated database: 3 min 26 s for 1,559 tests. Timeout raised to 20 minutes.                                        |
| H5  | High     | Local accounts couldn't change their password, so a leaked password or a lost device couldn't be locked out without editing the database.                                                               | **Fixed, verified.** `POST /auth/local/password` (current password required, other sessions ended) and a Settings form; API, component, and browser tests. |
| M1  | Medium   | Uvicorn's access log wrote full query strings: search terms (personal data) and the Microsoft webhook `validationToken`.                                                                                | **Fixed, verified.** Access log off; Orbit logs method, path, status, and duration only (test and live server check).                                      |
| M2  | Medium   | No request IDs or structured logs, so a reported failure couldn't be matched to a log line.                                                                                                             | **Fixed, verified.** `X-Request-ID` on every response and log line; optional JSON logs.                                                                    |
| M3  | Medium   | Only liveness and connectivity checks; nothing reported a schema that didn't match the running version.                                                                                                 | **Fixed, verified.** `/health/live` and `/health/ready` (database and schema revision); the image health check uses readiness.                             |
| M4  | Medium   | The web app sent no security headers unless the optional Caddy proxy was used (clickjacking possible on the default install).                                                                           | **Fixed, verified.** `X-Frame-Options`, `frame-ancestors`, `nosniff`, referrer and permissions policies from `next.config.ts`.                             |
| M5  | Medium   | The rich-text editor (Tiptap, ProseMirror, highlight.js grammars; 198 KB gzipped) was loaded by the signed-in layout, so every page downloaded it.                                                      | **Fixed, measured.** Light note-link helpers split out; quick capture loads the converter on demand. The editor now loads only on `/notes`.                |
| M6  | Medium   | No browser end-to-end tests.                                                                                                                                                                            | **Fixed (partial).** Playwright with 5 journeys, run in CI. Most journeys in the brief are covered by API tests, not browser tests (see Testing).          |
| M7  | Medium   | No dependency vulnerability scanning or automated updates.                                                                                                                                              | **Fixed.** CI audit job (`pnpm audit --prod`, `pip-audit`) and Dependabot for npm, uv, Actions, and Docker.                                                |
| M8  | Medium   | Accounts can't be deleted from the app. Deleting a workspace removes its records, files, and stored backups; the account row and Personal workspace remain.                                             | **Documented** (SECURITY.md, README). Recommendation below.                                                                                                |
| M9  | Medium   | In cloud mode, AI endpoint checks against private addresses happen before each call but not at connection time, so DNS rebinding could reach internal addresses.                                        | **Documented** (SECURITY.md). Recommendation below.                                                                                                        |
| M10 | Medium   | Session tokens are in `localStorage`, and the Content-Security-Policy doesn't restrict scripts, so a script injection would expose the session.                                                         | **Documented.** Rendering is XSS-resistant (no raw HTML from data; links limited to safe schemes). Recommendation below.                                   |
| M11 | Medium   | Sign-in limits are kept in one process's memory: they reset on restart and aren't shared between API replicas. Someone who knows an email address can delay that person's sign-in for up to 15 minutes. | **Documented** (SECURITY.md, development and deployment guides).                                                                                           |
| L1  | Low      | Rendered Markdown accepted `/\host` and paths containing tabs or newlines as in-app links; browsers treat these as links to another host.                                                               | **Fixed, verified** (`markdown.test.ts`).                                                                                                                  |
| L2  | Low      | One moderate advisory (`minimatch` ReDoS) in ESLint's dependencies; development only, not shipped.                                                                                                      | **Documented**; Dependabot will propose the update.                                                                                                        |
| L3  | Low      | GitHub Actions are pinned to major tags rather than commit SHAs.                                                                                                                                        | **Recommendation.** Workflows already use read-only permissions and `pull_request`, never `pull_request_target`.                                           |
| L4  | Low      | `docs/finance-redesign/tools/` (a seed script and a screenshot tool from a finished redesign) is still tracked.                                                                                         | **Recommendation:** the maintainer decides whether to keep it.                                                                                             |
| L5  | Low      | Local accounts have no password recovery: a forgotten password means editing the database.                                                                                                              | **Documented** (existing).                                                                                                                                 |
| I1  | Info     | The phase brief lists a voice interface and multi-device synchronization. Neither exists: devices use one server through the browser, and there is no offline copy.                                     | Not built (out of scope for a maturity phase); README lists both as not built.                                                                             |
| I2  | Info     | Third-party licenses in what ships to users need a release-time review (below).                                                                                                                         | **Recommendation.**                                                                                                                                        |
| I3  | Info     | No independent security audit has been done.                                                                                                                                                            | **Documented** (SECURITY.md).                                                                                                                              |

## Strengths confirmed

- **Authorization is uniform.** An automated matrix over all 461 published operations confirms
  two things. Every operation outside a nine-entry public allowlist rejects missing and invalid
  tokens. Every one of the 425 workspace-scoped operations answers another person's workspace,
  and an unknown one, with the same `404 Workspace not found.` before reading a body. The
  victim's data is unchanged afterwards (`test_authorization_matrix.py`). Module tests
  additionally cover entity-level isolation inside workspaces.
- **Passwords and sessions:** Argon2id with rehash on sign-in, constant-time behavior for
  unknown emails, 32-byte random session tokens stored only as SHA-256 digests, expiry, and
  deletion on sign-out. Validation errors never echo submitted values.
- **Files:** uploads are read with a byte limit while streaming, typed by content rather than
  the declared type, stored outside the database under generated names, and served as downloads
  with `nosniff` and a sandboxing CSP.
- **Archives:** backups and imports are refused when they show any of the following:
  - entries outside an allowlist, or paths with `..`,
  - encrypted ZIP entries or unsupported compression,
  - suspicious compression ratios or totals over a limit,
  - parts the manifest doesn't list, or listed parts that are missing,
  - size or checksum mismatches.

  Password backups use Argon2id and AES-256-GCM. Credentials and tokens are excluded from
  backups by a catalog that must account for every table.

- **Secrets:** settings use `SecretStr` and hide input in validation errors. Provider keys and
  OAuth tokens are encrypted with Fernet keys. The browser receives only public values.
  The Git history contains no committed keys, tokens, private keys, databases, or `.env` files
  (pattern scan of every commit).
- **AI and the agent:** off by default and per person. Module read permissions are enforced on
  the server. Retrieved content is treated as data in prompts. Actions run only after an
  approval bound to the exact call by a fingerprint and revalidated before running. The
  permission decision takes no input a model can write.
- **Finance:** amounts are integer minor units end to end (`Decimal` only for display and
  quantities). The following are tested:
  - card bill payments and investing are transfers, not spending;
  - refunds are netted;
  - FIFO cost basis;
  - ledger rows that investments depend on are protected.
- **Backup and restore:** round trips cover every module, with ID remapping that preserves note
  links, tags, folders, attachments, document files, and recurring series with exceptions.
  Also covered: restore strategies, encryption, rollback on failure, snapshot consistency under
  concurrent writes, and the same on PostgreSQL.
- **Concurrency:** concurrent reminder workers deliver once, crashed leases are recovered, budget
  alerts are sent once, token refreshes happen once, and stale note saves are refused. New in
  this review, two signed-in devices writing truly concurrently were tested
  (`test_concurrent_devices.py`):
  - 40 transactions are all kept exactly once with exact balances;
  - simultaneous saves of one note keep exactly one and refuse the other with 409;
  - completing one task from both devices settles on one state;
  - signing one device out leaves the other signed in.
- **Data lifecycle:** trashed records leave AI search at once and the index on its next pass,
  turning a module off for AI removes its chunks, disconnecting an integration revokes and
  deletes its tokens, conversations and agent memory can be deleted, and deleting a workspace
  deletes its files and stored backups.
- **Deployment:** non-root images, a migrate-then-serve Compose stack, data in one volume,
  production defaults (no API docs, explicit CORS, closed registration, TLS required for cloud
  databases), and CI that smoke-tests the stack and publishes multi-architecture images with
  provenance and SBOMs only from `main` and tags.

## Testing and results

| Suite                         | Before                               | After                                             |
| ----------------------------- | ------------------------------------ | ------------------------------------------------- |
| API (Pytest, SQLite)          | 1,529 passed, 10 skipped, 11 min 5 s | 1,559 passed, 10 skipped (PostgreSQL), 3 min 26 s |
| API on PostgreSQL 17          | Not run in CI                        | 10 passed locally; CI job added                   |
| Web (Vitest)                  | 809 passed                           | 814 passed                                        |
| Browser journeys (Playwright) | None                                 | 5 passed                                          |
| Lint, format, types           | Pass                                 | Pass                                              |

The PostgreSQL tests are the 10 skipped in the SQLite run. New tests in this review cover:

- the authorization matrix,
- sign-in limits and the password change,
- readiness, request IDs, security headers, and logs without query strings,
- RLS on every table,
- concurrent devices,
- link sanitizing,
- quick capture,
- the password form.

The phase brief's journeys and where each is covered:

| Journey                          | Covered by                                                             |
| -------------------------------- | ---------------------------------------------------------------------- |
| Account and workspace            | Browser journey; `test_local_auth.py`, `test_workspaces.py`            |
| Create and complete a task       | Browser journey; `test_tasks.py`                                       |
| Recurring reminder               | `test_reminders.py`, `test_reminder_worker.py`                         |
| Financial transaction            | `test_finance.py`, `test_concurrent_devices.py`                        |
| Create and search a note         | Browser journey (quick capture and universal search); `test_notes.py`  |
| Calendar event                   | `test_calendar.py`, `test_calendar_recurrence.py`                      |
| Upload a document                | `test_documents.py`                                                    |
| Complete a habit                 | `test_habits.py`                                                       |
| Backup and restore               | `test_backups.py`, `test_postgres.py`                                  |
| Synchronize across devices       | No sync exists; `test_concurrent_devices.py` covers concurrent devices |
| Connect an external calendar     | `test_integrations.py` (fake Google and Microsoft)                     |
| Ask the AI assistant             | `test_ai.py` (fake provider)                                           |
| Execute an approved agent action | `test_agent.py`                                                        |
| Voice conversation               | Not applicable: no voice interface exists                              |

## Performance

The numbers come from profiling before optimizing, with data seeded through the API into SQLite on
a laptop: median latency over 7 requests, SQL statements per request, and response size.

At 5,000 tasks, 20,000 transactions, 3,000 notes, and 1,000 events:

| Endpoint                         | Median ms | SQL per request | Response |
| -------------------------------- | --------- | --------------- | -------- |
| Tasks list                       | 7.5       | 4               | 35 KB    |
| Finance transactions             | 4.4       | 4               | 21 KB    |
| Finance monthly summary          | 4.7       | 3               | <1 KB    |
| Finance accounts (with balances) | 19.6      | 3               | <1 KB    |
| Budgets overview                 | 4.9       | 5               | 2 KB     |
| Net worth                        | 71.1      | 16              | <1 KB    |
| Notes list                       | 7.3       | 5               | 20 KB    |
| Dashboard today                  | 14.7      | 26              | 4 KB     |
| Universal search (palette)       | 33.5      | 14              | 2 KB     |
| Universal search (results page)  | 55.3      | 24              | 7 KB     |
| Transactions CSV export          | 348       | 5               | 2 MB     |
| Calendar month (1,000 events)    | 12.4      | 7               | 168 KB   |

Lists are paginated and their query counts don't grow with the data; no N+1 patterns appeared.
At personal scale nothing needs optimizing, so no speculative backend changes were made. Watch
net worth and universal search if data grows by another order of magnitude: both scan rather
than index.

Frontend: in a production build, the editor chunk (656 KB raw, 198 KB gzipped) was referenced by
every signed-in route. After the change it is referenced only by `/notes`. Other routes now load
175 to 305 KB of gzipped JavaScript; finance, the heaviest, includes its charts.

## Open-source readiness

- **License:** Apache-2.0 is already chosen (`LICENSE`, package metadata, image labels). No
  change needed.
- **Third-party licenses:**
  - Python runtime dependencies are MIT, BSD, Apache-2.0, and PSF; none is copyleft.
  - The web app's production tree is overwhelmingly MIT, ISC, BSD, and Apache-2.0, with two
    exceptions to review before distributing images:
    - `@img/sharp-libvips-*` is LGPL-3.0-or-later. It is a prebuilt native library pulled in
      by Next.js's optional image optimization, and the web image may include it.
    - `caniuse-lite` is CC-BY-4.0 data and needs attribution.
  - Consider a third-party notices file in the images. This is an engineering note, not legal
    advice.
- **Repository hygiene:** `.gitignore` and `.dockerignore` exclude environment files, keys,
  SQLite files, data directories, and build and test output. The history scan found no secrets.
  The one test fixture with a home-directory path uses a fictional user.
- **Community files:** a README, CONTRIBUTING, a code of conduct, SECURITY (private reporting),
  issue and pull request templates, a changelog, and a release checklist exist.
- **Versioning:** SemVer for the product, with tags `vX.Y.Z` (see [release.md](release.md)).

## Remaining release blockers

These need a maintainer before a first public release:

1. Run the Containers workflow (or `docker compose up -d --build` locally) on the changes here.
   It wasn't possible on the machine used for this review.
2. Review the third-party license notes above for the published web image.
3. Decide whether account deletion (M8) is required for the first release. For a self-hosted
   single-user install, removing the data volume deletes everything; on a shared server it
   doesn't.
4. Work through the [release checklist](release.md#release-checklist), including the upgrade
   test from the last deployed version.
5. Make sure GitHub private vulnerability reporting is turned on for the repository; SECURITY.md
   points to it.

## Recommended next steps

1. **Account deletion:** delete the user row (workspaces cascade), each workspace's files and
   stored backups, and in cloud mode tell the person to delete their Supabase account too.
   Require the password in local mode.
2. **Connection-time address checks for AI providers in cloud mode (M9):** resolve once and
   connect to the checked address, or route provider traffic through an egress proxy that
   refuses private ranges.
3. **A script-restricting Content-Security-Policy (M10):** per-request nonces through Next.js
   middleware, `connect-src` limited to the API and Supabase URLs. Then consider moving local
   sessions to an `HttpOnly` cookie, which would also need CSRF protection.
4. **A shared rate-limit store** if Orbit is ever run as several API replicas.
5. **Pin GitHub Actions to commit SHAs**, and let Dependabot update them.
6. **Extend the browser journeys** to finance entry, document upload, and backup and restore
   once their dialogs have stable accessible names for every step.
7. **Commission an independent security review** before advertising Orbit for internet-facing
   multi-user deployments.
