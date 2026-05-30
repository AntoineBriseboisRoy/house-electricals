# Security Audit — House Electricals (G46)

**Date:** 2026-05-29
**Branch:** `feat/security-audit`
**Scope:** Backend (`@he/backend` Hono + `@he/shared` zod over PostgreSQL),
auth, request handling, file uploads/imports, dependencies, HTTP headers, and a
spot-check of the frontend for client-side injection sinks.

---

## Threat model

House Electricals is a **single-user, self-hosted personal app**. It runs on a
home server, reached over the **LAN** or through the operator's own **reverse
proxy / Cloudflare Tunnel**, speaking **plain HTTP behind that proxy**. Auth is
**casual-visitor deterrence**, not a defense against a determined, authenticated
internet adversary.

The hardening here is calibrated to that model:

- **In scope:** resource-exhaustion / DoS (unbounded uploads + imports),
  injection, file-handling (path traversal, upload type confusion), dependency
  CVEs, and missing baseline HTTP security headers.
- **Deliberately light:** auth hardening favors cheap, documented,
  single-user-appropriate measures (e.g. a deployment-procedure note) over
  heavy internet-grade controls (rate-limit infrastructure, MFA, etc.).
- **Out of scope:** the operator's own TLS termination, network ACLs, and the
  trustworthiness of the proxy fronting the app.

---

## Findings

| # | Severity | Area | Location | Status |
| --- | --- | --- | --- | --- |
| 1 | HIGH | DoS — uploads/imports buffer full body before any size check (OOM-able) | `routes/floor-plans.ts`, `routes/attachments.ts`, `routes/import.ts` | **Fixed** |
| 2 | HIGH | DoS — `buildingExportSchema` arrays uncapped → unbounded INSERT loop on import | `packages/shared/src/index.ts` (`buildingExportSchema`) | **Fixed** |
| 3 | MED | Missing Content-Security-Policy header (deferred when `secureHeaders()` was first mounted) | `server.ts` (`secureHeaders` call) | **Fixed** |
| 4 | LOW | fs write/unlink of DB/payload-sourced filenames lacked the resolve-inside-dir guard the static-serve path has | `routes/floor-plans.ts`, `routes/attachments.ts`, `routes/import.ts`; new `src/safe-path.ts` | **Fixed** |
| 5 | MED | First-boot `/auth/signup` is public + first-POST-wins; docs endorse tunnel exposure without a "sign up over LAN first" warning | `DEPLOYMENT.md` | **Documented** |
| 6 | MED | No login rate-limiting / lockout | `routes/auth.ts` | Deferred — recommended |
| 7 | LOW | Auth cookie `Secure` is hard-off (correct behind a TLS proxy, but no opt-in flag) | `routes/auth.ts` | Deferred — recommended |
| 8 | LOW | No token-version / secret-epoch for selective session revocation | `auth.ts` | Deferred — recommended |
| 9 | MED | No `AUTH_SETUP_TOKEN` bootstrap gate to safely expose before sign-up | `routes/auth.ts` | Deferred — recommended |

---

## Fixes implemented

### FIX 1 (HIGH) — request-body size caps before buffering

`c.req.parseBody()` (multipart uploads) and `c.req.json()` (import) buffer the
**entire** request body into memory before any application-level size check
runs, so a multi-GB POST could OOM the process. There was no global body limit.

Added Hono's built-in `bodyLimit` middleware (`hono/body-limit`, available in
Hono 4.x — the repo pins 4.12.23) as **per-route** middleware where the body is
read:

- `POST /floors/:floorId/floor-plan` → `maxSize: 11 MB` (just above the existing
  10 MB `MAX_UPLOAD_BYTES`, so the friendly 413/400 still fires for a 10–11 MB
  file while the hard limit stops anything larger before buffering).
- `POST /components/:id/photos` and `POST /breakers/:id/photos` → `maxSize: 11 MB`.
- `POST /buildings/import` → `maxSize: 25 MB` (a real-home export is well under a
  megabyte; 25 MB is generous but finite).

Each `bodyLimit` supplies an `onError` returning the standard
`{ error: { message } }` envelope with HTTP **413**.

### FIX 2 (HIGH) — bounded import-envelope arrays

`buildingExportSchema` declared every entity array as an uncapped
`z.array(...)`, so a giant JSON could pass validation and then drive an
unbounded INSERT loop inside the import transaction. Added `.max(N)` to each
array with single-home-sane ceilings:

| array | cap | array | cap |
| --- | --- | --- | --- |
| floors | 200 | components | 100000 |
| rooms | 5000 | switchControls | 200000 |
| walls | 20000 | serviceEntries | 500000 |
| panels | 1000 | breakerTests | 500000 |
| breakers | 50000 | | |

A payload exceeding any cap fails the existing `safeParse`, so the import route
returns its existing **400 "Invalid export file."** with no behavior change for
valid payloads. `@he/shared` is rebuilt so the backend (which imports its
`dist/`) picks up the new schema.

### FIX 3 (MED) — Content-Security-Policy header

`secureHeaders()` was mounted but CSP had been deferred. Extended the call with
a conservative same-origin `contentSecurityPolicy` tuned not to break the
Vite/PWA bundle:

```
default-src 'self'
img-src 'self' data: blob:           (icon data-URIs + PhotoStrip blob: object-URLs)
style-src 'self' 'unsafe-inline'     (Vite inline <style> + inline style attrs for canvas transforms)
script-src 'self'                    (no inline scripts in the built bundle)
connect-src 'self'
object-src 'none'
base-uri 'self'
frame-ancestors 'none'
worker-src 'self' blob:              (the registered service worker)
manifest-src 'self'
```

A regression test asserts `GET /api/v1/health` carries a
`content-security-policy` header containing `default-src 'self'`.

### FIX 4 (LOW, defense-in-depth) — resolve-inside-dir guard on fs writes/unlinks

The static-serve route (`routes/dev-static.ts`) already hardens reads against
path traversal, but the **write/unlink** paths joined a DB-stored filename to a
directory and called `unlinkSync`/`writeFileSync` without that guard. Today all
those filenames are server-generated, but the import route now ingests
`floorPlan.filename` from an attacker-controlled payload.

- New `src/safe-path.ts` centralizes the guard:
  - `assertInsideDir(dir, filename)` — rejects separators / `..` / leading `.`
    / NUL bytes, resolves the path, and asserts it lives strictly inside `dir`;
    returns the absolute path or `null`.
  - `isSafeFilename(x)` + `SAFE_FILENAME_RE` (`^[A-Za-z0-9._-]+$`) for cheap
    payload validation.
- Applied `assertInsideDir` before every `unlinkSync` of a DB-sourced filename
  in `floor-plans.ts` (replace + delete) and `attachments.ts` (`DELETE
  /photos/:id`).
- **Import route:** chose the **simpler, safe option** — a payload
  `floor_plan_filename` that isn't a single safe segment is **stored as `null`**
  (with its width/height nulled too) rather than rejecting the whole import.
  This is safe because the image **bytes are not imported** (per G43 scope), so
  a preserved filename would have no file on disk anyway; the operator
  re-uploads the plan. Server-generated write filenames (the freshly hashed
  upload name) are unchanged — they're already safe by construction.

### FIX 5 (MED) — document the first-boot sign-up window

`/auth/signup` is public and first-POST-wins; building a token system tonight
was judged too invasive for unattended work. Added a prominent **"Security:
complete the first sign-up over the LAN, BEFORE exposing the app"** callout to
`DEPLOYMENT.md` (in the Login & accounts section): the operator must claim the
single account over the local network before pointing a tunnel/proxy at the
instance, and the note explains the reset levers (delete the `app_users` row +
`.auth-secret`). An `AUTH_SETUP_TOKEN` bootstrap gate is flagged as the
recommended future enhancement.

---

## Verified OK (controls confirmed during the audit)

- **Dependencies:** `pnpm audit` reports **0 vulnerabilities**.
- **SQL is fully parameterized** — every query uses `$1, $2, …` positional
  placeholders, including the building **import** route's raw INSERTs (it uses
  the transactional `Querier` with parameter arrays, never string interpolation
  of user data). The only identifier interpolation (`DB_SCHEMA`) is validated
  against a strict `^[a-z_][a-z0-9_]*$` allowlist in `index.ts`.
- **Upload type confusion is blocked:** images are accepted only after a
  **magic-byte sniff** (`image-meta.ts`) for PNG/JPEG/WebP; **SVG is explicitly
  rejected** (its embedded-script XSS risk), and a 10 MB cap + 10000×10000
  max-dimension guard are enforced.
- **Path traversal on static serve is hardened** — `routes/dev-static.ts` and
  `routes/static-spa.ts` both reject separators/`..` and verify the resolved
  path lives inside the served directory.
- **No CORS middleware** — the app is strictly same-origin (the unified Hono
  server fronts API + images + SPA), so there is no `Access-Control-Allow-*`
  surface to misconfigure.
- **No frontend XSS sinks** — no `dangerouslySetInnerHTML`, `eval(`, or
  `new Function(` anywhere in `packages/frontend/src`.
- **JWT is `alg`-pinned to HS256** (`jwt({ ..., alg: 'HS256' })` in `server.ts`)
  so an `alg: none` / algorithm-confusion downgrade is rejected; `exp` is
  enforced by the middleware (30-day cookie).
- **Password handling is sound:** scrypt with a PHC-ish encoded format
  (`scrypt$N=…,r=…,p=…$salt$hash`), `timingSafeEqual` comparison, and a
  **constant-time, enumeration-safe** login (an unknown username still runs a
  scrypt verify against a pinned placeholder hash).
- **Runtime is distroless non-root** (UID 65532) — minimal attack surface, no
  shell, no root.
- **CI uses a least-privilege `GITHUB_TOKEN`** (the release workflow's
  `packages: write` scope, default token — no broad PAT).
- **No secret logging** — `AUTH_SECRET` / passwords are never written to logs;
  startup logs only non-sensitive config (timezone, host/port, schema name).

---

## Recommended future hardening (deferred)

These were intentionally **not** built tonight; each warrants its own focused,
tested change.

1. **Login rate-limiting / lockout** (Finding 6). Add a small in-memory or
   Postgres-backed attempt counter on `/auth/login` (e.g. exponential backoff
   or a short lockout after N failures). Needs care to avoid locking out the
   legitimate single user and to handle the proxy `X-Forwarded-For` correctly;
   modest value given the single-user threat model, but cheap insurance against
   credential-stuffing once exposed.

2. **`AUTH_SETUP_TOKEN` bootstrap gate** (Finding 9). Require a one-time
   operator-supplied token on the **first** sign-up so the app can be exposed
   publicly *before* the account exists without risk of a stranger claiming it.
   This would supersede the FIX 5 documentation workaround as the primary
   control.

3. **Cookie `Secure` opt-in flag** (Finding 7). Today `Secure` is hard-off
   (correct for plain HTTP behind a TLS-terminating proxy). Add an env flag
   (e.g. `COOKIE_SECURE=1`) so operators terminating TLS at the app — or
   wanting strict cookie scoping — can set it without a code change.

4. **Token-version / secret-epoch for selective session revocation**
   (Finding 8). Embed a monotonically-incrementing token version (per user or
   global) in the JWT and check it on each request, so a single session can be
   revoked without rotating `AUTH_SECRET` (which logs everyone out).
