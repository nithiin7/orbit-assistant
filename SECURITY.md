# Security policy

Orbit is designed to handle personal information, so security reports are taken seriously.

## Supported versions

Orbit is in early development and has no stable releases yet. Security fixes are applied to the
`main` branch.

## Reporting a vulnerability

**Do not open a public issue, discussion, or pull request for security vulnerabilities.**

Report vulnerabilities privately through GitHub's
[private vulnerability reporting](https://github.com/nithiin7/orbit-assistant/security/advisories/new).
Please include:

- A description of the issue and its potential impact.
- Steps to reproduce, or a proof of concept.
- Affected components (web app, API, tooling) and versions or commits.

You can expect an acknowledgement within a few days. We will keep you informed as the issue is
investigated and fixed, and will credit you in the advisory unless you prefer otherwise.

## Security model

Details are in [docs/architecture.md](docs/architecture.md#identity-and-authorization).

- **The API is the security boundary.** Every request except health checks and sign-in is
  authenticated from the `Authorization: Bearer` header, and workspace access is checked against
  the signed-in user on the server. Client-supplied user or workspace IDs never grant access;
  inaccessible workspaces return the same 404 as missing ones.
- **Local mode** stores passwords as Argon2id hashes and sessions as SHA-256 digests of random
  tokens, revoked on sign-out. **Cloud mode** uses Supabase Auth; the API verifies access tokens
  against the project's public keys and holds no Supabase secret.
- **Row Level Security** is enabled, with no policies, on every Orbit table in PostgreSQL, so
  Supabase's Data API exposes nothing. The API's own role is not restricted by RLS.

Known limitations (reports about them are still welcome):

- Sign-in has no rate limiting or lockout. Local mode relies on the API being bound to
  `127.0.0.1`; cloud mode relies on Supabase's limits.
- Sessions are stored in the browser's `localStorage`, readable by any script on the page.
- A Supabase access token remains valid until it expires (one hour by default) after sign-out.
- Local accounts have no password recovery.

## Handling secrets in this repository

- Never commit `.env` files or real credentials. Only `.env.example` files with placeholder
  values belong in Git.
- Variables prefixed `NEXT_PUBLIC_` are visible to anyone using the web app. Never use them for
  secrets.
- API responses and logs must not include secrets or configuration values.
- Orbit never needs the Supabase service-role key. The publishable key and project URL are
  public by design.
- If a secret is committed by accident, treat it as compromised: revoke and rotate it
  immediately. Removing it from Git history alone is not enough.
