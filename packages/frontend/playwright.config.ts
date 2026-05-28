import { defineConfig, devices } from '@playwright/test';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Playwright config — G21 cycle-21.
 *
 * Pins:
 * - chromium-only (LAN-only PWA, license + binary-size discipline)
 * - two projects: mobile-390x844 and desktop-1440x900
 * - tests live in ./e2e/
 * - globalSetup spawns an isolated backend on port 3100 with tmpdir DB +
 *   FLOOR_PLAN_DIR (NEVER ./data/) and seeds via REST
 * - webServer boots Vite with BACKEND_DEV_URL pointing at the isolated backend
 * - screenshots into e2e/.screenshots/<name>-<project>.png (gitignored)
 *
 * See CLAUDE.md "E2E (Playwright — G21)" for the canonical pins.
 */

const E2E_BACKEND_PORT = 3100;
const E2E_FRONTEND_PORT = 5180;
const E2E_BACKEND_URL = `http://127.0.0.1:${E2E_BACKEND_PORT}`;
const E2E_FRONTEND_URL = `http://127.0.0.1:${E2E_FRONTEND_PORT}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts$/,
  // Run smoke specs serially per project (modal/seed state is shared per project).
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: E2E_FRONTEND_URL,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'mobile-360x780',
      // G29 cycle-36: narrow-iPhone class (Mini, SE) where Display Zoom
      // hits ~360 CSS px. Catches overflow bugs the 390 viewport misses.
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 360, height: 780 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'mobile-390x844',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'desktop-1440x900',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  globalSetup: './e2e/globalSetup.ts',
  globalTeardown: './e2e/globalTeardown.ts',
  webServer: {
    // Use vite CLI flags directly so we can pin port + host without relying
    // on env-substitution in package.json (which is finicky on Windows).
    // The `pnpm exec` keeps us inside the workspace's hoisted node_modules.
    command: `pnpm exec vite --port ${E2E_FRONTEND_PORT} --host 127.0.0.1 --strictPort`,
    url: E2E_FRONTEND_URL,
    reuseExistingServer: false,
    timeout: 60_000,
    cwd: __dirname,
    env: {
      BACKEND_DEV_URL: E2E_BACKEND_URL,
    },
  },
});

export { E2E_BACKEND_URL, E2E_FRONTEND_URL, E2E_BACKEND_PORT, E2E_FRONTEND_PORT };
