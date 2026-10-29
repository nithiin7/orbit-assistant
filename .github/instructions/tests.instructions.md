---
applyTo: "apps/web/src/**/*.test.ts,apps/web/src/**/*.test.tsx,apps/web/vitest.setup.ts,apps/api/tests/**/*.py"
description: "Testing conventions for Vitest and Pytest suites"
---

# Tests

Follows the shared rules in `AGENTS.md`. Testing specifics:

- Test behavior, not implementation details. Cover success, validation failures, error paths,
  and edge cases. Mock external services, not the code under test.
- Never weaken, skip, or delete a test to make checks pass, and never change production code
  only to suit a broken test.
- Web (Vitest + Testing Library + jsdom): co-locate as `*.test.ts(x)` beside the code. Query by
  role and accessible name. Mock `next/navigation` with `vi.mock` and network calls with
  `vi.stubGlobal("fetch", …)`. Vitest globals are enabled in `vitest.config.mts`, and jest-dom
  matchers are registered in `vitest.setup.ts`.
- API (Pytest): tests in `apps/api/tests/`. Use the `client` fixture from `conftest.py`, which
  builds an isolated app with `create_app(Settings(...))`, and pass `_env_file=None` so local
  `.env` files don't leak in. Warnings are errors, and markers and config are strict.
- `tests/test_openapi.py` guards the shared contract. If it fails, run
  `pnpm contracts:generate`; don't edit the test.
- No end-to-end framework exists yet. Don't add one unless the task asks.
- Run the narrowest tests first, e.g.
  `pnpm --filter @orbit/web exec vitest run <file>` or `cd apps/api && uv run pytest <file>`.
