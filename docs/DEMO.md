# Public browser demo (GitHub Pages)

A zero-backend demo of House Electricals that runs the **real** Hono backend
in the browser, so people can try the app before self-hosting.

## How it works

GitHub Pages only serves static files — no Node, no Postgres. The demo runs the
actual production backend client-side with one swap:

- **PGlite** (Postgres compiled to WASM) replaces the `pg` connection pool. A
  `pg.Pool` look-alike (`src/demo/pglite-pool.ts`) wraps PGlite so the real
  `Db` class — and every repository, route, zod schema, and cascade — runs
  unchanged. The demo cannot drift from the shipped app: it *is* the app.
- `src/demo/bootstrap.ts` builds the real app via `buildApp({ …, auth: null })`,
  seeds sample data through the real routes, then installs a `window.fetch`
  interceptor that routes `/api/v1/*` into the in-browser app. `/api/v1/auth/*`
  gets canned responses so the no-auth backend presents as a logged-in "demo"
  user.

Everything else (panels, breakers, components, the vector map editor, load
tracking, the Impact view, JSON/CSV export) is the real code.

### Known demo limitations (by design)

- **Floor-plan images & component photos don't display.** `<img src="/files/…">`
  resource loads bypass the `window.fetch` interceptor. The vector map editor
  (walls/rooms/pins/drag-to-link) works fully — it needs no image.
- **No persistence.** Each page load is a fresh in-memory database re-seeded
  with the sample house.
- **PGlite loads from a CDN** (`cdn.jsdelivr.net`) — the demo's only runtime
  external dependency. The self-hostable product bundles everything locally and
  is unaffected. (Vite 8's bundler can't bundle PGlite's npm ESM, so the demo
  loads the browser build from jsDelivr and fetches its wasm/data explicitly.)

## Build & run locally

```bash
# Production-shape build (what deploys):
pnpm --filter @he/shared build
pnpm --filter @he/frontend build:demo
pnpm --filter @he/frontend preview:demo      # serves dist at /HouseBreaker/

# Dev server with HMR:
pnpm --filter @he/frontend dev:demo           # http://localhost:5173/HouseBreaker/
```

Both need network access for the PGlite CDN module.

## Deploy to GitHub Pages

1. Repo **Settings → Pages → Build and deployment → Source = "GitHub Actions"**.
2. Push to `master` (or run the workflow manually). `.github/workflows/deploy-demo.yml`
   builds with `DEMO_BASE=/<repo>/` and publishes `packages/frontend/dist`.
3. The demo lands at `https://<user>.github.io/<repo>/`.

The base path is derived from the repo name automatically. The SPA deep-link /
refresh support uses the standard `404.html` redirect (emitted by the build).

## Visitor analytics (GoatCounter)

1. Create a free site at <https://www.goatcounter.com> → note your site **code**
   (the `<code>` in `https://<code>.goatcounter.com`).
2. Repo **Settings → Secrets and variables → Actions → Variables** → add
   `GOATCOUNTER_CODE` = your code.
3. Re-deploy. The build injects a host-guarded snippet that counts page views
   **only** on the `*.github.io` host (forks / local previews send nothing). No
   cookie banner needed. View counts in your GoatCounter dashboard.

If `GOATCOUNTER_CODE` is unset, no analytics snippet is included.
