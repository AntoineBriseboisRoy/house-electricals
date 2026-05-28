/**
 * Cycle-76 — EmptyState illustration smoke.
 *
 * Verifies the new `.empty-state__illustration` slot renders an inline
 * SVG on the truly-empty PanelList and MapLanding routes. Desktop-only
 * (mobile coverage is implicit via mobile-overflow-triage.spec.ts).
 *
 * Strategy: the global seed creates 1 panel + 1 floor + breakers +
 * components. We DELETE every panel + every floor via REST API in
 * beforeAll (cascade clears breakers + components), assert the
 * illustrations render, then RE-SEED the full fixture in afterAll so
 * downstream specs in the project run see the canonical data.
 *
 * NO mutation of seed.ts. The spec owns its cleanup + restore.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import { seedFixtures } from './seed.js';

// Inlined (cycle-21 convention) — keep in sync with playwright.config.ts.
const E2E_BACKEND_URL = 'http://127.0.0.1:3100';

const listIds = async (
  api: APIRequestContext,
  path: string
): Promise<string[]> => {
  const res = await api.get(path);
  if (!res.ok()) {
    throw new Error(`GET ${path} → ${res.status()}`);
  }
  const json = (await res.json()) as { data: Array<{ id: string }> };
  return json.data.map((r) => r.id);
};

const del = async (api: APIRequestContext, path: string): Promise<void> => {
  const res = await api.delete(path);
  if (!res.ok() && res.status() !== 404) {
    const text = await res.text();
    throw new Error(`DELETE ${path} → ${res.status()}: ${text}`);
  }
};

test.describe('EmptyState illustration @cycle-76', () => {
  test.beforeEach(async ({}, info) => {
    test.skip(
      info.project.name !== 'desktop-1440x900',
      'desktop-only — mobile coverage lives in mobile-overflow-triage.spec.ts'
    );
  });

  test.beforeAll(async ({ request }, info) => {
    if (info.project.name !== 'desktop-1440x900') return;
    // Wipe every panel + floor + component so the EmptyState branches render.
    // Order matters: components first (they FK to floors+breakers), then
    // panels (cascades to breakers), then floors.
    const componentIds = await listIds(request, '/api/v1/components');
    for (const id of componentIds) {
      await del(request, `/api/v1/components/${id}`);
    }
    const panelIds = await listIds(request, '/api/v1/panels');
    for (const id of panelIds) {
      await del(request, `/api/v1/panels/${id}`);
    }
    const floorIds = await listIds(request, '/api/v1/floors');
    for (const id of floorIds) {
      await del(request, `/api/v1/floors/${id}`);
    }
  });

  test.afterAll(async ({}, info) => {
    if (info.project.name !== 'desktop-1440x900') return;
    // Re-seed the canonical fixture so downstream specs see the expected
    // data shape. We can swallow errors here — failure to re-seed is a
    // separate problem from the test's own assertions.
    try {
      await seedFixtures(E2E_BACKEND_URL);
    } catch (e) {
      console.error('[cycle-76 spec afterAll] re-seed failed:', e);
    }
  });

  test('PanelListScreen renders NoPanels illustration when empty', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const emptyState = page.locator('.empty-state').first();
    await expect(emptyState).toBeVisible();

    // The new illustration slot is present (NOT the old icon wrapper).
    const illustration = emptyState.locator('.empty-state__illustration');
    await expect(illustration).toBeVisible();
    await expect(illustration).toHaveCount(1);

    // The illustration contains an inline SVG.
    await expect(illustration.locator('svg').first()).toBeVisible();

    // The old icon wrapper must NOT render in this branch (mutually exclusive).
    await expect(emptyState.locator('.empty-state__icon')).toHaveCount(0);

    // Headline text rendered correctly.
    await expect(
      emptyState.getByText('No panels yet', { exact: true })
    ).toBeVisible();
  });

  test('MapLandingScreen renders NoFloors illustration when empty', async ({
    page,
  }) => {
    await page.goto('/map');
    await page.waitForLoadState('networkidle');

    const emptyState = page.locator('.empty-state').first();
    await expect(emptyState).toBeVisible();

    const illustration = emptyState.locator('.empty-state__illustration');
    await expect(illustration).toBeVisible();
    await expect(illustration).toHaveCount(1);
    await expect(illustration.locator('svg').first()).toBeVisible();

    await expect(emptyState.locator('.empty-state__icon')).toHaveCount(0);
    await expect(
      emptyState.getByText('No floors yet', { exact: true })
    ).toBeVisible();
  });

  // Cycle-77 — Part 2 coverage. Create a fresh panel (no breakers, no
  // components) so PanelDetailScreen + TestPanelScreen render their
  // newly-ported illustration EmptyStates.
  test('PanelDetailScreen + TestPanelScreen render illustrations for an empty panel', async ({
    page,
    request,
  }) => {
    const createRes = await request.post('/api/v1/panels', {
      data: { name: 'Cycle77 EmptyPanel', orientation: 'vertical', slotCount: 24 },
    });
    expect(createRes.ok()).toBeTruthy();
    const created = (await createRes.json()) as { data: { id: string } };
    const panelId = created.data.id;

    // PanelDetailScreen — "No components wired yet" — requires breakers to
    // exist but no components wired. With ZERO breakers the components-
    // on-panel section also renders the empty branch (totalWiredComponents
    // === 0). Either way the cycle-77 NoComponents illustration shows.
    await page.goto(`/panels/${panelId}`);
    await page.waitForLoadState('networkidle');

    const componentsEmpty = page
      .locator('.empty-state')
      .filter({ hasText: 'No components wired yet' });
    await expect(componentsEmpty).toBeVisible();
    await expect(
      componentsEmpty.locator('.empty-state__illustration svg').first()
    ).toBeVisible();
    await expect(componentsEmpty.locator('.empty-state__icon')).toHaveCount(0);

    // TestPanelScreen "No breakers yet" — panel has zero breakers.
    await page.goto(`/panels/${panelId}/test`);
    await page.waitForLoadState('networkidle');

    const breakersEmpty = page
      .locator('.empty-state')
      .filter({ hasText: 'No breakers yet' });
    await expect(breakersEmpty).toBeVisible();
    await expect(
      breakersEmpty.locator('.empty-state__illustration svg').first()
    ).toBeVisible();
    await expect(breakersEmpty.locator('.empty-state__icon')).toHaveCount(0);
  });
});
