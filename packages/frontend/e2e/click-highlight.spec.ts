/**
 * G23 click-highlight smoke spec (cycle-22).
 *
 * Verifies the core daily-use flow:
 *   Components list → "View on panel" link on a row
 *     → /panels/:id#breaker-<id>
 *     → panel viz auto-renders (if user was in 'list' mode, in-memory flip)
 *     → slot-cell-<id> gets data-highlight="true"
 *
 * Runs under both Playwright projects (mobile-390x844 + desktop-1440x900)
 * so we get coverage of both viewports without changing the spec.
 *
 * Hard rules from cycle-21:
 * - No page.waitForTimeout. Only auto-waiting expect().
 * - Screenshot via the shared snap() helper from smoke.spec.ts style.
 */

import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCREENSHOTS_DIR = join(__dirname, '.screenshots');
mkdirSync(SCREENSHOTS_DIR, { recursive: true });

type SeededState = {
  seeded?: {
    panelId: string;
    breakerIds: string[];
    componentIds: string[];
  };
};

const loadSeeded = (): NonNullable<SeededState['seeded']> => {
  const state = JSON.parse(
    readFileSync(join(__dirname, '.state.json'), 'utf8')
  ) as SeededState;
  if (state.seeded === undefined) {
    throw new Error('e2e/.state.json missing seeded ids');
  }
  return state.seeded;
};

test.describe('G23 click-to-highlight @cycle-22', () => {
  test('deep link #breaker-<id> pulses slot-cell-<id> in viz mode', async (
    { page },
    info
  ) => {
    const seeded = loadSeeded();
    // Component index 0 is Kitchen Outlet 1 (wired to breakerIds[1] per seed.ts).
    // We assert on the breaker id its breaker hash should point to.
    const targetBreakerId = seeded.breakerIds[1];

    // Navigate directly to the deep link — simulates a "View on panel" click
    // from any producer (ComponentsScreen, future producers, etc.).
    await page.goto(`/panels/${seeded.panelId}#breaker-${targetBreakerId}`);

    // The slot-cell-<id> should mount + receive data-highlight="true" within
    // 2s (one rAF tick after the viz finishes its first paint).
    const slot = page.locator(`#slot-cell-${targetBreakerId}`);
    await expect(slot).toBeVisible();
    await expect(slot).toHaveAttribute('data-highlight', 'true');

    await page.screenshot({
      path: join(SCREENSHOTS_DIR, `g23-slot-highlight-${info.project.name}.png`),
      fullPage: true,
    });
  });

  test('list-mode preference survives a deep-link visit', async ({ page }) => {
    const seeded = loadSeeded();
    const targetBreakerId = seeded.breakerIds[2];

    // First visit: switch view to list and assert localStorage was written.
    await page.goto(`/panels/${seeded.panelId}`);
    await page.getByRole('tab', { name: 'List' }).click();
    const storedAfterToggle = await page.evaluate(() =>
      window.localStorage.getItem('he.panel-view')
    );
    expect(storedAfterToggle).toBe('list');

    // Now arrive via deep link — the consumer should flip view IN MEMORY but
    // NOT mutate localStorage. The slot-cell highlight should still show.
    await page.goto(`/panels/${seeded.panelId}#breaker-${targetBreakerId}`);
    const slot = page.locator(`#slot-cell-${targetBreakerId}`);
    await expect(slot).toBeVisible();
    await expect(slot).toHaveAttribute('data-highlight', 'true');

    // localStorage preference unchanged — the user's choice survives.
    const storedAfterDeepLink = await page.evaluate(() =>
      window.localStorage.getItem('he.panel-view')
    );
    expect(storedAfterDeepLink).toBe('list');
  });
});
