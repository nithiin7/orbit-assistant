---
applyTo: "apps/web/**/*.ts,apps/web/**/*.tsx,apps/web/**/*.css"
description: "Next.js frontend conventions for apps/web"
---

# Frontend (`apps/web`)

Follows `AGENTS.md`. Specifics:

- Next.js 16 App Router: async `params` typed with generated `PageProps` (`next typegen`, run by
  `pnpm --filter @orbit/web typecheck`); version docs in `apps/web/node_modules/next/dist/docs/`.
- Server Components by default; `"use client"` only for state, effects, handlers, or browser
  APIs; keep client components small.
- `src/app/` routes, `src/components/` (`ui/` = shadcn/ui-compatible primitives), `src/hooks/`,
  `src/providers/`, `src/api/` and `src/lib/` (feature logic), `src/utils/` (generic).
  Dependencies point components → hooks → providers → api/lib. Navigation:
  `src/lib/navigation/navigation.ts`.
- Data access only through `src/api/` helpers with `import type` from `@orbit/contracts`; no
  direct `fetch` from components.
- Data views handle loading, error, empty, and success states.
- Accessible: semantic elements, labels, keyboard, `focus-visible:ring-2 focus-visible:ring-ring`,
  `aria-hidden="true"` on decorative icons.
- Tailwind with `src/styles/` tokens (colors in `tokens.css`) and `cn()` from
  `src/utils/common/common.ts`; Prettier sorts classes. Keep the warm, calm style.
- `@/` alias for `src/`; ESLint enforces sorted and type-only imports.
- Public config validated in `src/lib/env/env.ts`; only `NEXT_PUBLIC_*`, never secrets.
- Verify (AGENTS.md "Verification scope"): small: related tests, lint on changed files,
  `pnpm --filter @orbit/web typecheck`; large: add `pnpm test:web` and `pnpm build`.
