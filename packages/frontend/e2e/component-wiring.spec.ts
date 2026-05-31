/**
 * Cycle-39 / G31 — wire a component to a breaker from the edit form.
 *
 * 2026-05 updates this spec to the current UX:
 *  - Editing a component opens a bottom-sheet **Modal** (`edit-component-modal`)
 *    — no longer an inline `li.component-row--editing` swap.
 *  - The breaker field is the **BreakerComboField** (searchable popover with
 *    panel pills + rich rows), NOT a `<select>`. The panel is still derived
 *    from the chosen breaker (one-step wiring).
 *
 * Hard rules from cycle-21:
 *  - No page.waitForTimeout.
 *  - Both Playwright projects (mobile + desktop) must pass.
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCREENSHOTS_DIR = join(__dirname, '.screenshots');
mkdirSync(SCREENSHOTS_DIR, { recursive: true });

import { authedFetch, E2E_BACKEND_URL } from './authed-fetch.js';

/** POST a fresh unwired component so each test has its own clean slate. */
const createUnwiredComponent = async (name: string): Promise<string> => {
  const res = await authedFetch(`${E2E_BACKEND_URL}/api/v1/components`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'junction_box',
      name,
      room: null,
      notes: null,
      breakerId: null,
    }),
  });
  const body = (await res.json()) as { data: { id: string } };
  return body.data.id;
};

/** Open the edit modal for a row. The Edit control is on the always-visible
 *  row on desktop (icon, ≥720px) and in the expanded detail on mobile, so try
 *  the header icon first and fall back to expand → detail Edit. */
const openEditModal = async (page: Page, row: Locator): Promise<Locator> => {
  const headerEdit = row.getByTestId('component-row-edit');
  if (await headerEdit.isVisible().catch(() => false)) {
    await headerEdit.click();
  } else {
    await row.getByTestId('component-row-expand').click();
    await row.getByRole('button', { name: /Edit component/i }).click();
  }
  const modal = page.getByTestId('edit-component-modal');
  await expect(modal).toBeVisible();
  return modal;
};

test.describe('G31 component-edit wiring @cycle-39', () => {
  test('Edit opens a modal with a single breaker picker (combo)', async ({
    page,
  }, info) => {
    const targetName = `cycle39-unwired-${Date.now()}`;
    await createUnwiredComponent(targetName);

    await page.goto('/library');
    await expect(
      page.getByRole('heading', { name: 'Library', exact: true })
    ).toBeVisible();

    const row = page.locator('li.component-row', { hasText: targetName });
    await expect(row).toBeVisible();

    const modal = await openEditModal(page, row);

    // ONE breaker picker (panel auto-derived). It's the combo, not a <select>.
    const trigger = modal.getByTestId('cf-breaker-trigger');
    await expect(trigger).toBeVisible();
    await expect(modal.locator('select[data-testid="cf-breaker"]')).toHaveCount(0);
    // Unwired → the trigger reads the placeholder.
    await expect(trigger).toContainText(/Unassigned/i);

    // Open it → rich breaker rows are listed (grouped by panel pills).
    await trigger.click();
    const popover = page.getByTestId('cf-breaker-popover');
    await expect(popover).toBeVisible();
    await expect(page.getByTestId('breaker-combo-option').first()).toBeVisible();

    await page.screenshot({
      path: join(SCREENSHOTS_DIR, `cycle39-wiring-${info.project.name}.png`),
      fullPage: false,
      clip: { x: 0, y: 0, width: page.viewportSize()!.width, height: 800 },
    });
  });

  test('Picking a breaker in one step saves the wiring (panel derived)', async ({
    page,
  }) => {
    const targetName = `cycle39-wire-${Date.now()}`;
    const componentId = await createUnwiredComponent(targetName);

    await page.goto('/library');
    await expect(
      page.getByRole('heading', { name: 'Library', exact: true })
    ).toBeVisible();

    const row = page.locator('li.component-row', { hasText: targetName });
    const modal = await openEditModal(page, row);

    // Pick the first real breaker directly (no panel step).
    await modal.getByTestId('cf-breaker-trigger').click();
    const firstOption = page.getByTestId('breaker-combo-option').first();
    await expect(firstOption).toBeVisible();
    await firstOption.click();
    // The trigger now reflects a real breaker (not the placeholder).
    await expect(modal.getByTestId('cf-breaker-trigger')).not.toContainText(
      /Unassigned/i
    );

    // Save → the modal closes.
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('edit-component-modal')).toBeHidden();

    // The wiring persisted (breakpoint-independent check via the API).
    await expect(async () => {
      const res = await authedFetch(
        `${E2E_BACKEND_URL}/api/v1/components/${componentId}`
      );
      const body = (await res.json()) as { data: { breakerId: string | null } };
      expect(body.data.breakerId).not.toBeNull();
    }).toPass();
  });

  test('Already-wired component opens with its breaker pre-selected', async ({
    page,
  }) => {
    await page.goto('/library');

    // "Kitchen Outlet 1" is seeded wired to a breaker.
    const row = page.locator('li.component-row', {
      hasText: 'Kitchen Outlet 1',
    });
    await expect(row).toBeVisible();

    const modal = await openEditModal(page, row);

    // The picker trigger shows the wired breaker, not the placeholder.
    await expect(modal.getByTestId('cf-breaker-trigger')).not.toContainText(
      /Unassigned/i
    );
  });
});
