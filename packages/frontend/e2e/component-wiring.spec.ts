/**
 * Cycle-39 / G31 — wire a component to a breaker from the edit form.
 *
 * 2026-05: the wiring picker collapsed from a cascading Panel → Breaker
 * pair into a SINGLE breaker `<select>` grouped by panel (`<optgroup>`).
 * The panel a component lives on is DERIVED from its breaker, never picked
 * separately — so wiring is one step. These specs assert that single-picker
 * contract (no more `cf-panel`, no disabled-until-panel gate).
 *
 * Hard rules from cycle-21:
 *  - No page.waitForTimeout.
 *  - Both Playwright projects (mobile + desktop) must pass.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCREENSHOTS_DIR = join(__dirname, '.screenshots');
mkdirSync(SCREENSHOTS_DIR, { recursive: true });

import { authedFetch, E2E_BACKEND_URL } from './authed-fetch.js';

/** POST a fresh unwired component so each test has its own clean slate
 *  (the seed's Ceiling Junction would otherwise drift between tests). */
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

test.describe('G31 component-edit wiring @cycle-39', () => {
  test('Wiring section shows a single (enabled) breaker picker', async ({
    page,
  }, info) => {
    // Create a fresh unwired component for this test (avoids cross-test
    // state leak — the seeded Ceiling Junction can be mutated by other
    // tests that wire it).
    const targetName = `cycle39-unwired-${Date.now()}`;
    await createUnwiredComponent(targetName);

    await page.goto('/library');
    await expect(
      page.getByRole('heading', { name: 'Library', exact: true })
    ).toBeVisible();

    // Find the row by the unique name we just created.
    const row = page.locator('li.component-row', { hasText: targetName });
    await expect(row).toBeVisible();

    // Click its Edit button.
    // 2026-05 — Edit lives in the row's expandable detail; open it first.
    await row.getByTestId('component-row-expand').click();
    await row.getByRole('button', { name: /Edit component/i }).click();

    // Two ComponentForms render on this page (create + edit). Scope to
    // the .component-row--editing row so we only see the edit form.
    const editingRow = page.locator('li.component-row--editing');
    await expect(editingRow).toBeVisible();

    // 2026-05 — ONE breaker picker (panel auto-derived). No cf-panel.
    const breakerSel = editingRow.getByTestId('cf-breaker');
    await expect(breakerSel).toBeVisible();
    // Enabled from the start (no panel-first gate) + grouped by panel.
    await expect(breakerSel).toBeEnabled();
    await expect(breakerSel).toHaveValue(''); // unwired → placeholder
    await expect(breakerSel.locator('optgroup')).not.toHaveCount(0);

    await page.screenshot({
      path: join(
        SCREENSHOTS_DIR,
        `cycle39-wiring-section-${info.project.name}.png`
      ),
      fullPage: false,
      clip: { x: 0, y: 0, width: page.viewportSize()!.width, height: 800 },
    });
  });

  test('Picking a breaker in one step saves the wiring (panel derived)', async ({
    page,
  }) => {
    // Fresh unwired component just for this test.
    const targetName = `cycle39-wire-${Date.now()}`;
    await createUnwiredComponent(targetName);

    await page.goto('/library');
    await expect(
      page.getByRole('heading', { name: 'Library', exact: true })
    ).toBeVisible();

    const row = page.locator('li.component-row', { hasText: targetName });
    // 2026-05 — Edit lives in the row's expandable detail; open it first.
    await row.getByTestId('component-row-expand').click();
    await row.getByRole('button', { name: /Edit component/i }).click();
    const editingRow = page.locator('li.component-row--editing');

    // Single grouped picker — pick the first real breaker directly (no
    // panel step). option[0] is the placeholder; option[1] is the first
    // breaker of the first panel group (Kitchen lights, slot 1).
    const breakerSel = editingRow.getByTestId('cf-breaker');
    const options = await breakerSel.locator('option').all();
    const firstRealBreakerValue = await options[1].getAttribute('value');
    expect(firstRealBreakerValue).not.toBeNull();
    expect(firstRealBreakerValue).not.toBe('');
    await breakerSel.selectOption(firstRealBreakerValue!);

    // Save the form.
    await editingRow.getByRole('button', { name: 'Save' }).click();

    // Row should re-render with a wired breaker chip.
    const updatedRow = page.locator('li.component-row', { hasText: targetName });
    await expect(updatedRow).toBeVisible();
    await expect(updatedRow.getByText(/slot 1/i).first()).toBeVisible();
    await expect(updatedRow.getByText('Unassigned')).not.toBeVisible();
  });

  test('Already-wired component opens with its breaker pre-selected', async ({
    page,
  }) => {
    await page.goto('/library');

    // "Kitchen Outlet 1" is seeded as wired to a breaker. Open its edit form.
    const row = page.locator('li.component-row', {
      hasText: 'Kitchen Outlet 1',
    });
    await expect(row).toBeVisible();
    // 2026-05 — Edit lives in the row's expandable detail; open it first.
    await row.getByTestId('component-row-expand').click();
    await row.getByRole('button', { name: /Edit component/i }).click();
    const editingRow = page.locator('li.component-row--editing');

    // The single breaker picker should have a non-empty value.
    const breakerVal = await editingRow.getByTestId('cf-breaker').inputValue();
    expect(breakerVal).not.toBe('');
  });
});
