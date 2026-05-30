/**
 * Cycle-85 — Room dropdown (strict Combobox of existing rooms).
 *
 * The floor-panel-link tests that used to live here were removed in 2026-05
 * (the "Linked panel" default-wire picker + the `cf-panel` select no longer
 * exist). The breaker picker is now covered by `breaker-combo.spec.ts`.
 *
 * Hard rules from cycle-21:
 *  - No page.waitForTimeout.
 *  - Both Playwright projects (mobile + desktop) must pass.
 */
import { test, expect } from '@playwright/test';

test.describe('cycle-85 room dropdown', () => {
  test('ComponentForm Room field is a strict Combobox of existing rooms', async ({
    page,
  }) => {
    // Refactor 2026-05 follow-up — Room was Input + datalist (free text).
    // Per user direction, Room is now a STRICT Combobox dropdown. New rooms
    // come from the floor-plan Room drawing tool; typing in the form is
    // limited to filter-search the existing list.
    await page.goto('/library');
    await page.getByTestId('open-add-component').click();
    const modal = page.getByTestId('add-component-modal');
    await expect(modal).toBeVisible();

    // Old free-text input + datalist are gone.
    await expect(modal.locator('input[name="room"]')).toHaveCount(0);
    await expect(page.locator('#cf-room-suggestions')).toHaveCount(0);

    // New Combobox renders inside the modal.
    const combo = modal.getByTestId('cf-room');
    await expect(combo).toBeVisible();
    const trigger = combo.locator('button').first();
    await trigger.click();

    // Options listbox is portal-mounted; query at page root.
    const opts = page.locator('[data-testid="combobox-option"]');
    await expect(opts).toHaveCount(2); // Kitchen + Living Room (seeded)
    const values = await opts.evaluateAll((els) =>
      els.map((el) => (el as HTMLElement).getAttribute('data-value'))
    );
    expect(values).toContain('Kitchen');
    expect(values).toContain('Living Room');
  });

  // 2026-05 — Two tests were removed here:
  //  1. "Linked panel select persists via PATCH" — the standalone "Linked
  //     panel" default-wire picker was removed from FloorEditScreen (wiring a
  //     component always picks a real breaker, so a floor-level default added
  //     no value).
  //  2. "Edit form pre-selects Panel from floor.panelId" — asserted on the
  //     `cf-panel` <select>, which no longer exists: the Wiring section is now
  //     a single BreakerComboField (no separate panel select). `floor.panelId`
  //     remains a valid field and now drives the picker's default active panel
  //     pill. The breaker picker itself is covered by `breaker-combo.spec.ts`.
});
