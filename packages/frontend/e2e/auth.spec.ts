/**
 * feat/auth-gate — login flow spec.
 *
 * Most specs use the storageState cookie pre-loaded by globalSetup and
 * never see the login screen. This spec EXPLICITLY clears the cookie at
 * the start of each test so it can exercise the unauthed → login → authed
 * → logout loop end-to-end through the UI.
 *
 * Desktop-only — auth UI is identical across viewports and the cycle-34
 * mobile-overflow project already covers viewport sanity in the smoke
 * spec.
 */

import { test, expect } from '@playwright/test';

const USERNAME = 'e2e-user';
const PASSWORD = 'e2e-password';

const skipMobile = (info: { project: { name: string } }): void => {
  if (info.project.name !== 'desktop-1440x900') {
    test.skip();
  }
};

test.describe('auth gate @feat-auth-gate', () => {
  test.beforeEach(async ({ context }) => {
    // Reset the storageState-injected cookie for this test only.
    await context.clearCookies();
  });

  test('unauthed visit → LoginScreen renders', async ({ page }, info) => {
    skipMobile(info);
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'House Electricals' })
    ).toBeVisible();
    await expect(page.getByTestId('login-username')).toBeVisible();
    await expect(page.getByTestId('login-password')).toBeVisible();
    await expect(page.getByTestId('login-submit')).toBeVisible();
  });

  test('wrong password shows an inline error', async ({ page }, info) => {
    skipMobile(info);
    await page.goto('/');
    await page.getByTestId('login-username').fill(USERNAME);
    await page.getByTestId('login-password').fill('definitely-wrong');
    await page.getByTestId('login-submit').click();
    const err = page.getByRole('alert');
    await expect(err).toBeVisible();
    await expect(err).toContainText(/invalid/i);
    // Still on the login screen.
    await expect(page.getByTestId('login-submit')).toBeVisible();
  });

  test('correct credentials → AppShell renders (PanelList visible)', async ({
    page,
  }, info) => {
    skipMobile(info);
    await page.goto('/');
    await page.getByTestId('login-username').fill(USERNAME);
    await page.getByTestId('login-password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();

    // Wait for the seeded panel to show — confirms the session is live
    // and protected API calls work.
    await expect(page.getByText('Main Panel')).toBeVisible();
    // Bottom-tabs render (we're authed inside AppShell).
    await expect(page.locator('.bottom-tabs')).toBeVisible();
    // The fixed-top-right logout button is reachable.
    await expect(page.getByTestId('logout-button')).toBeVisible();
  });

  test('Sign out button returns to LoginScreen', async ({ page }, info) => {
    skipMobile(info);
    await page.goto('/');
    await page.getByTestId('login-username').fill(USERNAME);
    await page.getByTestId('login-password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByText('Main Panel')).toBeVisible();

    await page.getByTestId('logout-button').click();
    await expect(
      page.getByRole('heading', { name: 'House Electricals' })
    ).toBeVisible();
    await expect(page.getByTestId('login-submit')).toBeVisible();
  });

});
