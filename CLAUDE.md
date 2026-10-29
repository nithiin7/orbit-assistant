# CLAUDE.md

The shared project instructions are imported below and apply in full. `AGENTS.md` is canonical;
this file adds only Claude Code-specific guidance.

@AGENTS.md

## Working in Claude Code

- **Inspect before assuming.** Read the relevant code, `package.json` scripts, and
  `pyproject.toml` before making architectural claims. Read `docs/architecture.md` when a task
  touches module boundaries, the API contract, storage, or AI providers. It separates what
  exists from what is planned.
- **Discover commands from the repo.** Root `package.json` scripts are the entry points; each
  workspace's `package.json` shows what they run. Python tools run through `uv run` inside
  `apps/api`. If a shell has an unrelated `VIRTUAL_ENV`, uv warns and still uses the project
  `.venv`; the warning is harmless.
- **Plan substantial changes.** For multi-file or architectural work, state a brief plan
  (files, approach, verification) before editing. Small, obvious fixes don't need one.
- **Verify before declaring completion.** Run the narrowest relevant tests, then the checks from
  the definition of done. Report the actual results, including failures and anything not run.
- **Preserve user work.** Check `git status` first and leave unrelated changes alone. Ask before
  committing or pushing, even when a previous step was approved.
- **Subagents** in `.claude/agents/` cover frontend, backend, tests, and review. Delegate only
  when the user asks or a task clearly fits one. Use `code-reviewer` for an independent review
  of a finished change.
