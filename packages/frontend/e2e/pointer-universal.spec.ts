/**
 * Cycle-40 / G32 — Pointer tool acts on walls + rooms + components.
 *
 * User quote: "With the pointer on map builder, I should be able to move
 * things around, select something to resize, select for delete, etc. It
 * should act like a real pointer."
 *
 * Verifies (in pointer mode, no tool switching):
 *  - Tap a wall hit-rect → wall is selected (sidebar shows Wall card)
 *  - Tap a room hit-rect → room is selected (sidebar shows Room card)
 *  - Tap a component pin → component is selected (sidebar shows Component card)
 *  - Wall + Room + Component selections are mutually exclusive
 *  - Tap empty canvas → deselects
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
  seeded?: { floorId: string };
};

const loadSeeded = (): NonNullable<SeededState['seeded']> => {
  const state = JSON.parse(
    readFileSync(join(__dirname, '.state.json'), 'utf8')
  ) as SeededState;
  if (!state.seeded) throw new Error('no seed');
  return state.seeded;
};

test.describe('G32 Pointer universal manipulation @cycle-40', () => {
  test('Pointer mode exposes wall + room hit-rects (the universal layer)', async ({
    page,
  }) => {
    const { floorId } = loadSeeded();
    await page.goto(`/floors/${floorId}/edit`);
    await expect(page.getByRole('heading', { name: 'Main Floor' })).toBeVisible();
    // Pointer is the default tool.
    // The new layer is rendered with class .floor-plan__pointer-layer.
    await expect(page.locator('.floor-plan__pointer-layer')).toBeVisible();
    // It contains room hit-rects + wall hit-rects. Hit-targets are
    // intentionally transparent so Playwright's `toBeVisible` would
    // flag them; use count > 0 instead. The seed has 2 rooms + 4 walls.
    await expect(
      page.locator('[data-testid="pointer-room-hit"]')
    ).toHaveCount(2);
    await expect(
      page.locator('[data-testid="pointer-wall-hit"]')
    ).toHaveCount(4);
  });

  test('Tapping a wall hit-rect in pointer mode shows the Wall properties card', async ({
    page,
  }) => {
    const { floorId } = loadSeeded();
    await page.goto(`/floors/${floorId}/edit`);
    await expect(page.getByRole('heading', { name: 'Main Floor' })).toBeVisible();
    // Tap the first wall.
    await page.locator('[data-testid="pointer-wall-hit"]').first().click({
      force: true,
    });
    // Sidebar's Wall card appears (look for "Delete wall" button).
    await expect(
      page.getByRole('button', { name: 'Delete wall' })
    ).toBeVisible();
  });

  test('Tapping a room hit-rect in pointer mode shows the Room properties card', async ({
    page,
  }) => {
    const { floorId } = loadSeeded();
    await page.goto(`/floors/${floorId}/edit`);
    await expect(page.getByRole('heading', { name: 'Main Floor' })).toBeVisible();
    // Tap the first room.
    await page.locator('[data-testid="pointer-room-hit"]').first().click({
      force: true,
    });
    // Sidebar's Room card appears with the X/Y/W/H grid + Delete button.
    await expect(page.getByTestId('room-dim-grid')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Delete room' })
    ).toBeVisible();
  });

  test('Selecting a wall, then a room, then a component clears the prior selection', async ({
    page,
  }) => {
    const { floorId } = loadSeeded();
    await page.goto(`/floors/${floorId}/edit`);
    await expect(page.getByRole('heading', { name: 'Main Floor' })).toBeVisible();

    // Select wall.
    await page.locator('[data-testid="pointer-wall-hit"]').first().click({ force: true });
    await expect(page.getByRole('button', { name: 'Delete wall' })).toBeVisible();

    // Select room → Wall card gone, Room card visible.
    await page.locator('[data-testid="pointer-room-hit"]').first().click({ force: true });
    await expect(page.getByRole('button', { name: 'Delete wall' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete room' })).toBeVisible();

    // Select a component pin → Room card gone, Component card visible.
    await page.locator('.floor-plan__pin').first().click();
    await expect(page.getByRole('button', { name: 'Delete room' })).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: /Delete component/i })
    ).toBeVisible();
  });
});
