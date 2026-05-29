import { renderApp } from './AppRoot.js';

// All the provider tree + render logic lives in AppRoot so the GitHub Pages
// demo entry (src/demo/main.demo.tsx) can reuse the exact same app shell.
renderApp();
