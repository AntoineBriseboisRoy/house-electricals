/**
 * 2026-05 — BreakerComboField: the component-form "Breaker" picker.
 *
 * Combines a searchable, panel-grouped breaker list (rich rows: slot badge +
 * label + amperage + protection chip) with an inline "+ New breaker" mini-form
 * that creates a circuit without leaving the form, plus panel-selector pills
 * (shown when >1 panel) to scope the list.
 *
 * Hard rules from cycle-21:
 *  - No page.waitForTimeout.
 *  - Both Playwright projects (mobile + desktop) must pass.
 *
 * Verified DOM contract (stable testids): cf-breaker, cf-breaker-trigger,
 * cf-breaker-popover, breaker-combo-pill, breaker-combo-option,
 * breaker-combo-add, breaker-combo-mini(+ -slot/-amperage/-poles/-label/-create).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authedFetch, E2E_BACKEND_URL } from './authed-fetch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const seededPanelId = (): string => {
  const state = JSON.parse(
    readFileSync(join(__dirname, '.state.json'), 'utf8')
  ) as { seeded?: { panelId: string } };
  if (!state.seeded?.panelId) throw new Error('no seeded panelId in .state.json');
  return state.seeded.panelId;
};

const openAddComponentPicker = async (page: import('@playwright/test').Page) => {
  await page.goto('/library');
  await page.getByTestId('open-add-component').click();
  await expect(page.getByTestId('add-component-modal')).toBeVisible();
  await page.getByTestId('cf-breaker-trigger').click();
  await expect(page.getByTestId('cf-breaker-popover')).toBeVisible();
};

test.describe('breaker combo picker', () => {
  test('lists seeded breakers and selecting one fills the field', async ({
    page,
  }) => {
    await openAddComponentPicker(page);

    const options = page.getByTestId('breaker-combo-option');
    await expect(options.first()).toBeVisible();
    const count = await options.count();
    expect(count).toBeGreaterThan(0);

    // Pick the first breaker — the popover closes and the trigger reflects it.
    const firstLabel = await options.first().innerText();
    await options.first().click();
    await expect(page.getByTestId('cf-breaker-popover')).toHaveCount(0);
    // The trigger shows the chosen breaker's label (first word of the row
    // is the slot badge; the label text is part of the row text).
    const triggerText = await page.getByTestId('cf-breaker-trigger').innerText();
    expect(triggerText.length).toBeGreaterThan(0);
    expect(triggerText).not.toMatch(/Unassigned/);
    // Sanity: the row text we picked shares its label with the trigger.
    expect(firstLabel.replace(/\s+/g, ' ')).toContain(
      triggerText.split('·')[0].trim().split(' ').slice(1).join(' ').trim() ||
        triggerText.trim()
    );
  });

  test('inline "+ New breaker" creates a breaker and auto-selects it', async ({
    page,
  }) => {
    const panelId = seededPanelId();
    const label = `E2E Combo ${Date.now()}`;

    await openAddComponentPicker(page);

    await page.getByTestId('breaker-combo-add').click();
    const mini = page.getByTestId('breaker-combo-mini');
    await expect(mini).toBeVisible();

    // Slot is pre-filled with the next free slot; override to a high number
    // unlikely to collide with the seed, then fill the label.
    await page.getByTestId('breaker-combo-mini-slot').fill('41');
    await page.getByTestId('breaker-combo-mini-label').fill(label);
    await page.getByTestId('breaker-combo-mini-create').click();

    // Popover closes and the trigger now shows the created breaker.
    await expect(page.getByTestId('cf-breaker-popover')).toHaveCount(0);
    await expect(page.getByTestId('cf-breaker-trigger')).toContainText(label);

    // The breaker really exists on the server.
    const res = await authedFetch(
      `${E2E_BACKEND_URL}/api/v1/panels/${panelId}/breakers`
    );
    const body = (await res.json()) as {
      data: { id: string; label: string }[];
    };
    const created = body.data.find((b) => b.label === label);
    expect(created, 'created breaker should exist on the server').toBeTruthy();

    // Cleanup so the test is idempotent across runs.
    if (created) {
      await authedFetch(
        `${E2E_BACKEND_URL}/api/v1/breakers/${created.id}`,
        { method: 'DELETE' }
      );
    }
  });
});
