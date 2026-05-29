/**
 * Cycle-73 — mobile bottom-sheet Modal e2e.
 *
 * Verifies the `<Modal presentation="sheet">` opt-in variant renders as
 * a bottom-sheet at phone-width viewports:
 *  - Add-→-Modal on /components renders with `.modal--sheet` class +
 *    a visible drag-handle (now a functional swipe-to-dismiss affordance,
 *    2026-05 — superseding the cycle-73 "decorative only" decision).
 *  - ServiceLogModal triggered from a BreakerRow Log pill renders with
 *    the same sheet treatment.
 *  - Dismissal via the Close button still works (cycle-20 G20 ADR
 *    preserved); the drag-handle stays aria-hidden (ESC/Close/overlay are
 *    the accessible dismiss paths; the swipe is a touch enhancement).
 *
 * Mobile-only — desktop falls back to centered visuals automatically
 * via the cycle-36 G29 useNarrowViewport hook (matchMedia 720px). The
 * centered-mode rendering is exercised by the existing spec suite.
 *
 * Per the cycle-21 G21 e2e contract, captures viewport-only screenshots
 * to `.screenshots/` for a visual baseline; does NOT touch
 * mobile-overflow-triage.spec.ts or the global cycle-21 baseline.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const STATE_FILE = join(process.cwd(), 'e2e', '.state.json');

type SeededState = {
  seeded?: {
    panelId: string;
    breakerIds: string[];
  };
};

const loadSeeded = (): NonNullable<SeededState['seeded']> => {
  const state = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as SeededState;
  if (state.seeded === undefined) {
    throw new Error('e2e/.state.json missing seeded ids');
  }
  return state.seeded;
};

test.describe('cycle-73 mobile bottom-sheet Modal @cycle-73', () => {
  test.beforeEach(async ({}, info) => {
    test.skip(
      info.project.name === 'desktop-1440x900',
      'mobile-only spec — desktop falls back to centered visuals (720px breakpoint)'
    );
  });

  test('Add-component Modal renders as sheet on mobile', async ({ page }, info) => {
    await page.goto('/components');

    // Open the Add-→-Modal via the cycle-50 testid contract.
    await page.getByTestId('open-add-component').click();
    const modal = page.getByTestId('add-component-modal');
    await expect(modal).toBeVisible();

    // Sheet class is present (the modal is the `<div role="dialog">`).
    await expect(modal).toHaveClass(/\bmodal--sheet\b/);

    // The overlay (parent) carries the sheet modifier too.
    const overlay = page.locator('.modal-overlay--sheet').first();
    await expect(overlay).toBeVisible();

    // Drag-handle (swipe-to-dismiss) is rendered.
    const dragHandle = modal.locator('.modal__drag-handle');
    await expect(dragHandle).toBeVisible();
    // Stays aria-hidden: ESC/Close/overlay are the accessible dismiss paths;
    // the swipe is a touch enhancement layered on top.
    await expect(dragHandle).toHaveAttribute('aria-hidden', 'true');

    await page.screenshot({
      path: `e2e/.screenshots/modal-sheet-add-component-${info.project.name}.png`,
      fullPage: false,
    });

    // Dismissal via the Close (X) button still works.
    await modal.getByRole('button', { name: /close/i }).click();
    await expect(modal).not.toBeVisible();
  });

  test('ServiceLogModal renders as sheet on mobile', async ({ page }, info) => {
    const seeded = loadSeeded();
    await page.goto(`/panels/${seeded.panelId}`);

    // Pivot to list view so the BreakerRow renders.
    await page.getByRole('tab', { name: /list/i }).click();

    // Click the Log pill on the first breaker (cycle-66 G40 contract).
    const targetBreakerId = seeded.breakerIds[0];
    const badge = page.locator(
      `[data-testid="breaker-row-service-log"][data-breaker-id="${targetBreakerId}"]`
    );
    await expect(badge).toBeVisible();
    await badge.click();

    const modal = page.getByTestId('service-log-modal');
    await expect(modal).toBeVisible();
    await expect(modal).toHaveClass(/\bmodal--sheet\b/);

    const dragHandle = modal.locator('.modal__drag-handle');
    await expect(dragHandle).toBeVisible();
    await expect(dragHandle).toHaveAttribute('aria-hidden', 'true');

    await page.screenshot({
      path: `e2e/.screenshots/modal-sheet-service-log-${info.project.name}.png`,
      fullPage: false,
    });

    // Dismissal via the cycle-66 G40 testid contract still works.
    await modal.getByTestId('service-log-modal-close').click();
    await expect(modal).not.toBeVisible();
  });
});
