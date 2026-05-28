/**
 * Smoke spec (G21 cycle-21).
 *
 * Drives the 7 primary screens at mobile (390x844) + desktop (1440x900),
 * captures a screenshot per (screen × viewport) into e2e/.screenshots/.
 *
 * Hard rules:
 * - Deterministic waits only (auto-waiting locators / expect.toBeVisible).
 *   NO page.waitForTimeout.
 * - Uses the test-hooks landed in US-001 (data-testid='modal' etc.) where
 *   modal/drag-link interactions need stable selectors.
 *
 * This is the cycle-21 baseline. Story 5 triages the captured runs and
 * ships top-3 fixes; Story 6 re-runs.
 */

import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCREENSHOTS_DIR = join(__dirname, '.screenshots');
mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const screenshotPath = (name: string, projectName: string): string =>
  join(SCREENSHOTS_DIR, `${name}-${projectName}.png`);

const snap = async (page: Page, name: string, projectName: string): Promise<void> => {
  // Give layout a beat to settle (CSS transitions + lucide icons), but only
  // via auto-waiting — never a fixed sleep.
  await page.waitForLoadState('networkidle');
  await page.screenshot({
    path: screenshotPath(name, projectName),
    fullPage: true,
  });
};

test.describe('House Electricals smoke @G21', () => {
  test('PanelList — root route lists seeded panel', async ({ page }, info) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Panels/i })).toBeVisible();
    await expect(page.getByText('Main Panel')).toBeVisible();
    await snap(page, 'PanelList', info.project.name);
  });

  test('PanelDetail (viz) — breakers shown in seeded panel', async ({ page }, info) => {
    await page.goto('/');
    await expect(page.getByText('Main Panel')).toBeVisible();
    await page.getByRole('link', { name: /Main Panel/i }).first().click();
    // Heading is the panel name on PanelDetailScreen.
    await expect(page.getByRole('heading', { name: /Main Panel/i })).toBeVisible();
    // At least one of the seeded breakers should be visible by label.
    await expect(page.getByText(/Kitchen lights/i).first()).toBeVisible();
    await snap(page, 'PanelDetail-viz', info.project.name);
  });

  test('Library — seeded components listed', async ({ page }, info) => {
    await page.goto('/library');
    await expect(
      page.getByRole('heading', { name: 'Library', exact: true })
    ).toBeVisible();
    await expect(page.getByText('Kitchen Outlet 1').first()).toBeVisible();
    await expect(page.getByText('2-Gang Switch').first()).toBeVisible();
    await snap(page, 'Library', info.project.name);
  });

  test('Map landing — seeded floor is tappable', async ({ page }, info) => {
    await page.goto('/map');
    await expect(page.getByRole('heading', { name: /Map/i })).toBeVisible();
    await expect(page.getByText('Main Floor').first()).toBeVisible();
    await snap(page, 'MapLanding', info.project.name);
  });

  test('FloorEdit — opens the floor editor with walls + rooms', async ({ page }, info) => {
    await page.goto('/map');
    await page.getByRole('link', { name: /Main Floor/i }).first().click();
    // Editor heading is the floor name.
    await expect(page.getByRole('heading', { name: /Main Floor/i })).toBeVisible();
    // Should show the wall+room count caption from the canvas section.
    await expect(page.locator('.floor-edit__caption')).toBeVisible();
    await snap(page, 'FloorEdit', info.project.name);
  });

  test('PanelMap — pins + floor switcher render', async ({ page }, info) => {
    // Navigate via Panel detail → there's a "View on map" or similar link.
    // To keep this deterministic we use the route directly.
    await page.goto('/');
    await page.getByRole('link', { name: /Main Panel/i }).first().click();
    // PanelMap is at /panels/:id/map
    const url = page.url();
    const panelMapUrl = url.replace(/\/panels\/([^/]+).*/, '/panels/$1/map');
    await page.goto(panelMapUrl);
    // The canvas div is always rendered (with or without an underlay image),
    // so we assert on its first occurrence to avoid strict-mode ambiguity
    // when a "no floor plan yet" hint also appears.
    await expect(page.locator('.floor-plan').first()).toBeVisible();
    await snap(page, 'PanelMap', info.project.name);
  });

  test('TestPanel — verify mode renders breaker list', async ({ page }, info) => {
    await page.goto('/');
    await page.getByRole('link', { name: /Main Panel/i }).first().click();
    const url = page.url();
    const testUrl = url.replace(/\/panels\/([^/]+).*/, '/panels/$1/test');
    await page.goto(testUrl);
    await expect(page.getByRole('heading', { name: /test|breaker/i }).first()).toBeVisible();
    await snap(page, 'TestPanel', info.project.name);
  });

  test('Modal — PromptModal opens via floor Rename', async ({ page }, info) => {
    // FloorEditScreen has a Rename button in the header that uses prompt().
    await page.goto('/map');
    await page.getByRole('link', { name: /Main Floor/i }).first().click();
    await expect(page.getByRole('heading', { name: /Main Floor/i })).toBeVisible();
    await page.getByRole('button', { name: 'Rename' }).first().click();
    const modal = page.getByTestId('prompt-modal');
    await expect(modal).toBeVisible();
    // Verify the named buttons from US-001 landed.
    await expect(page.getByTestId('prompt-modal-confirm')).toBeVisible();
    await expect(page.getByTestId('prompt-modal-cancel')).toBeVisible();
    await snap(page, 'Modal-prompt', info.project.name);
    // Dismiss via ESC so the next test gets a clean screen.
    await page.keyboard.press('Escape');
    await expect(modal).not.toBeVisible();
  });
});
