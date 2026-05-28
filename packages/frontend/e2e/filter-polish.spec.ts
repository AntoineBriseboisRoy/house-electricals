/**
 * Cycle-79 — filter primitives mobile polish @cycle-79
 *
 * Verifies the cycle-79 polish on the cycle-60 filter+sort primitives:
 *   - At mobile viewport (<=720px), `.sort-dropdown__option` computed
 *     height is >= 44px (touch-target floor).
 *   - At mobile viewport, `.filter-popover__chip` computed height is
 *     >= 44px.
 *   - `.sort-dropdown__menu` has a non-empty `animation-name` (parity
 *     with `.combobox__listbox` which has had `he-modal-rise` since
 *     cycle-60). Asserted via `getComputedStyle().animationName !==
 *     'none'` to avoid coupling to the literal keyframe name.
 *
 * Mobile-only — skipped on the desktop project. The cycle-60 primitives
 * keep desktop density at >720px; the changes here are mobile-only.
 *
 * Drives /components which mounts both surfaces in the cycle-60 toolbar.
 */

import { test, expect } from '@playwright/test';

test.describe('cycle-79 filter primitives mobile polish @cycle-79', () => {
  test.beforeEach(async ({}, info) => {
    test.skip(
      info.project.name === 'desktop-1440x900',
      'mobile-only spec — desktop density preserved at >720px'
    );
  });

  test('sort-dropdown options + filter chips meet 44px touch-target floor', async ({
    page,
  }) => {
    await page.goto('/components');
    // Wait for the toolbar to render.
    await expect(page.getByTestId('components-filter-toolbar')).toBeVisible();

    // --- Filter chips: open the popover, then measure a chip ---
    await page.getByTestId('components-filter-trigger').click();
    await expect(
      page.getByTestId('components-filter-popover')
    ).toBeVisible();

    const chip = page
      .locator('[data-testid="filter-type-chip"]')
      .first();
    await expect(chip).toBeVisible();
    const chipBox = await chip.boundingBox();
    expect(chipBox).not.toBeNull();
    // Allow sub-pixel tolerance from layout rounding.
    expect(chipBox!.height).toBeGreaterThanOrEqual(43.5);

    // Close the filter popover before opening the sort dropdown — they
    // are independent surfaces but closing keeps the DOM clean.
    await page.keyboard.press('Escape');

    // --- Sort dropdown options ---
    await page.getByTestId('components-sort-trigger').click();
    const menu = page.getByTestId('components-sort-menu');
    await expect(menu).toBeVisible();

    // animation-name must not be 'none' (cycle-79 added he-modal-rise).
    const animationName = await menu.evaluate(
      (el) => getComputedStyle(el).animationName
    );
    expect(animationName).not.toBe('none');
    expect(animationName.length).toBeGreaterThan(0);

    const option = page
      .locator('[data-testid="sort-dropdown-option"]')
      .first();
    await expect(option).toBeVisible();
    const optionBox = await option.boundingBox();
    expect(optionBox).not.toBeNull();
    expect(optionBox!.height).toBeGreaterThanOrEqual(43.5);
  });
});
