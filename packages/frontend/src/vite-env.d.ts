/// <reference types="vite/client" />

/**
 * Cycle-68 — `VITE_GIT_SHA` is injected at build time by CI (see
 * `.github/workflows/release.yml` and `packages/backend/Dockerfile`'s
 * frontend-builder stage) so the running PWA can display the deployed
 * commit and offer a force-refresh affordance. Falls back to `undefined`
 * in local dev (the UI renders "dev" then).
 */
interface ImportMetaEnv {
  readonly VITE_GIT_SHA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
