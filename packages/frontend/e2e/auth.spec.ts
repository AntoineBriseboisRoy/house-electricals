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
    // The fix/mobile-floating-cluster UserMenu chip is reachable
    // (replaces the standalone logout button from the original
    // feat/auth-gate cycle).
    await expect(page.getByTestId('user-menu-button')).toBeVisible();
  });

  test('Sign out (via UserMenu) returns to LoginScreen', async ({
    page,
  }, info) => {
    skipMobile(info);
    await page.goto('/');
    await page.getByTestId('login-username').fill(USERNAME);
    await page.getByTestId('login-password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByText('Main Panel')).toBeVisible();

    // Open the UserMenu sheet, click Sign out.
    await page.getByTestId('user-menu-button').click();
    await expect(page.getByTestId('user-menu-modal')).toBeVisible();
    await page.getByTestId('user-menu-logout').click();
    await expect(
      page.getByRole('heading', { name: 'House Electricals' })
    ).toBeVisible();
    await expect(page.getByTestId('login-submit')).toBeVisible();
  });

  test('UserMenu sheet contains username + theme picker + change-password trigger', async ({
    page,
  }, info) => {
    skipMobile(info);
    await page.goto('/');
    await page.getByTestId('login-username').fill(USERNAME);
    await page.getByTestId('login-password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByText('Main Panel')).toBeVisible();

    await page.getByTestId('user-menu-button').click();
    const sheet = page.getByTestId('user-menu-modal');
    await expect(sheet).toBeVisible();

    await expect(sheet.getByTestId('user-menu-username')).toHaveText(USERNAME);
    await expect(sheet.getByTestId('user-menu-theme-light')).toBeVisible();
    await expect(sheet.getByTestId('user-menu-theme-dark')).toBeVisible();
    await expect(sheet.getByTestId('user-menu-theme-system')).toBeVisible();
    await expect(sheet.getByTestId('user-menu-change-password')).toBeVisible();
    await expect(sheet.getByTestId('user-menu-logout')).toBeVisible();
  });

  test('change password: UserMenu → Change password → modal → new password works', async ({
    page,
  }, info) => {
    skipMobile(info);
    const NEW_PASSWORD = 'rotated-e2e-password';

    // Log in with the original password.
    await page.goto('/');
    await page.getByTestId('login-username').fill(USERNAME);
    await page.getByTestId('login-password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByText('Main Panel')).toBeVisible();

    // Open the UserMenu and trigger Change password.
    await page.getByTestId('user-menu-button').click();
    await expect(page.getByTestId('user-menu-modal')).toBeVisible();
    await page.getByTestId('user-menu-change-password').click();
    // UserMenu sheet closes before ChangePasswordModal opens (avoid
    // modal-in-modal stacking).
    await expect(page.getByTestId('user-menu-modal')).not.toBeVisible();
    const modal = page.getByTestId('change-password-modal');
    await expect(modal).toBeVisible();

    await modal.getByTestId('change-password-current').fill(PASSWORD);
    await modal.getByTestId('change-password-new').fill(NEW_PASSWORD);
    await modal.getByTestId('change-password-confirm').fill(NEW_PASSWORD);
    await modal.getByTestId('change-password-submit').click();
    await expect(modal).not.toBeVisible();

    // Sign out → old fails → new succeeds.
    await page.getByTestId('user-menu-button').click();
    await page.getByTestId('user-menu-logout').click();
    await expect(page.getByTestId('login-submit')).toBeVisible();

    await page.getByTestId('login-username').fill(USERNAME);
    await page.getByTestId('login-password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByRole('alert')).toContainText(/invalid/i);

    await page.getByTestId('login-password').fill(NEW_PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByText('Main Panel')).toBeVisible();

    // Cleanup — rotate the password BACK so other tests in this file
    // (re-run order) keep working.
    await page.getByTestId('user-menu-button').click();
    await page.getByTestId('user-menu-change-password').click();
    const cleanupModal = page.getByTestId('change-password-modal');
    await expect(cleanupModal).toBeVisible();
    await cleanupModal.getByTestId('change-password-current').fill(NEW_PASSWORD);
    await cleanupModal.getByTestId('change-password-new').fill(PASSWORD);
    await cleanupModal.getByTestId('change-password-confirm').fill(PASSWORD);
    await cleanupModal.getByTestId('change-password-submit').click();
    await expect(cleanupModal).not.toBeVisible();
  });
});
