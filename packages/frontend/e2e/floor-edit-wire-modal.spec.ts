/**
 * Cycle-86 — Wire components from FloorEditScreen via Modal.
 *
 * Closes the cycle-85 user-flagged follow-up: a component placed via the
 * floor-edit canvas should be wireable to a panel/breaker WITHOUT leaving
 * the floor. The Modal hosting ComponentForm reuses the cycle-39 G31
 * Panel/Breaker cascading interlocks + cycle-85 floorPanelId pre-selection.
 *
 * Hard rules from cycle-21:
 *  - No page.waitForTimeout.
 *  - Test seeds its own scratch state via REST so other specs are unaffected.
 *
 * Coverage:
 *  - Pin click → sidebar Card → "Edit details" Button opens Modal.
 *  - Modal's Panel select is defaulted to the floor's linked panel.
 *  - Picking a breaker + Save persists via PATCH (verified by API re-fetch).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type SeededState = {
  seeded?: {
    panelId: string;
    breakerIds: string[];
    floorId: string;
  };
};

const loadSeeded = (): NonNullable<SeededState['seeded']> => {
  const state = JSON.parse(
    readFileSync(join(__dirname, '.state.json'), 'utf8')
  ) as SeededState;
  if (!state.seeded) throw new Error('no seed');
  return state.seeded;
};

const E2E_BACKEND_URL = 'http://127.0.0.1:3100';

test.describe('cycle-86 wire components from FloorEditScreen via Modal', () => {
  test('Edit details Modal pre-selects floor.panelId and saves a breakerId', async ({
    page,
  }, info) => {
    // Desktop project: the floor editor's 3-col layout shows the sidebar
    // properties card alongside the canvas. Mobile uses a sheet — still
    // testable, but desktop is the canonical path. The spec runs on both
    // playwright projects per the cycle-21 mobile-mandate.
    void info;
    const seed = loadSeeded();

    // 1) Link the floor to the seeded panel so ComponentForm has a
    //    floorPanelDefault to pre-select.
    await fetch(`${E2E_BACKEND_URL}/api/v1/floors/${seed.floorId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ panelId: seed.panelId }),
    });

    // 2) Create a fresh unwired component on this floor via REST.
    const created = await fetch(`${E2E_BACKEND_URL}/api/v1/components`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'outlet',
        name: 'Cycle-86 wire-from-floor test',
        room: null,
        notes: null,
        breakerId: null,
        floorId: seed.floorId,
        posX: 1234,
        posY: 4321,
      }),
    });
    const componentId = ((await created.json()) as { data: { id: string } })
      .data.id;

    // 3) Navigate to the floor editor. Pointer is the default tool.
    await page.goto(`/floors/${seed.floorId}/edit`);
    await expect(
      page.getByRole('heading', { name: 'Main Floor' })
    ).toBeVisible();

    // 4) Select the pin via its data-pin-id attribute (the canonical
    //    selector since cycle-20 G20).
    const pin = page.locator(`[data-pin-id="${componentId}"]`);
    await expect(pin).toBeVisible();
    await pin.click();

    // 5) Sidebar Card renders. Click the new "Edit details" button.
    //    On mobile the card is below the canvas; on desktop it's the
    //    right sidebar. Either way the testid resolves uniquely.
    const editBtn = page.getByTestId('floor-edit-component-edit');
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    // 6) Modal opens with the canonical testid.
    const modal = page.getByTestId('floor-edit-component-modal');
    await expect(modal).toBeVisible();

    // 7) Panel select inside the Modal is defaulted to the floor's
    //    linked panel (cycle-85 floorPanelDefault). The component itself
    //    has breakerId=null so the default is in effect.
    const panelSelect = modal.getByTestId('cf-panel');
    await expect(panelSelect).toHaveValue(seed.panelId);

    // 8) Pick the first breaker on that panel.
    const breakerSelect = modal.getByTestId('cf-breaker');
    await expect(breakerSelect).toBeEnabled();
    await breakerSelect.selectOption(seed.breakerIds[0]);
    await expect(breakerSelect).toHaveValue(seed.breakerIds[0]);

    // 9) Submit. Save closes the Modal.
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal).not.toBeVisible();

    // 10) Verify via API that the component is now wired to the breaker.
    const after = await fetch(
      `${E2E_BACKEND_URL}/api/v1/components/${componentId}`
    );
    const body = (await after.json()) as {
      data: { breakerId: string | null };
    };
    expect(body.data.breakerId).toBe(seed.breakerIds[0]);

    // Cleanup — leave the seed in its original shape so later specs see
    // the unlinked floor + no scratch component.
    await fetch(`${E2E_BACKEND_URL}/api/v1/components/${componentId}`, {
      method: 'DELETE',
    });
    await fetch(`${E2E_BACKEND_URL}/api/v1/floors/${seed.floorId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ panelId: null }),
    });
  });
});
