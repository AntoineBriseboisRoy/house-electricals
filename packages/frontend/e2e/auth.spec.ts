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

  test('change password: account button → modal → new password works on next login', async ({
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

    // Open the floating Account button → ChangePasswordModal.
    await page.getByTestId('account-button').click();
    const modal = page.getByTestId('change-password-modal');
    await expect(modal).toBeVisible();

    // Submit the change.
    await modal.getByTestId('change-password-current').fill(PASSWORD);
    await modal.getByTestId('change-password-new').fill(NEW_PASSWORD);
    await modal.getByTestId('change-password-confirm').fill(NEW_PASSWORD);
    await modal.getByTestId('change-password-submit').click();

    // Modal closes on success.
    await expect(modal).not.toBeVisible();

    // Sign out and verify the OLD password no longer works AND the NEW
    // one does.
    await page.getByTestId('logout-button').click();
    await expect(page.getByTestId('login-submit')).toBeVisible();

    // Old password rejected.
    await page.getByTestId('login-username').fill(USERNAME);
    await page.getByTestId('login-password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByRole('alert')).toContainText(/invalid/i);

    // New password accepted.
    await page.getByTestId('login-password').fill(NEW_PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByText('Main Panel')).toBeVisible();

    // Cleanup — rotate the password BACK so other specs that hard-code
    // the e2e creds (this file's earlier tests, on re-run) keep working.
    await page.getByTestId('account-button').click();
    const cleanupModal = page.getByTestId('change-password-modal');
    await expect(cleanupModal).toBeVisible();
    await cleanupModal.getByTestId('change-password-current').fill(NEW_PASSWORD);
    await cleanupModal.getByTestId('change-password-new').fill(PASSWORD);
    await cleanupModal.getByTestId('change-password-confirm').fill(PASSWORD);
    await cleanupModal.getByTestId('change-password-submit').click();
    await expect(cleanupModal).not.toBeVisible();
  });
});
