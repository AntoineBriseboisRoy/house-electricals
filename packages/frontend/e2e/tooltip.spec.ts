/**
 * Cycle-75 — Tooltip primitive e2e.
 *
 * Verifies the hover-activated tooltip appears on the .badge--critical
 * row in /components and exposes:
 *   - role="tooltip" body with the expected description text
 *   - aria-describedby on the trigger pointing at the tooltip's id
 *
 * Seeds a critical-flagged component via REST so the badge renders
 * (the global seed leaves all components non-critical). Desktop-only;
 * mobile activation is touch long-press which Playwright's mouse
 * emulation doesn't model cleanly.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';

type Json = Record<string, unknown> | unknown[];

const post = async <T = { id: string }>(
  api: APIRequestContext,
  path: string,
  body: Json
): Promise<T> => {
  const res = await api.post(path, { data: body });
  if (!res.ok()) {
    const text = await res.text();
    throw new Error(`POST ${path} → ${res.status()}: ${text}`);
  }
  const json = (await res.json()) as { data: T };
  return json.data;
};

test.describe('Tooltip primitive @cycle-75', () => {
  test.beforeEach(async ({}, info) => {
    test.skip(
      info.project.name !== 'desktop-1440x900',
      'desktop-only — hover activation is the canonical surface'
    );
  });

  test('critical badge surfaces tooltip via hover + aria-describedby', async ({
    page,
    request,
  }) => {
    // Seed a critical component (the global seed has no critical=true rows).
    const uniqueName = `Cycle75 Critical ${Date.now()}`;
    const created = await post<{ id: string }>(
      request,
      '/api/v1/components',
      {
        name: uniqueName,
        type: 'outlet',
        critical: true,
      }
    );
    expect(created.id).toBeTruthy();

    await page.goto('/components');

    // Wait for the seeded row to render.
    const row = page
      .locator('[data-testid="component-row"]')
      .filter({ hasText: uniqueName });
    await expect(row).toBeVisible();

    const badge = row.locator('[data-testid="badge-critical"]');
    await expect(badge).toBeVisible();

    // Pre-hover: tooltip is not in the DOM.
    await expect(page.locator('[role="tooltip"]')).toHaveCount(0);

    // Hover the badge — Tooltip opens after the 250ms scheduled delay.
    await badge.hover();

    const tooltip = page.locator('[role="tooltip"]', {
      hasText: /Marked as critical/i,
    });
    await expect(tooltip).toBeVisible({ timeout: 1500 });

    // The badge trigger MUST carry aria-describedby that includes the
    // tooltip's id (Lockin FATAL #5 contract).
    const tooltipId = await tooltip.getAttribute('id');
    expect(tooltipId).toBeTruthy();
    const describedBy = await badge.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(describedBy?.split(/\s+/)).toContain(tooltipId);

    // Move the cursor off the badge — tooltip closes immediately.
    await page.mouse.move(0, 0);
    await expect(page.locator('[role="tooltip"]')).toHaveCount(0);
  });
});
