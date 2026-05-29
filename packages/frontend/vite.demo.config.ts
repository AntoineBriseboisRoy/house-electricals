import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

/**
 * GitHub Pages demo build. Runs the REAL backend in the browser (PGlite +
 * the real Hono app) — see src/demo/*. Differs from the product build
 * (vite.config.ts) ONLY in demo concerns: a base subpath, Node-builtin shims
 * so the backend bundles for the browser, the demo entry, GoatCounter, SPA 404
 * handling, and NO PWA.
 *
 * The product build is untouched; src/demo/** is excluded from the product
 * typecheck (tsconfig.json) and built esbuild-only here.
 *
 * PGlite (the in-browser Postgres) is NOT bundled — it's imported from esm.sh
 * in src/demo/pglite-pool.ts (Vite 8's rolldown can't bundle its npm ESM). The
 * import stays external in both dev and build. This is the demo's only runtime
 * CDN dependency; the self-hostable product bundles everything locally.
 */
const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(resolve(here, 'package.json'), 'utf-8')
) as { version: string };

// Project-pages subpath, e.g. https://<user>.github.io/HouseBreaker/. CI sets
// DEMO_BASE to "/${repo}/"; default matches this repository's name.
const BASE = process.env.DEMO_BASE ?? '/HouseBreaker/';

// GoatCounter site code (the "<code>" in https://<code>.goatcounter.com). Set
// as a repo Actions variable. When unset, no analytics snippet is injected.
const GOATCOUNTER_CODE = process.env.GOATCOUNTER_CODE ?? '';

const shim = (p: string): string => resolve(here, 'src/demo/shims', p);

// Absolute path so aliases resolve regardless of which package imports them
// (the backend source lives in a sibling pnpm package).
const pathBrowserify = createRequire(import.meta.url).resolve('path-browserify');

// GoatCounter, guarded so it ONLY fires on the github.io demo host (a fork or
// local preview sends no hits). Counts page views = "how many people tested it".
const goatcounterSnippet = (): string =>
  GOATCOUNTER_CODE === ''
    ? '<!-- GoatCounter disabled: set the GOATCOUNTER_CODE build env to enable -->'
    : `<script>
      (function () {
        if (!location.hostname.endsWith('github.io')) return;
        var s = document.createElement('script');
        s.async = true;
        s.src = '//gc.zgo.at/count.js';
        s.setAttribute('data-goatcounter', 'https://${GOATCOUNTER_CODE}.goatcounter.com/count');
        document.head.appendChild(s);
      })();
    </script>`;

// spa-github-pages (rafgraph) decoder: 404.html encodes the path into a query
// and redirects to index.html; this restores it via history.replaceState. One
// path segment kept = the project base ("/HouseBreaker/").
const spaRestoreSnippet = (): string => `<script>
      (function () {
        var l = window.location;
        if (l.search[1] === '/') {
          var decoded = l.search.slice(1).split('&').map(function (s) {
            return s.replace(/~and~/g, '&');
          }).join('?');
          window.history.replaceState(null, null, l.pathname.slice(0, -1) + decoded + l.hash);
        }
      })();
    </script>`;

const spa404Html = (): string => `<!doctype html>
<html><head><meta charset="utf-8"><title>House Electricals — demo</title>
<script>
  // spa-github-pages: redirect deep links / refresh back through index.html.
  (function () {
    var segments = 1; // keep "/HouseBreaker/"
    var l = window.location;
    l.replace(
      l.protocol + '//' + l.hostname + (l.port ? ':' + l.port : '') +
      l.pathname.split('/').slice(0, 1 + segments).join('/') + '/?/' +
      l.pathname.split('/').slice(1 + segments).join('/').replace(/&/g, '~and~') +
      (l.search ? '&' + l.search.slice(1).replace(/&/g, '~and~') : '') +
      l.hash
    );
  })();
</script>
</head><body></body></html>`;

const demoHtmlPlugin = (): Plugin => ({
  name: 'he-demo-html',
  transformIndexHtml(html) {
    // Build uses index.demo.html (already the demo entry); dev serves the root
    // index.html, so swap its script to the demo entry there. Inject the SPA
    // restore + GoatCounter snippets into <head> in both.
    return html
      .replace('/src/main.tsx', '/src/demo/main.demo.tsx')
      .replace('</head>', `    ${spaRestoreSnippet()}\n    ${goatcounterSnippet()}\n  </head>`);
  },
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: '404.html', source: spa404Html() });
  },
  closeBundle() {
    const out = resolve(here, 'dist');
    // Build input is index.demo.html → Vite writes dist/index.demo.html.
    // GitHub Pages serves dist/index.html, so promote it.
    const demoHtml = join(out, 'index.demo.html');
    if (existsSync(demoHtml)) {
      const target = join(out, 'index.html');
      if (existsSync(target)) rmSync(target);
      renameSync(demoHtml, target);
    }
  },
});

export default defineConfig({
  base: BASE,
  plugins: [react(), demoHtmlPlugin()],
  resolve: {
    alias: {
      // The ONE real swap: the pg driver → an inert stub (db.ts loads but we
      // build a PGlite-backed pool ourselves in src/demo/pglite-pool.ts).
      pg: shim('pg.ts'),
      // Node builtins the backend's file/auth routes import. They run in the
      // bundle but uploads aren't displayable (see fs.ts) and auth is disabled.
      'node:fs': shim('fs.ts'),
      fs: shim('fs.ts'),
      'node:crypto': shim('crypto.ts'),
      crypto: shim('crypto.ts'),
      'node:util': shim('util.ts'),
      util: shim('util.ts'),
      'node:path': pathBrowserify,
      path: pathBrowserify,
    },
  },
  define: {
    // Some browserified deps reference a bare `global`.
    global: 'globalThis',
    __APP_VERSION__: JSON.stringify(`${pkg.version.replace(/\.0$/, '')}-demo`),
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // The demo entry HTML (its <script> points at src/demo/main.demo.tsx).
      // closeBundle promotes the emitted index.demo.html → index.html.
      input: resolve(here, 'index.demo.html'),
    },
  },
});
