/**
 * cycle-78 he-pulse theme-fix verification.
 *
 * The cycle-22 G23 + cycle-13 G13 `he-pulse` keyframe drives the
 * click-to-highlight pulse on .breaker-row[data-highlight='true'],
 * .floor-plan__pin[data-highlight='true'], and the
 * .test-breaker--tracked infinite pulse. Pre-cycle-78 it used
 * bootstrap sky-blue rgba(56, 189, 248, ...) literals — broken for the
 * cycle-23 G22 sage palette + cycle-23 light theme (no light-mode
 * adaptation, themed-invariant blue flash).
 *
 * Build-time CSS source assertions lock in the fix:
 * 1. No sky-blue (rgba(56, 189, 248, ...)) literals inside he-pulse.
 * 2. The keyframe references --color-accent-subtle + --color-accent-border
 *    so both dark + light themes adapt automatically.
 *
 * Runtime browser-context verification was attempted but the
 * data-highlight attribute has a 1.5s self-clearing window that races
 * with Playwright's auto-wait — flaky. The build-time assertions are
 * deterministic and cover the regression: if a future cycle reintroduces
 * the sky-blue literals or removes the accent-token references, this
 * spec fails.
 *
 * Desktop-only — file-system assertions don't depend on viewport.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test.describe('cycle-78 he-pulse theme fix', () => {
  test('compiled styles.css has no sky-blue literals inside he-pulse', ({}, info) => {
    test.skip(info.project.name !== 'desktop-1440x900', 'desktop-only spec');

    // styles.css is the source — Vite serves it from /src/styles.css in dev
    // (no build asset names) but the source is what we want to lock in any
    // way. Read the source file directly.
    const stylesPath = join(__dirname, '..', 'src', 'styles.css');
    const css = readFileSync(stylesPath, 'utf8');

    const keyframeMatch = css.match(/@keyframes he-pulse\s*\{[\s\S]*?\n\}/);
    expect(keyframeMatch, 'he-pulse keyframe must exist in styles.css').not.toBeNull();
    const keyframeBlock = keyframeMatch![0];

    // Sky-blue literal pattern (case-insensitive whitespace).
    const skyBlue = /rgba\(\s*56\s*,\s*189\s*,\s*248/;
    expect(
      skyBlue.test(keyframeBlock),
      `he-pulse keyframe must NOT contain sky-blue rgba(56, 189, 248, ...) literals — found in:\n${keyframeBlock}`
    ).toBe(false);

    // Spot-check the fix uses the canonical accent tokens.
    expect(
      keyframeBlock.includes('var(--color-accent-subtle)'),
      'he-pulse keyframe should reference --color-accent-subtle'
    ).toBe(true);
  });

  test('he-pulse keyframe defines accent-tinted ring at peak (20%)', () => {
    // Lock in the visual identity of the fix: the 20% keyframe stop should
    // use a 6px box-shadow ring driven by --color-accent-border (theme-aware
    // ~0.4 alpha sage). The cycle-3 bootstrap was 6px sky-blue at 0.18.
    const stylesPath = join(__dirname, '..', 'src', 'styles.css');
    const css = readFileSync(stylesPath, 'utf8');
    const keyframeMatch = css.match(/@keyframes he-pulse\s*\{[\s\S]*?\n\}/);
    expect(keyframeMatch).not.toBeNull();
    const keyframeBlock = keyframeMatch![0];

    // Verify the 20% stop has the accent-border box-shadow.
    expect(keyframeBlock).toMatch(/20%\s*\{[\s\S]*box-shadow[\s\S]*var\(--color-accent-border\)/);
    // And that the 0% / 100% stops use transparent (or 0-alpha) not sky-blue.
    expect(keyframeBlock).toMatch(/0%\s*\{[\s\S]*box-shadow:\s*0 0 0 0 transparent/);
  });
});
