/**
 * cycle-52 — ThemedToaster hoist + theme binding spec.
 *
 * Verifies the two bugs documented in CLAUDE.md cycle-51 ADR are fixed:
 *
 *   1. FloorEditScreen is an AppShell escape-hatch route (rendered OUTSIDE
 *      the AppShell-wrapped Switch in App.tsx). In cycle-11 through cycle-51
 *      the sonner Toaster lived INSIDE AppShell, so FloorEditScreen's
 *      ~27 `toast()` calls fired into a void — no Toaster host was mounted.
 *      cycle-52 hoists the Toaster to main.tsx (above the Switch), so the
 *      host is always mounted, regardless of which subtree is rendered.
 *
 *   2. The sonner Toaster previously had no `theme` prop, so it fell back
 *      to OS `prefers-color-scheme` — wrong when the user's `he.theme`
 *      preference disagrees. cycle-52 wraps it in `ThemedToaster`, which
 *      calls `useTheme()` and binds the resolved theme.
 *
 * Implementation note: sonner only renders the `<ol data-sonner-toaster>`
 * host element when at least one toast is queued (its aria-live `<section>`
 * exists earlier, but the visible host is lazy). So the spec proves the
 * hoist worked by TRIGGERING a toast on the escape-hatch route and
 * observing the toast renders — pre-cycle-52 it would have been swallowed.
 *
 * Hard rules (from cycle-21):
 * - No page.waitForTimeout. Only auto-waiting expect().
 * - Runs on both mobile + desktop projects.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type SeededState = {
  seeded?: {
    floorId: string;
  };
};

const loadSeeded = (): NonNullable<SeededState['seeded']> => {
  const state = JSON.parse(
    readFileSync(join(__dirname, '.state.json'), 'utf8')
  ) as SeededState;
  if (state.seeded === undefined) {
    throw new Error('e2e/.state.json missing seeded ids');
  }
  return state.seeded;
};

test.describe('ThemedToaster hoist + theme binding @cycle-52', () => {
  test('rename-floor toast fires on escape-hatch route AND renders in correct (dark) theme', async ({
    page,
  }) => {
    const { floorId } = loadSeeded();
    await page.goto(`/floors/${floorId}/edit`);
    await expect(page.getByRole('heading', { name: /Main Floor/i })).toBeVisible();

    // Pre-cycle-52, sonner's host lived in AppShell — and FloorEditScreen
    // bypasses AppShell — so this `toast.success('Floor renamed')` would
    // have been swallowed. Post-cycle-52 the Toaster is mounted in
    // main.tsx (above the route Switch), so it's always reachable.
    //
    // Trigger the toast via the Rename floor flow (handler calls
    // attemptRenameFloor → toast.success on success).
    await page.getByRole('button', { name: 'Rename' }).first().click();
    const modal = page.getByTestId('prompt-modal');
    await expect(modal).toBeVisible();

    const input = page.getByTestId('prompt-modal-input');
    await input.fill('Main Floor Renamed');
    await page.getByTestId('prompt-modal-confirm').click();

    // THE proof of fix #1 — the toast actually rendered.
    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(/Floor renamed/i);

    // THE proof of fix #2 — the toaster host carries data-theme="dark"
    // (ThemeProvider default), NOT whatever the OS prefers. Sonner only
    // renders the <ol data-sonner-toaster> when at least one toast is
    // queued, so we check it after the toast fired.
    const host = page.locator('[data-sonner-toaster]');
    await expect(host).toHaveCount(1);
    await expect(host).toHaveAttribute('data-theme', 'dark');

    // Modal should have closed.
    await expect(modal).not.toBeVisible();

    // Restore the floor name so other specs see "Main Floor" as expected.
    await page.getByRole('button', { name: 'Rename' }).first().click();
    await expect(modal).toBeVisible();
    await input.fill('Main Floor');
    await page.getByTestId('prompt-modal-confirm').click();
    await expect(modal).not.toBeVisible();
  });
});
