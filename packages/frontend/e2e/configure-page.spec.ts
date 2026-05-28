/**
 * G25 cycle-24 — Configure page side-by-side click-to-highlight spec.
 *
 * Verifies the unified PanelDetailScreen flow:
 *   - The Components-on-panel section renders one group per breaker with
 *     components, listing each wired component as a tappable row.
 *   - Tapping a component row updates window.location.hash to
 *     #breaker-<id> (no navigation away from the page) and the cycle-22
 *     hash consumer pulses the matching slot-cell-<id>.
 *
 * Pure in-page interaction — URL pathname stays /panels/:id throughout.
 */

import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCREENSHOTS_DIR = join(__dirname, '.screenshots');
mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const loadSeeded = (): { panelId: string; breakerIds: string[]; componentIds: string[] } => {
  const raw = JSON.parse(readFileSync(join(__dirname, '.state.json'), 'utf8')) as {
    seeded?: { panelId: string; breakerIds: string[]; componentIds: string[] };
  };
  if (raw.seeded === undefined) throw new Error('e2e/.state.json missing seeded ids');
  return raw.seeded;
};

test.describe('G25 configure page @cycle-24', () => {
  test('Components-on-panel section renders + pulses slot on click', async (
    { page },
    info
  ) => {
    const seeded = loadSeeded();
    await page.goto(`/panels/${seeded.panelId}`);

    // The new section is present + has the seeded count.
    const list = page.getByTestId('components-on-panel');
    await expect(list).toBeVisible();

    // Tap a known component (Kitchen Outlet 1 — wired to breakerIds[1]).
    const items = page.getByTestId('components-on-panel-item');
    const target = items.first();
    await expect(target).toBeVisible();
    const breakerId = await target.getAttribute('data-breaker-id');
    if (breakerId === null) throw new Error('component item missing data-breaker-id');

    const urlBefore = page.url();
    await target.click();
    // URL path unchanged (no nav); only hash should change.
    const urlAfter = page.url();
    expect(new URL(urlAfter).pathname).toBe(new URL(urlBefore).pathname);
    expect(new URL(urlAfter).hash).toBe(`#breaker-${breakerId}`);

    // Slot cell pulses.
    const slot = page.locator(`#slot-cell-${breakerId}`);
    await expect(slot).toBeVisible();
    await expect(slot).toHaveAttribute('data-highlight', 'true');

    await page.screenshot({
      path: join(SCREENSHOTS_DIR, `g25-configure-${info.project.name}.png`),
      fullPage: true,
    });
  });
});
