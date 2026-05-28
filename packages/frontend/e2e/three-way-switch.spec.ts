/**
 * G38 three-way switch UI smoke (cycle-64).
 *
 * Seeds a fresh scenario via REST: a floor with 2 switches and 1 light,
 * each switch's gang 0 controls the same light. Then verifies:
 *   1. Both switches' gang handles show the "3-way" badge.
 *   2. Selecting the light renders 2 control-lines (one per switch) and a
 *      "Controlled by" sidebar list with 2 clickable rows.
 *   3. Clicking a row in "Controlled by" navigates selection to that
 *      switch (the destination switch's gang badge becomes visible).
 *
 * Council Devil OBJ4 — mobile clutter regression: ALSO runs at the
 * mobile-390x844 project (Playwright projects iterate via the
 * config — no per-spec opt-out here). Adds a mobile-only screenshot
 * for visual triage.
 *
 * Hard rules from cycle-21:
 * - No page.waitForTimeout.
 * - Each test creates its own scratch fixture so cross-test order is
 *   irrelevant.
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

type Created<T> = { data: T };

const post = async <T,>(path: string, body: unknown): Promise<T> => {
  const res = await authedFetch(`${E2E_BACKEND_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `[three-way-switch.spec] POST ${path} → ${res.status} ${await res.text()}`
    );
  }
  return ((await res.json()) as Created<T>).data;
};

type Scratch = {
  floorId: string;
  switchAId: string;
  switchBId: string;
  lightId: string;
};

const createScratchScenario = async (tag: string): Promise<Scratch> => {
  const floor = await post<{ id: string }>('/api/v1/floors', {
    name: `3way-${tag}`,
  });
  const swA = await post<{ id: string }>('/api/v1/components', {
    type: 'switch',
    name: `3way-${tag}-A`,
    floorId: floor.id,
    posX: 1000,
    posY: 1000,
    gangs: 1,
  });
  const swB = await post<{ id: string }>('/api/v1/components', {
    type: 'switch',
    name: `3way-${tag}-B`,
    floorId: floor.id,
    posX: 9000,
    posY: 1000,
    gangs: 1,
  });
  const light = await post<{ id: string }>('/api/v1/components', {
    type: 'light',
    name: `3way-${tag}-light`,
    floorId: floor.id,
    posX: 5000,
    posY: 5000,
  });
  // Link both switches' gang 0 to the same light → co-controlled.
  await post(`/api/v1/components/${swA.id}/controls`, {
    gangIndex: 0,
    controlledId: light.id,
  });
  await post(`/api/v1/components/${swB.id}/controls`, {
    gangIndex: 0,
    controlledId: light.id,
  });
  return {
    floorId: floor.id,
    switchAId: swA.id,
    switchBId: swB.id,
    lightId: light.id,
  };
};

test.describe('G38 three-way / co-controlled switches @cycle-64', () => {
  test('selecting a contributing switch shows the 3-way badge on its gang', async ({
    page,
  }) => {
    const s = await createScratchScenario(`badge-${Date.now()}`);
    await page.goto(`/floors/${s.floorId}/edit`);
    await expect(
      page.getByRole('heading', { name: /3way-badge-/ })
    ).toBeVisible();

    // Click switch A's pin.
    const pinA = page.locator(`[data-pin-id="${s.switchAId}"]`);
    await expect(pinA).toBeVisible();
    await pinA.click();

    // Badge for switch A's gang 0 should be visible.
    const badgeA = page.locator(
      `[data-testid="three-way-badge"][data-switch-id="${s.switchAId}"][data-gang-index="0"]`
    );
    await expect(badgeA).toBeVisible();

    // Now click switch B's pin — its gang should also have the badge.
    const pinB = page.locator(`[data-pin-id="${s.switchBId}"]`);
    await pinB.click();
    const badgeB = page.locator(
      `[data-testid="three-way-badge"][data-switch-id="${s.switchBId}"][data-gang-index="0"]`
    );
    await expect(badgeB).toBeVisible();
  });

  test('selecting the co-controlled light shows Controlled-by list with 2 rows AND 2 control-lines', async ({
    page,
  }) => {
    const s = await createScratchScenario(`light-${Date.now()}`);
    await page.goto(`/floors/${s.floorId}/edit`);
    await expect(
      page.getByRole('heading', { name: /3way-light-/ })
    ).toBeVisible();

    // Click the light pin.
    const pinL = page.locator(`[data-pin-id="${s.lightId}"]`);
    await expect(pinL).toBeVisible();
    await pinL.click();

    // The "Controlled by" sidebar block should appear with 2 rows.
    const block = page.locator('[data-testid="controlled-by"]');
    await expect(block).toBeVisible();
    const rows = page.locator('[data-testid="controlled-by-row"]');
    await expect(rows).toHaveCount(2);

    // The link-layer should render 2 inverse control-lines pointing at
    // this light (one per contributing switch).
    const lines = page.locator(
      `[data-testid="control-line"][data-controlled-id="${s.lightId}"]`
    );
    await expect(lines).toHaveCount(2);
  });

  test('clicking a Controlled-by row navigates selection to that switch', async ({
    page,
  }) => {
    const s = await createScratchScenario(`nav-${Date.now()}`);
    await page.goto(`/floors/${s.floorId}/edit`);
    await expect(
      page.getByRole('heading', { name: /3way-nav-/ })
    ).toBeVisible();

    // Select the light first.
    await page.locator(`[data-pin-id="${s.lightId}"]`).click();

    // Click the row whose data-switch-id === switchAId.
    const rowA = page.locator(
      `[data-testid="controlled-by-row"][data-switch-id="${s.switchAId}"]`
    );
    await expect(rowA).toBeVisible();
    await rowA.click();

    // Selection should now be switch A — its gang handle appears (the
    // gang handles are only rendered for the selected switch).
    const handlesA = page.locator(
      `[data-testid="gang-handles"][data-switch-id="${s.switchAId}"]`
    );
    await expect(handlesA).toBeVisible();
    // And the Controlled-by block is gone (switch A is not a controlled
    // component; the section only shows on light/outlet selection).
    await expect(page.locator('[data-testid="controlled-by"]')).toHaveCount(0);
  });

  test('mobile-clutter screenshot — light selected with badge + lines', async (
    { page },
    info
  ) => {
    test.skip(
      info.project.name === 'desktop-1440x900',
      'mobile clutter visual regression (Devil OBJ4)'
    );
    const s = await createScratchScenario(`mclutter-${Date.now()}`);
    await page.goto(`/floors/${s.floorId}/edit`);
    await expect(
      page.getByRole('heading', { name: /3way-mclutter-/ })
    ).toBeVisible();
    // Select switch A so its gang handle + badge render.
    await page.locator(`[data-pin-id="${s.switchAId}"]`).click();
    await expect(
      page.locator(
        `[data-testid="three-way-badge"][data-switch-id="${s.switchAId}"]`
      )
    ).toBeVisible();
    await page.screenshot({
      path: join(
        SCREENSHOTS_DIR,
        `cycle64-3way-mobile-clutter-${info.project.name}.png`
      ),
      fullPage: false,
    });
  });
});
