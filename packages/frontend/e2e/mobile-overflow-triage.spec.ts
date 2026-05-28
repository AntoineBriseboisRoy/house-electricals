/**
 * G28 cycle-34 — mobile responsiveness triage.
 *
 * User report: "Open Playwright in cellphone mode. I've tried 2 seconds —
 * things are going everywhere, out of screen, super ugly."
 *
 * This spec exhaustively walks every primary screen + the edit + map routes
 * at the mobile-390x844 viewport, then asserts each screen has NO horizontal
 * overflow at the root level and reports any specific child elements that
 * stick out past the viewport. Failing assertions produce a screenshot.
 *
 * Hard rules (cycle-21 pinned):
 * - No page.waitForTimeout. Deterministic waits only.
 * - Both projects normally run, but this spec gates on mobile via the project name.
 *
 * Triage strategy:
 *   1. Visit screen, wait for primary heading.
 *   2. Read document.documentElement.scrollWidth vs window.innerWidth.
 *      If scrollWidth > innerWidth, the screen overflows — fail with a
 *      detailed message listing the worst-offending children.
 *   3. Screenshot every screen to e2e/.screenshots/mobile-overflow-<name>.png.
 */

import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCREENSHOTS_DIR = join(__dirname, '.screenshots');
mkdirSync(SCREENSHOTS_DIR, { recursive: true });

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

/** Returns top-5 offenders if root overflows; null otherwise. */
const findOverflow = async (page: Page): Promise<{
  scrollWidth: number;
  innerWidth: number;
  offenders: { tag: string; cls: string; right: number; text: string }[];
} | null> => {
  return page.evaluate(() => {
    const innerWidth = window.innerWidth;
    const root = document.documentElement;
    const scrollWidth = root.scrollWidth;
    if (scrollWidth <= innerWidth + 1) return null; // 1px tolerance for sub-pixel rounding
    // Find the worst offenders.
    const all = Array.from(document.querySelectorAll<HTMLElement>('*'));
    const offenders = all
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          cls: typeof el.className === 'string' ? el.className.slice(0, 80) : '',
          right: rect.right,
          // tiny preview of text for orientation
          text: (el.textContent ?? '').trim().slice(0, 60),
        };
      })
      .filter((o) => o.right > innerWidth + 1)
      .sort((a, b) => b.right - a.right)
      .slice(0, 5);
    return { scrollWidth, innerWidth, offenders };
  });
};

const screens: { name: string; path: (s: ReturnType<typeof loadSeeded>) => string; waitFor: string }[] = [
  { name: 'PanelList', path: () => '/', waitFor: 'Main Panel' },
  { name: 'PanelDetail', path: (s) => `/panels/${s.panelId}`, waitFor: 'Kitchen lights' },
  { name: 'PanelMap', path: (s) => `/panels/${s.panelId}/map`, waitFor: 'Floor plan' },
  { name: 'PanelTest', path: (s) => `/panels/${s.panelId}/test`, waitFor: 'Test: Main Panel' },
  { name: 'PanelPrint', path: (s) => `/panels/${s.panelId}/print`, waitFor: 'Main Panel' },
  { name: 'Components', path: () => '/components', waitFor: 'Kitchen Outlet 1' },
  { name: 'MapLanding', path: () => '/map', waitFor: 'Main Floor' },
  { name: 'FloorEdit', path: (s) => `/floors/${s.floorId}/edit`, waitFor: 'Main Floor' },
  // G36 Part 2 cycle-63 — house-level audit log (per CLAUDE.md "Mobile
  // responsiveness (G28 — cycle-34)" rule 3: every new top-level route
  // joins this array).
  { name: 'Audit', path: () => '/audit', waitFor: 'Audit log' },
];

test.describe('G28 mobile overflow triage @cycle-34', () => {
  for (const s of screens) {
    test(`${s.name} — no horizontal overflow at 390x844`, async ({ page }, info) => {
      // Only meaningful at the mobile viewport — desktop is a separate project.
      test.skip(info.project.name !== 'mobile-390x844', 'mobile only');
      const seeded = loadSeeded();
      await page.goto(s.path(seeded));
      // Use a wider locator hunt — for some screens the heading varies, but the
      // seeded text we picked is guaranteed.
      await expect(page.getByText(s.waitFor).first()).toBeVisible();
      await page.waitForLoadState('networkidle');

      // Screenshot for visual triage.
      await page.screenshot({
        path: join(SCREENSHOTS_DIR, `mobile-overflow-${s.name}.png`),
        fullPage: true,
      });

      const overflow = await findOverflow(page);
      if (overflow !== null) {
        const lines = [
          `${s.name} OVERFLOWS:`,
          `  scrollWidth=${overflow.scrollWidth}, innerWidth=${overflow.innerWidth}`,
          `  Top 5 offenders (rect.right > innerWidth):`,
          ...overflow.offenders.map(
            (o, i) =>
              `    ${i + 1}. <${o.tag}.${o.cls}> right=${Math.round(o.right)}  "${o.text}"`
          ),
        ];
        // Throw inside expect so the message goes into the report cleanly.
        expect.soft(overflow, lines.join('\n')).toBeNull();
      }
    });
  }
});
