<!--
Thanks for the contribution! Please fill this out so reviewers have context.
Security issues must NOT be reported via PR — see SECURITY.md.
-->

## What & why

<!-- What does this change and, more importantly, why? Link any related issue. -->

Closes #

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / cleanup
- [ ] Documentation
- [ ] CI / tooling

## Checklist

- [ ] `pnpm build` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm --filter @he/backend test` passes (dev Postgres running)
- [ ] Playwright e2e green, if UI changed
- [ ] No secrets, no committed `.env`, no generated artifacts
- [ ] Mobile-first preserved (touch targets ≥ 44px; no desktop-only CSS)
- [ ] No new design-token *names*; components read tokens (no hard-coded values)
- [ ] Consistent with pinned decisions in `CLAUDE.md` (or deviations explained below)

## Notes for reviewers

<!-- Screenshots for UI changes, migration notes, anything non-obvious. -->
