/**
 * 2026-05 — verify the floor-editor tool palette doesn't orphan a tool on
 * its own row at mobile widths. Renders the REAL editor and measures the
 * bounding boxes of the 6 tool buttons → distinct row count must be <= 2.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCREENSHOTS_DIR = join(__dirname, '.screenshots');
mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const loadFloorId = (): string => {
  const state = JSON.parse(
    readFileSync(join(__dirname, '.state.json'), 'utf8')
  ) as { seeded?: { floorId: string } };
  if (!state.seeded?.floorId) throw new Error('no seeded floorId in .state.json');
  return state.seeded.floorId;
};

test.describe('floor-editor tool palette', () => {
  test('all 6 tools fit in <=2 rows (no orphan)', async ({ page }, info) => {
    const floorId = loadFloorId();
    await page.goto(`/floors/${floorId}/edit`);

    const palette = page.locator('.tool-palette');
    await expect(palette).toBeVisible();

    const buttons = palette.locator('li .btn');
    await expect(buttons).toHaveCount(6);

    // Group button top-edges into rows (round to absorb sub-pixel diffs).
    const tops = await buttons.evaluateAll((els) =>
      els.map((el) => Math.round((el as HTMLElement).getBoundingClientRect().top))
    );
    const rows = [...new Set(tops)].sort((a, b) => a - b);

    await page.screenshot({
      path: join(SCREENSHOTS_DIR, `tool-palette-${info.project.name}.png`),
      clip: {
        x: 0,
        y: 0,
        width: page.viewportSize()!.width,
        height: 360,
      },
    });

    // eslint-disable-next-line no-console
    console.log(
      `[tool-palette ${info.project.name}] rowCount=${rows.length} tops=[${rows.join(', ')}]`
    );

    const isMobile = info.project.name !== 'desktop-1440x900';
    if (isMobile) {
      expect(rows.length, 'tool buttons should occupy at most 2 rows').toBeLessThanOrEqual(2);
    }
  });
});
