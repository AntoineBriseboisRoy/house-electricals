/**
 * Cycle-42 / G34 — tandem breakers are two independent circuits ("6a" + "6b").
 *
 * User quote: "tandem breaker need to be treated as 6a and 6b for example,
 *              cause they are really 2 circuits in the end."
 *
 * Frontend contract (mirrors server-side):
 *   1. Picking poles='tandem' reveals the Tandem half (a / b) picker.
 *   2. Submitting tandem without picking a half is rejected.
 *   3. Two tandems CAN share one slot — one 'a', one 'b'.
 *   4. Two 'a' tandems on the same slot are rejected.
 *   5. Tandem cannot land on a slot already taken by a single/double breaker.
 *   6. The panel viz renders a tandem-pair container with two clickable
 *      sub-cells, each carrying its own breaker id.
 *   7. The breaker row label shows "Slot Na" / "Slot Nb".
 *
 * Seed: panel 24 slots, breakers on 1, 2, 3-4 (double), 5, 6, 7.
 * Slot 8 is the first free single slot; we use it for the tandem-pair test.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type SeededState = {
  seeded?: { panelId: string };
};

const loadSeeded = (): NonNullable<SeededState['seeded']> => {
  const state = JSON.parse(
    readFileSync(join(__dirname, '.state.json'), 'utf8')
  ) as SeededState;
  if (!state.seeded) throw new Error('no seed');
  return state.seeded;
};

const openAddBreakerForm = async (
  page: import('@playwright/test').Page,
  panelId: string
): Promise<void> => {
  await page.goto(`/panels/${panelId}`);
  const toggle = page.getByTestId('open-add-breaker');
  if (await toggle.count()) {
    await toggle.click();
  }
  await expect(page.getByLabel('Slot', { exact: true })).toBeVisible();
};

const fillBreakerBasics = async (
  page: import('@playwright/test').Page,
  opts: { slot: string; label: string; poles?: 'single' | 'double' | 'tandem' }
): Promise<void> => {
  await page.getByLabel('Slot', { exact: true }).fill(opts.slot);
  await page.getByLabel('Label', { exact: true }).fill(opts.label);
  if (opts.poles) {
    await page.getByLabel('Poles').selectOption(opts.poles);
  }
};

test.describe('G34 tandem breakers as 6a/6b @cycle-42', () => {
  test('tandem-half picker is hidden until poles=tandem', async ({ page }) => {
    const { panelId } = loadSeeded();
    await openAddBreakerForm(page, panelId);
    // Default poles='single' → no half picker.
    await expect(page.getByTestId('bf-tandem-half')).toHaveCount(0);
    // Switch to tandem → picker appears.
    await page.getByLabel('Poles').selectOption('tandem');
    await expect(page.getByTestId('bf-tandem-half')).toBeVisible();
    // Switch back to single → picker hides again.
    await page.getByLabel('Poles').selectOption('single');
    await expect(page.getByTestId('bf-tandem-half')).toHaveCount(0);
  });

  test('tandem without a half is rejected', async ({ page }) => {
    const { panelId } = loadSeeded();
    await openAddBreakerForm(page, panelId);
    await fillBreakerBasics(page, {
      slot: '20',
      label: 'no-half tandem',
      poles: 'tandem',
    });
    // Do NOT pick a half — submit and expect an error.
    await page.getByRole('button', { name: 'Add breaker' }).click();
    await expect(
      page.getByText(/Tandem breakers must pick a half/i).first()
    ).toBeVisible();
  });

  test('tandem cannot land on a slot taken by a single breaker', async ({
    page,
  }) => {
    const { panelId } = loadSeeded();
    await openAddBreakerForm(page, panelId);
    // Slot 1 is already a single-pole "Kitchen lights" in the seed.
    await fillBreakerBasics(page, {
      slot: '1',
      label: 'tandem collide',
      poles: 'tandem',
    });
    await page.getByTestId('bf-tandem-half').selectOption('a');
    await page.getByRole('button', { name: 'Add breaker' }).click();
    await expect(
      page.getByText(/Slot 1 is already taken/i).first()
    ).toBeVisible();
  });

  test('two tandem halves (a + b) can share one slot, render as a pair', async ({
    page,
  }) => {
    const { panelId } = loadSeeded();
    await openAddBreakerForm(page, panelId);
    // Create the 'a' half on slot 20.
    await fillBreakerBasics(page, {
      slot: '20',
      label: 'tandem A',
      poles: 'tandem',
    });
    await page.getByTestId('bf-tandem-half').selectOption('a');
    await page.getByRole('button', { name: 'Add breaker' }).click();

    // Form should reset (Add panel is collapsed again post-success on some
    // screens, or fields cleared). Open again + create the 'b' half.
    await openAddBreakerForm(page, panelId);
    await fillBreakerBasics(page, {
      slot: '20',
      label: 'tandem B',
      poles: 'tandem',
    });
    await page.getByTestId('bf-tandem-half').selectOption('b');
    await page.getByRole('button', { name: 'Add breaker' }).click();

    // Default view is 'viz' — each tandem half is a button whose
    // aria-label starts with "Slot 20a: ..." / "Slot 20b: ...".
    await expect(
      page.getByRole('button', { name: /Slot 20a:/i })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Slot 20b:/i })
    ).toBeVisible();

    // The pair container holds two clickable sub-cells, each with its own
    // slot-cell-<id> id. Assert the pair is visible and contains two
    // slot-cells (one per half).
    const pair = page.locator('.panel-viz__slot--tandem-pair').first();
    await expect(pair).toBeVisible();
    const subCells = pair.locator('[data-testid="slot-cell"]');
    await expect(subCells).toHaveCount(2);

    // Switch to list view and verify the "Slot 20a" / "Slot 20b" labels
    // also appear in BreakerRow (the cycle-42 BreakerRow suffix contract).
    await page.getByRole('tab', { name: /list/i }).click();
    await expect(page.getByText(/^Slot 20a$/i).first()).toBeVisible();
    await expect(page.getByText(/^Slot 20b$/i).first()).toBeVisible();
  });

  test('clicking an empty tandem half pre-fills the form with poles=tandem + that half', async ({
    page,
    request,
    baseURL,
  }) => {
    // Cycle-42 follow-up: an empty tandem half is one that's the partner
    // of an already-filled tandem slot (e.g. slot 14 has 14a but not 14b
    // yet). Clicking 14b should pre-fill the Add-breaker form with
    // slot=14, poles=tandem, tandemHalf='b' — saving the user 3 taps.
    const { panelId } = loadSeeded();
    // Seed half-a on slot 14 via API so the panel viz has a tandem-pair
    // cell with one filled + one empty sub-cell.
    const seeded = await request.post(
      `${baseURL}/api/v1/panels/${panelId}/breakers`,
      {
        data: {
          slot: '14',
          slotPosition: 14,
          amperage: 15,
          poles: 'tandem',
          tandemHalf: 'a',
          label: 'pair-seed A',
        },
      }
    );
    expect(seeded.ok()).toBe(true);

    await page.goto(`/panels/${panelId}`);
    // Click the empty 14b sub-cell.
    const emptyHalfB = page.locator(
      '[data-tandem-half="b"].panel-viz__slot--empty'
    ).first();
    await expect(emptyHalfB).toBeVisible();
    await emptyHalfB.click();

    // The Add-a-breaker form should now be visible (auto-opened) with the
    // slot + poles + half pre-filled.
    await expect(page.getByLabel('Slot', { exact: true })).toHaveValue('14');
    await expect(page.getByLabel('Poles')).toHaveValue('tandem');
    // Half picker is visible because poles=tandem, and 'b' is selected.
    await expect(page.getByTestId('bf-tandem-half')).toHaveValue('b');
  });

  test('rejects a second tandem-a on a slot already holding a tandem-a', async ({
    page,
    request,
    baseURL,
  }) => {
    // This case is best-tested via the API directly — the UI happy-path
    // already exercises the (a+b) acceptance; here we want to prove that
    // the (a+a) collision returns 400.
    const { panelId } = loadSeeded();

    // Create the first 'a' tandem on slot 22.
    const first = await request.post(
      `${baseURL}/api/v1/panels/${panelId}/breakers`,
      {
        data: {
          slot: '22',
          slotPosition: 22,
          amperage: 15,
          poles: 'tandem',
          tandemHalf: 'a',
          label: 'tandem A1',
        },
      }
    );
    expect(first.ok()).toBe(true);

    // Try to add a SECOND 'a' on the same slot — must fail with 400.
    const dup = await request.post(
      `${baseURL}/api/v1/panels/${panelId}/breakers`,
      {
        data: {
          slot: '22',
          slotPosition: 22,
          amperage: 15,
          poles: 'tandem',
          tandemHalf: 'a',
          label: 'tandem A2',
        },
      }
    );
    expect(dup.status()).toBe(400);
    const body = (await dup.json()) as { error?: { message?: string } };
    expect(body.error?.message ?? '').toMatch(/already taken/i);
  });
});
