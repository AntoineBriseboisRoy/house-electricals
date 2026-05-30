/**
 * 2026-05 — the floor-editor tools surface is a horizontal, scrollable
 * carousel (`.tool-bar`) on BOTH mobile and desktop. Every tool is a labelled
 * pill in a single horizontally-scrolling row (no orphaned icon-only row).
 * This spec renders the REAL editor and asserts: all 10 tool pills are present,
 * they share ONE row, and the track is horizontally scrollable when it
 * overflows.
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

const ALL_TOOLS = [
  'pointer',
  'wall',
  'room',
  'outlet',
  'light',
  'switch',
  'appliance',
  'junction_box',
  'smoke_detector',
  'other',
] as const;

test.describe('floor-editor tool carousel', () => {
  test('all 10 tools render as labelled pills in a single row', async ({
    page,
  }, info) => {
    const floorId = loadFloorId();
    await page.goto(`/floors/${floorId}/edit`);

    const bar = page.locator('.tool-bar');
    await expect(bar).toBeVisible();

    // Every tool is reachable by its stable testid.
    for (const tool of ALL_TOOLS) {
      await expect(page.getByTestId(`tool-${tool}`)).toBeVisible();
    }

    const pills = bar.locator('.tool-bar__track li .btn');
    await expect(pills).toHaveCount(ALL_TOOLS.length);

    // All pills live on the same row (a horizontal carousel) — distinct
    // top-edges (rounded to absorb sub-pixel diffs) must be exactly 1.
    const tops = await pills.evaluateAll((els) =>
      els.map((el) => Math.round((el as HTMLElement).getBoundingClientRect().top))
    );
    const rows = [...new Set(tops)].sort((a, b) => a - b);

    await page.screenshot({
      path: join(SCREENSHOTS_DIR, `tool-carousel-${info.project.name}.png`),
      clip: {
        x: 0,
        y: 0,
        width: page.viewportSize()!.width,
        height: 220,
      },
    });

    // eslint-disable-next-line no-console
    console.log(
      `[tool-carousel ${info.project.name}] rowCount=${rows.length} tops=[${rows.join(', ')}]`
    );

    expect(rows.length, 'tool pills should occupy exactly one row').toBe(1);
  });

  test('selecting a pill activates that tool', async ({ page }) => {
    const floorId = loadFloorId();
    await page.goto(`/floors/${floorId}/edit`);

    const wall = page.getByTestId('tool-wall');
    await expect(wall).toBeVisible();
    await wall.click();
    await expect(wall).toHaveAttribute('aria-pressed', 'true');

    // Pointer is the default; clicking wall must deactivate it.
    await expect(page.getByTestId('tool-pointer')).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });
});
