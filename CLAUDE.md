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
- **Python runs through uv** in `apps/api`. A warning about an unrelated `VIRTUAL_ENV` is harmless.
- **Subagents** (`.claude/agents/`): `frontend-engineer`, `backend-engineer`, `test-engineer`,
  and `code-reviewer`. Use one only when the user asks or a large task splits cleanly; give it
  the files and decisions you already know so it doesn't start cold.
- **Reports are short:** what changed and why, check results, and anything unresolved. No
  restating the diff.
