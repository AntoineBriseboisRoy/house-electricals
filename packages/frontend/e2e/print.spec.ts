/**
 * G24 cycle-27 — Printable diagram spec.
 *
 * Verifies:
 *   - /panels/:id/print renders the printable diagram (h1 + slot grid).
 *   - The bottom-tabs nav is NOT in the DOM (escape-hatch route — no app
 *     chrome). Confirms the App.tsx isolation pattern is working.
 *   - The "Print diagram" link in PanelDetail footer points here.
 */

import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authedFetch, E2E_BACKEND_URL } from './authed-fetch.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCREENSHOTS_DIR = join(__dirname, '.screenshots');
mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const loadSeeded = (): { panelId: string } => {
  const raw = JSON.parse(readFileSync(join(__dirname, '.state.json'), 'utf8')) as {
    seeded?: { panelId: string };
  };
  if (raw.seeded === undefined) throw new Error('e2e/.state.json missing seeded ids');
  return raw.seeded;
};

test.describe('G24 printable diagram @cycle-27', () => {
  test('renders the panel diagram + no app chrome', async ({ page }, info) => {
    const seeded = loadSeeded();
    await page.goto(`/panels/${seeded.panelId}/print`);

    // Paper-like white card visible.
    const paper = page.getByTestId('printable-page');
    await expect(paper).toBeVisible();

    // Heading is the panel name.
    await expect(page.getByRole('heading', { name: 'Main Panel' })).toBeVisible();

    // Slot grid is present with the seeded breakers. Scope to the slot grid
    // (G44 added a "Scan index" section that ALSO renders the labels, which
    // would make a bare getByText ambiguous under strict mode).
    const slots = page.getByLabel('Breaker slots');
    await expect(slots.getByText('Kitchen lights')).toBeVisible();
    await expect(slots.getByText('Kitchen outlets')).toBeVisible();

    // Escape-hatch confirmed: no bottom-tabs nav in the DOM.
    await expect(page.locator('.bottom-tabs')).toHaveCount(0);

    // No floating account/theme UI either (lives in AppShell).
    // fix/mobile-floating-cluster: the cluster collapsed from 3 chips
    // (.theme-toggle + .account-button + .logout-button) to a single
    // .user-menu chip. Print escape-hatch is unaffected — assert all
    // four selectors are absent for forwards/backwards safety.
    await expect(page.locator('.theme-toggle')).toHaveCount(0);
    await expect(page.locator('.user-menu')).toHaveCount(0);

    // Cycle-68 — no VersionPill either (lives in AppShell next to
    // ThemeToggle). Locks in escape-hatch isolation for the new affordance.
    await expect(page.locator('[data-testid="version-pill"]')).toHaveCount(0);

    // G11 cycle-52: ThemedToaster mounts in main.tsx (above the route
    // Switch), so its host element exists on the print route too. But
    // PrintableDiagramScreen makes ZERO `toast()` calls — assert the host
    // contains no rendered toast. Locks in "static artifact" invariant
    // even though the Toaster region is technically in the DOM.
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);

    await page.screenshot({
      path: join(SCREENSHOTS_DIR, `g24-print-${info.project.name}.png`),
      fullPage: true,
    });
  });

  test('PanelDetail footer links to /print', async ({ page }) => {
    const seeded = loadSeeded();
    await page.goto(`/panels/${seeded.panelId}`);

    const link = page.getByRole('link', { name: /Open printable breaker diagram/i });
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toBe(`/panels/${seeded.panelId}/print`);
  });

  // G44 — QR deep-link labels. The panel header carries a panel-level QR and a
  // dedicated "Scan index" section carries one QR per OCCUPIED breaker, each
  // encoding the verbatim G44 deep-link contract:
  //   panel:   <origin>/panels/<id>
  //   breaker: <origin>/panels/<id>#breaker-<bid>
  // Assert via the data-qr-value attribute rendered by ui/qr.tsx (PIN 1),
  // NOT by decoding the SVG.
  test('renders panel-level + per-breaker QR deep links @g44', async ({ page }) => {
    const seeded = loadSeeded();

    // Fetch the occupied breakers (slotPosition !== null) — the SAME set the
    // scan index iterates. Includes both tandem halves + the double-pole id.
    // authedFetch needs an absolute URL (raw fetch, not the page fixture).
    const res = await authedFetch(
      `${E2E_BACKEND_URL}/api/v1/panels/${seeded.panelId}/breakers`
    );
    const body = (await res.json()) as {
      data: Array<{ id: string; slotPosition: number | null }>;
    };
    const occupied = body.data.filter((b) => b.slotPosition !== null);
    expect(occupied.length).toBeGreaterThan(0);

    await page.goto(`/panels/${seeded.panelId}/print`);
    await expect(page.getByTestId('printable-page')).toBeVisible();

    // Origin is computed from the page URL at render time (PIN 4).
    const origin = new URL(page.url()).origin;

    // Panel-level QR in the header encodes the panel URL.
    const panelQr = page.locator(
      '[data-testid="printable-panel-qr"] [data-qr-value]'
    );
    await expect(panelQr).toHaveAttribute(
      'data-qr-value',
      `${origin}/panels/${seeded.panelId}`
    );

    // Scan index has exactly one QR item per occupied breaker.
    const indexItems = page.locator('[data-testid="printable-scan-index-item"]');
    await expect(indexItems).toHaveCount(occupied.length);

    // Every occupied breaker has a QR encoding its exact deep link.
    for (const b of occupied) {
      const expected = `${origin}/panels/${seeded.panelId}#breaker-${b.id}`;
      const qr = page.locator(
        `[data-testid="printable-scan-index-item"][data-breaker-id="${b.id}"] [data-qr-value]`
      );
      await expect(qr).toHaveAttribute('data-qr-value', expected);
    }

    // No app chrome on the print escape-hatch route (existing contract holds).
    await expect(page.locator('.bottom-tabs')).toHaveCount(0);
    await expect(page.locator('.theme-toggle')).toHaveCount(0);
  });
});
