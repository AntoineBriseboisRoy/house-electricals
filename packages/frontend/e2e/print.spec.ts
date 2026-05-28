/**
 * G24 cycle-27 — Printable diagram spec.
 *
 * Verifies:
 *   - /panels/:id/print renders the printable diagram (h1 + slot grid).
 *   - The bottom-tabs nav is NOT in the DOM (escape-hatch route — no app
 *     chrome). Confirms the App.tsx isolation pattern is working.
 *   - The "Print diagram" link in PanelDetail footer points here.
 */

import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCREENSHOTS_DIR = join(__dirname, '.screenshots');
mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const loadSeeded = (): { panelId: string } => {
  const raw = JSON.parse(readFileSync(join(__dirname, '.state.json'), 'utf8')) as {
    seeded?: { panelId: string };
  };
  if (raw.seeded === undefined) throw new Error('e2e/.state.json missing seeded ids');
  return raw.seeded;
};

test.describe('G24 printable diagram @cycle-27', () => {
  test('renders the panel diagram + no app chrome', async ({ page }, info) => {
    const seeded = loadSeeded();
    await page.goto(`/panels/${seeded.panelId}/print`);

    // Paper-like white card visible.
    const paper = page.getByTestId('printable-page');
    await expect(paper).toBeVisible();

    // Heading is the panel name.
    await expect(page.getByRole('heading', { name: 'Main Panel' })).toBeVisible();

    // Slot grid is present with the seeded breakers.
    await expect(page.getByText('Kitchen lights')).toBeVisible();
    await expect(page.getByText('Kitchen outlets')).toBeVisible();

    // Escape-hatch confirmed: no bottom-tabs nav in the DOM.
    await expect(page.locator('.bottom-tabs')).toHaveCount(0);

    // No theme toggle either (lives in AppShell).
    await expect(page.locator('.theme-toggle')).toHaveCount(0);

    // Cycle-68 — no VersionPill either (lives in AppShell next to
    // ThemeToggle). Locks in escape-hatch isolation for the new affordance.
    await expect(page.locator('[data-testid="version-pill"]')).toHaveCount(0);

    // G11 cycle-52: ThemedToaster mounts in main.tsx (above the route
    // Switch), so its host element exists on the print route too. But
    // PrintableDiagramScreen makes ZERO `toast()` calls — assert the host
    // contains no rendered toast. Locks in "static artifact" invariant
    // even though the Toaster region is technically in the DOM.
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);

    await page.screenshot({
      path: join(SCREENSHOTS_DIR, `g24-print-${info.project.name}.png`),
      fullPage: true,
    });
  });

  test('PanelDetail footer links to /print', async ({ page }) => {
    const seeded = loadSeeded();
    await page.goto(`/panels/${seeded.panelId}`);

    const link = page.getByRole('link', { name: /Open printable breaker diagram/i });
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toBe(`/panels/${seeded.panelId}/print`);
  });
});
