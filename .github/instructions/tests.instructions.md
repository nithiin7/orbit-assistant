---
applyTo: "apps/web/src/**/*.test.ts,apps/web/src/**/*.test.tsx,apps/web/vitest.setup.ts,apps/api/tests/**/*.py"
description: "Testing conventions for Vitest and Pytest suites"
---

# Tests

Follows `AGENTS.md`. Specifics:

- Test behavior: success, validation failures, errors, edge cases. Mock external services, not
  the code under test.
- Never weaken, skip, or delete tests, or change production code only to suit a broken test.
- Web (Vitest + Testing Library + jsdom): co-located `*.test.ts(x)`, query by role and name.
  Mock `next/navigation` with `vi.mock`, network with `vi.stubGlobal("fetch", …)`. Globals on in
  `vitest.config.mts`; jest-dom matchers in `vitest.setup.ts`.
- API (Pytest, `apps/api/tests/`): `client` fixture from `conftest.py` (isolated
  `create_app(Settings(...))`, with `_env_file=None` so local `.env` doesn't leak in). Warnings
  are errors; markers and config are strict.
- `tests/test_openapi.py` guards the contract; if it fails, run `pnpm contracts:generate`; don't
  edit the test.
- Playwright (`apps/web/e2e/`, `pnpm test:e2e`) for critical paths only.
- Run the narrowest tests first (`pnpm --filter @orbit/web exec vitest run <file>` or
  `cd apps/api && uv run pytest <file>`); full suites only for large changes.
