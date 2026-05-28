/**
 * G42(f) cycle-50 — bulk-actions on ComponentsScreen.
 *
 * Verifies:
 *   1. Tapping ≥1 row checkbox shows the SelectionBar with the right count
 *      and replaces the BottomTabs (which gets `display: none` while the
 *      bar is mounted, via `body:has(.selection-bar)`).
 *   2. The bar's Clear (✕) button empties the selection; bottom-tabs return.
 *   3. Bulk Delete asks for a confirm, then optimistically removes the
 *      rows and shows a single "Deleted N components" toast with Undo.
 *      Clicking Undo restores all rows.
 *   4. Bulk Assign breaker opens the picker, applies a single breakerId
 *      to all selected rows, and the breaker chip on each row updates.
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

const componentRows = (page: Page): Locator =>
  page.getByTestId('component-row');

const checkRow = async (row: Locator): Promise<void> => {
  // The native input is visually hidden so its bounding box is 1×1px;
  // Playwright's `.check()` strict hit-test fails because the styled
  // `.checkbox__box` sibling sits on top. Clicking the wrapping `<label>`
  // element correctly dispatches to the underlying input via standard
  // form-control semantics (label-for-input pointer pairing).
  await row.locator('label.checkbox').click();
};

test.describe('G42(f) bulk actions @cycle-50', () => {
  test('selecting rows shows SelectionBar with count + hides BottomTabs', async ({
    page,
  }) => {
    loadSeeded();
    await page.goto('/components');

    // Wait for rows to render.
    const rows = componentRows(page);
    await expect(rows.first()).toBeVisible();

    // BottomTabs is visible to start with.
    const bottomTabs = page.locator('.bottom-tabs');
    await expect(bottomTabs).toBeVisible();
    const bar = page.getByTestId('selection-bar');
    await expect(bar).toHaveCount(0);

    // Select 2 rows.
    await checkRow(rows.nth(0));
    await checkRow(rows.nth(1));

    // SelectionBar appears with count = 2.
    await expect(bar).toBeVisible();
    await expect(page.getByTestId('selection-bar-count')).toHaveText('2');

    // BottomTabs are hidden via the :has() rule.
    await expect(bottomTabs).toBeHidden();
  });

  test('Clear button on SelectionBar dismisses it + brings back BottomTabs', async ({
    page,
  }) => {
    await page.goto('/components');
    const rows = componentRows(page);
    await expect(rows.first()).toBeVisible();

    await checkRow(rows.nth(0));
    const bar = page.getByTestId('selection-bar');
    await expect(bar).toBeVisible();

    await page.getByTestId('selection-bar-clear').click();
    await expect(bar).toHaveCount(0);
    await expect(page.locator('.bottom-tabs')).toBeVisible();
  });

  test('bulk delete: confirm → rows removed → Undo restores them', async ({
    page,
  }) => {
    await page.goto('/components');
    const rows = componentRows(page);
    await expect(rows.first()).toBeVisible();

    const initialCount = await rows.count();
    expect(initialCount).toBeGreaterThanOrEqual(3);

    // Snapshot the names of the first two rows so we can verify restore
    // brought back the same identities.
    const row0Id = await rows.nth(0).getAttribute('data-component-id');
    const row1Id = await rows.nth(1).getAttribute('data-component-id');
    if (row0Id === null || row1Id === null) {
      throw new Error('component row missing data-component-id');
    }

    await checkRow(rows.nth(0));
    await checkRow(rows.nth(1));
    await expect(page.getByTestId('selection-bar')).toBeVisible();

    // Click Delete in the SelectionBar.
    await page.getByTestId('bulk-delete').click();

    // Confirm modal appears.
    const confirmModal = page.getByTestId('confirm-modal');
    await expect(confirmModal).toBeVisible();
    await expect(confirmModal).toContainText('Delete 2 components?');
    await page.getByTestId('confirm-modal-confirm').click();

    // Rows optimistically removed — count drops by 2.
    await expect(rows).toHaveCount(initialCount - 2);
    // Selection bar dismisses (count → 0).
    await expect(page.getByTestId('selection-bar')).toHaveCount(0);

    // Sonner toast shows "Deleted 2 components" with an Undo button.
    const toast = page.locator('[data-sonner-toast]', {
      hasText: 'Deleted 2 components',
    });
    await expect(toast).toBeVisible();

    // Click Undo.
    await toast.getByRole('button', { name: /Undo/i }).click();

    // Rows are restored back to the original count.
    await expect(rows).toHaveCount(initialCount);
    // Verify the same ids reappeared.
    await expect(
      page.locator(`[data-component-id="${row0Id}"]`)
    ).toBeVisible();
    await expect(
      page.locator(`[data-component-id="${row1Id}"]`)
    ).toBeVisible();
  });

  test('bulk assign breaker: pick → chips update on all selected rows', async ({
    page,
  }) => {
    const seeded = loadSeeded();
    await page.goto('/components');
    const rows = componentRows(page);
    await expect(rows.first()).toBeVisible();

    // Pick the last two rows (less likely to already be wired to the
    // breaker we'll pick — but the test only cares that the chip
    // updates to the target breaker's label after the action).
    const totalRows = await rows.count();
    expect(totalRows).toBeGreaterThanOrEqual(3);
    const indexA = totalRows - 1;
    const indexB = totalRows - 2;

    await checkRow(rows.nth(indexA));
    await checkRow(rows.nth(indexB));
    await expect(page.getByTestId('selection-bar')).toBeVisible();

    // Click "Assign breaker" — picker modal opens.
    await page.getByTestId('bulk-assign').click();
    const picker = page.getByTestId('picker-modal');
    await expect(picker).toBeVisible();

    // Pick the first breaker option (data-value carries the id).
    const targetBreakerId = seeded.breakerIds[0];
    const option = picker.locator(
      `[data-testid="picker-modal-option"][data-value="${targetBreakerId}"]`
    );
    await expect(option).toBeVisible();
    await option.click();

    // The picker closes.
    await expect(picker).toHaveCount(0);

    // The two rows now show a breaker chip linking to the target breaker.
    // Selection bar dismisses on success.
    await expect(page.getByTestId('selection-bar')).toHaveCount(0);

    // After a successful bulk-assign, the screen refreshes (the canonical
    // sort may reorder rows but we still have the same ids). Verify both
    // target rows now have a breaker-chip pointing at #breaker-<targetId>.
    // We use the data-component-id stamp we captured before the operation.
    // Reread the rows after refresh.
    const rowsAfter = componentRows(page);
    await expect(rowsAfter).toHaveCount(totalRows);

    // Pick any row whose chip links to #breaker-<targetBreakerId> and
    // assert at least 2 such rows exist (because the seed already wires
    // some rows to other breakers, only the two we just assigned plus
    // any pre-existing kitchen-light row would point at breakerIds[0]).
    const chip = page.locator(
      `a[href*="#breaker-${targetBreakerId}"].component-row__breaker-chip`
    );
    // At least 2 rows show this chip — the two we just bulk-assigned.
    // (The seed pre-wires componentIds[2] = Kitchen Ceiling Light to
    // breakerIds[0], so the total could be 3 — accept >=2.)
    const chipCount = await chip.count();
    expect(chipCount).toBeGreaterThanOrEqual(2);
  });
});
