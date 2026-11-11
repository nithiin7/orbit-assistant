# CLAUDE.md

@AGENTS.md

## Claude Code specifics

- **Spend tokens on thinking, not reading.** Grep for symbols and headings, then read only the
  lines you need (`grep -n` plus a range for files over ~150 lines; one reference
  implementation, not every similar feature). Run independent reads in parallel. Don't re-read
  files you just edited or re-run checks that passed on unchanged code.
- **State multi-file plans in a few lines, then execute** without pausing unless a decision is
  genuinely the user's.
- **Keep tool output small** (it stays in context):
  - Vitest: `DEBUG_PRINT_LIMIT=0 pnpm exec vitest run <file> 2>&1 | grep -E "Tests |×|Error"`
    (a failing Testing Library query otherwise prints the whole DOM).
  - Large-scope `pnpm check` / `pnpm build`: run once, redirected to a scratchpad log; print only
    the exit code and summary lines. Never rerun to recover an exit code.
  - Run `eslint --fix` and `prettier --write` on touched files before the first lint check.
- **Edit, don't rewrite**, unless most of a file changes.
- **Python runs through uv** in `apps/api`; a warning about an unrelated `VIRTUAL_ENV` is
  harmless.
- **Subagents** (`.claude/agents/`): `frontend-engineer`, `backend-engineer`, `test-engineer`,
  `code-reviewer`. Use one only when the user asks or a large task splits cleanly; hand it the
  files and decisions you already know.
- **Reports are short:** what changed and why, check results, anything unresolved; don't
  restate the diff.
