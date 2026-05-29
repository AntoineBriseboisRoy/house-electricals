import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Router } from 'wouter';
import { App } from './App.js';
import { AuthProvider } from './contexts/AuthContext.js';
import { ThemeProvider } from './contexts/ThemeContext.js';
import { ThemedToaster } from './ui/toast.js';
// G22 cycle-23: self-host Plus Jakarta Sans via @fontsource. 4 weights
// (regular/medium/semibold/bold) — same Latin-subset variants the type
// scale uses. Fontsource files are MIT, served by Vite from same-origin
// — no Google Fonts CDN, no outbound network at runtime.
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
// Design tokens must load BEFORE any component styles so primitives can
// resolve --color-*, --space-*, --text-*, --radius-*, --shadow-*, --motion-*.
import './ui/tokens.css';
import './styles.css';

// wouter base path. In normal/self-host builds Vite's BASE_URL is "/", so this
// resolves to "" (no base — byte-identical to pre-existing behavior). In the
// GitHub Pages demo build it is e.g. "/HouseBreaker/", so routing works under
// the project subpath. The app's `#breaker-<id>` / `#pin-<id>` highlight
// deep-links are unaffected (they use location.hash, not the path).
const routerBase = import.meta.env.BASE_URL.replace(/\/$/, '');

/**
 * The single render entry point, shared by `main.tsx` (normal) and
 * `demo/main.demo.tsx` (the in-browser-backend demo). Keeping one render path
 * means the demo never diverges from the real app shell.
 *
 * G11 cycle-52 — ThemedToaster lives here (NOT in AppShell) so escape-hatch
 * routes (/floors/:id/edit, /panels/:id/print) — which render OUTSIDE the
 * AppShell-wrapped Switch in App.tsx — can still fire toasts. Mounted once,
 * inside ThemeProvider so useTheme() resolves; OUTSIDE the route Switch so it
 * survives any route change. See CLAUDE.md "Library choices (pinned)".
 */
export const renderApp = (): void => {
  const rootEl = document.getElementById('root');
  if (!rootEl) {
    throw new Error('Root element #root not found in document.');
  }
  createRoot(rootEl).render(
    <StrictMode>
      <ThemeProvider>
        <AuthProvider>
          <Router base={routerBase}>
            <App />
          </Router>
          <ThemedToaster
            position="top-center"
            richColors
            closeButton
            toastOptions={{ duration: 4000 }}
          />
        </AuthProvider>
      </ThemeProvider>
    </StrictMode>
  );
};
