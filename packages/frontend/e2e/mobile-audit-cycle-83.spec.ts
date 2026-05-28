/**
 * Cycle-83 mobile audit — exhaustive spacing/alignment/rhythm review.
 *
 * The user reports: "Not everything has the right spacing between components.
 * Some squish together, some are not aligned, etc."
 *
 * This spec captures fullPage + zoomed-band screenshots of every primary
 * screen at BOTH mobile viewports (360x780 + 390x844) so we can review
 * each visually and produce a findings report.
 *
 * Outputs land under e2e/.screenshots/mobile-audit/<projectName>/ — gitignored.
 *
 * Detection-only — does NOT modify production code. Findings are written
 * to e2e/.screenshots/mobile-audit/FINDINGS.md by the agent after reading
 * each screenshot.
 */

import { test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '.screenshots', 'mobile-audit');
mkdirSync(ROOT_DIR, { recursive: true });

type SeededState = {
  seeded?: {
    panelId: string;
    floorId: string;
    componentIds: string[];
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

const screens: {
  name: string;
  path: (s: ReturnType<typeof loadSeeded>) => string;
  waitFor: string;
}[] = [
  { name: 'PanelList', path: () => '/', waitFor: 'Main Panel' },
  { name: 'PanelDetail', path: (s) => `/panels/${s.panelId}`, waitFor: 'Kitchen lights' },
  { name: 'PanelMap', path: (s) => `/panels/${s.panelId}/map`, waitFor: 'Floor plan' },
  { name: 'PanelTest', path: (s) => `/panels/${s.panelId}/test`, waitFor: 'Test: Main Panel' },
  { name: 'PanelPrint', path: (s) => `/panels/${s.panelId}/print`, waitFor: 'Main Panel' },
  { name: 'Components', path: () => '/components', waitFor: 'Kitchen Outlet 1' },
  { name: 'MapLanding', path: () => '/map', waitFor: 'Main Floor' },
  { name: 'FloorEdit', path: (s) => `/floors/${s.floorId}/edit`, waitFor: 'Main Floor' },
  { name: 'Audit', path: () => '/audit', waitFor: 'Audit log' },
];

async function captureScreen(
  page: Page,
  projectDir: string,
  name: string
): Promise<void> {
  // 1. Full page
  await page.screenshot({
    path: join(projectDir, `${name}-full.png`),
    fullPage: true,
  });

  // 2. Header band (top 220px viewport)
  await page.screenshot({
    path: join(projectDir, `${name}-header.png`),
    clip: { x: 0, y: 0, width: page.viewportSize()!.width, height: 220 },
  });

  // 3. Footer band (bottom 120px of viewport) — bottom-tabs area
  const vp = page.viewportSize()!;
  await page.screenshot({
    path: join(projectDir, `${name}-footer.png`),
    clip: { x: 0, y: vp.height - 120, width: vp.width, height: 120 },
  });
}

test.describe('cycle-83 mobile audit @cycle-83', () => {
  for (const s of screens) {
    test(`${s.name} — capture mobile audit screenshots`, async ({ page }, info) => {
      // Skip desktop project entirely
      test.skip(info.project.name === 'desktop-1440x900', 'mobile audit only');

      const projectDir = join(ROOT_DIR, info.project.name);
      mkdirSync(projectDir, { recursive: true });

      const seeded = loadSeeded();
      await page.goto(s.path(seeded));
      // Be lenient — we want screenshots even if a specific text doesn't load.
      try {
        await page
          .getByText(s.waitFor)
          .first()
          .waitFor({ state: 'visible', timeout: 8000 });
      } catch {
        // continue anyway — capture whatever rendered
      }
      await page.waitForLoadState('networkidle').catch(() => {});

      await captureScreen(page, projectDir, s.name);
    });
  }

  // Modal capture — bottom-sheet variant on mobile (cycle-73)
  test(`Modal — capture prompt modal`, async ({ page }, info) => {
    test.skip(info.project.name === 'desktop-1440x900', 'mobile audit only');
    const projectDir = join(ROOT_DIR, info.project.name);
    mkdirSync(projectDir, { recursive: true });

    await page.goto('/');
    await page
      .getByText('Main Panel')
      .first()
      .waitFor({ state: 'visible', timeout: 8000 })
      .catch(() => {});

    // Open the Add Panel modal via the header CTA
    const addBtn = page.getByTestId('open-add-panel');
    if ((await addBtn.count()) > 0) {
      await addBtn.first().click().catch(() => {});
      await page
        .getByTestId('add-panel-modal')
        .waitFor({ state: 'visible', timeout: 4000 })
        .catch(() => {});
      await page.screenshot({
        path: join(projectDir, `Modal-add-panel-full.png`),
        fullPage: true,
      });
    }
  });

  // Selection bar capture — bulk-actions on components
  test(`SelectionBar — capture bulk-actions bar`, async ({ page }, info) => {
    test.skip(info.project.name === 'desktop-1440x900', 'mobile audit only');
    const projectDir = join(ROOT_DIR, info.project.name);
    mkdirSync(projectDir, { recursive: true });

    await page.goto('/components');
    await page
      .getByText('Kitchen Outlet 1')
      .first()
      .waitFor({ state: 'visible', timeout: 8000 })
      .catch(() => {});

    // Select first 2 rows to surface the SelectionBar
    const checkboxes = page.getByTestId('component-row-checkbox');
    const count = await checkboxes.count();
    if (count >= 2) {
      await checkboxes.nth(0).click().catch(() => {});
      await checkboxes.nth(1).click().catch(() => {});
      await page.waitForTimeout(200);
      await page.screenshot({
        path: join(projectDir, `SelectionBar-components-full.png`),
        fullPage: true,
      });
      const vp = page.viewportSize()!;
      await page.screenshot({
        path: join(projectDir, `SelectionBar-components-footer.png`),
        clip: { x: 0, y: vp.height - 140, width: vp.width, height: 140 },
      });
    }
  });

  // BreakerForm + ComponentForm — frontmost form layout
  test(`BreakerForm — capture form layout on PanelDetail`, async ({ page }, info) => {
    test.skip(info.project.name === 'desktop-1440x900', 'mobile audit only');
    const projectDir = join(ROOT_DIR, info.project.name);
    mkdirSync(projectDir, { recursive: true });

    const seeded = loadSeeded();
    await page.goto(`/panels/${seeded.panelId}`);
    await page
      .getByText('Kitchen lights')
      .first()
      .waitFor({ state: 'visible', timeout: 8000 })
      .catch(() => {});

    // The new-breaker form is always present at the bottom of PanelDetail.
    // Scroll to it and capture.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(150);
    await page.screenshot({
      path: join(projectDir, `BreakerForm-create.png`),
      fullPage: true,
    });

    // Now open an edit form by clicking the first breaker row
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(150);
    const editBtn = page
      .getByRole('button', { name: /edit|breaker/i })
      .first();
    if ((await editBtn.count()) > 0) {
      await editBtn.click().catch(() => {});
      await page.waitForTimeout(200);
      await page.screenshot({
        path: join(projectDir, `BreakerForm-edit.png`),
        fullPage: true,
      });
    }
  });
});
