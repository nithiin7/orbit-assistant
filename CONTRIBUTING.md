# Contributing to Orbit

Thanks for your interest in Orbit! This guide explains how to propose changes.

## Ground rules

- Be respectful. Everyone participating is expected to follow the
  [Code of Conduct](CODE_OF_CONDUCT.md).
- Orbit is **privacy-first**. Changes that collect, transmit, or store personal data need a
  clear justification in the pull request.
- Never commit secrets, credentials, or real personal data, including in tests and fixtures.
- Report security issues privately, as described in [SECURITY.md](SECURITY.md).

## Workflow

1. **Discuss first** for anything non-trivial: open an issue (or comment on an existing one)
   before starting work.
2. **Set up** your environment using the [development guide](docs/development.md).
3. **Branch** from `main` using a descriptive name with a type prefix, for example
   `feat/task-list` or `fix/api-cors-origins`.
4. **Make focused changes.** One logical change per pull request. Include tests for new
   behavior.
5. **Run the checks** before pushing:

   ```bash
   pnpm check   # lint, format check, type check, tests
   pnpm build   # if you changed the web app
   ```

6. **Open a pull request** against `main` and fill in the template. CI must pass before merge.

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/). A `commit-msg` hook
validates every message.

```text
<type>(<optional scope>): <short imperative summary>
```

| Type       | Use for                                          |
| ---------- | ------------------------------------------------ |
| `feat`     | A new user-facing feature                        |
| `fix`      | A bug fix                                        |
| `docs`     | Documentation only                               |
| `refactor` | Code change that neither fixes nor adds behavior |
| `test`     | Adding or fixing tests                           |
| `perf`     | Performance improvement                          |
| `build`    | Build system or dependency changes               |
| `ci`       | CI configuration                                 |
| `chore`    | Maintenance that fits nowhere else               |
| `style`    | Formatting-only changes                          |
| `revert`   | Reverting a previous commit                      |

Rules:

- Keep the subject short, **72 characters at most**, in the imperative mood ("add", not
  "added"), with no trailing period.
- Suggested scopes: `web`, `api`, `contracts`, `config`, `ci`, `deps`, `docs`.
- Explain _why_ in the body when it is not obvious.
- Mark breaking changes with `!` (`feat(api)!: rename health fields`) and a `BREAKING CHANGE:`
  footer.

Examples:

```text
feat(web): add responsive app shell
fix(api): validate health response
test(api): cover health endpoint
docs: document local development
```

## Code style

Formatting and linting are automated. The `pre-commit` hook fixes most issues on the files you
stage. Do not hand-format code that the tools manage.

- **TypeScript:** strict mode, ESLint (Next.js rules, sorted imports), Prettier.
- **Python:** Ruff (lint, format, import sorting), Pyright in strict mode, type hints everywhere.
- Prefer small, composable functions and the simplest abstraction that works. Avoid adding
  dependencies without discussion.

## Pull request review

Reviewers look for correctness, tests, clarity, accessibility (for UI changes), and privacy
impact. Address feedback with new commits. Maintainers may squash on merge.
