/**
 * Cycle-39 / G31 — wire a component to a breaker from the edit form.
 *
 * The seed includes "Ceiling Junction" with breakerId === null (the
 * unwired junction box on Living Room). Open its Edit form, pick the
 * panel from the new Wiring section, pick a breaker, save, and verify
 * the row's chip changes from "Not wired to any breaker" to the
 * breaker's slot/label.
 *
 * Hard rules from cycle-21:
 *  - No page.waitForTimeout.
 *  - Both Playwright projects (mobile + desktop) must pass.
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
  seeded?: { panelId: string; breakerIds: string[]; componentIds: string[] };
};

const loadSeeded = (): NonNullable<SeededState['seeded']> => {
  const state = JSON.parse(
    readFileSync(join(__dirname, '.state.json'), 'utf8')
  ) as SeededState;
  if (!state.seeded) throw new Error('no seed');
  return state.seeded;
};

const E2E_BACKEND_URL = 'http://127.0.0.1:3100';

/** POST a fresh unwired component so each test has its own clean slate
 *  (the seed's Ceiling Junction would otherwise drift between tests). */
const createUnwiredComponent = async (name: string): Promise<string> => {
  const res = await fetch(`${E2E_BACKEND_URL}/api/v1/components`, {
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
  test('Wiring section appears in Edit form with panel + breaker selectors', async ({
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
    await row.getByRole('button', { name: /Edit component/i }).click();

    // Two ComponentForms render on this page (create + edit). Scope to
    // the .component-row--editing row so we only see the edit form.
    const editingRow = page.locator('li.component-row--editing');
    await expect(editingRow).toBeVisible();

    // The Wiring section should now be visible with both selectors.
    await expect(editingRow.getByTestId('cf-panel')).toBeVisible();
    await expect(editingRow.getByTestId('cf-breaker')).toBeVisible();

    // Initially nothing is wired → both at default ('').
    await expect(editingRow.getByTestId('cf-panel')).toHaveValue('');
    await expect(editingRow.getByTestId('cf-breaker')).toBeDisabled();

    await page.screenshot({
      path: join(
        SCREENSHOTS_DIR,
        `cycle39-wiring-section-${info.project.name}.png`
      ),
      fullPage: false,
      clip: { x: 0, y: 0, width: page.viewportSize()!.width, height: 800 },
    });
  });

  test('Selecting a panel enables the breaker dropdown; selecting both saves the wiring', async ({
    page,
  }) => {
    const { panelId } = loadSeeded();
    // Fresh unwired component just for this test.
    const targetName = `cycle39-wire-${Date.now()}`;
    await createUnwiredComponent(targetName);

    await page.goto('/library');
    await expect(
      page.getByRole('heading', { name: 'Library', exact: true })
    ).toBeVisible();

    const row = page.locator('li.component-row', { hasText: targetName });
    await row.getByRole('button', { name: /Edit component/i }).click();
    const editingRow = page.locator('li.component-row--editing');

    // Pick the seeded "Main Panel" from the Panel select.
    await editingRow.getByTestId('cf-panel').selectOption(panelId);

    // Breaker select should now be enabled.
    await expect(editingRow.getByTestId('cf-breaker')).toBeEnabled();

    // Pick the first breaker (Kitchen lights, slot 1).
    const breakerSel = editingRow.getByTestId('cf-breaker');
    const options = await breakerSel.locator('option').all();
    // First option is the placeholder ("— choose a breaker —"); pick option[1].
    const firstRealBreakerValue = await options[1].getAttribute('value');
    expect(firstRealBreakerValue).not.toBeNull();
    expect(firstRealBreakerValue).not.toBe('');
    await breakerSel.selectOption(firstRealBreakerValue!);

    // Save the form.
    await editingRow.getByRole('button', { name: 'Save' }).click();

    // Row should re-render with a wired breaker chip.
    const updatedRow = page.locator('li.component-row', { hasText: targetName });
    await expect(updatedRow).toBeVisible();
    // The breaker chip should now say "slot 1 · Kitchen lights" (the
    // first seeded breaker). And the Unassigned badge should be gone.
    await expect(updatedRow.getByText(/slot 1/i).first()).toBeVisible();
    await expect(updatedRow.getByText('Unassigned')).not.toBeVisible();
  });

  test('Already-wired component opens with its panel + breaker pre-selected', async ({
    page,
  }) => {
    const { panelId } = loadSeeded();
    await page.goto('/library');

    // "Kitchen Outlet 1" is seeded as wired to a breaker. Open its edit form.
    const row = page.locator('li.component-row', {
      hasText: 'Kitchen Outlet 1',
    });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: /Edit component/i }).click();
    const editingRow = page.locator('li.component-row--editing');

    // The Panel select should show the seeded panel.
    await expect(editingRow.getByTestId('cf-panel')).toHaveValue(panelId);
    // The Breaker select should have a non-empty value.
    const breakerVal = await editingRow.getByTestId('cf-breaker').inputValue();
    expect(breakerVal).not.toBe('');
  });
});
