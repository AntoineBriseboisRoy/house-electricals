# Releasing House Electricals

House Electricals ships as a single Docker image to the GitHub Container
Registry (GHCR). Releases follow a **three-channel** model so self-hosters can
choose how much stability-vs-freshness they want. This doc is the source of
truth for how the channels work and how to cut a release.

> The CI that implements this lives in `.github/workflows/release.yml`. The
> operator-facing side (how to *consume* a channel) is in `.env.example` and
> `DEPLOYMENT.md`.

## The three channels

| Channel | Cut from | Stability promise | Who should run it |
|---|---|---|---|
| **`:nightly`** | every push to `main`/`master` | newest code; may be rough | you, while developing / testing |
| **`:beta`** | a pre-release tag `vX.Y.Z-rc.N` | feature-frozen, hunting bugs | early adopters who want the next release early |
| **`:stable`** | a clean release tag `vX.Y.Z` | soak-tested | **most self-hosters (recommended)** |

`:latest` is an **alias of `:stable`** — the standard Docker convention that
`:latest` means "the newest released (soak-tested) version". It moves only when
a clean `vX.Y.Z` tag is pushed, never on a plain push to `main`.

The flow runs **right-to-left in time**: code lands on `main` → published as
`:nightly` → when a batch is ready you tag a release-candidate (`-rc.1`) → it
publishes as `:beta` and soaks → when no blocker bugs surface, you tag the
clean version → it publishes as `:stable`.

```
main ──●────●────●────●────●────●─────────►   :nightly  (and :latest)
            │                   │
            │ tag v1.4.0-rc.1   │ tag v1.4.0
            ▼                   ▼
          :beta               :stable  (+ :1.4.0  :1.4  :1)
       (+ :1.4.0-rc.1)
```

## Versioning — SemVer + pre-release suffixes

Versions follow [Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH`.

- **MAJOR** — breaking change (a deploy needs manual steps / data migration the
  operator must read about).
- **MINOR** — new feature, backward-compatible.
- **PATCH** — bug fix only.

Pre-releases hang off the next version with a hyphen and sort *before* it:

```
v1.4.0-rc.1     →  :beta      (release candidate — "we think this is it")
v1.4.0          →  :stable    (promoted after soak)
```

The commit history already uses [Conventional Commits](https://www.conventionalcommits.org)
(`feat(...)`, `fix(...)`, `feat!:`/`BREAKING CHANGE:` for major), which is what
makes the next version number obvious and a changelog easy to generate.

## What each trigger publishes

Decided entirely by the git ref shape (see the "Classify the release channel"
step in `release.yml`):

| You do… | Channel | Tags published |
|---|---|---|
| push to `main`/`master` | nightly | `:nightly` · `:latest` · `:sha-<full-sha>` |
| `git tag v1.4.0-rc.1 && git push --tags` | beta | `:beta` · `:1.4.0-rc.1` · `:sha-<full-sha>` |
| `git tag v1.4.0 && git push --tags` | stable | `:stable` · `:1.4.0` · `:1.4` · `:1` · `:sha-<full-sha>` |

The **`:sha-<full-sha>`** tag is published on *every* build and is the immutable
rollback substrate — pin it in `.env` to freeze a deployment at an exact commit.
Clean releases also move the rolling `:1.4` and `:1` pointers so an operator can
track "latest 1.4.x patch" or "latest 1.x" if they prefer.

The version pill in the app's bottom-left corner reflects the build: it parses
`git describe` (injected as a build-arg), so a `v1.4.0` tag makes the pill read
`v1.4.0`, and an `-rc.1` pre-release shows the suffix too.

## Cutting a release — step by step

Every channel is gated by the same CI job (`test` → `build-and-push`): the
backend test suite runs against a real Postgres service container and **a red
build never publishes an image**. So all you do is push the right ref.

### Ship to nightly (automatic)
Just merge to `main`. CI publishes `:nightly` (+ `:latest`, `:sha-…`). Nothing
else to do.

### Cut a beta (release candidate)
1. Make sure `main` is green and has the changes you want.
2. Tag a release candidate and push the tag:
   ```bash
   git checkout main && git pull
   git tag v1.4.0-rc.1
   git push origin v1.4.0-rc.1
   ```
3. CI publishes `:beta` + `:1.4.0-rc.1`. Point a test deployment at `:beta`
   (or pin `:1.4.0-rc.1`) and **soak it** — run it for a few days, exercise the
   real flows. Find a blocker? Fix on `main`, then tag `-rc.2`, repeat.

### Promote to stable
When an RC has soaked with no blocker bugs:
```bash
git checkout main && git pull
git tag v1.4.0          # clean — no suffix
git push origin v1.4.0
```
CI publishes `:stable` + `:1.4.0` (+ `:1.4` `:1`). Self-hosters on `:stable`
pick it up on their next `docker compose pull`.

> Tag the **same commit** the RC pointed at when you can, so `:stable` is
> bit-for-bit the thing you soak-tested. (CI rebuilds the image, but from the
> identical tree.)

### Patch / hotfix
Same as stable, bump the PATCH: land the fix on `main`, tag `v1.4.1`, push. For
an urgent fix to an *older* line while `main` has moved on, branch from the old
tag (`git checkout -b release/1.4 v1.4.0`), cherry-pick the fix, tag `v1.4.1`
from that branch, push.

## How operators consume a channel

In the server's `.env` (next to `compose.prod.yaml`):

```bash
# recommended — soak-tested releases
IMAGE=ghcr.io/<your-github-username>/house-electricals:stable

# or: early access to the next release
# IMAGE=ghcr.io/<your-github-username>/house-electricals:beta

# or: frozen rollback target (immutable)
# IMAGE=ghcr.io/<your-github-username>/house-electricals:1.4.0
```

Then `docker compose pull && docker compose up -d`. A channel pointer
(`:stable`/`:beta`/`:nightly`) moves under the operator's feet on each pull;
an immutable tag (`:1.4.0` / `:sha-…`) never does — that's your rollback anchor.

### Rolling back
Pin the previous immutable tag and re-pull:
```bash
# in .env
IMAGE=ghcr.io/<your-github-username>/house-electricals:1.3.2
# then
docker compose pull && docker compose up -d
```

## Notes / future work

- **Changelog + version automation** isn't wired yet. Because commits already
  follow Conventional Commits, a tool like `release-please` could later compute
  the next SemVer bump, generate `CHANNELS`/`CHANGELOG.md`, and open the tag PR
  automatically. Today the version is chosen by hand when you push the tag.
- **No LTS line.** A single `:stable` is the long-lived channel; if a
  maintenance line is ever needed, add a `release/X.Y` branch per the hotfix
  recipe above.
- The `docker/metadata-action` config is the single place the tag matrix is
  defined — change tags there, not by hand-tagging images.
