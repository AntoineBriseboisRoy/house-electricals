/**
 * fix/mobile-floating-cluster — the account / theme / logout controls live
 * INSIDE the bottom tab bar (the trailing "Account" item that opens a
 * bottom sheet), NOT as floating chrome over page content.
 *
 * History: the feat/auth-gate-signup work mounted 3 separate fixed-position
 * icon buttons (ThemeToggle, AccountButton, LogoutButton) top-right. On a
 * 360px / 390px viewport that cluster overlapped the right-aligned
 * "Add panel" / "Add component" / "Add floor" CTAs in the ScreenHeader.
 * An interim single floating chip was also rejected — the user wants
 * nothing user/theme-related floating over the page.
 *
 * This spec locks in the resolution:
 *   1. NO floating cluster classes/testids exist anymore
 *      (.theme-toggle / account-button / logout-button = count 0).
 *   2. The account trigger (`user-menu-button`) lives within `.bottom-tabs`
 *      and sits in the bottom third of the viewport — never over the header.
 *   3. The in-header Add CTA is fully visible + clickable (no overlap).
 *   4. Tapping the trigger opens the account sheet with theme + change-
 *      password + sign-out.
 *
 * Mobile-only spec — the placement bug only manifested on narrow viewports.
 */

import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCREENSHOTS_DIR = join(__dirname, '.screenshots', 'floating-cluster');
mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const skipDesktop = (info: { project: { name: string } }): void => {
  if (info.project.name === 'desktop-1440x900') {
    test.skip();
  }
};

type Screen = {
  path: string;
  ctaTestId: string;
  headingPattern: RegExp;
  fileSuffix: string;
};

const SCREENS: readonly Screen[] = [
  {
    path: '/',
    ctaTestId: 'open-add-panel',
    headingPattern: /house electricals/i,
    fileSuffix: 'panels',
  },
  {
    path: '/library',
    ctaTestId: 'open-add-component',
    headingPattern: /^library$/i,
    fileSuffix: 'library',
  },
  {
    path: '/map',
    ctaTestId: 'open-add-floor',
    headingPattern: /^maps$/i,
    fileSuffix: 'map',
  },
];

const rectOverlap = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): boolean => {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  return !(ax2 <= b.x || bx2 <= a.x || ay2 <= b.y || by2 <= a.y);
};

test.describe('Account menu in bottom tab bar @mobile', () => {
  for (const screen of SCREENS) {
    test(`${screen.path} — account trigger lives in tab bar, Add CTA unobstructed`, async ({
      page,
    }, info) => {
      skipDesktop(info);
      await page.goto(screen.path);

      // Wait for the screen header to render.
      await expect(
        page.getByRole('heading', { name: screen.headingPattern })
      ).toBeVisible();

      const cta = page.getByTestId(screen.ctaTestId);
      await expect(cta).toBeVisible();
      const ctaBox = await cta.boundingBox();
      expect(ctaBox).not.toBeNull();

      // (1) The legacy floating chrome must be entirely gone.
      await expect(page.locator('.theme-toggle')).toHaveCount(0);
      await expect(page.locator('[data-testid="account-button"]')).toHaveCount(
        0
      );
      await expect(page.locator('[data-testid="logout-button"]')).toHaveCount(
        0
      );

      // (2) The account trigger must be a descendant of the bottom tab bar
      // (no fixed floating chip), and sit in the bottom third of the
      // viewport — well clear of the header.
      const trigger = page.getByTestId('user-menu-button');
      await expect(trigger).toBeVisible();
      const triggerInTabBar = page.locator(
        '.bottom-tabs [data-testid="user-menu-button"]'
      );
      await expect(triggerInTabBar).toHaveCount(1);
      const viewport = page.viewportSize();
      const triggerBox = await trigger.boundingBox();
      expect(triggerBox).not.toBeNull();
      if (viewport !== null) {
        expect(triggerBox!.y).toBeGreaterThan(viewport.height * 0.66);
      }

      // Snapshot the page for the PR visual.
      await page.screenshot({
        path: join(
          SCREENSHOTS_DIR,
          `after-${screen.fileSuffix}-${info.project.name}.png`
        ),
        fullPage: false,
      });

      // (3) Nothing (including the tab-bar trigger) overlaps the Add CTA.
      const triggerOverlaps = rectOverlap(triggerBox!, ctaBox!);
      expect(
        triggerOverlaps,
        `account trigger overlaps the Add CTA ${ctaBox!.x},${ctaBox!.y} ${ctaBox!.width}x${ctaBox!.height}`
      ).toBe(false);

      // And the CTA must actually be clickable (Playwright auto-waits for
      // hit-test cleanliness — an overlapping element would fail this).
      await cta.click({ trial: true });
    });
  }

  test('account trigger opens a sheet with theme + change-password + sign-out', async ({
    page,
  }, info) => {
    skipDesktop(info);
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: /house electricals/i })
    ).toBeVisible();

    await page.getByTestId('user-menu-button').click();
    const sheet = page.getByTestId('user-menu-modal');
    await expect(sheet).toBeVisible();

    await expect(sheet.getByTestId('user-menu-theme-light')).toBeVisible();
    await expect(sheet.getByTestId('user-menu-theme-dark')).toBeVisible();
    await expect(sheet.getByTestId('user-menu-theme-system')).toBeVisible();
    await expect(sheet.getByTestId('user-menu-change-password')).toBeVisible();
    await expect(sheet.getByTestId('user-menu-logout')).toBeVisible();

    // Capture the open sheet for the PR visual.
    await page.screenshot({
      path: join(
        SCREENSHOTS_DIR,
        `after-sheet-open-${info.project.name}.png`
      ),
      fullPage: false,
    });
  });
});
