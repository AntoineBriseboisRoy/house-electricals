/**
 * Cycle-74 — Button `busy` prop e2e.
 *
 * Verifies: the Add-panel submit button shows the in-flight signal
 * during a slow POST: `data-busy="true"` + `aria-busy="true"` +
 * `.btn--busy` class all appear. Children (the "Creating…" label)
 * stay visible during the busy window — no replacement / layout
 * jitter (Lockin FATAL #4). The leading `.btn__spinner` icon is
 * also present.
 *
 * Desktop-only. Spinner primitive coverage is via the build's
 * type/CSS surface — its consumer (BreakerWithComponents) currently
 * defers expansion until after the fetch resolves, so a "loading"
 * window isn't observable from e2e here.
 */

import { test, expect } from '@playwright/test';

test.describe('Button busy + Spinner primitive @cycle-74', () => {
  test.beforeEach(async ({}, info) => {
    test.skip(
      info.project.name !== 'desktop-1440x900',
      'desktop-only — focused micro-spec for the Button busy signal'
    );
  });

  test('Add-panel submit shows in-flight signal during slow POST', async ({
    page,
  }) => {
    // Block the POST until we release it. This keeps the busy window
    // open indefinitely so assertions never race the response.
    let releasePost = (): void => {};
    const postBlocked = new Promise<void>((resolve) => {
      releasePost = resolve;
    });

    await page.route('**/api/v1/panels', async (route) => {
      if (route.request().method() === 'POST') {
        await postBlocked;
      }
      await route.continue();
    });

    // PanelListScreen lives at root (`/`), not `/panels`.
    await page.goto('/');
    await page.getByTestId('open-add-panel').click();

    const modal = page.getByTestId('add-panel-modal');
    await expect(modal).toBeVisible();

    const uniqueName = `Cycle74 Busy Panel ${Date.now()}`;
    await modal.getByPlaceholder(/main panel/i).fill(uniqueName);

    // Use a CSS locator on the submit button so we don't depend on the
    // accessible name (which changes from "Create" to "Creating…" the
    // moment busy flips — a name-regex would stop matching mid-flight).
    const submit = modal.locator('button[type="submit"]');
    // Pre-click — not busy yet.
    await expect(submit).not.toHaveAttribute('data-busy', 'true');

    // Click. The route is blocked until releasePost() so the button
    // stays busy until our assertions are done.
    await submit.click();

    // During the in-flight window the button MUST surface the busy signal.
    await expect(submit).toHaveAttribute('data-busy', 'true');
    await expect(submit).toHaveAttribute('aria-busy', 'true');
    await expect(submit).toHaveClass(/btn--busy/);

    // Children stay visible during busy — Lockin FATAL #4. The label
    // swaps text from "Create" to "Creating…" but the label span IS
    // still rendered.
    await expect(submit.locator('.btn__label')).toBeVisible();
    await expect(submit.locator('.btn__label')).toHaveText(/creating/i);

    // The leading spinner icon is present alongside the existing leading
    // Plus icon — neither replaces the other.
    await expect(submit.locator('.btn__spinner')).toBeVisible();

    // Release the POST — the modal closes + busy state lifts.
    releasePost();

    await expect(modal).not.toBeVisible();
  });
});
