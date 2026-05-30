/**
 * Cycle 65 — UI Polish Audit @audit-only
 *
 * User mandate: "make sure the UI is polished. The spacing between things is
 * respected, it feels good to use it, things are aligned as they should, etc.
 * Use Playwright for that iteration."
 *
 * This spec CAPTURES ONLY — it produces screenshots into
 * `e2e/.screenshots/cycle65/<viewport>/<name>.png`. The companion markdown
 * report `cycle65-polish-audit.md` (at repo root) reads those screenshots and
 * triages findings.
 *
 * Hard rules (cycle-21 pinned):
 * - Deterministic waits only — no `page.waitForTimeout` for content.
 * - Touches NO production source — additional state for special surfaces
 *   (extra breaker tests, second switch w/ three-way control, critical
 *   components, "tested >12mo ago") is seeded via the public REST API.
 * - Runs against the default e2e backend on port 3100 (cycle-21 isolated tmp).
 *
 * Tag: every test is marked @audit-only so a future CI filter can skip it.
 */

import { test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SCREENSHOTS_ROOT = join(__dirname, '.screenshots', 'cycle65');

import { authedFetch, E2E_BACKEND_URL } from './authed-fetch.js';

type SeededState = {
  seeded?: {
    panelId: string;
    breakerIds: string[];
    floorId: string;
    roomIds: string[];
    componentIds: string[];
    switchId: string;
    controlledLightIds: string[];
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

const snap = async (
  page: Page,
  projectName: string,
  name: string,
  opts?: { fullPage?: boolean }
): Promise<void> => {
  const viewportDir = join(SCREENSHOTS_ROOT, projectName);
  mkdirSync(viewportDir, { recursive: true });
  await page.screenshot({
    path: join(viewportDir, `${name}.png`),
    fullPage: opts?.fullPage ?? false,
  });
};

const settle = async (page: Page): Promise<void> => {
  await page.waitForLoadState('networkidle').catch(() => {
    /* some screens keep poll-like calls open; that's OK */
  });
};

/** Wait for a CSS opacity-driven enter animation on a [data-testid] to finish. */
const waitForModalSettled = async (
  page: Page,
  testId: string
): Promise<void> => {
  await page
    .waitForFunction(
      (id) => {
        const el = document.querySelector(
          `[data-testid="${id}"]`
        ) as HTMLElement | null;
        if (el === null) return false;
        const op = parseFloat(getComputedStyle(el).opacity);
        return op > 0.95;
      },
      testId,
      { timeout: 2_000 }
    )
    .catch(() => {});
};

const post = async (path: string, body: unknown): Promise<unknown> => {
  const res = await authedFetch(`${E2E_BACKEND_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `POST ${path} failed: ${res.status} ${await res.text()}`
    );
  }
  const j = (await res.json()) as { data: unknown };
  return j.data;
};

const patch = async (path: string, body: unknown): Promise<void> => {
  const res = await authedFetch(`${E2E_BACKEND_URL}${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `PATCH ${path} failed: ${res.status} ${await res.text()}`
    );
  }
};

/**
 * Idempotent supplemental seed so the audit covers extra surfaces:
 *  - 3 breaker_tests (1 recent OK, 1 with notes, 1 "tested >12 months ago")
 *  - 1 critical component
 *  - tandem breaker pair (slot 9 a + 9 b)
 *  - a second 2-gang switch with switch_controls forming a 3-way light
 *
 * Re-run-safe: each block checks the existing state via a probe GET first.
 */
const supplementalSeed = async (
  seeded: ReturnType<typeof loadSeeded>
): Promise<void> => {
  const b0 = seeded.breakerIds[0];

  // 1. Breaker tests — three rows w/ different outcomes + ages.
  const existingTests = await authedFetch(
    `${E2E_BACKEND_URL}/api/v1/breaker-tests?breakerId=${b0}`
  ).then((r) => r.json() as Promise<{ data: { id: string }[] }>);
  if (existingTests.data.length < 3) {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    const oneYearPlus = 13 * 30 * 24 * oneHour;
    // recent
    await post(`/api/v1/breakers/${b0}/breaker-tests`, {
      testedAt: now - oneHour,
      outcome: 'OK',
      notes: 'Verified at panel — load returned cleanly',
    });
    // mid-range
    await post(`/api/v1/breakers/${seeded.breakerIds[1]}/breaker-tests`, {
      testedAt: now - 7 * 24 * oneHour,
      outcome: 'Trips on inrush',
      notes: 'High inrush detected, may need bigger amp',
    });
    // >12 mo ago — exercise the warn dot
    await post(`/api/v1/breakers/${b0}/breaker-tests`, {
      testedAt: now - oneYearPlus,
      outcome: 'OK',
      notes: 'Original install',
    });
  }

  // 2. Critical flag on the first outlet
  try {
    await patch(`/api/v1/components/${seeded.componentIds[0]}`, {
      critical: true,
    });
  } catch {
    /* already critical or schema-skipped — ignore */
  }

  // 3. Tandem breaker pair at slot 9 a/b (avoid colliding with seeded 1..7)
  const probe = (await authedFetch(
    `${E2E_BACKEND_URL}/api/v1/panels/${seeded.panelId}/breakers`
  ).then((r) => r.json())) as { data: { slotPosition: number | null; tandemHalf: string | null }[] };
  const hasTandem = probe.data.some(
    (b) => b.slotPosition === 9 && (b.tandemHalf === 'a' || b.tandemHalf === 'b')
  );
  if (!hasTandem) {
    try {
      await post(`/api/v1/panels/${seeded.panelId}/breakers`, {
        slot: '9',
        slotPosition: 9,
        amperage: 15,
        poles: 'tandem',
        tandemHalf: 'a',
        label: 'Outdoor lights',
      });
      await post(`/api/v1/panels/${seeded.panelId}/breakers`, {
        slot: '9',
        slotPosition: 9,
        amperage: 15,
        poles: 'tandem',
        tandemHalf: 'b',
        label: 'Garage outlets',
      });
    } catch {
      /* may already exist from a prior audit run */
    }
  }

  // 4. Three-way switch — add a SECOND switch + a switch_control row that
  //    co-controls the existing Living-Room light (cycle-64 surface).
  //    The seeded switch (gang 1) already controls the Living-Room light.
  //    A new 2nd switch with gang0 → same Living-Room light makes it a 3-way.
  const components = (await authedFetch(`${E2E_BACKEND_URL}/api/v1/components`).then(
    (r) => r.json()
  )) as { data: { id: string; name: string }[] };
  const has3wayFlag = components.data.some(
    (c) => c.name === 'Hall 3-way switch'
  );
  if (!has3wayFlag) {
    try {
      const sw2 = (await post('/api/v1/components', {
        type: 'switch',
        name: 'Hall 3-way switch',
        room: 'Living Room',
        breakerId: seeded.breakerIds[3],
        floorId: seeded.floorId,
        posX: 5500,
        posY: 4500,
        gangs: 1,
      })) as { id: string };
      // 3-way controlling the Living-Room light (componentIds[3])
      await post(`/api/v1/components/${sw2.id}/controls`, {
        gangIndex: 0,
        controlledId: seeded.controlledLightIds[1],
      });
    } catch {
      /* may already exist */
    }
  }
};

test.describe('Cycle 65 polish audit @audit-only', () => {
  test('capture all primary screens + special states', async ({
    page,
  }, info) => {
    test.setTimeout(180_000);

    const seeded = loadSeeded();
    await supplementalSeed(seeded);

    const project = info.project.name;

    // -------- 1. PanelListScreen (seeded) --------
    await page.goto('/');
    await page
      .getByText('Main Panel')
      .first()
      .waitFor({ timeout: 10_000 })
      .catch(() => {});
    await settle(page);
    await snap(page, project, '01-panel-list-seeded', { fullPage: true });

    // Open Add Panel modal
    const openAddPanel = page.getByTestId('open-add-panel');
    if (await openAddPanel.isVisible()) {
      await openAddPanel.click();
      await page.getByTestId('add-panel-modal').waitFor();
      await waitForModalSettled(page, 'add-panel-modal');
      await snap(page, project, '02-panel-list-add-modal');
      // Close
      await page.keyboard.press('Escape');
      await page
        .getByTestId('add-panel-modal')
        .waitFor({ state: 'hidden' })
        .catch(() => {});
    }

    // -------- 2. PanelDetailScreen (viz default) --------
    await page.goto(`/panels/${seeded.panelId}`);
    await page
      .getByRole('heading', { name: /Main Panel/i })
      .first()
      .waitFor({ timeout: 10_000 })
      .catch(() => {});
    await settle(page);
    await snap(page, project, '03-panel-detail-viz', { fullPage: true });

    // Switch to LIST view (panel-view-toggle role=tab name="List")
    const listToggle = page
      .locator('.panel-view-toggle button', { hasText: /^List$/ })
      .first();
    if (await listToggle.isVisible().catch(() => false)) {
      await listToggle.click();
      await settle(page);
      await snap(page, project, '04-panel-detail-list', { fullPage: true });

      // 2026-05 — the persistent On/Off toggle replaces the removed Impact
      // button. Flip a breaker off, snapshot the de-energized row, flip back.
      const stateToggle = page.getByTestId('breaker-state-toggle').first();
      if (await stateToggle.isVisible().catch(() => false)) {
        await stateToggle.click();
        await settle(page);
        await snap(page, project, '05-breaker-off');
        // Restore so the seeded state stays clean for sibling specs.
        await page.getByTestId('breaker-state-toggle').first().click();
        await settle(page);
      }
    }

    // -------- 3. TestPanelScreen (with last verified hint) --------
    await page.goto(`/panels/${seeded.panelId}/test`);
    await page
      .getByText(/Test: Main Panel/i)
      .first()
      .waitFor({ timeout: 10_000 })
      .catch(() => {});
    await settle(page);
    await snap(page, project, '06-test-panel', { fullPage: true });

    // -------- 4. PanelMapScreen --------
    await page.goto(`/panels/${seeded.panelId}/map?floor=${seeded.floorId}`);
    await page.locator('.floor-plan').first().waitFor();
    await settle(page);
    await snap(page, project, '07-panel-map', { fullPage: true });

    // -------- 5. ComponentsScreen --------
    await page.goto('/components');
    await page
      .getByText('Kitchen Outlet 1')
      .first()
      .waitFor({ timeout: 10_000 })
      .catch(() => {});
    await settle(page);
    await snap(page, project, '08-components', { fullPage: true });

    // Open filter popover
    const filterTrigger = page.getByTestId('components-filter-trigger');
    if (await filterTrigger.isVisible().catch(() => false)) {
      await filterTrigger.click();
      await page
        .getByTestId('components-filter-popover')
        .waitFor({ timeout: 3_000 })
        .catch(() => {});
      await waitForModalSettled(page, 'components-filter-popover');
      await snap(page, project, '09-components-filter-open');
      // Close
      await page.keyboard.press('Escape');
    }

    // Add Component modal
    const openAddComp = page.getByTestId('open-add-component');
    if (await openAddComp.isVisible().catch(() => false)) {
      await openAddComp.click();
      await page
        .getByTestId('add-component-modal')
        .waitFor({ timeout: 3_000 })
        .catch(() => {});
      await waitForModalSettled(page, 'add-component-modal');
      await snap(page, project, '10-components-add-modal');
      await page.keyboard.press('Escape');
      await page
        .getByTestId('add-component-modal')
        .waitFor({ state: 'hidden' })
        .catch(() => {});
    }

    // Selection bar — check 2 rows. The native input is 1×1 + hidden;
    // click the wrapping `label.checkbox` instead (per cycle-50 spec pattern).
    const rows = page.getByTestId('component-row');
    const rowCount = await rows.count();
    if (rowCount >= 2) {
      await rows.nth(0).locator('label.checkbox').click();
      await rows.nth(1).locator('label.checkbox').click();
      await page
        .locator('.selection-bar')
        .first()
        .waitFor({ timeout: 3_000 })
        .catch(() => {});
      await snap(page, project, '11-components-selection-bar', {
        fullPage: true,
      });
      // Clear
      await rows.nth(0).locator('label.checkbox').click();
      await rows.nth(1).locator('label.checkbox').click();
    }

    // -------- 6. MapLandingScreen --------
    await page.goto('/map');
    await page
      .getByText('Main Floor')
      .first()
      .waitFor({ timeout: 10_000 })
      .catch(() => {});
    await settle(page);
    await snap(page, project, '12-map-landing', { fullPage: true });

    // Add Floor modal
    const openAddFloor = page.getByTestId('open-add-floor');
    if (await openAddFloor.isVisible().catch(() => false)) {
      await openAddFloor.click();
      await page
        .getByTestId('add-floor-modal')
        .waitFor({ timeout: 3_000 })
        .catch(() => {});
      await waitForModalSettled(page, 'add-floor-modal');
      await snap(page, project, '13-map-landing-add-modal');
      await page.keyboard.press('Escape');
    }

    // -------- 7. FloorEditScreen (escape-hatch) --------
    await page.goto(`/floors/${seeded.floorId}/edit`);
    await page
      .getByRole('heading', { name: /Main Floor/i })
      .first()
      .waitFor({ timeout: 10_000 })
      .catch(() => {});
    await settle(page);
    await snap(page, project, '14-floor-edit', { fullPage: true });

    // -------- 8. AuditScreen --------
    await page.goto('/audit');
    await page
      .getByRole('heading', { name: /Audit/i })
      .first()
      .waitFor({ timeout: 5_000 })
      .catch(() => {});
    await settle(page);
    await snap(page, project, '15-audit', { fullPage: true });

    // Open audit filter popover if one exists
    const auditFilter = page.getByTestId('audit-filter-trigger');
    if (await auditFilter.isVisible().catch(() => false)) {
      await auditFilter.click();
      await page
        .getByTestId('audit-filter-popover')
        .waitFor({ timeout: 3_000 })
        .catch(() => {});
      await waitForModalSettled(page, 'audit-filter-popover');
      await snap(page, project, '16-audit-filter-open');
      await page.keyboard.press('Escape');
    }

    // -------- 9. PrintableDiagramScreen --------
    await page.goto(`/panels/${seeded.panelId}/print`);
    await page
      .locator('.printable-page')
      .first()
      .waitFor({ timeout: 5_000 })
      .catch(() => {});
    await settle(page);
    await snap(page, project, '17-print', { fullPage: true });

    // -------- 10. Confirm modal — CYCLE-65b: skipped capture.
    //   Component delete moved to undoable-delete (cycle-47), so clicking
    //   Delete on the Components page DOES NOT open a confirm modal — it
    //   queues a 30-second undoable delete that mutates server state and
    //   breaks subsequent tests (smoke, floor-map-polish, mobile-overflow)
    //   that expect "Kitchen Outlet 1" to still exist. We could surface
    //   a confirm modal via Panel-delete or Floor-delete instead, but both
    //   would tear down other seed dependencies. The polished UI no longer
    //   uses ConfirmModal for the audit's reachable flow; the snapshot
    //   would be redundant with the Panel-delete bar already shown in
    //   `20-light-panel-detail` (it shows the danger bar on /panels/:id).
    //   Future cycles may add an isolated path to surface ConfirmModal.
    await page.goto('/components');
    await settle(page);

    // -------- 11. Light theme parity — toggle theme via UserMenu, capture a few key shots --------
    // fix/mobile-floating-cluster: the standalone ThemeToggle chip is
    // gone; theme controls live inside the UserMenu sheet now.
    const userMenuBtn = page.getByTestId('user-menu-button');
    if (await userMenuBtn.isVisible().catch(() => false)) {
      await userMenuBtn.click();
      await page.getByTestId('user-menu-modal').waitFor({ timeout: 2_000 });
      await page.getByTestId('user-menu-theme-light').click();
      // Light theme often takes a 850ms transition window — wait for the
      // theme class to land instead of a fixed sleep.
      await page
        .locator('html.light, html.theme-light')
        .first()
        .waitFor({ timeout: 2_000 })
        .catch(() => {});
      // Close the sheet so it doesn't dominate the polish screenshots.
      await page.keyboard.press('Escape');
      await page
        .getByTestId('user-menu-modal')
        .waitFor({ state: 'hidden', timeout: 2_000 })
        .catch(() => {});
      await settle(page);
      await snap(page, project, '19-light-components', { fullPage: true });

      await page.goto(`/panels/${seeded.panelId}`);
      await settle(page);
      await snap(page, project, '20-light-panel-detail', { fullPage: true });

      await page.goto('/');
      await settle(page);
      await snap(page, project, '21-light-panel-list', { fullPage: true });

      // Restore dark theme — best-effort.
      await page.getByTestId('user-menu-button').click().catch(() => {});
      await page
        .getByTestId('user-menu-theme-dark')
        .click()
        .catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
    }

    // -------- 12. Empty states — wipe seeded data is NOT something we can
    //   do (other tests rely on it). Instead, capture the closest analog:
    //   the new-floor screen by clicking on the floor that has no panels (none
    //   exist by default). We'll skip this branch and document in the report
    //   that empty-state shots require a separate isolated seed.

    // -------- 13. Focus-ring capture on PanelList --------
    await page.goto('/');
    await page.getByText('Main Panel').first().waitFor();
    await settle(page);
    // Tab once to focus the first interactive element
    await page.keyboard.press('Tab');
    await snap(page, project, '22-focus-ring-panel-list');

    // Done — explicit no-fail assertion. The test PASSES as long as no
    // throw, since the audit value is in the screenshots themselves.
  });
});
