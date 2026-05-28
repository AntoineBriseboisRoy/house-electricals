/**
 * Cycle-85 — Room datalist autocomplete + floor.panelId linking.
 *
 * Covers the two user-flagged asks:
 *  1. Room field on ComponentForm shows a datalist of existing rooms so
 *     typos like "Kichen" / "kitchen" don't fragment the canonical
 *     "Kitchen". Free text is still accepted (suggest-only).
 *  2. Linking a floor to a panel via FloorEditScreen's "Linked panel"
 *     select makes ComponentForm pre-select that panel when editing a
 *     component on that floor.
 *
 * Hard rules from cycle-21:
 *  - No page.waitForTimeout.
 *  - Both Playwright projects (mobile + desktop) must pass.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type SeededState = {
  seeded?: {
    panelId: string;
    breakerIds: string[];
    floorId: string;
    roomIds: string[];
    componentIds: string[];
  };
};

const loadSeeded = (): NonNullable<SeededState['seeded']> => {
  const state = JSON.parse(
    readFileSync(join(__dirname, '.state.json'), 'utf8')
  ) as SeededState;
  if (!state.seeded) throw new Error('no seed');
  return state.seeded;
};

const E2E_BACKEND_URL = 'http://127.0.0.1:3100';

test.describe('cycle-85 room dropdown + floor-panel link', () => {
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

  test('FloorEditScreen — Linked panel select persists via PATCH', async ({
    page,
  }) => {
    const seed = loadSeeded();
    await page.goto(`/floors/${seed.floorId}/edit`);

    // The picker is at the top of the right sidebar (loaded after the
    // floor itself).
    const picker = page.getByTestId('floor-linked-panel');
    await expect(picker).toBeVisible();

    // Wait for panels to load — picker shouldn't be disabled.
    await expect(picker).toBeEnabled();

    // The seed has 1 panel ("Main Panel"). Pick it.
    await picker.selectOption({ label: 'Main Panel' });

    // Server PATCH succeeded — verify by re-fetching the floor.
    await expect(async () => {
      const res = await fetch(
        `${E2E_BACKEND_URL}/api/v1/floors/${seed.floorId}`
      );
      const body = (await res.json()) as { data: { panelId: string | null } };
      expect(body.data.panelId).toBe(seed.panelId);
    }).toPass();

    // Cleanup — leave the seed floor unlinked so later specs (smoke,
    // configure, etc.) see the floor in its original shape.
    await fetch(`${E2E_BACKEND_URL}/api/v1/floors/${seed.floorId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ panelId: null }),
    });
  });

  test('Edit form pre-selects Panel from floor.panelId when component is unwired', async ({
    page,
  }) => {
    const seed = loadSeeded();
    // Step 1: link the floor to the panel via the public API so the
    // ComponentsScreen sees the floor.panelId on load.
    await fetch(`${E2E_BACKEND_URL}/api/v1/floors/${seed.floorId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ panelId: seed.panelId }),
    });

    // Step 2: create a fresh unwired component on this floor.
    const created = await fetch(`${E2E_BACKEND_URL}/api/v1/components`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'outlet',
        name: 'Cycle-85 default-wire test',
        room: null,
        notes: null,
        breakerId: null,
        floorId: seed.floorId,
      }),
    });
    const componentId = ((await created.json()) as { data: { id: string } })
      .data.id;

    // Step 3: open ComponentsScreen, find this component's row, click Edit.
    await page.goto('/components');
    const row = page.locator(`[data-component-id="${componentId}"]`);
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: /Edit component/ }).click();

    // Step 4: the Wiring section's Panel select should default to the
    // linked panel id (because the component itself has breakerId=null).
    const panelSelect = page.getByTestId('cf-panel');
    await expect(panelSelect).toHaveValue(seed.panelId);

    // Cleanup so the test is idempotent.
    await fetch(`${E2E_BACKEND_URL}/api/v1/components/${componentId}`, {
      method: 'DELETE',
    });
    await fetch(`${E2E_BACKEND_URL}/api/v1/floors/${seed.floorId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ panelId: null }),
    });
  });
});
