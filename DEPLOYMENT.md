# Deployment

How to run House Electricals on your own server and reach it from your phone.

If you just want to try it locally, skip ahead to the [Quick Start](#quick-start) — `docker compose up -d --build` is the whole story. The rest of this document is for production deployment.

## Prerequisites

- Docker Engine 20.10+ with Compose v2 (`docker compose version`).
- 1 GB RAM minimum, 2 GB recommended.
- ~500 MB disk for the Postgres data + floor-plan images (grows with your house).
- An external reverse proxy you already operate (Caddy, Nginx, Traefik) **or** a Cloudflare Tunnel. This stack itself serves plain HTTP only.

> **Why no in-stack TLS?** This matches the HousesTracker pattern — the user already runs Caddy / Cloudflare for their other services. The compose stack stays simple (no cert-manager, no ACME), and TLS is a deployment-level concern.

## Quick Start

```bash
# Clone and enter the project
git clone <repo-url> house-electricals
cd house-electricals

# Create your .env (defaults are fine for first try)
cp .env.example .env
nano .env          # set DATA_PATH=/srv/house-electricals/data on a real server

# Launch everything (builds images from source)
docker compose up -d --build

# Check status
docker compose ps
```

The app is now reachable at `http://<your-host>:8070` (or whatever `HOST_PORT` you set). Open it on your phone's browser → **Add to Home Screen** to install as a PWA.

## What Gets Deployed

Two containers: the **app** (one Node 22 process serving everything) and **Postgres**.

| Service | Container             | Image                              | Serves                                                                                   |
|---------|----------------------|------------------------------------|------------------------------------------------------------------------------------------|
| `app`   | `house-electricals`  | distroless Node 22 + Hono + `pg`   | `/api/v1/*` (REST API) · `/files/floor-plans/*` (uploaded images) · `/*` (Vite-built React PWA with SPA fallback) |
| `db`    | `house-electricals-db` | `postgres:18-alpine`             | The Postgres database — all relational data. Reachable only on the internal compose network. |

The app container runs as **UID 65532** (distroless `nonroot`). The first time you point `DATA_PATH` at a fresh directory on a Linux server, set ownership once:

```bash
sudo chown -R 65532:65532 /srv/house-electricals/data
```

On Windows Docker Desktop / WSL2 / macOS this isn't necessary — the VFS layer handles ownership.

## Configuration (`.env`)

| Variable            | Description                                                  | Default                                              |
|---------------------|--------------------------------------------------------------|------------------------------------------------------|
| `HOST_PORT`         | Port exposed on the host                                     | `8070`                                               |
| `POSTGRES_USER`     | Postgres role — seeds the `db` container **and** builds the app's `DATABASE_URL` | `postgres`                       |
| `POSTGRES_PASSWORD` | Postgres password — **set a strong value in production**     | `postgres`                                           |
| `POSTGRES_DB`       | Database name                                                | `house_electricals`                                  |
| `DATA_PATH`         | Host path holding `floor-plans/` + `.auth-secret` (relational data lives in the Postgres volume, not here) | `./data` |
| `IMAGE`             | (compose.prod.yaml only) Registry path + release channel for the unified image — **required, no default**. Channels: `:stable` (recommended), `:beta`, `:nightly`; or pin `:X.Y.Z` / `:sha-…` for a frozen rollback. See [RELEASING.md](RELEASING.md). | _e.g._ `ghcr.io/<your-github-username>/house-electricals:stable` |

There are no `AUTH_USERNAME` / `AUTH_PASSWORD` env vars. The first time you open the app in a browser, a one-time sign-up form mints the account (scrypt-hashed password stored in the Postgres `app_users` table). See [README → Login](README.md#login) for the full account lifecycle (sign-up, change password, reset).

The `POSTGRES_*` values seed the `db` container on first boot **and** are interpolated into the `DATABASE_URL` the app connects with — they must stay in sync, which is why both compose files derive `DATABASE_URL` from them rather than asking you to set it twice.

For real-server deployments use an absolute `DATA_PATH` (e.g. `/srv/house-electricals/data`), not a repo-relative path.

## Data Persistence

State lives in **two** places — both must be backed up together:

1. **The Postgres volume** (`he-pgdata`, a named Docker volume) holds all relational data: buildings, panels, breakers, components, floors, walls, rooms, switch controls, service entries, breaker tests, and the single `app_users` login row.
2. **The `DATA_PATH` bind-mount** holds filesystem state only:

```
${DATA_PATH}/
├── .auth-secret       # auto-generated HMAC secret for login session cookies (mode 600)
└── floor-plans/       # uploaded floor-plan images, content-hashed filenames
```

The `.auth-secret` file is generated on first boot and reused on every subsequent restart. Back it up alongside the Postgres volume — without it, all existing login sessions become invalid (the user signs back in with the same password; no data lost). Deleting it is a soft "log everyone out".

The single user account row lives in Postgres (`app_users` table). The account is created via the in-app sign-up screen on first boot. To reset the account (e.g. forgot the password), delete the row and reload — the sign-up screen appears again on the next visit:

```bash
docker compose exec db psql -U postgres -d house_electricals -c "DELETE FROM app_users"
```

The Postgres volume + the bind-mount both survive container rebuilds, `docker compose down`, and host reboots.

### Backup

Postgres is live — dump it with `pg_dump` rather than copying the volume directory (a file-level copy of a running database can be inconsistent). Then archive the floor-plans + auth secret separately:

```bash
# 1. Logical dump of the database (safe while running)
docker compose exec -T db pg_dump -U postgres -d house_electricals \
  | gzip > house-electricals-db-$(date +%F).sql.gz

# 2. Filesystem state (floor-plan images + auth secret)
tar czf house-electricals-files-$(date +%F).tgz "${DATA_PATH:-./data}"
```

### Restore

```bash
# 1. Restore the database (start only the db service first)
docker compose up -d db
gunzip -c house-electricals-db-2026-05-28.sql.gz \
  | docker compose exec -T db psql -U postgres -d house_electricals

# 2. Restore filesystem state
docker compose down
rm -rf "${DATA_PATH:-./data}"
tar xzf house-electricals-files-2026-05-28.tgz
docker compose up -d
```

## Common Operations

```bash
# View logs (all / single service — services are `app` and `db`)
docker compose logs -f
docker compose logs -f app
docker compose logs -f db

# Restart everything (or one service)
docker compose restart
docker compose restart app

# Stop
docker compose down

# Update after git pull (build-from-source flavor)
git pull
docker compose up -d --build

# Open a psql shell against the database
docker compose exec db psql -U postgres -d house_electricals
# e.g. SELECT COUNT(*) FROM panels;

# Health check
curl -s http://localhost:${HOST_PORT:-8070}/api/v1/health
# → {"data":{"ok":true}}
```

## Reverse Proxy (HTTPS)

The compose stack listens on plain HTTP on `HOST_PORT`. Point your reverse proxy at it.

### Caddy

```Caddyfile
house-electricals.example.com {
    reverse_proxy localhost:8070
}
```

Caddy auto-issues a Let's Encrypt cert. The PWA installs cleanly on iOS Safari / Android Chrome with no manual cert trust.

### Cloudflare Tunnel

In the Cloudflare Zero Trust dashboard, add a tunnel and route a hostname to `http://localhost:8070`. Cloudflare terminates TLS at its edge; no inbound port needs to be open on your network.

### Nginx

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

## Production deploy (CI/CD)

For "push to main → images build → server pulls and redeploys", see **[docs/CI-CD-SETUP.md](docs/CI-CD-SETUP.md)**. The pipeline shipped in this repo:

- [`.github/workflows/release.yml`](.github/workflows/release.yml) — GitHub Actions builds the unified backend + frontend image on every push to main and publishes it to **GitHub Container Registry (GHCR)** under the repo owner's namespace. Each fork publishes at `ghcr.io/<your-fork-owner>/house-electricals` automatically (the workflow uses `${{ github.repository_owner }}`). Tagged `latest` (moves with main), the full commit SHA (pinned rollback target), and the git tag if you push a `vX.Y.Z` release tag.
- A restricted-SSH `deployer` user on your server runs [`scripts/deploy.sh`](scripts/deploy.sh), which `docker compose pull`s the new images and `up -d`s them.
- The server uses `compose.prod.yaml` (renamed to `compose.yaml` on the host) — no source code on the server, only `compose.yaml`, `.env`, and `deploy.sh`.

The build-from-source path described above ("Quick Start") is still fully supported — use it for local testing, first-time setup before CI is wired up, or rapid iteration on a dev machine.

## Troubleshooting

**Containers won't start.** `docker compose logs app` — most often the app can't read `/data` because of UID 65532 ownership on a fresh Linux directory. Run `sudo chown -R 65532:65532 ${DATA_PATH}` and `docker compose restart app`. If the app logs show connection errors to the database, check `docker compose logs db` and confirm the `db` service is healthy (`docker compose ps`) — the app waits for `db` via `depends_on: condition: service_healthy`.

**Can't reach the app.** `curl -s http://localhost:${HOST_PORT:-8070}/api/v1/health` should return `{"data":{"ok":true}}`. If you get connection-refused, check `docker compose ps` for the `app` container's status. If the curl works from the host but the phone can't reach it, verify firewall rules and that the reverse proxy is forwarding to the right port.

**Healthcheck fails.** The app healthcheck pings `http://127.0.0.1:3000/api/v1/health` from inside the container. If the app hangs on startup, it's almost always waiting on the database — check `docker compose logs db` for a Postgres that failed to come up (e.g. a corrupt `he-pgdata` volume or a `POSTGRES_PASSWORD` change that doesn't match the already-initialized volume).

**Floor-plan images 404.** Floor-plan images are served by the app itself from `${DATA_PATH}/floor-plans` (mounted at `/data/floor-plans`). If that subdirectory doesn't exist on the host yet, the mount silently maps an empty directory. Create it: `mkdir -p ${DATA_PATH:-./data}/floor-plans` then `docker compose restart app`.

**`docker compose pull` fails on the server** (compose.prod.yaml mode). If your fork publishes images to a private GHCR namespace, the deployer user needs to be logged in: `sudo -u deployer docker login ghcr.io -u <github-username>` and paste a [GitHub Personal Access Token](https://github.com/settings/tokens) with the `read:packages` scope as the password. Public GHCR images don't need login. See [docs/CI-CD-SETUP.md](docs/CI-CD-SETUP.md) for the full registry setup.

**PWA doesn't offer "Add to Home Screen" on the phone.** PWA install requires a secure context: either `http://localhost:8070` from the host browser (localhost is always a secure context), **or** an HTTPS URL via your reverse proxy. Plain `http://192.168.x.y:8070` won't trigger the install prompt — that's a browser policy, not House Electricals's choice.

**Database corruption after a host crash.** Postgres is crash-safe by design (write-ahead logging + fsync), so a clean recovery on restart is the normal case. If Postgres refuses to start with a corrupt-data error, restore from your last `pg_dump` backup (see "Backup" above). Use `docker compose down` (not `kill`) before planned host shutdowns so Postgres checkpoints and shuts down cleanly.
