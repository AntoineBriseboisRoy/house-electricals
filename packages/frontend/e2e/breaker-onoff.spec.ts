/**
 * 2026-05 — breaker persistent on/off state e2e.
 *
 * Verifies:
 *   - Toggling a breaker off on PanelDetailScreen (list view) marks the row
 *     off and PERSISTS across a reload (DB-backed via breakers.is_on).
 *   - A state change recorded via REST shows up on the /audit screen's
 *     "On/off changes" section.
 *
 * The toggle replaces the removed Impact feature.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { authedFetch, E2E_BACKEND_URL } from './authed-fetch.js';

const STATE_FILE = join(process.cwd(), 'e2e', '.state.json');

type SeededState = {
  seeded?: { panelId: string; breakerIds: string[] };
};

const loadSeeded = (): NonNullable<SeededState['seeded']> => {
  const state = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as SeededState;
  if (state.seeded === undefined) {
    throw new Error('e2e/.state.json missing seeded ids');
  }
  return state.seeded;
};

/** Reset a breaker to ON via REST so the spec is order-independent. */
const setState = async (breakerId: string, isOn: boolean): Promise<void> => {
  const res = await authedFetch(
    `${E2E_BACKEND_URL}/api/v1/breakers/${breakerId}/state`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isOn }),
    }
  );
  if (!res.ok) {
    throw new Error(`POST state failed: ${res.status} ${await res.text()}`);
  }
};

test.describe('breaker on/off persistence', () => {
  test('toggle off persists across reload, then back on', async ({ page }) => {
    const { panelId, breakerIds } = loadSeeded();
    const breakerId = breakerIds[0]!;
    await setState(breakerId, true); // known starting state

    await page.goto(`/panels/${panelId}`);
    // Switch to LIST view so the breaker rows (with toggles) render.
    const listToggle = page
      .locator('.panel-view-toggle button', { hasText: /^List$/ })
      .first();
    await listToggle.click();

    const toggle = page.locator(
      `[data-testid="breaker-state-toggle"][data-breaker-id="${breakerId}"]`
    );
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('data-breaker-on', 'true');

    // Flip OFF.
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-breaker-on', 'false');
    await expect(
      page.locator(
        `[data-testid="breaker-off-badge"][data-breaker-id="${breakerId}"]`
      )
    ).toBeVisible();

    // Persisted: reload and confirm still off.
    await page.reload();
    await page
      .locator('.panel-view-toggle button', { hasText: /^List$/ })
      .first()
      .click();
    await expect(toggle).toHaveAttribute('data-breaker-on', 'false');

    // Flip back ON and confirm.
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-breaker-on', 'true');
  });

  test('on/off change appears in the audit log', async ({ page }) => {
    const { breakerIds } = loadSeeded();
    const breakerId = breakerIds[1] ?? breakerIds[0]!;
    // Record an explicit off event via REST.
    await setState(breakerId, false);

    await page.goto('/audit');
    const stateList = page.getByTestId('audit-state-list');
    await expect(stateList).toBeVisible();
    const row = stateList
      .locator(`[data-testid="audit-state-row"][data-breaker-id="${breakerId}"]`)
      .first();
    await expect(row).toBeVisible();
    await expect(
      row.locator('[data-testid="audit-state-row-action"]').first()
    ).toContainText(/Turned off/i);

    // Cleanup — restore ON.
    await setState(breakerId, true);
  });
});
