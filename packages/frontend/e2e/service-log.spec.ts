/**
 * G40 Part 1 cycle-66 — service-log e2e spec.
 *
 * Verifies the breaker service-log flow end-to-end:
 *  - PanelDetail BreakerRow shows the "Log · 0" badge when no entries exist.
 *  - Clicking the badge opens ServiceLogModal.
 *  - Adding an entry persists + the badge count increments.
 *  - The new entry appears in the modal list with the note text.
 *  - Deleting an entry removes it + the count decrements.
 *
 * Desktop-only — the badge + modal are exercised in click flow; mobile
 * rendering is regression-covered by mobile-overflow-triage via the
 * screens[] array.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { authedFetch, E2E_BACKEND_URL } from './authed-fetch.js';

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

const deleteServiceEntry = async (id: string): Promise<void> => {
  await authedFetch(`${E2E_BACKEND_URL}/api/v1/service-entries/${id}`, {
    method: 'DELETE',
  });
};

const listEntriesForBreaker = async (
  breakerId: string
): Promise<{ id: string; note: string }[]> => {
  const res = await authedFetch(
    `${E2E_BACKEND_URL}/api/v1/service-entries?parentType=breaker&parentId=${breakerId}`
  );
  const body = (await res.json()) as {
    data: { id: string; note: string }[];
  };
  return body.data;
};

test.describe('G40 service-log on BreakerRow @cycle-66', () => {
  test.beforeEach(async ({}, info) => {
    test.skip(
      info.project.name !== 'desktop-1440x900',
      'desktop-only spec — mobile rendering covered by mobile-overflow-triage'
    );
    // Belt-and-suspenders: clear any stragglers from a prior failed run.
    const seeded = loadSeeded();
    for (const breakerId of seeded.breakerIds) {
      const existing = await listEntriesForBreaker(breakerId);
      for (const e of existing) await deleteServiceEntry(e.id);
    }
  });

  test('badge → modal: add an entry, count goes 0 → 1', async ({ page }) => {
    const seeded = loadSeeded();
    await page.goto(`/panels/${seeded.panelId}`);

    // Pivot to list view so the BreakerRow renders (viz is the default).
    await page.getByRole('tab', { name: /list/i }).click();

    // First breaker is the canonical target.
    const targetBreakerId = seeded.breakerIds[0];
    const badge = page.locator(
      `[data-testid="breaker-row-service-log"][data-breaker-id="${targetBreakerId}"]`
    );
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute('data-log-count', '0');

    // Click the badge → ServiceLogModal opens with the empty state copy.
    await badge.click();
    const modal = page.getByTestId('service-log-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId('service-log-modal-subtitle')).toContainText(
      /no entries yet/i
    );

    // Add an entry via the form.
    await modal
      .getByTestId('service-log-modal-note')
      .fill('Retorqued lugs on breaker — annual maintenance');
    await modal.getByTestId('service-log-modal-submit').click();

    // The subtitle flips to "1 entry on record" + the list shows the row.
    await expect(modal.getByTestId('service-log-modal-subtitle')).toContainText(
      /1 entry on record/i
    );
    const items = modal.getByTestId('service-log-modal-item');
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText('Retorqued lugs');

    // Close the modal — the badge count is now 1.
    await modal.getByTestId('service-log-modal-close').click();
    await expect(modal).not.toBeVisible();
    await expect(badge).toHaveAttribute('data-log-count', '1');
  });

  test('badge → modal → delete: count goes 1 → 0', async ({ page }) => {
    const seeded = loadSeeded();
    const targetBreakerId = seeded.breakerIds[0];

    // Seed one entry via the API so the spec doesn't depend on the add-flow.
    const post = await authedFetch(
      `${E2E_BACKEND_URL}/api/v1/breakers/${targetBreakerId}/service-entries`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ note: 'Inspected for arc damage' }),
      }
    );
    expect(post.status).toBe(201);

    await page.goto(`/panels/${seeded.panelId}`);
    await page.getByRole('tab', { name: /list/i }).click();

    const badge = page.locator(
      `[data-testid="breaker-row-service-log"][data-breaker-id="${targetBreakerId}"]`
    );
    await expect(badge).toHaveAttribute('data-log-count', '1');

    await badge.click();
    const modal = page.getByTestId('service-log-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId('service-log-modal-item')).toHaveCount(1);

    // Click the delete IconButton on the entry.
    await modal.getByTestId('service-log-modal-delete').click();
    await expect(modal.getByTestId('service-log-modal-item')).toHaveCount(0);
    await expect(modal.getByTestId('service-log-modal-subtitle')).toContainText(
      /no entries yet/i
    );

    await modal.getByTestId('service-log-modal-close').click();
    await expect(badge).toHaveAttribute('data-log-count', '0');
  });
});
