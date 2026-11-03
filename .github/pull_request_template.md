## Summary

<!-- What does this change do, and why? Link related issues (e.g. "Closes #12"). -->

## Changes

-

## Verification

<!-- How did you verify this? Commands run, screenshots for UI changes. -->

- [ ] `pnpm check` passes locally
- [ ] `pnpm build` succeeds (if the web app changed)
- [ ] Tests added or updated for new behavior
- [ ] `pnpm test:e2e` passes (if a sign-in, task, note, or search journey changed)

## Checklist

- [ ] PR title follows [Conventional Commits](https://www.conventionalcommits.org/) (e.g. `feat(web): add task list`)
- [ ] No secrets, credentials, or personal data are included
- [ ] Documentation updated where relevant
- [ ] CHANGELOG.md updated under Unreleased (if users would notice the change)
- [ ] Security and privacy considered: new routes use `CurrentUserDep`/`WorkspaceDep` (the
      authorization matrix test checks this), nothing personal is logged, and migrations
      enable RLS on new tables
