/**
 * 2026-06 user-feedback fixes.
 *
 * Verifies the three changes from this cycle:
 *   1. Bulk "Select all / Unselect all" toggle in the SelectionBar
 *      (testid `bulk-select-all`) — selects every visible row, then clears.
 *   2. Deferred delete finalizes on refresh: deleting a row, then reloading
 *      the page during the (now 5s) undo window, fires a `keepalive` DELETE
 *      via the `pagehide` flush so the row stays deleted instead of
 *      "reappearing" on next load.
 *   3. Floor backdrop image upload lives on FloorEditScreen
 *      (`/floors/:id/edit`): Add → image renders as the canvas underlay →
 *      Remove → underlay gone.
 *
 * Deterministic waits only (cycle-21 pin) — no page.waitForTimeout.
 */

import { test, expect, type Page, type Locator } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type SeededState = { seeded?: { floorId: string } };

const seededFloorId = (): string => {
  const state = JSON.parse(
    readFileSync(join(__dirname, '.state.json'), 'utf8')
  ) as SeededState;
  if (state.seeded === undefined) throw new Error('.state.json missing seeded');
  return state.seeded.floorId;
};

const componentRows = (page: Page): Locator => page.getByTestId('component-row');

const checkRow = async (row: Locator): Promise<void> => {
  await row.locator('label.checkbox').click();
};

// A minimal valid 1×1 PNG (magic bytes pass the backend's sniffImage check).
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64'
);

test.describe('2026-06 fixes', () => {
  test('SelectionBar Select all / Unselect all toggles every visible row', async ({
    page,
  }) => {
    await page.goto('/components');
    const rows = componentRows(page);
    await expect(rows.first()).toBeVisible();
    const total = await rows.count();
    expect(total).toBeGreaterThanOrEqual(3);

    // Enter selection mode by checking one row → SelectionBar appears.
    await checkRow(rows.nth(0));
    await expect(page.getByTestId('selection-bar')).toBeVisible();
    await expect(page.getByTestId('selection-bar-count')).toHaveText('1');

    // Select all — count jumps to the full visible total, label flips.
    const selectAll = page.getByTestId('bulk-select-all');
    await expect(selectAll).toHaveText('Select all');
    await selectAll.click();
    await expect(page.getByTestId('selection-bar-count')).toHaveText(
      String(total)
    );
    await expect(selectAll).toHaveText('Unselect all');

    // Every row reflects data-selected="true".
    for (let i = 0; i < total; i++) {
      await expect(rows.nth(i)).toHaveAttribute('data-selected', 'true');
    }

    // Unselect all — selection empties, bar dismisses.
    await selectAll.click();
    await expect(page.getByTestId('selection-bar')).toHaveCount(0);
  });

  test('deferred delete finalizes on refresh (no resurrection)', async ({
    page,
    request,
  }) => {
    // Seed our OWN throwaway component via REST (the `request` fixture
    // inherits the auth cookie) — this test is destructive, so it must NOT
    // delete a shared seeded row that other specs (e.g. smoke) depend on.
    // CLAUDE.md isolation rule: destructive specs seed their own fixture.
    const createRes = await request.post('/api/v1/components', {
      data: { name: 'Scratch Delete Victim', type: 'other' },
    });
    expect(createRes.ok()).toBeTruthy();
    const victimId = ((await createRes.json()) as { data: { id: string } }).data
      .id;

    await page.goto('/components');
    const rows = componentRows(page);
    await expect(rows.first()).toBeVisible();
    const victimRow = page.locator(`[data-component-id="${victimId}"]`);
    await expect(victimRow).toBeVisible();

    // Delete it via the bulk path (single selection → confirm).
    await checkRow(victimRow);
    await page.getByTestId('bulk-delete').click();
    const confirmModal = page.getByTestId('confirm-modal');
    await expect(confirmModal).toBeVisible();
    await page.getByTestId('confirm-modal-confirm').click();

    // Optimistically removed from the list.
    await expect(victimRow).toHaveCount(0);

    // Reload IMMEDIATELY — far inside the 5s undo window. The old page's
    // setTimeout dies with its JS context on reload, so the ONLY thing that
    // can commit this delete is the `pagehide` flush firing the keepalive
    // DELETE. Poll the backend directly (request fixture inherits the auth
    // cookie) until the component is gone — proving the refresh finalized it.
    await page.reload();
    await expect
      .poll(
        async () => {
          const res = await request.get('/api/v1/components');
          const body = (await res.json()) as { data: { id: string }[] };
          return body.data.some((c) => c.id === victimId);
        },
        { message: 'component should be deleted server-side after refresh' }
      )
      .toBe(false);

    // And the UI never shows it again on a fresh load.
    await page.reload();
    await expect(rows.first()).toBeVisible();
    await expect(
      page.locator(`[data-component-id="${victimId}"]`)
    ).toHaveCount(0);
  });

  test('floor backdrop upload + remove on FloorEditScreen', async ({ page }) => {
    const floorId = seededFloorId();
    await page.goto(`/floors/${floorId}/edit`);

    // Header shows the Add-backdrop control; seeded floor has no plan yet.
    const uploadBtn = page.getByTestId('floor-edit-backdrop-upload');
    await expect(uploadBtn).toBeVisible();
    await expect(uploadBtn).toContainText('Add backdrop');
    await expect(page.locator('img.floor-plan__img')).toHaveCount(0);

    // Upload a tiny PNG directly into the hidden file input.
    await page
      .getByTestId('floor-edit-backdrop-input')
      .setInputFiles({
        name: 'plan.png',
        mimeType: 'image/png',
        buffer: PNG_1X1,
      });

    // The image renders as the canvas underlay; button flips to Replace.
    await expect(page.locator('img.floor-plan__img')).toBeVisible();
    await expect(uploadBtn).toContainText('Replace backdrop');
    const removeBtn = page.getByTestId('floor-edit-backdrop-remove');
    await expect(removeBtn).toBeVisible();

    // Remove it → confirm → underlay gone, button back to Add.
    await removeBtn.click();
    const confirmModal = page.getByTestId('confirm-modal');
    await expect(confirmModal).toBeVisible();
    await page.getByTestId('confirm-modal-confirm').click();

    await expect(page.locator('img.floor-plan__img')).toHaveCount(0);
    await expect(uploadBtn).toContainText('Add backdrop');
  });
});
