/**
 * Cycle-41 / G33 — breaker slot validation in the Add-a-breaker form.
 *
 * User quote: "When adding a breaker, I should have validation that I
 * can only enter a valid breaker slot. Anything else should not work."
 *
 * Frontend rules (mirror server-side):
 *   1. Slot must be a whole number (no "A12", no decimals, no empty).
 *   2. Slot must be in [1, panel.slotCount].
 *   3. Slot must not collide with an existing breaker.
 *   4. Double-pole: slot+1 must also be in range AND free.
 *
 * Seed: panel has 24 slots, breakers on 1, 2, 3-4 (double-pole), 5, 6, 7.
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

const openAddBreakerForm = async (page: import('@playwright/test').Page, panelId: string): Promise<void> => {
  await page.goto(`/panels/${panelId}`);
  // The Add-a-breaker section is collapsed by default once a panel has
  // any breakers (cycle 29). Click the toggle if present, otherwise the
  // form is already open (empty-panel state).
  const toggle = page.getByTestId('open-add-breaker');
  if (await toggle.count()) {
    await toggle.click();
  }
  await expect(page.getByLabel('Slot', { exact: true })).toBeVisible();
};

test.describe('G33 breaker slot validation @cycle-41', () => {
  test('slot input is a number field with min=1 and max=24', async ({ page }) => {
    const { panelId } = loadSeeded();
    await openAddBreakerForm(page, panelId);
    const slot = page.getByLabel('Slot', { exact: true });
    await expect(slot).toHaveAttribute('type', 'number');
    await expect(slot).toHaveAttribute('min', '1');
    await expect(slot).toHaveAttribute('max', '24');
  });

  test('submitting empty slot shows an error', async ({ page }) => {
    const { panelId } = loadSeeded();
    await openAddBreakerForm(page, panelId);
    // Fill required Label so only slot is the blocker.
    await page.getByLabel('Label', { exact: true }).fill('test');
    // Click Add breaker without setting slot.
    await page.getByRole('button', { name: 'Add breaker' }).click();
    // Empty input fails zod's `string().min(1)` OR our custom validate
    // (depending on RHF eval order). Either way an error message appears
    // under the Slot field — match on the standard input__error class.
    await expect(page.locator('.input__error').first()).toBeVisible();
  });

  test('out-of-range slot (25) blocks submit with helpful message', async ({ page }) => {
    const { panelId } = loadSeeded();
    await openAddBreakerForm(page, panelId);
    await page.getByLabel('Slot', { exact: true }).fill('25');
    await page.getByLabel('Label', { exact: true }).fill('out-of-range');
    await page.getByRole('button', { name: 'Add breaker' }).click();
    await expect(
      page.getByText(/24 slots — pick 1–24/i).first()
    ).toBeVisible();
  });

  test('collision with seeded slot 1 shows "already taken" message', async ({ page }) => {
    const { panelId } = loadSeeded();
    await openAddBreakerForm(page, panelId);
    await page.getByLabel('Slot', { exact: true }).fill('1');
    await page.getByLabel('Label', { exact: true }).fill('duplicate');
    await page.getByRole('button', { name: 'Add breaker' }).click();
    await expect(
      page.getByText(/Slot 1 is already taken/i).first()
    ).toBeVisible();
  });

  test('double-pole on slot 24 fails because slot 25 is out of range', async ({
    page,
  }) => {
    const { panelId } = loadSeeded();
    await openAddBreakerForm(page, panelId);
    await page.getByLabel('Slot', { exact: true }).fill('24');
    await page.getByLabel('Poles').selectOption('double');
    await page.getByLabel('Label', { exact: true }).fill('overflows');
    await page.getByRole('button', { name: 'Add breaker' }).click();
    await expect(
      page.getByText(/past the panel's 24-slot limit/i).first()
    ).toBeVisible();
  });
});
