# Contributing to House Electricals

Thanks for your interest! This is a personal-scale, self-hostable app for
mapping a home electrical panel. Contributions are welcome — please read the
ground rules below first.

## Ground rules

- Be respectful. This project follows our [Code of Conduct](./CODE_OF_CONDUCT.md).
- **Never report security issues in a public issue or PR** — follow the
  [Security Policy](./SECURITY.md).
- **Never commit secrets.** `DATABASE_URL`, `AUTH_SECRET`, deploy keys, and
  any credentials belong in `.env` (gitignored) or your CI secret store.
  `.env.example` documents the variables without real values.

## Project layout

A pnpm workspace with three packages:

- `packages/shared` (`@he/shared`) — types, zod schemas, repository
  interfaces shared by both ends. Build it first; the others read its
  emitted `.d.ts`.
- `packages/backend` (`@he/backend`) — Hono API + PostgreSQL access (`pg`).
- `packages/frontend` (`@he/frontend`) — Vite + React PWA.

## Local development

Prerequisites: **Node 22+**, **pnpm 9** (`packageManager` is pinned), and
Docker (for the dev PostgreSQL container).

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d   # starts Postgres on :5433
pnpm dev                                          # all three packages in watch mode
```

Frontend dev server: http://localhost:5173 — it proxies `/api/*` and
`/files/*` to the backend, preserving the same-origin contract.

## Before you open a PR

Run the full gate locally — CI runs the same checks:

```bash
pnpm build       # topological build; catches type-emit + Vite breaks
pnpm typecheck
pnpm --filter @he/backend test   # needs the dev Postgres running
```

For frontend/UX changes, also run the Playwright e2e suite:

```bash
cd packages/frontend
pnpm exec playwright install chromium   # first time only
pnpm test:e2e
```

## Conventions

- **Commits**: Conventional Commits style (`feat:`, `fix:`, `refactor:`,
  `docs:`, `chore:`). Keep them scoped and descriptive.
- **No new design tokens by name.** The design system reads from
  `packages/frontend/src/ui/tokens.css`; add values, not new token *names*,
  without discussion. Never hard-code a color/spacing/radius in a component.
- **Database access goes through the `Repository` interfaces** — never query
  `pg` directly from a route. All SQL uses positional `$1, $2` placeholders.
- **Respect the pinned architecture decisions** documented in `CLAUDE.md`
  (URL conventions, cascade semantics, frozen enums, mobile-first). If a
  change contradicts one, call it out explicitly in the PR.
- Keep it **mobile-first** — touch targets ≥ 44px; no desktop-only CSS.

## Pull request checklist

- [ ] `pnpm build`, `pnpm typecheck`, and backend tests pass.
- [ ] e2e suite green (if UI changed).
- [ ] No secrets, no committed `.env`, no generated artifacts.
- [ ] PR description explains the *why*, not just the *what*.

## License

By contributing, you agree your contributions are licensed under the
project's [MIT License](../LICENSE).
