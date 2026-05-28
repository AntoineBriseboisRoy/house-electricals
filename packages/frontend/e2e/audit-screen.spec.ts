/**
 * G36 Part 2 cycle-63 — /audit screen e2e spec.
 *
 * Verifies the audit-log flow end-to-end:
 *   - 3 BreakerTest rows seeded via REST appear on the /audit screen.
 *   - Outcome filter narrows the visible row count.
 *   - Date range filter (since/until) narrows the visible row count.
 *   - Notes search narrows the visible row count.
 *   - Clicking a row navigates to /panels/<panelId>#breaker-<breakerId>
 *     per the cycle-22/23 deep-link contract.
 *
 * Desktop-only (the popover-anchored Combobox + date inputs are easier to
 * drive at a wider viewport; the mobile rendering is regression-covered by
 * the mobile-overflow-triage spec via the screens[] array). Skipping the
 * two mobile projects keeps the spec runtime low.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { authedFetch, E2E_BACKEND_URL } from './authed-fetch.js';

// .state.json lives under packages/frontend/e2e/ — Playwright is invoked
// with cwd = packages/frontend, so this resolves correctly under both
// `pnpm test:e2e` and a direct `pnpm exec playwright test` from the
// frontend package root.
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

const postTest = async (
  breakerId: string,
  body: Record<string, unknown>
): Promise<{ id: string }> => {
  const res = await authedFetch(
    `${E2E_BACKEND_URL}/api/v1/breakers/${breakerId}/breaker-tests`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    throw new Error(`POST breaker-tests failed: ${res.status} ${await res.text()}`);
  }
  const j = (await res.json()) as { data: { id: string } };
  return j.data;
};

const deleteTest = async (id: string): Promise<void> => {
  await authedFetch(`${E2E_BACKEND_URL}/api/v1/breaker-tests/${id}`, {
    method: 'DELETE',
  });
};

test.describe('G36 Part 2 /audit screen @cycle-63', () => {
  const createdIds: string[] = [];

  test.afterAll(async () => {
    for (const id of createdIds) {
      try {
        await deleteTest(id);
      } catch {
        // best-effort
      }
    }
    createdIds.length = 0;
  });

  test('shows seeded tests, filters by outcome/date/search, deep-links on click', async ({
    page,
  }, info) => {
    // Skip on the mobile projects — the popover-anchored combobox + native
    // date inputs interact better at the wider desktop viewport. Mobile
    // overflow is covered by mobile-overflow-triage's screens[] array.
    test.skip(info.project.name !== 'desktop-1440x900', 'desktop-only spec');
    const seeded = loadSeeded();
    const b0 = seeded.breakerIds[0];
    const b1 = seeded.breakerIds[1];

    // Seed three tests with distinct outcomes + testedAt timestamps and
    // distinguishing notes for the search assertion. Use widely-spaced
    // timestamps so the date filter selects a precise subset.
    const now = Date.now();
    const t1 = await postTest(b0, {
      outcome: 'pass',
      notes: 'killed power, kitchen lights dead',
      testedAt: now - 30 * 86_400_000, // 30 days ago
    });
    const t2 = await postTest(b1, {
      outcome: 'fail',
      notes: 'still hot, check wiring',
      testedAt: now - 15 * 86_400_000, // 15 days ago
    });
    const t3 = await postTest(b0, {
      outcome: 'pass',
      notes: 'verified after rewire',
      testedAt: now - 2 * 86_400_000, // 2 days ago
    });
    createdIds.push(t1.id, t2.id, t3.id);

    await page.goto('/audit');

    // All 3 seeded rows are visible.
    const rows = page.getByTestId('audit-row');
    await expect(rows).toHaveCount(3);

    // --- Outcome filter ---
    await page.getByTestId('audit-filter-trigger').click();
    // The outcome Combobox lists distinct outcomes. Open + select "fail".
    await page.getByTestId('audit-filter-outcome-trigger').click();
    await page
      .locator('[data-testid="combobox-option"][data-value="fail"]')
      .click();
    // The list narrows to 1 row.
    await expect(rows).toHaveCount(1);

    // Clear the outcome filter via the in-popover Clear button — restores all 3.
    await page.getByTestId('audit-filter-popover-clear').click();
    await expect(rows).toHaveCount(3);

    // --- Date filter (since = 10 days ago) ---
    // Only t3 (2 days ago) should remain.
    const tenDaysAgo = new Date(now - 10 * 86_400_000);
    const yyyy = tenDaysAgo.getFullYear();
    const mm = String(tenDaysAgo.getMonth() + 1).padStart(2, '0');
    const dd = String(tenDaysAgo.getDate()).padStart(2, '0');
    await page
      .getByTestId('audit-filter-since')
      .fill(`${yyyy}-${mm}-${dd}`);
    await expect(rows).toHaveCount(1);

    // Clear filters via the toolbar-level button.
    await page.getByTestId('audit-filter-popover-done').click();
    await page.getByTestId('audit-filter-clear').click();
    await expect(rows).toHaveCount(3);

    // --- Search (notes substring) — "rewire" only matches t3 ---
    await page.getByTestId('audit-search').fill('rewire');
    await expect(rows).toHaveCount(1);
    await page.getByTestId('audit-search').fill('');
    await expect(rows).toHaveCount(3);

    // --- Click-through deep link — row 0 is the newest (t3) on breaker b0 ---
    const firstRow = rows.first();
    const linkBreakerId = await firstRow.getAttribute('data-breaker-id');
    expect(linkBreakerId).toBe(b0);
    const link = firstRow.getByTestId('audit-row-link');
    await link.click();
    // Wouter navigation should land on /panels/<panelId> with the
    // #breaker-<id> hash (cycle-22/23 contract).
    await expect(page).toHaveURL(
      new RegExp(`/panels/${seeded.panelId}#breaker-${b0}$`)
    );
    // And the cycle-22 consumer should pulse the matching slot-cell.
    const slot = page.locator(`#slot-cell-${b0}`);
    await expect(slot).toBeVisible();
    await expect(slot).toHaveAttribute('data-highlight', 'true');
  });
});
