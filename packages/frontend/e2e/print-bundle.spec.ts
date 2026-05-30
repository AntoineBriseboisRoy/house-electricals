import { test, expect } from '@playwright/test';

/**
 * G41 — "Share with electrician" building PDF bundle.
 *
 * Asserts the /buildings/:id/print route renders the escape-hatch artifact
 * (no AppShell chrome — the same G24 isolation contract as the per-panel
 * print), and that it contains the building's panel section(s), the circuit
 * directory, and the "verify before working live" watermark.
 *
 * Uses Playwright's `request` fixture (inherits storageState — the e2e
 * he_auth cookie — automatically, and resolves relative URLs against the
 * config baseURL) to discover the seeded building id, then drives the page
 * through the Vite proxy where the cookie applies.
 */
test.describe('G41 building PDF bundle', () => {
  test('renders the building bundle without app chrome', async ({
    page,
    request,
  }) => {
    const res = await request.get('/api/v1/buildings');
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { data: Array<{ id: string }> };
    expect(body.data.length).toBeGreaterThan(0);
    const buildingId = body.data[0].id;

    await page.goto(`/buildings/${buildingId}/print`);

    // Escape-hatch: NO bottom tabs, NO theme toggle (G24 isolation contract).
    await expect(page.locator('.bottom-tabs')).toHaveCount(0);
    await expect(page.locator('.theme-toggle')).toHaveCount(0);

    // The bundle root is present.
    await expect(page.locator('[data-testid="printable-bundle"]')).toBeVisible();

    // Watermark with the pinned wording.
    const watermark = page.locator('[data-testid="printable-bundle-watermark"]');
    await expect(watermark).toBeVisible();
    await expect(watermark).toContainText('verify before working live');

    // At least one panel section + the shared slot grid.
    await expect(
      page.locator('[data-testid="printable-bundle-panel"]').first()
    ).toBeVisible();
    await expect(
      page
        .locator('[data-testid="printable-bundle-panels"] .printable-slots')
        .first()
    ).toBeVisible();

    // The circuit directory section.
    await expect(
      page.locator('[data-testid="printable-bundle-directory"]')
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="printable-bundle-directory-row"]').first()
    ).toBeVisible();

    // Cycle-52 — the hoisted ThemedToaster makes no toast() calls here.
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  });
});

/**
 * Regression: the per-panel G24 print route STILL renders the escape-hatch
 * artifact after the G41 shared-component extraction.
 */
test.describe('G24 per-panel print (post-G41)', () => {
  test('per-panel printable diagram still works', async ({ page, request }) => {
    const res = await request.get('/api/v1/panels');
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { data: Array<{ id: string }> };
    expect(body.data.length).toBeGreaterThan(0);
    const panelId = body.data[0].id;

    await page.goto(`/panels/${panelId}/print`);

    await expect(page.locator('.bottom-tabs')).toHaveCount(0);
    await expect(page.locator('.theme-toggle')).toHaveCount(0);
    await expect(page.locator('[data-testid="printable-page"]')).toBeVisible();
    // The shared slot grid renders.
    await expect(page.locator('.printable-slots')).toBeVisible();
    // Panel-level QR still present (G44).
    await expect(
      page.locator('[data-testid="printable-panel-qr"]')
    ).toBeVisible();
  });
});
