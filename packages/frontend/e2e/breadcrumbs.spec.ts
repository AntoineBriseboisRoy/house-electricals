import { test, expect } from '@playwright/test';

/**
 * G42(b) — breadcrumb navigation strip.
 *
 * Asserts the Breadcrumbs primitive renders on deep screens (PanelDetail +
 * FloorEdit) with the expected trail and that a parent crumb link navigates.
 * The seed (e2e/seed.ts) creates "Main Panel" + "Main Floor" inside the
 * default "My House" building. Navigation uses link text (the same robust
 * approach as smoke.spec.ts) rather than row testids.
 */
test.describe('breadcrumbs (G42b)', () => {
  test('PanelDetail shows "… › Panels › Main Panel" with a working Panels crumb', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /Main Panel/i }).first().click();
    await expect(page).toHaveURL(/\/panels\/[^/]+$/);

    const crumbs = page.getByTestId('breadcrumbs');
    await expect(crumbs).toBeVisible();

    const crumbItems = page.getByTestId('breadcrumb-crumb');
    await expect(crumbItems.filter({ hasText: 'Panels' })).toBeVisible();
    // Leaf crumb = current page (panel name), marked aria-current.
    const leaf = crumbItems.filter({ hasText: 'Main Panel' });
    await expect(leaf).toBeVisible();
    await expect(leaf).toHaveAttribute('aria-current', 'page');

    // The "Panels" crumb is a link back to the panel list.
    await crumbItems.filter({ hasText: 'Panels' }).first().click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('FloorEdit shows "… › Map › <floor>" with a working Map crumb', async ({
    page,
  }) => {
    await page.goto('/map');
    await page.getByRole('link', { name: /Main Floor/i }).first().click();
    await expect(page).toHaveURL(/\/floors\/[^/]+\/edit$/);

    const crumbs = page.getByTestId('breadcrumbs');
    await expect(crumbs).toBeVisible();

    const crumbItems = page.getByTestId('breadcrumb-crumb');
    await expect(crumbItems.filter({ hasText: 'Map' }).first()).toBeVisible();
    // Leaf crumb = current page (floor name), marked aria-current.
    const leaf = crumbItems.filter({ hasText: 'Main Floor' });
    await expect(leaf).toBeVisible();
    await expect(leaf).toHaveAttribute('aria-current', 'page');

    // The Map crumb navigates back to the map landing.
    await crumbItems.filter({ hasText: 'Map' }).first().click();
    await expect(page).toHaveURL(/\/map$/);
  });
});
