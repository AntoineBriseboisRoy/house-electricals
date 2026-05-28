/**
 * Cycle-36 — reproduce the user's mobile PanelDetail screenshot.
 *
 * User has a fresh "main" panel with 2 breakers and ZERO components
 * attached. On mobile (390x844) the "Components on this panel" section
 * renders an EmptyState that visually creates a huge black gap before
 * the Breakers section + panel viz below.
 *
 * This spec creates that exact scenario via REST (mirroring globalSetup's
 * seed pattern) and screenshots /panels/<id>.
 */

import { test, type Page, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCREENSHOTS_DIR = join(__dirname, '.screenshots');
mkdirSync(SCREENSHOTS_DIR, { recursive: true });

// We POST against the seeded backend (port 3100) directly to create a
// fresh panel-with-no-components scenario in addition to the existing seed.
const E2E_BACKEND_URL = 'http://127.0.0.1:3100';

const createEmptyPanel = async (): Promise<string> => {
  // Panel
  const pRes = await fetch(`${E2E_BACKEND_URL}/api/v1/panels`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'main', orientation: 'horizontal', slotCount: 24 }),
  });
  const pBody = (await pRes.json()) as { data: { id: string } };
  const panelId = pBody.data.id;

  // 2 breakers (matches user's screenshot)
  for (const spec of [
    { slot: '1', slotPosition: 1, amperage: 20, poles: 'single', label: 'asdasda' },
    { slot: '2', slotPosition: 2, amperage: 20, poles: 'single', label: 'dasda' },
  ]) {
    await fetch(`${E2E_BACKEND_URL}/api/v1/panels/${panelId}/breakers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(spec),
    });
  }
  return panelId;
};

const snap = async (page: Page, name: string): Promise<void> => {
  await page.waitForLoadState('networkidle');
  await page.screenshot({
    path: join(SCREENSHOTS_DIR, `${name}.png`),
    fullPage: true,
  });
};

test.describe('Cycle-36 PanelDetail empty-components mobile repro', () => {
  test('PanelDetail with 2 breakers + 0 components — horizontal-orientation viz folds to vertical', async ({
    page,
  }, info) => {
    test.skip(
      info.project.name === 'desktop-1440x900',
      'mobile only (mobile-360x780 + mobile-390x844)'
    );
    const panelId = await createEmptyPanel();
    await page.goto(`/panels/${panelId}`);
    await expect(page.getByRole('heading', { name: 'main' })).toBeVisible();
    await snap(page, `cycle36-PanelDetail-empty-${info.project.name}`);

    // Empty-state compact: < 260px tall on mobile (header + Lightbulb + title +
    // description, all sized down per the @media max-width: 719px overrides).
    const section = page.locator(
      'section[aria-labelledby="components-on-panel-heading"]'
    );
    const sectionBox = await section.boundingBox();
    expect(sectionBox).not.toBeNull();
    expect(
      sectionBox!.height,
      `empty 'Components on this panel' section is ${Math.round(sectionBox!.height)}px — should be < 260px on mobile`
    ).toBeLessThan(260);

    // Panel viz: horizontal-orientation panel folds to vertical on mobile,
    // so the viz width should fit inside the viewport (no horizontal scroll).
    const viz = page.locator('.panel-viz').first();
    await expect(viz).toBeVisible();
    const vizBox = await viz.boundingBox();
    expect(vizBox).not.toBeNull();
    const vw = page.viewportSize()!.width;
    expect.soft(
      vizBox!.width,
      `panel-viz width ${Math.round(vizBox!.width)} > viewport ${vw} — viz overflowing`
    ).toBeLessThanOrEqual(vw + 1);

    // The viz should be the .panel-viz--vertical variant on mobile (folded).
    await expect(page.locator('.panel-viz--vertical')).toBeVisible();
  });
});
