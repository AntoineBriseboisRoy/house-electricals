/**
 * Refactor 2026-05 — Test tab navigation spec.
 *
 * Locks in the new 4-tab IA. Coverage:
 *   - 4 bottom-tabs render (Map, Panels, Test, Library).
 *   - /test → TestHomeScreen lists panels (or auto-redirects when 1).
 *   - /test/:panelId → TestPanelScreen with back to /test.
 *   - /test/audit → AuditScreen with Test tab still highlighted.
 *   - Back-compat: /audit and /panels/:id/test still work (legacy aliases).
 *   - Library tab points at /library; old /components still renders.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const loadSeed = (): { panelId: string; floorId: string } => {
  const raw = readFileSync(join(__dirname, '.state.json'), 'utf8');
  const j = JSON.parse(raw) as { seeded?: { panelId: string; floorId: string } };
  if (j.seeded === undefined) throw new Error('no seed');
  return j.seeded;
};

test.describe('Nav — Test tab + 4-tab shell @refactor', () => {
  test('bottom-tabs renders 4 tabs in the canonical order', async ({ page }) => {
    await page.goto('/');
    const labels = await page
      .locator('.bottom-tabs__link .bottom-tabs__label')
      .allTextContents();
    expect(labels).toEqual(['Map', 'Panels', 'Test', 'Library']);
  });

  test('Test tab CTA opens TestHomeScreen with the panel picker', async ({
    page,
  }) => {
    await page.goto('/test');
    await expect(
      page.getByRole('heading', { name: 'Test', exact: true })
    ).toBeVisible();
    // The picker lists at least the seeded panel + an audit-log link.
    await expect(page.locator('[data-testid="test-home-row"]')).toHaveCount(1);
    await expect(
      page.locator('[data-testid="test-home-audit-link"]')
    ).toBeVisible();
    await expect(page).toHaveURL(/\/test$/);
    await expect(
      page.locator('.bottom-tabs__link--active .bottom-tabs__label')
    ).toHaveText('Test');
  });

  test('Per-panel walk-through has back to /test when entered via /test/<id>', async ({
    page,
  }) => {
    const seed = loadSeed();
    await page.goto(`/test/${seed.panelId}`);
    await expect(
      page.getByRole('heading', { name: /Test: Main Panel/i })
    ).toBeVisible();
    // Back button navigates to /test (the Test tab home), NOT to /panels/:id.
    await page.locator('.screen-header__back').click();
    await expect(page).toHaveURL(/\/test$/);
  });

  test('/test/audit renders the audit log with Test tab highlighted', async ({
    page,
  }) => {
    await page.goto('/test/audit');
    await expect(
      page.getByRole('heading', { name: /Audit log/i })
    ).toBeVisible();
    await expect(
      page.locator('.bottom-tabs__link--active .bottom-tabs__label')
    ).toHaveText('Test');
  });

  test('Back-compat: legacy /audit + /panels/:id/test still resolve', async ({
    page,
  }) => {
    const seed = loadSeed();

    // Legacy /audit
    await page.goto('/audit');
    await expect(
      page.getByRole('heading', { name: /Audit log/i })
    ).toBeVisible();
    // Still highlights Test tab because AppShell active-state covers /audit.
    await expect(
      page.locator('.bottom-tabs__link--active .bottom-tabs__label')
    ).toHaveText('Test');

    // Legacy /panels/:id/test — back lands on panel detail (not /test) so
    // the user's history stays consistent with the entry point.
    await page.goto(`/panels/${seed.panelId}/test`);
    await expect(
      page.getByRole('heading', { name: /Test: Main Panel/i })
    ).toBeVisible();
    await page.locator('.screen-header__back').click();
    await expect(page).toHaveURL(new RegExp(`/panels/${seed.panelId}$`));
  });

  test('/library renders the components inventory with Library tab active', async ({
    page,
  }) => {
    await page.goto('/library');
    await expect(
      page.getByRole('heading', { name: 'Library', exact: true })
    ).toBeVisible();
    await expect(
      page.locator('.bottom-tabs__link--active .bottom-tabs__label')
    ).toHaveText('Library');
  });
});
