/**
 * Guided troubleshooting (2026-05) — the "something here has no power" flow.
 *
 * Verifies the Test-tab entry point, the device picker, and that selecting a
 * seeded device produces an ordered diagnosis with at least one step. The seed
 * (e2e/seed.ts) wires components to breakers, so the picked device resolves to
 * a real circuit.
 */
import { test, expect } from '@playwright/test';

test.describe('Guided troubleshooting @troubleshoot', () => {
  test('Test tab → Troubleshoot entry navigates to /troubleshoot', async ({
    page,
  }) => {
    await page.goto('/test');
    await page.getByTestId('open-troubleshoot').click();
    await expect(page).toHaveURL(/\/troubleshoot$/);
    await expect(page.getByTestId('troubleshoot-search')).toBeVisible();
  });

  test('pick a device → ordered diagnosis with steps, then reset', async ({
    page,
  }) => {
    await page.goto('/troubleshoot');
    await expect(page.getByTestId('troubleshoot-search')).toBeVisible();

    const firstDevice = page.getByTestId('troubleshoot-device').first();
    await expect(firstDevice).toBeVisible();
    await firstDevice.click();

    await expect(page.getByTestId('troubleshoot-diagnosis')).toBeVisible();
    const steps = page
      .getByTestId('troubleshoot-steps')
      .locator('.troubleshoot__step');
    await expect(steps.first()).toBeVisible();
    expect(await steps.count()).toBeGreaterThan(0);

    // The last step is always the local-vs-circuit reasoning.
    await expect(steps.last()).toHaveAttribute('data-step-kind', 'isolate');

    // Reset returns to the picker.
    await page.getByTestId('troubleshoot-reset').click();
    await expect(page.getByTestId('troubleshoot-search')).toBeVisible();
  });
});
