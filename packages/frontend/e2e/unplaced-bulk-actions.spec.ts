/**
 * G42(f) cycle-51 — bulk-actions on the PanelMapScreen Unplaced sidebar.
 *
 * Mirrors the cycle-50 ComponentsScreen bulk-actions spec but against the
 * Unplaced sidebar at /panels/:id/map. The seed places all 8 components
 * by default, so each test FIRST un-places 2 of them by PATCHing
 * posX/posY/floorId → null. That move surfaces those rows in the Unplaced
 * section where the test can drive checkboxes + the SelectionBar.
 *
 * Verifies:
 *   1. Tapping >=1 checkbox in the Unplaced list shows the SelectionBar
 *      with the right count + replaces the BottomTabs.
 *   2. Bulk Delete asks for a confirm modal, optimistically removes the
 *      rows, shows a single "Deleted N components" toast with Undo.
 *      Clicking Undo restores all rows.
 *   3. Bulk Assign breaker opens the picker; picking applies the breakerId
 *      to all selected rows.
 *   4. Drag-vs-select isolation — clicking the checkbox column toggles
 *      selection (does NOT start a drag); pointerdown on the row Button
 *      does NOT toggle selection.
 *
 * Hard rules (cycle-21 pins):
 *   - Deterministic waits only — no page.waitForTimeout.
 *   - Reuses the seed.ts fixture (1 panel + 6 breakers + 8 components).
 */

import { test, expect, type Page, type Locator } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { authedFetch, E2E_BACKEND_URL } from './authed-fetch.js';

type SeededState = {
  seeded?: {
    panelId: string;
    breakerIds: string[];
    floorId: string;
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

/**
 * Create a fresh unwired/unplaced component on the seeded panel. We need
 * components on THIS panel's breakers but with posX/posY === null so they
 * show up in the Unplaced section of /panels/:id/map.
 *
 * Returns the component id.
 */
const createUnplacedOnPanel = async (
  name: string,
  breakerId: string
): Promise<string> => {
  const res = await authedFetch(`${E2E_BACKEND_URL}/api/v1/components`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'outlet',
      name,
      room: null,
      notes: null,
      breakerId,
      // posX/posY/floorId omitted → null → unplaced.
    }),
  });
  if (!res.ok) {
    throw new Error(
      `[unplaced-bulk-actions] failed to create component: ${res.status}`
    );
  }
  const body = (await res.json()) as { data: { id: string } };
  return body.data.id;
};

/** Tap the checkbox label inside an unplaced row to toggle selection.
 *  The native input is visually hidden so we click the wrapping label —
 *  same pattern as bulk-actions.spec.ts. */
const checkUnplacedRow = async (row: Locator): Promise<void> => {
  await row.locator('label.checkbox').click();
};

const unplacedRows = (page: Page): Locator =>
  page.getByTestId('unplaced-item');

test.describe('G42(f) Unplaced bulk actions @cycle-51', () => {
  test('selecting Unplaced rows shows SelectionBar + hides BottomTabs', async ({
    page,
  }) => {
    const seeded = loadSeeded();
    // Create 2 fresh unplaced components on this panel's breakers.
    const ts = Date.now();
    await createUnplacedOnPanel(`unp-A-${ts}`, seeded.breakerIds[0]);
    await createUnplacedOnPanel(`unp-B-${ts}`, seeded.breakerIds[0]);

    await page.goto(`/panels/${seeded.panelId}/map?floor=${seeded.floorId}`);

    // Wait for the Unplaced section to render with >=2 items.
    const rows = unplacedRows(page);
    await expect(rows.first()).toBeVisible();
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // BottomTabs visible to start.
    const bottomTabs = page.locator('.bottom-tabs');
    await expect(bottomTabs).toBeVisible();
    const bar = page.getByTestId('selection-bar');
    await expect(bar).toHaveCount(0);

    // Select 2 rows.
    await checkUnplacedRow(rows.nth(0));
    await checkUnplacedRow(rows.nth(1));

    // SelectionBar appears with count=2; bottom-tabs hidden.
    await expect(bar).toBeVisible();
    await expect(page.getByTestId('selection-bar-count')).toHaveText('2');
    await expect(bottomTabs).toBeHidden();

    // Cleanup: SelectionBar clear restores tabs.
    await page.getByTestId('selection-bar-clear').click();
    await expect(bar).toHaveCount(0);
    await expect(bottomTabs).toBeVisible();
  });

  test('bulk delete from Unplaced: confirm → rows removed → Undo restores', async ({
    page,
  }) => {
    const seeded = loadSeeded();
    const ts = Date.now();
    const idA = await createUnplacedOnPanel(`unp-del-A-${ts}`, seeded.breakerIds[0]);
    const idB = await createUnplacedOnPanel(`unp-del-B-${ts}`, seeded.breakerIds[0]);

    await page.goto(`/panels/${seeded.panelId}/map?floor=${seeded.floorId}`);
    const rows = unplacedRows(page);
    await expect(rows.first()).toBeVisible();

    const rowA = page.locator(`[data-testid="unplaced-item"][data-component-id="${idA}"]`);
    const rowB = page.locator(`[data-testid="unplaced-item"][data-component-id="${idB}"]`);
    await expect(rowA).toBeVisible();
    await expect(rowB).toBeVisible();
    const initialCount = await rows.count();

    await checkUnplacedRow(rowA);
    await checkUnplacedRow(rowB);
    await expect(page.getByTestId('selection-bar')).toBeVisible();

    // Click Delete.
    await page.getByTestId('bulk-delete').click();

    // Confirm modal asks for the count.
    const confirmModal = page.getByTestId('confirm-modal');
    await expect(confirmModal).toBeVisible();
    await expect(confirmModal).toContainText('Delete 2 components?');
    await page.getByTestId('confirm-modal-confirm').click();

    // Rows optimistically removed.
    await expect(rowA).toHaveCount(0);
    await expect(rowB).toHaveCount(0);
    await expect(rows).toHaveCount(initialCount - 2);
    await expect(page.getByTestId('selection-bar')).toHaveCount(0);

    // Sonner toast with Undo.
    const toast = page.locator('[data-sonner-toast]', {
      hasText: 'Deleted 2 components',
    });
    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: /Undo/i }).click();

    // Rows restored.
    await expect(rowA).toBeVisible();
    await expect(rowB).toBeVisible();
  });

  test('bulk assign breaker from Unplaced: pick → all selected rows wired', async ({
    page,
  }) => {
    const seeded = loadSeeded();
    const ts = Date.now();
    // Create with breakerIds[0] so we can pick breakerIds[4] (a different
    // breaker) to ensure the chip changes.
    const idA = await createUnplacedOnPanel(`unp-asn-A-${ts}`, seeded.breakerIds[0]);
    const idB = await createUnplacedOnPanel(`unp-asn-B-${ts}`, seeded.breakerIds[0]);
    const targetBreakerId = seeded.breakerIds[4];

    await page.goto(`/panels/${seeded.panelId}/map?floor=${seeded.floorId}`);
    const rows = unplacedRows(page);
    await expect(rows.first()).toBeVisible();

    const rowA = page.locator(`[data-testid="unplaced-item"][data-component-id="${idA}"]`);
    const rowB = page.locator(`[data-testid="unplaced-item"][data-component-id="${idB}"]`);
    await expect(rowA).toBeVisible();
    await expect(rowB).toBeVisible();

    await checkUnplacedRow(rowA);
    await checkUnplacedRow(rowB);
    await expect(page.getByTestId('selection-bar')).toBeVisible();

    // Click Assign breaker — picker modal opens.
    await page.getByTestId('bulk-assign').click();
    const picker = page.getByTestId('picker-modal');
    await expect(picker).toBeVisible();

    const option = picker.locator(
      `[data-testid="picker-modal-option"][data-value="${targetBreakerId}"]`
    );
    await expect(option).toBeVisible();
    await option.click();

    // Picker closes; bar dismisses on success.
    await expect(picker).toHaveCount(0);
    await expect(page.getByTestId('selection-bar')).toHaveCount(0);

    // After refresh, the two rows should still be in the Unplaced
    // section (they're still unplaced — only the breaker changed).
    // Their meta line should now mention the target breaker's slot.
    await expect(rowA).toBeVisible();
    await expect(rowB).toBeVisible();

    // Verify via API that the breakerId actually changed on both.
    const getRes = async (id: string): Promise<{ breakerId: string | null }> => {
      const res = await authedFetch(`${E2E_BACKEND_URL}/api/v1/components/${id}`);
      const body = (await res.json()) as {
        data: { breakerId: string | null };
      };
      return body.data;
    };
    const compA = await getRes(idA);
    const compB = await getRes(idB);
    expect(compA.breakerId).toBe(targetBreakerId);
    expect(compB.breakerId).toBe(targetBreakerId);
  });

  test('drag-vs-select isolation: checkbox toggles, button does not', async ({
    page,
  }) => {
    const seeded = loadSeeded();
    const ts = Date.now();
    const idA = await createUnplacedOnPanel(`unp-iso-A-${ts}`, seeded.breakerIds[0]);

    await page.goto(`/panels/${seeded.panelId}/map?floor=${seeded.floorId}`);
    const rowA = page.locator(
      `[data-testid="unplaced-item"][data-component-id="${idA}"]`
    );
    await expect(rowA).toBeVisible();

    // 1. Tapping checkbox toggles selection.
    await checkUnplacedRow(rowA);
    await expect(rowA).toHaveAttribute('data-selected', 'true');
    await expect(page.getByTestId('selection-bar')).toBeVisible();

    // Untoggle to reset.
    await checkUnplacedRow(rowA);
    await expect(rowA).toHaveAttribute('data-selected', 'false');
    await expect(page.getByTestId('selection-bar')).toHaveCount(0);

    // 2. Pointerdown + small move + up on the row BUTTON (not the
    //    checkbox) must NOT toggle selection. Use a regular hover then
    //    a pointer sequence that mimics a started-but-cancelled drag.
    const button = rowA.locator('.unplaced-item__btn');
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    if (box === null) throw new Error('button has no bounding box');
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    // Press, move a tiny bit, release outside any map — useMapDrag's
    // onDrop(null) fires (no PATCH) and selection state is untouched.
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 4, startY + 4);
    await page.mouse.up();

    // Selection bar should still NOT be mounted; the row data-selected
    // stays 'false'.
    await expect(rowA).toHaveAttribute('data-selected', 'false');
    await expect(page.getByTestId('selection-bar')).toHaveCount(0);
  });
});
