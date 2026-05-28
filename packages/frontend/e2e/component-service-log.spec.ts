/**
 * G40 Part 2 cycle-67 — component service-log e2e spec.
 *
 * Verifies the component service-log flow end-to-end on /components:
 *  - ComponentsScreen row shows the "Log · 0" badge when no entries exist.
 *  - Clicking the badge opens ServiceLogModal with parentType='component'.
 *  - Adding an entry persists + the badge count increments.
 *  - The cycle-67 search widening: search by note content finds the matching
 *    component (and only that component) on /components.
 *
 * Desktop-only — mirrors cycle-66's service-log.spec.ts skip-rule. Mobile
 * rendering is covered by mobile-overflow-triage via the screens[] array.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const STATE_FILE = join(process.cwd(), 'e2e', '.state.json');
const E2E_BACKEND_URL = 'http://127.0.0.1:3100';

type SeededState = {
  seeded?: {
    panelId: string;
    breakerIds: string[];
    componentIds: string[];
  };
};

const loadSeeded = (): NonNullable<SeededState['seeded']> => {
  const state = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as SeededState;
  if (state.seeded === undefined) {
    throw new Error('e2e/.state.json missing seeded ids');
  }
  return state.seeded;
};

const deleteServiceEntry = async (id: string): Promise<void> => {
  await fetch(`${E2E_BACKEND_URL}/api/v1/service-entries/${id}`, {
    method: 'DELETE',
  });
};

const listEntriesForComponent = async (
  componentId: string
): Promise<{ id: string; note: string }[]> => {
  const res = await fetch(
    `${E2E_BACKEND_URL}/api/v1/service-entries?parentType=component&parentId=${componentId}`
  );
  const body = (await res.json()) as {
    data: { id: string; note: string }[];
  };
  return body.data;
};

test.describe('G40 Part 2 service-log on ComponentRow @cycle-67', () => {
  test.beforeEach(async ({}, info) => {
    test.skip(
      info.project.name !== 'desktop-1440x900',
      'desktop-only spec — mobile rendering covered by mobile-overflow-triage'
    );
    // Belt-and-suspenders: clear any stragglers from a prior failed run.
    const seeded = loadSeeded();
    for (const componentId of seeded.componentIds) {
      const existing = await listEntriesForComponent(componentId);
      for (const e of existing) await deleteServiceEntry(e.id);
    }
  });

  test('component row badge → modal: add entry, count goes 0 → 1', async ({
    page,
  }) => {
    const seeded = loadSeeded();
    // Pick the first seeded component — name "Kitchen Outlet 1".
    const targetComponentId = seeded.componentIds[0];

    await page.goto('/components');

    const badge = page.locator(
      `[data-testid="component-row-service-log"][data-target-component-id="${targetComponentId}"]`
    );
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute('data-log-count', '0');

    // Click the badge → ServiceLogModal opens with the empty-state copy
    // and the component parentType microcopy.
    await badge.click();
    const modal = page.getByTestId('service-log-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId('service-log-modal-subtitle')).toContainText(
      /no entries yet/i
    );
    // The ServiceLogModal swaps microcopy on parentType — "what was changed"
    // is the component variant (vs "what was serviced" for breaker).
    await expect(modal).toContainText(/what was changed/i);

    // Add an entry via the form.
    await modal
      .getByTestId('service-log-modal-note')
      .fill('Replaced GFCI outlet — burnt terminals scorched');
    await modal.getByTestId('service-log-modal-submit').click();

    // The subtitle flips to "1 entry on record" + the list shows the row.
    await expect(modal.getByTestId('service-log-modal-subtitle')).toContainText(
      /1 entry on record/i
    );
    const items = modal.getByTestId('service-log-modal-item');
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText('Replaced GFCI outlet');

    // Close the modal — the badge count is now 1.
    await modal.getByTestId('service-log-modal-close').click();
    await expect(modal).not.toBeVisible();
    await expect(badge).toHaveAttribute('data-log-count', '1');
  });

  test('cycle-67 search widening — /components?search= matches service_entries.note', async ({
    page,
  }) => {
    const seeded = loadSeeded();
    // Seed a distinctive note on the FIRST component only. The word
    // "scorched-cycle67" appears in NO component's name or room, so a
    // hit at /components?search=... is exclusively from the note widening.
    const targetComponentId = seeded.componentIds[0];
    const post = await fetch(
      `${E2E_BACKEND_URL}/api/v1/components/${targetComponentId}/service-entries`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          note: 'Inspection scorched-cycle67 reading shows OK',
        }),
      }
    );
    expect(post.status).toBe(201);

    await page.goto('/components');

    // Type the distinctive token into the search input — 250ms debounce.
    const searchInput = page.getByPlaceholder(/search name, room, or notes/i);
    await expect(searchInput).toBeVisible();
    await searchInput.fill('scorched-cycle67');

    // Exactly one component row should show — the one we seeded the entry on.
    const rows = page.getByTestId('component-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute(
      'data-component-id',
      targetComponentId
    );
  });
});
