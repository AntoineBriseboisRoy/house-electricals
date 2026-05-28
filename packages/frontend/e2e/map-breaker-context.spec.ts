/**
 * Refactor 2026-05 — Map drawer breaker-context spec.
 *
 * Locks in the user's #1 daily-driver fix: clicking a pin on the floor map
 * shows which breaker slot controls the selected component, with a static
 * highlight on that slot in a mini panel-viz inside the properties drawer.
 *
 * Two branches:
 *   - Wired pin → `[data-testid="component-breaker-context"][data-breaker-id]`
 *     renders, has panel name + slot + amperage + mini viz with exactly one
 *     `.panel-viz__slot--active`.
 *   - Unwired pin → same testid but with `data-unwired="true"` + the "Not
 *     wired to a breaker yet." copy; NO active slot anywhere on the page.
 *
 * Desktop-only — the properties drawer is mobile-hidden below 960px
 * (cycle-34 G28 styles.css:4007-4009 selection-placeholder rule).
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type State = {
  seeded?: {
    floorId: string;
    componentIds: string[];
  };
};

const loadState = (): NonNullable<State['seeded']> => {
  const raw = readFileSync(join(__dirname, '.state.json'), 'utf8');
  const j = JSON.parse(raw) as State;
  if (j.seeded === undefined) throw new Error('no seed in .state.json');
  return j.seeded;
};

test.describe('Map drawer — breaker context @refactor', () => {
  test('wired pin renders panel name + slot + mini-viz with active slot', async ({
    page,
  }, info) => {
    // Drawer is mobile-hidden below 960px (cycle-34 G28 selection placeholder).
    test.skip(
      info.project.name !== 'desktop-1440x900',
      'Drawer is mobile-hidden below 960px.'
    );
    const state = loadState();
    await page.goto(`/floors/${state.floorId}/edit`);

    // Click the first seeded pin (Kitchen Outlet 1, wired to breaker[1])
    const firstWiredId = state.componentIds[0];
    const pin = page.locator(`[data-pin-id="${firstWiredId}"]`);
    await expect(pin).toBeVisible();
    await pin.click();

    const ctx = page.locator('[data-testid="component-breaker-context"]');
    await expect(ctx).toBeVisible();
    await expect(ctx).toHaveAttribute('data-breaker-id', /.+/);

    // Inline summary shows panel name + slot + amperage.
    await expect(ctx.locator('.component-breaker-context__summary')).toContainText(
      /Main Panel/
    );
    await expect(ctx.locator('.component-breaker-context__summary')).toContainText(
      /slot/
    );

    // Mini panel-viz wrapper is present + exactly one slot is statically active.
    await expect(ctx.locator('.panel-viz--mini')).toBeVisible();
    const active = ctx.locator('.panel-viz__slot--active');
    await expect(active).toHaveCount(1);

    // Refactor iter-5 — "Open panel →" CTA navigates to /panels/<id>
    // with #breaker-<id> hash so PanelDetailScreen pulses the matching slot.
    const cta = ctx.locator(
      '[data-testid="component-breaker-context-open-panel"]'
    );
    await expect(cta).toBeVisible();
    await expect(cta).toContainText(/Open panel/);
    const href = await cta.getAttribute('href');
    expect(href).toMatch(/^\/panels\/.+#breaker-.+/);

    // Refactor follow-up — inline breaker picker renders with the
    // "Reassign" label when the pin is already wired.
    const picker = ctx.locator(
      '[data-testid="component-breaker-context-picker"]'
    );
    await expect(picker).toBeVisible();
    await expect(picker).toContainText(/Reassign/);
  });

  test('unwired pin shows "Not wired" copy + no active slot', async ({
    page,
  }, info) => {
    test.skip(
      info.project.name !== 'desktop-1440x900',
      'Drawer is mobile-hidden below 960px.'
    );
    const state = loadState();
    await page.goto(`/floors/${state.floorId}/edit`);

    // Last seeded component is the junction box with breakerId=null (unwired).
    const unwiredId = state.componentIds[state.componentIds.length - 1];
    const pin = page.locator(`[data-pin-id="${unwiredId}"]`);
    await expect(pin).toBeVisible();
    await pin.click();

    const ctx = page.locator('[data-testid="component-breaker-context"]');
    await expect(ctx).toBeVisible();
    await expect(ctx).toHaveAttribute('data-unwired', 'true');
    await expect(ctx).toContainText(/Not wired/);

    // No mini panel-viz, no static highlight.
    await expect(ctx.locator('.panel-viz--mini')).toHaveCount(0);
    await expect(page.locator('.panel-viz__slot--active')).toHaveCount(0);

    // Refactor follow-up — inline picker IS visible even when unwired,
    // labeled "Wire to a breaker" so the user can wire from the drawer.
    const picker = ctx.locator(
      '[data-testid="component-breaker-context-picker"]'
    );
    await expect(picker).toBeVisible();
    await expect(picker).toContainText(/Wire to a breaker/);
  });
});
