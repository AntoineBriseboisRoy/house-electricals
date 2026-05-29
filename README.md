# House Electricals

> A self-hosted, mobile-first **breaker-panel mapper** for homeowners.
> Map every outlet, light, switch, and appliance in your house to the
> breaker that controls it. Use it from your phone while you work in the
> panel.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Image](https://img.shields.io/badge/image-ghcr.io%2Fhouse--electricals-blue?logo=docker)](https://github.com/AntoineBriseboisRoy/house-electricals/pkgs/container/house-electricals)
![Build](https://github.com/AntoineBriseboisRoy/house-electricals/actions/workflows/release.yml/badge.svg)

## Features

- 📱 **Mobile-first PWA** — installs to your phone's home screen
- ⚡ **Click any component → see its breaker** — the daily-driver workflow
- 🏢 **Multiple buildings** — manage several houses/buildings in one app; switch between them from the top dropdown, and move panels or floors from one to another
- 🗺️ **Floor-plan editor** — sketch walls on a pan/zoom canvas (converging walls link; close a loop and it becomes a room), then place and drag outlet / light / switch pins
- 🔌 **Multi-panel + subpanel support** — feeder breakers cascade to subpanel components in test mode
- 🧪 **Walk-through test mode** — flip a breaker IRL, tap the components that lost power, the app records the wiring
- 🛡️ **GFCI/AFCI tracking** with monthly test reminders + printable panel-door diagram
- 📒 **Per-breaker audit log** and per-component service log
- 🔐 **Sign-up on first boot, login after** — single-user account, scrypt-hashed password, change it from the Account button in the bottom tab bar
- 🌗 Dark and light themes
- 🏠 100% **self-hosted**, no cloud, no telemetry — your wiring data stays on your hardware

## Install

You need a host with [Docker Engine](https://docs.docker.com/engine/install/) 24+ and Compose v2.

Two containers run: the app (one Node process serving the API + SPA + uploaded
images) and Postgres (all relational data). Grab the compose file and an
environment template:

```bash
mkdir -p house-electricals && cd house-electricals

# compose.prod.yaml pulls the pre-built image; save it as compose.yaml
curl -fsSL https://raw.githubusercontent.com/AntoineBriseboisRoy/house-electricals/master/compose.prod.yaml -o compose.yaml
curl -fsSL https://raw.githubusercontent.com/AntoineBriseboisRoy/house-electricals/master/.env.example     -o .env
```

All configuration lives in `.env` (compose interpolates it automatically, so the
app and database credentials can never drift apart). Open it and set at least:

- **`IMAGE`** — required, no default. Your fork's image, e.g. `ghcr.io/<your-github-username>/house-electricals:latest`.
- **`POSTGRES_PASSWORD`** — use a strong value.
- **`DATA_PATH`** — host directory for floor-plan uploads + `.auth-secret` (an absolute path in production, e.g. `/srv/house-electricals/data`).

Everything else (`HOST_PORT`, `POSTGRES_USER`, `POSTGRES_DB`) has a sensible default.

On Linux, prepare the data directory so the non-root container (UID 65532) can write to it — point this at your `DATA_PATH`:

```bash
mkdir -p data
sudo chown -R 65532:65532 data
```

(On Docker Desktop — Windows or macOS — skip the `chown`; the VFS layer handles it.)

Start it:

```bash
docker compose up -d
```

> The committed compose files mount the Postgres volume at `/var/lib/postgresql`
> (Postgres 18+ stores its cluster in a version-specific subdirectory and refuses
> to start if the volume is mounted at the older `.../data` path).

Open **http://your-host:8070/**. The very first visit shows a **sign-up screen** — pick a username and password (8+ characters). After that, every visit goes to the login screen. On your phone, use *Add to Home Screen* to install the PWA.

## Login

Every screen sits behind a single-user login gate.

- **First-boot sign-up.** The first time you open the app, a sign-up form appears (no user exists yet). Pick a username + password; the password is hashed with scrypt and stored in Postgres (the `app_users` table). Subsequent visits go to the login screen.
- **No env vars to set.** There is no `AUTH_PASSWORD` — credentials live in the database, not the environment.
- **Change password from the app.** Tap the Account button in the bottom tab bar → Change password.
- **`data/.auth-secret`** is auto-generated on first boot (mode 600) and used to sign session cookies. Back it up alongside the Postgres volume. Deleting it invalidates every active session (user row is untouched — they sign back in with the same password).
- **Forgot your password?** Sessions are 30 days. To reset, delete the user row and reload — first visit shows sign-up again: `docker compose exec db psql -U postgres -d house_electricals -c "DELETE FROM app_users"`. (No e-mail-based recovery flow, by design.)

There is no public sign-up beyond the first user, no second account, no roles. This is a single-user app on a LAN — the password protects the data from a casual visitor on your network, not from a determined attacker. Put it behind HTTPS (see below) before exposing it to the internet.

## Configuration

Set under `environment:` in `compose.yaml` or in a sibling `.env` file.

| Variable | Default | Notes |
|---|---|---|
| `HOST_PORT` | `8070` | Host port the container binds to. Change the left side of `ports:` to match. |
| `POSTGRES_USER` | `postgres` | Postgres role. Seeds the `db` container **and** builds the app's `DATABASE_URL` — keep them in sync. |
| `POSTGRES_PASSWORD` | `postgres` | Postgres password. **Set a strong value in production.** |
| `POSTGRES_DB` | `house_electricals` | Database name. |
| `DATA_PATH` | `./data` | Host directory holding floor-plan uploads + the auto-generated `.auth-secret`. (Relational data lives in the Postgres volume, not here.) Back up both. |
| `IMAGE` | _(required for `compose.prod.yaml`)_ | Your fork's GHCR image, e.g. `ghcr.io/<your-github-username>/house-electricals:latest`. Pin to a commit SHA (e.g. `:a1b2c3d…`) or a `vX.Y.Z` tag for a stable rollback target. |

## HTTPS

The container serves plain HTTP. Terminate TLS at your existing reverse proxy.

<details>
<summary>Caddy</summary>

```Caddyfile
house-electricals.example.com {
    reverse_proxy localhost:8070
}
```

</details>

<details>
<summary>Cloudflare Tunnel</summary>

In the Cloudflare Zero Trust dashboard, add a tunnel and route a hostname to `http://localhost:8070`. Cloudflare terminates TLS at its edge; no inbound port needs to be open on your network.

</details>

<details>
<summary>Nginx</summary>

```nginx
server {
    listen 443 ssl http2;
    server_name house-electricals.example.com;

    ssl_certificate     /etc/letsencrypt/live/house-electricals.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/house-electricals.example.com/privkey.pem;

    location / {
        proxy_pass         http://localhost:8070;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

</details>

## Update

```bash
docker compose pull
docker compose up -d
```

Both the `he-pgdata` Postgres volume and the bind-mounted `data/` directory survive image rebuilds.

## Backup

App state lives in **two** places — back up both:

1. The **Postgres volume** (`he-pgdata`) — all relational data: buildings,
   panels, breakers, floors, rooms, components, logs, and the user account.
2. The **`data/` directory** — uploaded floor-plan images + the
   `.auth-secret` session-signing key.

```bash
# Relational data — pg_dump the database to a SQL file.
docker compose exec -T db pg_dump -U postgres house_electricals > house-electricals-db-$(date +%F).sql

# Files — the bind-mounted data directory.
tar czf house-electricals-data-$(date +%F).tgz data/
```

Restore: recreate the stack, pipe the SQL dump back in
(`docker compose exec -T db psql -U postgres -d house_electricals < house-electricals-db-YYYY-MM-DD.sql`),
and unpack the `data/` archive in place.

## Versioning

- `:latest` — moves with `master` (rolling release)
- `:vX.Y.Z` — pinned semver releases (recommended for production)
- `:<commit-sha>` — every commit (rollback target)

Browse tags on the [package page](https://github.com/AntoineBriseboisRoy/house-electricals/pkgs/container/house-electricals).

## Uninstall

```bash
docker compose down -v   # -v also removes the he-pgdata volume (all relational data)
rm -rf data/             # only if you really want to delete floor-plan images too
```

## More

- 📖 [DEPLOYMENT.md](DEPLOYMENT.md) — production deployment notes, additional reverse-proxy setups, troubleshooting
- 🔧 [docs/CI-CD-SETUP.md](docs/CI-CD-SETUP.md) — push-to-main → image build → server pulls (for forks that want their own CI pipeline)
- 🤖 [CLAUDE.md](CLAUDE.md) — architectural decisions and pinned contracts (for contributors)
- 📐 [VISION.md](VISION.md) — what the project is, why it exists

## Stack

Node 22 · [Hono](https://hono.dev/) · [Postgres](https://www.postgresql.org/) ([pg](https://node-postgres.com/)) · React 18 · [Vite](https://vitejs.dev/) · [vite-plugin-pwa](https://vite-pwa-org.netlify.app/) · TypeScript · Playwright

## License

[MIT](LICENSE) — feel free to fork, deploy, modify.
