import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
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

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found in document.');
}

// G11 cycle-52 — ThemedToaster lives here (NOT in AppShell) so escape-hatch
// routes (/floors/:id/edit, /panels/:id/print) — which render OUTSIDE the
// AppShell-wrapped Switch in App.tsx — can still fire toasts. Mounted once,
// inside ThemeProvider so useTheme() resolves; OUTSIDE the route Switch so
// it survives any route change. See CLAUDE.md "Library choices (pinned)".
createRoot(rootEl).render(
  <StrictMode>
    <ThemeProvider>
      <App />
      <ThemedToaster
        position="top-center"
        richColors
        closeButton
        toastOptions={{ duration: 4000 }}
      />
    </ThemeProvider>
  </StrictMode>
);
