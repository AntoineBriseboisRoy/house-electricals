/**
 * A11y color-contrast pilot — cycle-82.
 *
 * Scope (intentionally narrow — pilot):
 *  - Runs ONE axe-core rule only: `color-contrast` (tag: `wcag2aa`).
 *    Matches G11 design-system commitment to AA contrast verbatim.
 *  - Runs on ONE pilot route: `/panels` (the first surface a new user sees).
 *  - Both projects (mobile-390x844 + desktop-1440x900) covered — contrast
 *    can flex with viewport because of media-query token tweaks.
 *
 * Decision model:
 *  - Baseline is COMMITTED at `e2e/a11y-contrast-baseline.json`.
 *  - Each violation is keyed by `ruleId` + `selector` (NOT raw count) so
 *    fixing one node and introducing a different one in the same render
 *    is detected as a regression.
 *  - The spec ASSERTS every live violation key already exists in the
 *    baseline. New keys = regression = test fails.
 *  - Fewer violations than baseline = improvement = test PASSES (good).
 *  - When the baseline file is MISSING, the spec FAILS with bootstrap
 *    instructions — it NEVER auto-writes in CI. The only path to a new
 *    baseline is the explicit `pnpm test:a11y:bootstrap` script, which
 *    sets `A11Y_BOOTSTRAP=1` and rewrites the file from the live scan.
 *
 * Why this is NOT pinned in CLAUDE.md yet:
 *  - Per the cycle-82 council Lockin FATAL #3: pinning a process rule
 *    before it's proven to stick across 3-4 cycles risks committing to
 *    contracts we end up walking back. The spec header carries the
 *    contract for now; promote to CLAUDE.md once it's lived through a
 *    few real fix cycles.
 *
 * Bootstrap recipe (NEVER run in CI):
 *   pnpm --filter @he/frontend run test:a11y:bootstrap
 *
 * Hard rules carried over from cycle-21 G21:
 *  - Deterministic waits only (auto-waiting locators / waitForLoadState).
 *    NO page.waitForTimeout.
 *  - Both projects run the same spec.
 *
 * Future cycles can:
 *  - Add more routes via the `routes[]` array below (cycle-34 G28
 *    `screens[]` pattern — Devil OBJ3 from the cycle-82 council).
 *  - Add more axe rules if the team chooses (each rule expansion is
 *    its own cycle so the baseline doesn't surprise-shift).
 */

import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASELINE_PATH = join(__dirname, 'a11y-contrast-baseline.json');

type ViolationKey = {
  ruleId: string;
  selector: string;
  impact: string | null;
};

type BaselineFile = Record<string, ViolationKey[]>;

const routes: { name: string; path: string; waitFor: string }[] = [
  // Pilot: just /panels for cycle-82. Add more in future cycles.
  { name: '/panels', path: '/', waitFor: 'Main Panel' },
];

const scanRoute = async (
  page: Page,
  path: string,
  waitFor: string
): Promise<ViolationKey[]> => {
  await page.goto(path);
  await expect(page.getByText(waitFor).first()).toBeVisible();
  await page.waitForLoadState('networkidle');

  const results = await new AxeBuilder({ page })
    // Color-contrast rule only, per the cycle-82 pilot scope.
    .withRules(['color-contrast'])
    .analyze();

  const keys: ViolationKey[] = [];
  for (const v of results.violations) {
    for (const node of v.nodes) {
      keys.push({
        ruleId: v.id,
        selector: node.target.map((t) => String(t)).join('>'),
        impact: v.impact ?? null,
      });
    }
  }
  // Sort for stable diff/serialization.
  keys.sort((a, b) => {
    if (a.ruleId !== b.ruleId) return a.ruleId.localeCompare(b.ruleId);
    return a.selector.localeCompare(b.selector);
  });
  return keys;
};

const readBaseline = (): BaselineFile | null => {
  if (!existsSync(BASELINE_PATH)) return null;
  const raw = readFileSync(BASELINE_PATH, 'utf8');
  return JSON.parse(raw) as BaselineFile;
};

const keyOf = (v: ViolationKey): string => `${v.ruleId}::${v.selector}`;

test.describe('a11y color-contrast pilot @cycle-82', () => {
  for (const r of routes) {
    test(`${r.name} — color-contrast (vs baseline)`, async ({ page }) => {
      const live = await scanRoute(page, r.path, r.waitFor);

      const isBootstrap = process.env.A11Y_BOOTSTRAP === '1';

      if (isBootstrap) {
        // Bootstrap mode: write the baseline. CI never sets A11Y_BOOTSTRAP.
        // Read existing baseline (if any) to preserve other routes' keys.
        const existing = readBaseline() ?? {};
        existing[r.name] = live;
        writeFileSync(BASELINE_PATH, JSON.stringify(existing, null, 2) + '\n', 'utf8');
        // No assertion in bootstrap — we're seeding ground truth.
        return;
      }

      // CI / normal mode: baseline MUST exist; never auto-write.
      const baseline = readBaseline();
      if (baseline === null) {
        throw new Error(
          [
            `[a11y-contrast] Baseline file missing at ${BASELINE_PATH}.`,
            `To bootstrap, run from packages/frontend:`,
            `  pnpm run test:a11y:bootstrap`,
            `Then commit the generated e2e/a11y-contrast-baseline.json.`,
            `This spec NEVER auto-writes the baseline in CI.`,
          ].join('\n')
        );
      }

      const baselineKeys = new Set((baseline[r.name] ?? []).map(keyOf));
      const liveKeys = live.map(keyOf);
      const newKeys = liveKeys.filter((k) => !baselineKeys.has(k));

      if (newKeys.length > 0) {
        const message = [
          `[a11y-contrast] NEW color-contrast violations detected on ${r.name}:`,
          ...newKeys.map((k) => `  - ${k}`),
          ``,
          `Either:`,
          `  (a) Fix the regression so axe stops reporting these nodes, OR`,
          `  (b) If the violation is genuinely accepted, regenerate the baseline:`,
          `      pnpm run test:a11y:bootstrap`,
          `      git add e2e/a11y-contrast-baseline.json && commit`,
        ].join('\n');
        expect(newKeys, message).toEqual([]);
      }

      // Improvement (fewer keys) is allowed — log so the team sees it.
      const removed = [...baselineKeys].filter((k) => !liveKeys.includes(k));
      if (removed.length > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `[a11y-contrast] ${r.name} improved: ${removed.length} baseline key(s) no longer present. Consider regenerating baseline via pnpm test:a11y:bootstrap.`
        );
      }
    });
  }
});
