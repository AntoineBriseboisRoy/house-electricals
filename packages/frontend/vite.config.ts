import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// ── Real build versioning (2026-05) ─────────────────────────────────────────
// The bundle is stamped at build time with four values, mirroring the
// canonical OSS pattern (git-describe + commit + build date, à la Docker /
// Grafana / Prometheus ldflags). Values come ENV-FIRST so CI/Docker — where
// `.git` is absent (alpine base, .dockerignore) — can inject them as
// build-args; otherwise we shell out to git for local `pnpm dev`/`build`.
//   - __APP_VERSION__  : semver from package.json (the human release marker)
//   - __GIT_DESCRIBE__ : `git describe --tags --always --dirty` (precise id —
//                        e.g. "v0.3.0", "v0.3.0-4-gabc1234", or just the SHA
//                        when untagged). Auto-increments every commit.
//   - __GIT_SHA__      : full commit SHA (short form shown in the UI)
//   - __BUILD_TIME__   : ISO-8601 build timestamp
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, 'package.json'), 'utf-8')
) as { version: string };

/** Run a git command, returning '' on any failure (no .git, no git binary). */
const git = (args: string): string => {
  try {
    return execSync(`git ${args}`, {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return '';
  }
};

const GIT_SHA = (
  process.env.GIT_SHA ||
  process.env.VITE_GIT_SHA ||
  git('rev-parse HEAD')
).trim();
const GIT_DESCRIBE = (
  process.env.GIT_DESCRIBE ||
  git('describe --tags --always --dirty') ||
  GIT_SHA.slice(0, 7)
).trim();
const BUILD_TIME = (process.env.BUILD_TIME || new Date().toISOString()).trim();

// The displayed version is TAG-DRIVEN: the nearest release tag wins, so
// `git tag v0.3 && push` makes the pill read "v0.3" (not the static
// package.json field). Strip git-describe's "-<N>-g<sha>" ahead-suffix +
// "-dirty" to recover the bare tag (e.g. "v0.3-1-g02ef0ca" → "v0.3"); fall
// back to package.json only when the repo has NO reachable tag. `v` prefix
// is dropped since the pill renders its own "v".
const TAG_FROM_DESCRIBE = GIT_DESCRIBE.replace(/-dirty$/, '').replace(
  /-\d+-g[0-9a-f]+$/,
  ''
);
const APP_VERSION = (
  /^v?\d+(\.\d+)+/.test(TAG_FROM_DESCRIBE) ? TAG_FROM_DESCRIBE : pkg.version
).replace(/^v/, '');

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'House Electricals',
        short_name: 'Electricals',
        description: 'Map your house electrical panel to outlets, lights, and appliances.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Without these two, a freshly-deployed SW installs into the
        // `waiting` state and only activates after every client closes.
        // On mobile PWAs the window is suspended (not closed), so the
        // old SW keeps serving the cached index.html + old hashed
        // bundles indefinitely — users see "stuck on old version even
        // after refresh". skipWaiting + clientsClaim makes the new SW
        // take over on the next reload after deploy.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // SW runtime cache allow-list. Rule (see CLAUDE.md):
        //   SWR only for panel/component/breaker GETs that are safe to render
        //   stale for a short while; mutations (POST/PATCH/DELETE) are not
        //   cached. Adding a new entry here requires updating CLAUDE.md.
        runtimeCaching: [
          {
            urlPattern: ({ url, request }) =>
              request.method === 'GET' &&
              (url.pathname === '/api/v1/panels' ||
                /^\/api\/v1\/panels\/[^/]+$/.test(url.pathname) ||
                /^\/api\/v1\/panels\/[^/]+\/breakers$/.test(url.pathname) ||
                /^\/api\/v1\/breakers\/[^/]+$/.test(url.pathname) ||
                url.pathname === '/api/v1/components' ||
                /^\/api\/v1\/components\/[^/]+$/.test(url.pathname)),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'he-api-swr',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 },
            },
          },
          {
            urlPattern: ({ url, request }) =>
              request.method === 'GET' && url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'he-api',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    host: '0.0.0.0',
    // Local-dev proxy: same-origin contract in prod (nginx fronts both static
    // assets + /api/* + /files/*). For `pnpm dev` we need Vite to forward the
    // backend-shaped URLs to the Node process. BACKEND_DEV_URL override lets a
    // contributor point at a remote dev backend if they want.
    proxy: {
      '/api': {
        target: process.env.BACKEND_DEV_URL ?? 'http://localhost:3000',
        changeOrigin: false,
      },
      '/files': {
        target: process.env.BACKEND_DEV_URL ?? 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
  define: {
    // Inlined at build time so the bundle has zero runtime overhead.
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __GIT_SHA__: JSON.stringify(GIT_SHA),
    __GIT_DESCRIBE__: JSON.stringify(GIT_DESCRIBE),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
