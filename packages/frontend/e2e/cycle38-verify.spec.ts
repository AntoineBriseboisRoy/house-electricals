/**
 * Cycle-38 verify — visible-viewport screenshots (fullPage: false) so the
 * captured PNG fits inside the Read-tool size budget. Just enough to
 * confirm the title-cropping + room-label fixes.
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
  seeded?: { panelId: string; floorId: string };
};

const loadSeeded = (): NonNullable<SeededState['seeded']> => {
  const state = JSON.parse(
    readFileSync(join(__dirname, '.state.json'), 'utf8')
  ) as SeededState;
  if (!state.seeded) throw new Error('no seed');
  return state.seeded;
};

test.describe('Cycle-38 verify @cycle-38', () => {
  test('PanelDetail header — title not cropped, action icon-only', async (
    { page },
    info
  ) => {
    test.skip(info.project.name === 'desktop-1440x900', 'mobile only');
    const { panelId } = loadSeeded();
    await page.goto(`/panels/${panelId}`);
    await expect(page.getByRole('heading', { name: 'Main Panel' })).toBeVisible();
    await page.screenshot({
      path: join(SCREENSHOTS_DIR, `cycle38-PanelDetail-header-${info.project.name}.png`),
      fullPage: false,
      clip: { x: 0, y: 0, width: page.viewportSize()!.width, height: 120 },
    });
  });

  test('FloorEdit header — title not cropped, Rename icon-only', async (
    { page },
    info
  ) => {
    test.skip(info.project.name === 'desktop-1440x900', 'mobile only');
    const { floorId } = loadSeeded();
    await page.goto(`/floors/${floorId}/edit`);
    await expect(page.getByRole('heading', { name: 'Main Floor' })).toBeVisible();
    await page.screenshot({
      path: join(SCREENSHOTS_DIR, `cycle38-FloorEdit-header-${info.project.name}.png`),
      fullPage: false,
      clip: { x: 0, y: 0, width: page.viewportSize()!.width, height: 120 },
    });
  });

  test('FloorEdit room labels — fit inside narrow rooms on mobile', async (
    { page },
    info
  ) => {
    test.skip(info.project.name === 'desktop-1440x900', 'mobile only');
    const { floorId } = loadSeeded();
    await page.goto(`/floors/${floorId}/edit`);
    await expect(page.getByRole('heading', { name: 'Main Floor' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    // Capture just the canvas region (~600px tall on mobile per cycle-34 rule).
    await page.screenshot({
      path: join(SCREENSHOTS_DIR, `cycle38-FloorEdit-canvas-${info.project.name}.png`),
      fullPage: false,
      clip: { x: 0, y: 100, width: page.viewportSize()!.width, height: 700 },
    });
  });
});
