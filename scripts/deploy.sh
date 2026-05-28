#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# House Electricals — server-side deploy script
# ─────────────────────────────────────────────────────────────────────────────
# Invoked over SSH by the GitHub Actions CI pipeline
# (.github/workflows/release.yml). The SSH key on the server is restricted
# via `command=` in authorized_keys, so this script is the ONLY thing the
# deployer user can run — see docs/CI-CD-SETUP.md.
#
# Expected layout on the server:
#   /srv/house-electricals/
#     compose.yaml   (copy of compose.prod.yaml from the repo)
#     .env           (HOST_PORT, DATA_PATH, IMAGE)
#     deploy.sh      (this script)
# ─────────────────────────────────────────────────────────────────────────────
set -e

cd /srv/house-electricals

echo "[deploy] Pulling latest images…"
docker compose pull

echo "[deploy] Starting services (with --remove-orphans)…"
docker compose up -d --remove-orphans

echo "[deploy] Cleaning up dangling images…"
docker image prune -f

echo "[deploy] Done."
