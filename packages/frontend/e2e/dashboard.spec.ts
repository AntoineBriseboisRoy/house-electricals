/**
 * G45 — home status dashboard e2e.
 *
 * Desktop-only (the card grid + links read best at the wider viewport;
 * mobile rendering is covered by mobile-overflow-triage.spec.ts which now
 * includes /dashboard in its screens[] array).
 *
 * The globalSetup seed creates 1 panel + 6 breakers + 8 components (none
 * carrying loadWatts, none critical). beforeAll augments the fixture via
 * authed REST so both the overload card AND the protection card surface a
 * non-zero count:
 *   - wires a high-load (2500W) appliance onto a 15A single-pole breaker
 *     (rated 1800W) so its circuit reads 'over' capacity.
 *   - creates one new GFCI-protected breaker with no breaker_tests, so the
 *     "untested this month" count is reliably > 0 even though the seed's
 *     breakers carry no `protection` value.
 */

import { test, expect } from '@playwright/test';
import { authedFetch, E2E_BACKEND_URL } from './authed-fetch.js';

const json = async (res: Response): Promise<{ data: unknown }> => {
  if (!res.ok) {
    throw new Error(`${res.status} ${await res.text()}`);
  }
  return (await res.json()) as { data: unknown };
};

const createdComponentIds: string[] = [];
const createdBreakerIds: string[] = [];

// Desktop-only — the per-test `info.project.name` guard (mirrors
// audit-screen.spec.ts) skips the two mobile projects; mobile rendering of
// /dashboard is regression-covered by mobile-overflow-triage's screens[].
const desktopOnly = (info: { project: { name: string } }): void => {
  test.skip(info.project.name !== 'desktop-1440x900', 'desktop-only spec');
};

test.describe('G45 status dashboard @g45', () => {

  test.beforeAll(async () => {
    // Resolve the seeded panel + its breakers.
    const panels = (
      await json(await authedFetch(`${E2E_BACKEND_URL}/api/v1/panels`))
    ).data as { id: string }[];
    const panelId = panels[0].id;
    const breakers = (
      await json(
        await authedFetch(
          `${E2E_BACKEND_URL}/api/v1/panels/${panelId}/breakers`
        )
      )
    ).data as { id: string; amperage: number; poles: string }[];

    // (1) Overload — wire a 2500W appliance onto a 15A single-pole breaker
    //     (continuous capacity = 15 * 120 * 0.8 = 1440W) → 'over'.
    const overTarget =
      breakers.find((b) => b.poles === 'single' && b.amperage === 15) ??
      breakers[0];
    const comp = (
      await json(
        await authedFetch(`${E2E_BACKEND_URL}/api/v1/components`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'G45 Dashboard Overload Heater',
            type: 'appliance',
            breakerId: overTarget.id,
            loadWatts: 2500,
          }),
        })
      )
    ).data as { id: string };
    createdComponentIds.push(comp.id);

    // (2) Protection — a fresh GFCI breaker with NO breaker_tests is
    //     "untested this month" by definition.
    const br = (
      await json(
        await authedFetch(
          `${E2E_BACKEND_URL}/api/v1/panels/${panelId}/breakers`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              slot: '20',
              slotPosition: 20,
              amperage: 20,
              poles: 'single',
              label: 'G45 GFCI untested',
              protection: 'gfci',
            }),
          }
        )
      )
    ).data as { id: string };
    createdBreakerIds.push(br.id);
  });

  test.afterAll(async () => {
    for (const id of createdComponentIds) {
      try {
        await authedFetch(`${E2E_BACKEND_URL}/api/v1/components/${id}`, {
          method: 'DELETE',
        });
      } catch {
        // best-effort
      }
    }
    for (const id of createdBreakerIds) {
      try {
        await authedFetch(`${E2E_BACKEND_URL}/api/v1/breakers/${id}`, {
          method: 'DELETE',
        });
      } catch {
        // best-effort
      }
    }
    createdComponentIds.length = 0;
    createdBreakerIds.length = 0;
  });

  test('Status link in Panels header navigates to /dashboard', async ({
    page,
  }, info) => {
    desktopOnly(info);
    await page.goto('/');
    // Wait for the panel list to render AND the network to settle so the
    // header layout has stopped shifting (the protection aggregate card
    // mounts above the list once its tests load, which would otherwise make
    // the header link "not stable" mid-click).
    await expect(page.getByTestId('panel-tree')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const link = page.getByTestId('open-dashboard');
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId('dashboard-screen')).toBeVisible();
  });

  test('renders all four cards', async ({ page }, info) => {
    desktopOnly(info);
    await page.goto('/dashboard');
    await expect(page.getByTestId('dashboard-screen')).toBeVisible();
    await expect(page.getByTestId('dashboard-card-overload')).toBeVisible();
    await expect(page.getByTestId('dashboard-card-protection')).toBeVisible();
    await expect(page.getByTestId('dashboard-card-critical')).toBeVisible();
    await expect(page.getByTestId('dashboard-card-counts')).toBeVisible();
  });

  test('overload card surfaces the seeded over-capacity circuit + links to a panel/list', async ({
    page,
  }, info) => {
    desktopOnly(info);
    await page.goto('/dashboard');
    const card = page.getByTestId('dashboard-card-overload');
    await expect(card).toBeVisible();
    const count = await card.getAttribute('data-count');
    expect(Number(count)).toBeGreaterThan(0);
    const link = page.getByTestId('dashboard-card-overload-link');
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    // Single affected panel → /panels/<id>; multiple → / (Panels list).
    expect(href === '/' || /^\/panels\/[^/]+$/.test(href ?? '')).toBe(true);
  });

  test('protection card surfaces untested-this-month + links to /test', async ({
    page,
  }, info) => {
    desktopOnly(info);
    await page.goto('/dashboard');
    const card = page.getByTestId('dashboard-card-protection');
    await expect(card).toBeVisible();
    const count = await card.getAttribute('data-count');
    // The fresh GFCI breaker (no tests) → untested this month.
    expect(Number(count)).toBeGreaterThan(0);
    const link = page.getByTestId('dashboard-card-protection-link');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/test');
  });

  test('critical card renders a calm zero-state (seed has no critical components)', async ({
    page,
  }, info) => {
    desktopOnly(info);
    await page.goto('/dashboard');
    const card = page.getByTestId('dashboard-card-critical');
    await expect(card).toBeVisible();
    // Seed flags nothing critical → calm zero-state copy.
    await expect(
      page.getByTestId('dashboard-card-critical-calm')
    ).toBeVisible();
    await expect(card).toHaveAttribute('data-count', '0');
  });

  test('counts card links to each surface', async ({ page }, info) => {
    desktopOnly(info);
    await page.goto('/dashboard');
    const card = page.getByTestId('dashboard-card-counts');
    await expect(card).toBeVisible();
    await expect(
      page.getByTestId('dashboard-card-counts-panels')
    ).toHaveAttribute('href', '/');
    await expect(
      page.getByTestId('dashboard-card-counts-components')
    ).toHaveAttribute('href', '/library');
    await expect(
      page.getByTestId('dashboard-card-counts-floors')
    ).toHaveAttribute('href', '/map');
  });
});
