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
- 🗺️ **Floor-plan editor** — draw walls and rooms in-app, place pins for outlets / lights / switches with drag-and-drop
- 🔌 **Multi-panel + subpanel support** — feeder breakers cascade to subpanel components in test mode
- 🧪 **Walk-through test mode** — flip a breaker IRL, tap the components that lost power, the app records the wiring
- 🛡️ **GFCI/AFCI tracking** with monthly test reminders + printable panel-door diagram
- 📒 **Per-breaker audit log** and per-component service log
- 🌗 Dark and light themes
- 🏠 100% **self-hosted**, no cloud, no telemetry — your wiring data stays on your hardware

## Install

You need a host with [Docker Engine](https://docs.docker.com/engine/install/) 24+ and Compose v2.

Create `compose.yaml`:

```yaml
services:
  app:
    image: ghcr.io/antoinebriseboisroy/house-electricals:latest
    container_name: house-electricals
    restart: unless-stopped
    ports:
      - 8070:3000
    volumes:
      - ./data:/data
```

On Linux, prepare the data directory so the non-root container can write to it:

```bash
mkdir -p data
sudo chown -R 65532:65532 data
```

(On Docker Desktop — Windows or macOS — skip the `chown`; the VFS layer handles it.)

Start it:

```bash
docker compose up -d
```

Open **http://your-host:8070/**. On your phone, use *Add to Home Screen* to install the PWA.

## Configuration

All optional — the defaults work for a typical home server. Set under `environment:` in `compose.yaml` or in a sibling `.env` file.

| Variable | Default | Notes |
|---|---|---|
| `HOST_PORT` | `8070` | Host port the container binds to. Change the left side of `ports:` to match. |
| `DATA_PATH` | `./data` | Host directory holding the SQLite DB and uploaded floor-plan images. Back this up. |
| `IMAGE` | `ghcr.io/antoinebriseboisroy/house-electricals:latest` | Pin to a commit SHA (e.g. `:a1b2c3d…`) or a `vX.Y.Z` tag for a stable rollback target. |

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

The bind-mounted `data/` directory survives image rebuilds.

## Backup

The entire app state is one directory.

```bash
docker compose stop
tar czf house-electricals-$(date +%F).tgz data/
docker compose start
```

Restore by stopping the container, replacing `data/` with the unpacked archive, and starting again.

## Versioning

- `:latest` — moves with `master` (rolling release)
- `:vX.Y.Z` — pinned semver releases (recommended for production)
- `:<commit-sha>` — every commit (rollback target)

Browse tags on the [package page](https://github.com/AntoineBriseboisRoy/house-electricals/pkgs/container/house-electricals).

## Uninstall

```bash
docker compose down
rm -rf data/    # only if you really want to delete your wiring data
```

## More

- 📖 [DEPLOYMENT.md](DEPLOYMENT.md) — production deployment notes, additional reverse-proxy setups, troubleshooting
- 🔧 [docs/CI-CD-SETUP.md](docs/CI-CD-SETUP.md) — push-to-main → image build → server pulls (for forks that want their own CI pipeline)
- 🤖 [CLAUDE.md](CLAUDE.md) — architectural decisions and pinned contracts (for contributors)
- 📐 [VISION.md](VISION.md) — what the project is, why it exists

## Stack

Node 22 · [Hono](https://hono.dev/) · [node:sqlite](https://nodejs.org/api/sqlite.html) · React 18 · [Vite](https://vitejs.dev/) · [vite-plugin-pwa](https://vite-pwa-org.netlify.app/) · TypeScript · Playwright

## License

[MIT](LICENSE) — feel free to fork, deploy, modify.
