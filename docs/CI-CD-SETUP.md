# CI/CD Setup — GitHub Actions → GHCR → your server

Push-to-main → CI builds images → server pulls and restarts. This document
walks through wiring it up end-to-end on a self-hosted server.

The pipeline is intentionally simple:

1. You push commits to `main`.
2. GitHub Actions ([`.github/workflows/release.yml`](../.github/workflows/release.yml))
   builds the backend + web images and pushes them to **GitHub Container
   Registry (GHCR)** under your fork's namespace.
3. GitHub Actions then SSHes your server and runs a restricted deploy
   script that pulls the new images and restarts the stack.

No third-party CI or registry is required. The only GitHub feature you
need beyond a free account is GHCR (included with every account / org).

---

## Part 1 — Prerequisites

- A Linux server you control (Debian / Ubuntu / Alpine / similar) with
  Docker Engine 24+ and `docker compose` v2.
- A working SSH connection to the server from your laptop.
- A GitHub account that owns the fork of this repository.

A reverse proxy (Caddy / Nginx / Traefik / Cloudflare Tunnel) in front of
House Electricals is recommended for HTTPS but not required for the CI loop
itself.

---

## Part 2 — Make the GHCR images public (optional but recommended)

GHCR images are created **private** by default. If they stay private the
server needs a Personal Access Token to pull them. Making them public
removes that friction.

1. Push to main once so the workflow runs and creates the package
   (`ghcr.io/<your-github-username>/house-electricals`).
2. On GitHub, go to your profile → **Packages** → click the image →
   **Package settings** → **Change visibility** → Public.

If you'd rather keep them private, see Part 5 below for the server-side
`docker login` step.

---

## Part 3 — Server-side: the deployer user

The CI pipeline SSHes the server as a dedicated low-privilege user whose
only job is to run the deploy script. We restrict the SSH key with
`command="…"` in `authorized_keys` so even a stolen key can only invoke
that one script.

On the server:

```bash
# Create the user
sudo useradd -r -m -s /bin/bash -d /home/deployer deployer

# Add to docker group (required for `docker compose`)
sudo usermod -aG docker deployer

# Create the app directory
sudo mkdir -p /srv/house-electricals
sudo chown -R deployer:deployer /srv/house-electricals

# Create the data directory (separate from the app dir so backup
# rules can scope to /srv/house-electricals/data without copying compose.yaml)
sudo mkdir -p /srv/house-electricals/data
sudo chown -R 65532:65532 /srv/house-electricals/data
```

The `65532:65532` ownership matches the distroless `nonroot` UID/GID the
app container runs as. Without this the container will fail to write
floor-plan images and the `.auth-secret` into `/data`. (Relational data
lives in the Postgres volume, not here.)

---

## Part 4 — Drop the deploy script on the server

Copy [`scripts/deploy.sh`](../scripts/deploy.sh) from this repo to
`/srv/house-electricals/deploy.sh`:

```bash
# From your laptop:
scp scripts/deploy.sh your-user@server:/tmp/deploy.sh
ssh your-user@server "sudo install -o deployer -g deployer -m 755 /tmp/deploy.sh /srv/house-electricals/deploy.sh && rm /tmp/deploy.sh"
```

Verify it landed with correct ownership + mode:

```bash
ssh your-user@server "ls -la /srv/house-electricals/deploy.sh"
# -rwxr-xr-x  1 deployer deployer  XXX  …  /srv/house-electricals/deploy.sh
```

---

## Part 5 — Generate the SSH key for CI

On your laptop:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/house-electricals-deploy -C "house-electricals-ci@github" -N ""
```

This produces:
- `~/.ssh/house-electricals-deploy`     → the private key (goes into a GitHub Secret)
- `~/.ssh/house-electricals-deploy.pub` → the public key (goes into the server)

Append the public key to the deployer user's `authorized_keys` with a
`command=` restriction so it can ONLY run the deploy script:

```bash
# From your laptop:
PUBKEY=$(cat ~/.ssh/house-electricals-deploy.pub)
ssh your-user@server "
  sudo mkdir -p /home/deployer/.ssh &&
  echo 'command=\"/srv/house-electricals/deploy.sh\",no-port-forwarding,no-X11-forwarding,no-agent-forwarding ${PUBKEY}' | sudo tee -a /home/deployer/.ssh/authorized_keys &&
  sudo chown -R deployer:deployer /home/deployer/.ssh &&
  sudo chmod 700 /home/deployer/.ssh &&
  sudo chmod 600 /home/deployer/.ssh/authorized_keys
"
```

Verify the restriction:

```bash
ssh -i ~/.ssh/house-electricals-deploy deployer@server "whoami"
# Should print the deploy script's stdout (NOT 'deployer'). The command=
# prefix overrides anything the client sends, so even `ssh deployer@server
# bash` only runs /srv/house-electricals/deploy.sh.
```

### Server pulls a private GHCR image (skip if you made them public)

If you kept the images private, the deployer user also needs to be logged
in to GHCR. Create a [GitHub Personal Access Token (classic)](https://github.com/settings/tokens)
with **`read:packages`** scope, then:

```bash
ssh your-user@server "
  echo '<your-pat>' | sudo -u deployer docker login ghcr.io -u <github-username> --password-stdin
"
```

The Docker credentials are saved to `/home/deployer/.docker/config.json`
and persist across reboots.

---

## Part 6 — GitHub Secrets for the workflow

GHCR push uses the workflow's default `GITHUB_TOKEN`, so no secret is
needed for that. You only need to add the SSH credentials for the deploy
step.

On GitHub: **Repository → Settings → Secrets and variables → Actions →
New repository secret** for each of:

| Secret name      | Value                                                      |
|------------------|------------------------------------------------------------|
| `DEPLOY_HOST`    | Your server's hostname or IP (e.g. `server.example.com`).  |
| `DEPLOY_USER`    | `deployer`                                                 |
| `DEPLOY_KEY`     | Contents of `~/.ssh/house-electricals-deploy` (the PRIVATE key) |

> The deploy step is OPTIONAL. The shipped workflow only builds + pushes
> the images to GHCR. If you don't add the deploy secrets, run pull + up
> manually on the server (`ssh server "cd /srv/house-electricals && docker
> compose pull && docker compose up -d"`).
>
> To enable the auto-deploy step, append this snippet to
> [`.github/workflows/release.yml`](../.github/workflows/release.yml)
> and push:
>
> ```yaml
>       - name: Deploy to server via SSH
>         uses: appleboy/ssh-action@v1
>         with:
>           host: ${{ secrets.DEPLOY_HOST }}
>           username: ${{ secrets.DEPLOY_USER }}
>           key: ${{ secrets.DEPLOY_KEY }}
>           # The deployer's authorized_keys has command= bound to the
>           # script, so this `script:` value is informational only —
>           # whichever script is bound to the key actually runs.
>           script: /srv/house-electricals/deploy.sh
> ```

---

## Part 7 — Drop the compose file + .env on the server

Copy `compose.prod.yaml` to the server as `compose.yaml`:

```bash
scp compose.prod.yaml your-user@server:/tmp/compose.yaml
ssh your-user@server "sudo install -o deployer -g deployer -m 644 /tmp/compose.yaml /srv/house-electricals/compose.yaml && rm /tmp/compose.yaml"
```

Build the `.env` file from `.env.example` and copy it:

```bash
# Locally, edit a copy:
cp .env.example .env.production
# Set IMAGE to ghcr.io/<your-github-username>/house-electricals:latest
# Set DATA_PATH to /srv/house-electricals/data
# Set HOST_PORT to the port your reverse proxy will forward to (default 8070)
# Set a strong POSTGRES_PASSWORD (POSTGRES_USER / POSTGRES_DB can stay default)

scp .env.production your-user@server:/tmp/env
ssh your-user@server "
  sudo install -o deployer -g deployer -m 640 /tmp/env /srv/house-electricals/.env &&
  rm /tmp/env
"
```

Sanity-check ownership + mode:

```bash
ssh your-user@server "ls -la /srv/house-electricals/"
# Expected:
#   -rw-r--r-- deployer deployer compose.yaml
#   -rw-r----- deployer deployer .env
#   -rwxr-xr-x deployer deployer deploy.sh
#   drwxr-xr-x 65532    65532    data/
```

---

## Part 8 — First deploy + rollback

Push any commit to `main` and watch GitHub Actions run. The two image-build
jobs run in parallel; total wall time is typically 2-4 minutes on the free
runners. When the workflow goes green, your server should be on the new
images.

### Pin to a specific image (rollback)

To revert to an older image:

```bash
ssh your-user@server "sudo -u deployer sed -i 's|:latest|:<commit-sha>|g' /srv/house-electricals/.env && sudo -u deployer /srv/house-electricals/deploy.sh"
```

Or edit `/srv/house-electricals/.env` directly and replace `:latest` with the
full commit SHA (visible in the GitHub Actions run summary). The full SHA
tag is published alongside `:latest` for every commit, so any commit on
main is a valid rollback target.

---

## Part 9 — Reverse proxy

The web container exposes plain HTTP on `${HOST_PORT:-8070}`. Terminate
TLS at your reverse proxy. Example Caddy:

```Caddyfile
house-electricals.example.com {
    reverse_proxy localhost:8070
}
```

Or Cloudflare Tunnel: route the hostname to `http://localhost:8070` in
the Cloudflare Zero Trust dashboard.

---

## Troubleshooting

**The workflow fails at the GHCR login step.** Check that the workflow has
`packages: write` permission (already set in the shipped workflow). If
your fork is in an organization, GHCR may have additional package
visibility settings under **Organization → Packages → Package settings**.

**The workflow succeeds but the server doesn't update.** The auto-deploy
step is opt-in (see Part 6). If you haven't added it, run the pull + up
manually: `ssh server "cd /srv/house-electricals && docker compose pull && docker compose up -d"`.

**Manual `docker compose pull` returns "denied: requested access denied"**.
The images are private and the deployer user isn't logged in. Either make
the images public (Part 2) or run the `docker login ghcr.io` step (Part 5).

**`docker compose pull` succeeds but `up -d` fails with EACCES on /data**.
The host-side `${DATA_PATH}` isn't owned by UID 65532. Fix:
`sudo chown -R 65532:65532 /srv/house-electricals/data` and rerun.

**The deploy script runs but `image prune -f` removes images I want to
keep.** `docker image prune -f` only removes **dangling** (untagged)
images — never images in use by running containers or images that still
carry a tag. If you want to be paranoid-conservative, edit
`/srv/house-electricals/deploy.sh` on the server and remove the `prune` line.
