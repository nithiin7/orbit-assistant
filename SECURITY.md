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

## Handling secrets in this repository

- Never commit `.env` files or real credentials. Only `.env.example` files with placeholder
  values belong in Git.
- Variables prefixed `NEXT_PUBLIC_` are visible to anyone using the web app. Never use them for
  secrets.
- API responses and logs must not include secrets or configuration values.
- If a secret is committed by accident, treat it as compromised: revoke and rotate it
  immediately. Removing it from Git history alone is not enough.
