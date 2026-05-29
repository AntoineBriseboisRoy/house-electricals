// GitHub Pages demo entry. Boots the in-browser backend (PGlite + the real
// Hono app), THEN renders the exact same app shell as production. The
// `vite.demo.config.ts` transformIndexHtml swaps index.html's script to point
// here when building with `build:demo`.
import './shims/process-global.js'; // MUST be first — sets globalThis.process
import { start } from './bootstrap.js';
import { renderApp } from '../AppRoot.js';

void start().then(renderApp);
