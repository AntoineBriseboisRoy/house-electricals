/**
 * fix/mobile-floating-cluster — PR screenshot helper.
 *
 * Opens the UserMenu sheet on each viewport and captures one screenshot
 * for the PR body. Not part of the regression suite (skipped at
 * desktop, single test per mobile project).
 */

import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCREENSHOTS_DIR = join(__dirname, '.screenshots', 'floating-cluster');
mkdirSync(SCREENSHOTS_DIR, { recursive: true });

test('user-menu sheet open @screenshot', async ({ page }, info) => {
  // Capture on every project — both mobile + desktop — so reviewers can
  // see the sheet vs centered presentations.
  await page.goto('/');
  await page.getByRole('heading', { name: /house electricals/i }).waitFor();
  await page.getByTestId('user-menu-button').click();
  await page.getByTestId('user-menu-modal').waitFor();
  // Give the sheet animation 350ms to fully settle.
  await page.waitForFunction(
    () => {
      const el = document.querySelector(
        '[data-testid="user-menu-modal"]'
      ) as HTMLElement | null;
      if (el === null) return false;
      return parseFloat(getComputedStyle(el).opacity) > 0.95;
    },
    null,
    { timeout: 2_000 }
  );
  await page.screenshot({
    path: join(
      SCREENSHOTS_DIR,
      `after-menu-open-${info.project.name}.png`
    ),
    fullPage: false,
  });
});
