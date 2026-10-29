---
applyTo: "apps/web/**/*.ts,apps/web/**/*.tsx,apps/web/**/*.css"
description: "Next.js frontend conventions for apps/web"
---

# Frontend (`apps/web`)

Follows the shared rules in `AGENTS.md`. Frontend specifics:

- Next.js 16 App Router. Pages receive async `params` typed with the generated `PageProps`
  (`next typegen`, run by `pnpm --filter @orbit/web typecheck`). Docs for the installed version
  are in `apps/web/node_modules/next/dist/docs/`.
- Server Components by default. Add `"use client"` only for state, effects, event handlers, or
  browser APIs, and keep client components small.
- Layout: routes in `src/app/`, components in `src/components/` (`ui/` = small
  shadcn/ui-compatible primitives), logic in `src/lib/`. Navigation items come from
  `src/lib/navigation/navigation.ts`.
- Data access goes through typed helpers in `src/lib/api/api.ts`, using `import type` from
  `@orbit/contracts`. Don't call `fetch` against the API directly from components.
- Every data-driven view handles loading, error, empty, and success states.
- Accessibility: semantic elements, labelled controls, keyboard support, visible focus
  (`focus-visible:ring-2 focus-visible:ring-ring`), `aria-hidden="true"` on decorative icons.
- Styling: Tailwind utilities with the tokens in `src/app/globals.css`, combined with `cn()`
  from `src/lib/utils/utils.ts`. Prettier sorts classes. Keep the restrained, minimal style.
- Imports use the `@/` alias for `src/`. ESLint enforces sorted imports and type-only imports.
- Public config is read and validated in `src/lib/env/env.ts`. Only `NEXT_PUBLIC_*` values, never
  secrets.
- Verify with `pnpm lint:web`, `pnpm --filter @orbit/web typecheck`, `pnpm test:web`, and
  `pnpm build`.
