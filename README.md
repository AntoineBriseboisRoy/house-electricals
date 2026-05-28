# House Electricals

A personal-use breaker-panel mapper. Deploy as a Docker Compose stack on your home server; use it from your phone over LAN or expose it through your existing reverse proxy / Cloudflare Tunnel.

Licensed under the [MIT License](LICENSE).

> **Deploying to a server?** See [`DEPLOYMENT.md`](DEPLOYMENT.md) for the full deploy guide. CI publishes images to **GitHub Container Registry (GHCR)** on every push to `main` via [`.github/workflows/release.yml`](.github/workflows/release.yml); your server pulls those images via [`compose.prod.yaml`](compose.prod.yaml).

## Prerequisites

- Docker Engine 24+ with Compose v2 (`docker compose version`).
- A host machine you control (Linux server, Pi, NAS with Container Manager, or Windows Desktop with Docker Desktop).
- For HTTPS / phone PWA: an external reverse proxy you already operate (Caddy / Nginx / Traefik) **or** a Cloudflare Tunnel. This stack itself serves plain HTTP only.

## Quick start

The fastest path: pull the pre-built image from GHCR and run it. No source clone required.

```bash
docker run -d --name house-electricals \
  -p 8070:3000 \
  -v $(pwd)/data:/data \
  ghcr.io/antoinebriseboisroy/house-electricals:latest
```

Or use Compose — copy [`compose.prod.yaml`](compose.prod.yaml) and [`.env.example`](.env.example) to your host, edit `.env`, then:

```bash
docker compose pull && docker compose up -d
```

Open `http://localhost:8070/` in a browser. That's the canonical local-testing path. (`localhost` is a "secure context" in browsers, so service workers / PWA install work without TLS.)

Building locally from source instead? Clone the repo and run `docker compose up -d --build` (uses [`docker-compose.yml`](docker-compose.yml)).

The stack is **one container, one image, one process**. Hono serves the REST API, the Vite-built PWA, and the uploaded floor-plan images all on `${HOST_PORT:-8070}`.

| Container | Image | Serves |
|---|---|---|
| `house-electricals` | distroless Node 22 + Hono + `node:sqlite` | `/api/v1/*` (REST API) · `/files/floor-plans/*` (uploaded images) · `/*` (the React PWA with SPA fallback) |

## Deployment patterns

### Behind your existing Caddy (homelab pattern)

You already have Caddy on your home server. Point it at the House Electricals port:

```Caddyfile
house-electricals.example.com {
    reverse_proxy localhost:8070
}
```

Caddy handles TLS via Let's Encrypt; the PWA installs cleanly on iOS Safari and Android Chrome with no manual cert trust needed.

### Behind Cloudflare Tunnel

In the Cloudflare Zero Trust dashboard, add a tunnel and route a hostname to `http://localhost:8070`. Cloudflare terminates TLS at its edge; you don't need to open any inbound port on your network.

### Local browser testing only

`http://localhost:8070/` from the host browser — no proxy needed. Use this for development and sanity checks.

## Configuration (`.env`)

| Variable | Description | Default |
|---|---|---|
| `HOST_PORT` | Port exposed on the host | `8070` |
| `DATA_PATH` | Where SQLite + floor-plan images live on the host | `./data` |

On a Linux host, the backend container runs as **UID 65532** (distroless nonroot). The first time you point `DATA_PATH` at a fresh directory, set ownership once:

```bash
sudo chown -R 65532:65532 /srv/house-electricals/data  # or whatever your DATA_PATH is
```

On Windows Docker Desktop this is unnecessary — the WSL/Hyper-V VFS layer handles ownership.

## Data persistence

Everything you care about lives under `DATA_PATH`:

```
${DATA_PATH:-./data}/
├── panels.db          # SQLite database
├── panels.db-wal      # WAL file (write-ahead log)
├── panels.db-shm      # shared-memory file
└── floor-plans/       # uploaded floor-plan images, content-hashed filenames
```

### Backup

```bash
docker compose down
tar czf house-electricals-backup-$(date +%F).tgz "${DATA_PATH:-./data}"
docker compose up -d
```

### Restore

```bash
docker compose down
rm -rf "${DATA_PATH:-./data}"
tar xzf house-electricals-backup-2026-05-25.tgz
docker compose up -d
```

## Common operations

```bash
# Logs
docker compose logs -f
docker compose logs -f backend

# Restart
docker compose restart

# Update after git pull
docker compose up -d --build

# Stop
docker compose down
```

## Managing breakers

On the phone PWA:

1. The home screen lists your panels. Tap a row to open `/panels/:id` — the panel-detail screen.
2. The detail screen lists the breakers in that panel, sorted by an optional **position** field (lowest first) then by slot label.
3. **Add a breaker** with the form at the top. Fields:
   - **Slot** — free-text (e.g. `1`, `A12`, `main`). Required, ≤16 chars.
   - **Amps** — integer 1–400. Required.
   - **Poles** — `single` (120V), `double` (240V), or `tandem`. Required.
   - **Position** — optional integer (≥0) used only for sorting if you want a different visual order than the slot label gives.
   - **Label** — free-text description (e.g. "Kitchen counter"). Required, ≤120 chars.
4. **Edit** or **Delete** each breaker inline. Both touch targets are at least 44 CSS px high.
5. **Delete this panel** (bottom of the detail screen) cascades: every breaker on the panel is removed in the same SQLite transaction. There is no soft-delete and no undo.

REST routes (for direct API use or future integrations):

| Method | Route                                      | Notes                          |
|--------|--------------------------------------------|--------------------------------|
| GET    | `/api/v1/panels`                           | List panels                    |
| POST   | `/api/v1/panels`                           | Create panel `{ name }`        |
| GET    | `/api/v1/panels/:panelId`                  | Get one panel                  |
| DELETE | `/api/v1/panels/:panelId`                  | Delete + cascade to breakers   |
| GET    | `/api/v1/panels/:panelId/breakers`         | List breakers in the panel     |
| POST   | `/api/v1/panels/:panelId/breakers`         | Create breaker                 |
| GET    | `/api/v1/breakers/:id`                     | Get one breaker                |
| PATCH  | `/api/v1/breakers/:id`                     | Partial update                 |
| DELETE | `/api/v1/breakers/:id`                     | Delete a single breaker        |

All success responses are wrapped in `{ data: T }`; errors return `{ error: { message: string } }` with an appropriate HTTP status.

## Managing components

Tap **Components** in the nav banner on the home screen to reach `/components`.

- **Add** components by type (outlet, light, switch, appliance, junction box, smoke detector, other) with a name and an optional room and notes.
- **Filter** the list by an exact (case-sensitive) room name and/or a type.
- **Edit** and **delete** inline. Touch targets are at least 44 CSS px high.
- **Assign a breaker** to each component via the per-row dropdown — options are grouped by panel (e.g. `Main panel → slot 14 · Kitchen · 20A`). Select **Unassigned** to clear the assignment. Components without a breaker show the **Unassigned** badge.
- On `/panels/:id`, each breaker row shows a chip with the number of components attached, plus a **Show** toggle that lazily loads and lists the components under that breaker.
- **Deleting a breaker keeps its components**, just marks them Unassigned. Deleting a panel cascades to its breakers and likewise leaves all those components Unassigned. There's no "are you sure your components will lose their breaker" extra prompt — Unassigned is a normal state, and the components survive intact.

REST routes:

| Method | Route                                | Notes                            |
|--------|--------------------------------------|----------------------------------|
| GET    | `/api/v1/components?room=&type=`     | Exact, case-sensitive `room=`    |
| POST   | `/api/v1/components`                 | Create                           |
| GET    | `/api/v1/components/:id`             | Get one                          |
| PATCH  | `/api/v1/components/:id`             | Partial update                   |
| DELETE | `/api/v1/components/:id`             | Delete                           |

Type values are frozen to: `outlet`, `light`, `switch`, `appliance`, `junction_box`, `smoke_detector`, `other`.

## Floor plans

Each panel can have an optional floor-plan image (PNG, JPEG, or WebP, up to 10MB). Open a panel and tap **🗺️ Floor plan** in the header to open `/panels/<id>/map`. From there:

- **Upload floor plan…** opens the file picker. Magic-byte validation: SVG is rejected.
- After upload, the image displays in a touch-friendly aspect-ratio container. Components placed on the map (via cycle-10's drag-place UX — *coming next*) appear as touch-sized pins.
- Tap any pin to highlight it and see the controlling breaker (panel + slot + label + amps) below the map.
- **Replace floor plan…** uploads a new image; the prior file is deleted from disk automatically.
- **Remove** clears the floor-plan reference and unlinks the file.

The image is served by the Node process directly from the bind-mount (`${DATA_PATH:-./data}/floor-plans/<panelId>-<sha8>.<ext>` on the host, `/data/floor-plans/<…>` inside the container). Filenames embed an 8-character content hash so re-uploads self-cache-bust without needing service-worker invalidation. Path-traversal is blocked at the route layer (filename sanitization + resolved-path-must-live-inside-dir check).

### Placing components on the map

- The map screen has an **Unplaced** list showing every component on this panel's breakers that doesn't yet have a position.
- **Press and drag** an unplaced item onto the map to place it. A ghost icon follows your finger; releasing inside the floor-plan area drops the pin at that spot. Releasing outside cancels (no PATCH).
- **Drag a placed pin** to move it. Same rule: release inside the map to commit, release outside to cancel.
- Tap a pin to select it; the selected callout shows the controlling breaker and a **Remove from map** button that returns the component to the Unplaced list (the assignment to its breaker is preserved — only the position is cleared).

Position is stored as normalized 0–10000 integers relative to the image's natural dimensions, so a pin renders at the same logical spot regardless of viewport size.

## Breaker-test workflow

When you're standing at the panel, open `/panels/<id>/test` from a panel's detail screen (the ⚡ **Test mode** link in the header). The screen has two modes that live on the same page:

**Verify mode (default).** Tap **Mark off** on a breaker; the components assigned to it dim with a "Currently off" badge and a strikethrough. Flip the matching breaker physically — if the right things went dark in real life, your mapping is correct. Tap **Restore** to clear. Toggle as many breakers as you like; the "off" state is purely client-side and resets on screen unmount, on `docker compose` reload, or after the tab has been hidden for more than 10 seconds (so the flashlight-app-switch case doesn't leave you with stale state).

**Track mode.** Tap **Track** on a breaker — that one breaker pulses, and now every component on the page is a tappable target. Walk through your house tapping outlets and lights that just lost power; each tap PATCHes `breakerId = <tracked breaker>` for that component. Each pending tap shows a **Saving…** badge until the server confirms. Failed taps (LAN drops, server restarts) auto-retry twice with 250ms linear backoff and then surface as a dismissible banner at the top of the components section. Tap **Stop tracking** to leave the mode; successful taps are already saved.

Wake-lock keeps the screen on while you're testing (best-effort — works on iOS Safari 16.4+ and Android Chrome; silently ignored elsewhere). The test screen does not consume battery beyond a normal foreground tab.

Test mode never persists anything except the explicit `breakerId` assignments made in track mode.

## Updating

```bash
git pull
docker compose up -d --build
```

The bind-mount means your SQLite database and floor-plan images survive image rebuilds.

## Stopping / removing

```bash
docker compose down              # stop + remove containers, keep volumes
docker compose down --volumes    # also wipe named volumes (data on bind-mounts is untouched)
```

## Project layout

```
.
├── docker-compose.yml          # local build-from-source: one service, one image
├── compose.prod.yaml           # production: pulls the prebuilt GHCR image
├── .env.example                # HOST_PORT, DATA_PATH, IMAGE
├── packages/
│   ├── shared/                 # @he/shared — types + ULID factory + Repository interface
│   ├── backend/                # Node 22 + Hono + node:sqlite
│   │   └── Dockerfile          # multi-stage: build frontend + backend → distroless runtime
│   └── frontend/               # Vite + React + TS + vite-plugin-pwa
├── data/                       # bind-mount → container's /data (SQLite + floor-plan images)
└── scripts/
    ├── deploy.sh               # invoked over SSH by the CI pipeline on the server
    ├── smoke-test.sh           # integration smoke (upload + fetch a floor-plan)
    └── dev/                    # local-dev helpers
```

## Local development without Docker

`docker compose up` is still the canonical *run* — but for code iteration there's a single hot-reload command:

```bash
pnpm install
pnpm dev
```

That runs all three workspace packages in parallel:

- **`@he/shared`** — `tsc --watch` rebuilds the shared types/zod schemas on save. Both backend and frontend pick up the new `.d.ts` automatically.
- **`@he/backend`** — `tsx watch` restarts the Hono server on every change. Listens on `http://127.0.0.1:3000`. Reads `./.env.dev` so the DB and floor-plan dir resolve to `./data/` (gitignored), not the docker `/data` absolute paths.
- **`@he/frontend`** — Vite dev server on `http://localhost:5173` with full HMR. Edits to React components patch the running page without losing state.

**Open `http://localhost:5173/`** — that's the dev URL. Vite proxies `/api/*` and `/files/*` to the backend, so the app's same-origin contract (the same one Hono enforces in prod via the unified image) holds in dev too. The full backend API, floor-plan uploads, SQLite writes, etc. work end-to-end against the local `./data/` directory.

What hot-reloads:

| Edit | Reload behavior |
|---|---|
| React component / CSS / shared type used by frontend | Vite HMR — instant in-page patch, state preserved when possible |
| Backend route / repo / migration | `tsx watch` full process restart (~300ms). Frontend keeps running; refresh the browser if you need to re-issue requests against the new code |
| `@he/shared` schema / type | shared rebuilds → backend restarts → frontend HMRs the new types in |

What's the same as prod:

- Same routes (`/api/v1/...`)
- Same DB engine (SQLite via `node:sqlite`)
- Same file-on-disk hashing (`<floorId>-<sha8>.<ext>`)
- Same zod validation

What's different:

- Backend runs directly under Node (not distroless container)
- Vite's dev server serves the SPA on its own port (5173) + proxies API/files to the backend on 3000. In production the same Hono process serves all three.
- Data lives at `./data/` under the repo (gitignored), not the bind-mounted host path

To wipe local dev state: `rm -rf ./data && pnpm dev` (re-creates panels.db + floor-plans/).

If you want to point the dev frontend at a different backend (e.g. a real server you're debugging against), set `BACKEND_DEV_URL`:

```bash
BACKEND_DEV_URL=https://house-electricals.example.com pnpm --filter @he/frontend dev
```

## License

MIT.
