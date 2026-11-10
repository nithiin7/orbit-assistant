# CLAUDE.md

@AGENTS.md

## Claude Code specifics

- **Spend tokens on thinking, not reading.** Grep for symbols and headings, then read only the
  lines you need. Run independent searches and reads in parallel. Don't re-read files you just
  edited or re-run checks that already passed on unchanged code.
- **Find the pattern first.** Before building something, locate the closest existing feature
  (route, service, repository, hook, component, test) and mirror it, so the change fits in
  one pass.
- **Think before multi-file changes.** State the plan in a few lines, then execute without
  pausing for confirmation unless a decision is genuinely the user's.
- **Verify in order:** the touched test file, then lint and types for the touched app, then
  `pnpm check` (plus `pnpm build` for web, `pnpm contracts:check` for API surface changes).
  Run long suites once, at the end.
- **Keep tool output small.** Every line a command prints stays in context for the rest of the
  session, so:
  - Run Vitest as `DEBUG_PRINT_LIMIT=0 pnpm exec vitest run <file> 2>&1 | grep -E "Tests |×|Error"`
    (a failing Testing Library query otherwise prints the whole DOM).
  - Run `pnpm check` and `pnpm build` once, redirected to a scratchpad log; print only the exit
    code and the summary lines. Never run them twice to recover an exit code.
  - Run `eslint --fix` and `prettier --write` on touched files before the first lint check.
- **Read narrowly.** Use `grep -n` plus a line range instead of `cat` on files over ~150 lines.
  Read one reference implementation, not every similar feature.
- **Edit, don't rewrite.** Prefer targeted edits; rewrite a whole file only when most of it
  changes.
- **Python runs through uv** in `apps/api`. A warning about an unrelated `VIRTUAL_ENV` is harmless.
- **Subagents** (`.claude/agents/`): `frontend-engineer`, `backend-engineer`, `test-engineer`,
  and `code-reviewer`. Use one only when the user asks or a large task splits cleanly; give it
  the files and decisions you already know so it doesn't start cold.
- **Layouts:** module pages with several views use the side rail from AGENTS.md (mirror
  `habits-nav.tsx`), not tab strips.
- **Never touch real data.** Don't run migrations or scripts against `apps/api/.data/` or the
  database in `apps/api/.env`; work on copies. Migrations must keep data
  (`test_upgrades_keep_existing_data`); tell the user to back up before they migrate.
- **Reports are short:** what changed and why, check results, and anything unresolved. No
  restating the diff.
