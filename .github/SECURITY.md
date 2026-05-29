# Security Policy

House Electricals is a self-hosted, single-user web app for mapping a home
electrical panel. It handles authentication, file uploads, and a PostgreSQL
database, so we take security reports seriously.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately through one of:

1. **GitHub Private Security Advisories** (preferred) — go to the
   [Security tab](https://github.com/AntoineBriseboisRoy/house-electricals/security/advisories/new)
   and click **Report a vulnerability**. This keeps the report private and
   lets us collaborate on a fix before disclosure.
2. **Email** — `jocosage@gmail.com` with the subject line
   `[security] house-electricals`.

Please include:

- A description of the vulnerability and its impact.
- Steps to reproduce (a proof-of-concept is ideal).
- The affected version / commit SHA, and your deployment topology if relevant
  (LAN-only, behind a reverse proxy, exposed to the internet, etc.).

## What to expect

- **Acknowledgement** within 5 business days.
- An assessment and, where applicable, a fix or mitigation plan.
- Coordinated disclosure: we'll agree on a timeline before any public
  write-up. Credit is given to reporters who want it.

This is a personal-scale open-source project maintained on a best-effort
basis — there is no paid bug-bounty program.

## Supported versions

Only the latest `master` and the most recent published image tag receive
security fixes. Pin and update regularly:

| Version           | Supported          |
| ----------------- | ------------------ |
| latest `master`   | :white_check_mark: |
| tagged `vX.Y.Z`   | latest only        |
| older tags        | :x:                |

## Operator security notes (self-hosters)

The app ships with sane defaults, but **how you deploy it matters**:

- **Put TLS in front of it.** The app serves plain HTTP on an internal port
  and sets the auth cookie with `Secure=false`. Terminate HTTPS at a reverse
  proxy (Caddy, nginx) or a Cloudflare Tunnel before exposing it beyond
  `localhost`. Never expose the raw HTTP port to the internet.
- **Keep PostgreSQL off the public network.** In the shipped compose files
  the database is on the internal compose network only — keep it that way.
- **Back up both secrets stores:** the `.auth-secret` file under your
  `DATA_PATH` bind-mount, and the `app_users` table in the Postgres volume.
  Deleting `.auth-secret` logs everyone out; deleting the `app_users` row
  resets to the first-boot sign-up screen.
- **Treat `DATABASE_URL`, `AUTH_SECRET`, and any deploy keys as secrets.**
  They belong in `.env` (gitignored) or your CI secret store — never in
  committed files.
- **Keep dependencies and base images current.** Enable Dependabot and apply
  the image/dependency update PRs.

## Security features already in place

For transparency, the app implements:

- Password hashing with **scrypt** (PHC-style encoded params), not plaintext
  or fast hashes.
- **Constant-time login** across the user-exists / user-missing paths to
  avoid username-enumeration timing oracles.
- Upload validation by **magic-byte sniffing** (PNG/JPEG/WebP only);
  **SVG is rejected** to avoid stored-XSS, with a 10 MB cap.
- Auth-secret **auto-generated** at first boot (48 random bytes), stored
  `0600`; no credentials in environment variables.
- All `/api/v1/*` routes (except a small public auth/health carve-out)
  gated behind a signed `HttpOnly` JWT cookie.
- Parameterized SQL throughout (`pg` positional placeholders); no string
  interpolation of user input into queries.
