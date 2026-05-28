# Deployment

How to run House Electricals on your own server and reach it from your phone.

If you just want to try it locally, skip ahead to the [Quick Start](#quick-start) — `docker compose up -d --build` is the whole story. The rest of this document is for production deployment.

## Prerequisites

- Docker Engine 20.10+ with Compose v2 (`docker compose version`).
- 1 GB RAM minimum, 2 GB recommended.
- ~500 MB disk for the SQLite DB + floor-plan images (grows with your house).
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

A single container with one Node 22 process inside it.

| Container             | Image                                   | Serves                                                                                   |
|----------------------|----------------------------------------|------------------------------------------------------------------------------------------|
| `house-electricals`  | distroless Node 22 + Hono + node:sqlite | `/api/v1/*` (REST API) · `/files/floor-plans/*` (uploaded images) · `/*` (Vite-built React PWA with SPA fallback) |

The container runs as **UID 65532** (distroless `nonroot`). The first time you point `DATA_PATH` at a fresh directory on a Linux server, set ownership once:

```bash
sudo chown -R 65532:65532 /srv/house-electricals/data
```

On Windows Docker Desktop / WSL2 / macOS this isn't necessary — the VFS layer handles ownership.

## Configuration (`.env`)

| Variable      | Description                                                  | Default                                              |
|---------------|--------------------------------------------------------------|------------------------------------------------------|
| `HOST_PORT`   | Port exposed on the host                                     | `8070`                                               |
| `DATA_PATH`   | Host path holding `panels.db` + `floor-plans/`               | `./data`                                             |
| `IMAGE`       | (compose.prod.yaml only) Registry path for the unified image | `ghcr.io/antoinebriseboisroy/house-electricals:latest` (the maintainer's published image; override for forks) |

For real-server deployments use an absolute `DATA_PATH` (e.g. `/srv/house-electricals/data`), not a repo-relative path.

## Data Persistence

Everything you care about lives under `DATA_PATH`:

```
${DATA_PATH}/
├── panels.db          # SQLite database
├── panels.db-wal      # WAL file (write-ahead log)
├── panels.db-shm      # shared-memory file
└── floor-plans/       # uploaded floor-plan images, content-hashed filenames
```

The bind-mount means SQLite + images survive container rebuilds, `docker compose down`, and host reboots.

### Backup

```bash
docker compose down
tar czf house-electricals-backup-$(date +%F).tgz "${DATA_PATH:-./data}"
docker compose up -d
```

The `down` ensures SQLite flushes the WAL cleanly before you snapshot.

### Restore

```bash
docker compose down
rm -rf "${DATA_PATH:-./data}"
tar xzf house-electricals-backup-2026-05-26.tgz
docker compose up -d
```

## Common Operations

```bash
# View logs (all / single service)
docker compose logs -f
docker compose logs -f backend

# Restart everything (or one service)
docker compose restart
docker compose restart backend

# Stop
docker compose down

# Update after git pull (build-from-source flavor)
git pull
docker compose up -d --build

# Tail SQLite directly (read-only)
docker compose exec backend /nodejs/bin/node -e 'const d = new (require("node:sqlite").DatabaseSync)("/data/panels.db",{readOnly:true}); console.log(d.prepare("SELECT COUNT(*) FROM panels").get());'

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

- [`.github/workflows/release.yml`](.github/workflows/release.yml) — GitHub Actions builds the unified backend + frontend image on every push to main and publishes it to **GitHub Container Registry (GHCR)** under the repo owner's namespace. The maintainer publishes at `ghcr.io/antoinebriseboisroy/house-electricals`; forks publish at `ghcr.io/<your-fork-owner>/house-electricals` automatically (the workflow uses `${{ github.repository_owner }}`). Tagged `latest` (moves with main), the full commit SHA (pinned rollback target), and the git tag if you push a `vX.Y.Z` release tag.
- A restricted-SSH `deployer` user on your server runs [`scripts/deploy.sh`](scripts/deploy.sh), which `docker compose pull`s the new images and `up -d`s them.
- The server uses `compose.prod.yaml` (renamed to `compose.yaml` on the host) — no source code on the server, only `compose.yaml`, `.env`, and `deploy.sh`.

The build-from-source path described above ("Quick Start") is still fully supported — use it for local testing, first-time setup before CI is wired up, or rapid iteration on a dev machine.

## Troubleshooting

**Containers won't start.** `docker compose logs backend` — most often the backend can't read `/data` because of UID 65532 ownership on a fresh Linux directory. Run `sudo chown -R 65532:65532 ${DATA_PATH}` and `docker compose restart backend`.

**Can't reach the app.** `curl -s http://localhost:${HOST_PORT:-8070}/api/v1/health` should return `{"data":{"ok":true}}`. If you get connection-refused, check `docker compose ps` for the `web` container's status. If the curl works from the host but the phone can't reach it, verify firewall rules and that the reverse proxy is forwarding to the right port.

**Healthcheck fails.** The backend healthcheck pings `http://127.0.0.1:3000/api/v1/health` from inside the container. If the backend hangs on startup, check for SQLite lock issues — `docker compose down` then `docker compose up -d` usually clears stale `panels.db-shm` / `panels.db-wal`.

**Floor-plan images 404.** The `web` container mounts `${DATA_PATH}/floor-plans:/srv/files/floor-plans:ro`. If that subdirectory doesn't exist on the host yet, the mount silently maps an empty directory. Create it: `mkdir -p ${DATA_PATH:-./data}/floor-plans` then `docker compose restart web`.

**`docker compose pull` fails on the server** (compose.prod.yaml mode). If your fork publishes images to a private GHCR namespace, the deployer user needs to be logged in: `sudo -u deployer docker login ghcr.io -u <github-username>` and paste a [GitHub Personal Access Token](https://github.com/settings/tokens) with the `read:packages` scope as the password. Public GHCR images don't need login. See [docs/CI-CD-SETUP.md](docs/CI-CD-SETUP.md) for the full registry setup.

**PWA doesn't offer "Add to Home Screen" on the phone.** PWA install requires a secure context: either `http://localhost:8070` from the host browser (localhost is always a secure context), **or** an HTTPS URL via your reverse proxy. Plain `http://192.168.x.y:8070` won't trigger the install prompt — that's a browser policy, not House Electricals's choice.

**SQLite corruption after a host crash.** The WAL mode is normally crash-safe but if you see a corrupt database error, restore from your last backup (see "Backup" above). Going forward, use `docker compose down` before host shutdowns to ensure clean WAL checkpoints.
