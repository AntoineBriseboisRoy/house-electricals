import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Cycle-83 — version stamp from packages/frontend/package.json so the
// VersionPill shows an incremental human-readable "v0.X" instead of a
// build SHA. Bump packages/frontend/package.json `"version"` to ship a
// new release marker. Patch (`.0`) is stripped at display time.
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')) as { version: string };
const APP_VERSION = pkg.version;

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
    // Strip the trailing `.0` patch so semver `0.2.0` displays as `0.2`.
    __APP_VERSION__: JSON.stringify(APP_VERSION.replace(/\.0$/, '')),
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
