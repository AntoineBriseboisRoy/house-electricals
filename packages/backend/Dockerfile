# syntax=docker/dockerfile:1.7

# ============================================================================
# House Electricals — single-image (backend + frontend) build.
# ============================================================================
# One Docker image that serves EVERYTHING from a single Hono process:
#   - REST API at /api/v1/*
#   - User-uploaded floor-plan images at /files/floor-plans/*
#   - The Vite-built React PWA at /* (with SPA fallback to index.html)
#
# Self-host with one command (the container needs a reachable Postgres —
# supply its connection string via DATABASE_URL):
#   docker run -d --name house-electricals \
#     -p 8070:3000 \
#     -e DATABASE_URL=postgresql://user:pass@db-host:5432/house_electricals \
#     -v /srv/house-electricals/data:/data \
#     ghcr.io/OWNER/house-electricals:latest
#
# See compose.prod.yaml for the canonical reverse-proxy-friendly wiring
# (it ships a Postgres service so you don't have to run one separately).
# ============================================================================

# ── Stage 1: frontend bundle ────────────────────────────────────────────────
FROM node:26-alpine AS frontend-builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /build

# Copy ALL workspace manifests for cached install. pnpm needs to see every
# package.json to resolve symlinks correctly — leaving any out causes
# partial installs.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/backend/package.json packages/backend/
COPY packages/frontend/package.json packages/frontend/

RUN pnpm install --frozen-lockfile=false

COPY packages/shared packages/shared
COPY packages/frontend packages/frontend

# CI passes GIT_SHA as a build-arg so the frontend bundle can surface the
# deployed commit in a "force-refresh" affordance (cycle-68). Local builds
# without --build-arg still work; the SHA fallback just isn't shown.
ARG GIT_SHA=""
ENV VITE_GIT_SHA=$GIT_SHA

RUN pnpm --filter @he/shared build \
 && pnpm --filter @he/frontend build

# ── Stage 2: backend bundle ─────────────────────────────────────────────────
FROM node:26-alpine AS backend-builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /build

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/backend/package.json packages/backend/
COPY packages/frontend/package.json packages/frontend/

RUN pnpm install --frozen-lockfile=false

COPY packages/shared packages/shared
COPY packages/backend packages/backend

RUN pnpm --filter @he/shared build \
 && pnpm --filter @he/backend build \
 && pnpm --filter @he/backend deploy --prod /build/deploy

# ── Stage 3: runtime (distroless nonroot) ───────────────────────────────────
FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runtime

WORKDIR /app

# Backend bundle (dist/ + pruned production node_modules).
COPY --from=backend-builder --chown=nonroot:nonroot /build/deploy /app

# Frontend SPA — served by Hono's static-spa route at /*.
COPY --from=frontend-builder --chown=nonroot:nonroot /build/packages/frontend/dist /app/public

ENV NODE_ENV=production
# DATABASE_URL is intentionally NOT defaulted here — it carries credentials
# and is deployment-specific, so the operator MUST supply it (compose/run -e).
# DATA_DIR holds filesystem state: uploaded floor plans + the auth secret.
ENV DATA_DIR=/data
ENV FLOOR_PLAN_DIR=/data/floor-plans
ENV PUBLIC_DIR=/app/public
ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

# distroless nodejs ENTRYPOINT is already `node`; CMD provides the script.
# (No --experimental-sqlite flag — persistence is Postgres via the `pg` driver.)
CMD ["dist/index.js"]
