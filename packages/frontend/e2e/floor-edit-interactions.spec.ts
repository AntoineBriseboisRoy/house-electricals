/**
 * 2026-05 — Floor editor interaction fixes (user-reported "weird behaviours").
 *
 *  #1  While a component tool is active you can SELECT an existing pin of that
 *      type — clicking it opens its details for editing (not just place).
 *  #2  Placing a component opens its details for modification, even in a tool
 *      (not just pointer mode); the tool STAYS active so you can keep placing
 *      after closing the sheet (multi-add).
 *  #3  Selecting a type in the tool carousel filters the map to ONLY that
 *      type's pins (and pointer mode shows them all again).
 *  #4  One-finger swipe pans the canvas on mobile.
 *
 * Desktop-only for #1–#3 (the drawer/canvas interactions are simplest at the
 * wide viewport); #4 is mobile-only (touch pan).
 *
 * Seed order (seed.ts): componentIds[0,1] = outlets, [2,3] = lights, then
 * switch, appliance, smoke_detector, junction_box. There is NO "other".
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type State = { seeded?: { floorId: string; componentIds: string[] } };
const loadState = (): NonNullable<State['seeded']> => {
  const j = JSON.parse(
    readFileSync(join(__dirname, '.state.json'), 'utf8')
  ) as State;
  if (j.seeded === undefined) throw new Error('no seed in .state.json');
  return j.seeded;
};

const MODAL = '[data-testid="floor-edit-component-modal"]';

test.describe('Floor editor interactions @floor-edit-fixes', () => {
  test('#3 the tool carousel filters the map to the active type', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop-1440x900', 'desktop drawer/canvas');
    const state = loadState();
    await page.goto(`/floors/${state.floorId}/edit`);

    const outletPin = page.locator(`[data-pin-id="${state.componentIds[0]}"]`);
    const lightPin = page.locator(`[data-pin-id="${state.componentIds[2]}"]`);
    await expect(outletPin).toBeVisible();
    await expect(lightPin).toBeVisible();

    // Light tool → only light pins; the outlet pin is filtered out entirely.
    await page.getByTestId('tool-light').click();
    await expect(lightPin).toBeVisible();
    await expect(outletPin).toHaveCount(0);

    // Back to pointer → everything shows again.
    await page.getByTestId('tool-pointer').click();
    await expect(outletPin).toBeVisible();
    await expect(lightPin).toBeVisible();
  });

  test('#1 clicking an existing pin while its tool is active opens its details', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop-1440x900', 'desktop drawer/canvas');
    const state = loadState();
    await page.goto(`/floors/${state.floorId}/edit`);

    await page.getByTestId('tool-outlet').click();
    const outletPin = page.locator(`[data-pin-id="${state.componentIds[0]}"]`);
    await expect(outletPin).toBeVisible(); // shown + clickable in tool mode
    await outletPin.click();
    await expect(page.locator(MODAL)).toBeVisible();
  });

  test('#2 placing opens the details sheet AND keeps the tool active (multi-add)', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop-1440x900', 'desktop drawer/canvas');
    const state = loadState();
    await page.goto(`/floors/${state.floorId}/edit`);

    // The "Other" tool has no seeded pins → the whole canvas is empty of its
    // type, so any click on the capture layer places (rather than selecting).
    await page.getByTestId('tool-other').click();
    const other = page.getByTestId('tool-other');
    await expect(other).toHaveAttribute('data-active', 'true');
    const capture = page.locator('.floor-plan__edit-capture');
    await expect(capture).toBeVisible();

    // Place → the details sheet opens for the new component.
    await capture.click({ position: { x: 160, y: 160 } });
    await expect(page.locator(MODAL)).toBeVisible();

    // Close it → the tool is STILL active (multi-add — no reset to pointer).
    await page.locator(MODAL).getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator(MODAL)).toBeHidden();
    await expect(other).toHaveAttribute('data-active', 'true');

    // Place a second one without re-picking the tool → details open again.
    await capture.click({ position: { x: 300, y: 240 } });
    await expect(page.locator(MODAL)).toBeVisible();
    // Two "Other" pins now exist on the floor (visible in this tool's filter).
    await page.locator(MODAL).getByRole('button', { name: 'Cancel' }).click();
    await expect(
      page.locator('[data-pin-id][data-link-target="other"]')
    ).toHaveCount(2);
  });

  test('#5 the new-room name prompt is a bottom-sheet on mobile', async ({
    page,
  }, info) => {
    test.skip(
      info.project.name === 'desktop-1440x900',
      'Bottom-sheet only applies below 720px.'
    );
    const state = loadState();
    await page.goto(`/floors/${state.floorId}/edit`);

    await page.getByTestId('tool-room').click();
    const capture = page.locator('.floor-plan__edit-capture');
    await expect(capture).toBeVisible();
    const box = (await capture.boundingBox())!;

    // Drag a rectangle in the top-left area (away from the seeded rooms),
    // which commits a new room and triggers the name prompt.
    await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.1);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.2, {
      steps: 4,
    });
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.36, {
      steps: 8,
    });
    await page.mouse.up();

    const modal = page.getByTestId('prompt-modal');
    await expect(modal).toBeVisible();
    // On mobile it pivots to the bottom-sheet presentation.
    await expect(modal).toHaveClass(/modal--sheet/);
  });

  test('#4 one-finger swipe pans the canvas (mobile)', async ({
    page,
  }, info) => {
    test.skip(
      info.project.name === 'desktop-1440x900',
      'One-finger touch pan is a mobile gesture.'
    );
    const state = loadState();
    await page.goto(`/floors/${state.floorId}/edit`);
    const canvas = page.locator('.floor-plan');
    await expect(canvas).toBeVisible();

    const transformBefore = await page
      .locator('svg g[transform]')
      .first()
      .getAttribute('transform');

    const box = (await canvas.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    for (const [type, y] of [
      ['pointerdown', cy],
      ['pointermove', cy - 120],
      ['pointerup', cy - 120],
    ] as const) {
      await canvas.dispatchEvent(type, {
        pointerType: 'touch',
        pointerId: 1,
        clientX: cx,
        clientY: y,
        bubbles: true,
      });
    }

    const transformAfter = await page
      .locator('svg g[transform]')
      .first()
      .getAttribute('transform');
    expect(transformAfter).not.toBe(transformBefore);
  });
});
