/**
 * 2026-05 — real build versioning. The version pill must show the semver
 * PLUS the short commit SHA (so it changes per deploy, not a frozen "v0.2"),
 * and the build-info modal must carry the full provenance.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCREENSHOTS_DIR = join(__dirname, '.screenshots');
mkdirSync(SCREENSHOTS_DIR, { recursive: true });

test.describe('version pill — real build versioning', () => {
  test('pill shows v<semver> · <shortSha> and modal shows build info', async ({
    page,
  }, info) => {
    await page.goto('/');

    const pill = page.getByTestId('version-pill');
    await expect(pill).toBeVisible();

    const text = (await pill.innerText()).trim();
    // eslint-disable-next-line no-console
    console.log(`[version-pill ${info.project.name}] "${text}"`);

    // Must be "v<version> · <7-hex-sha>" — proving the SHA is stamped, not
    // frozen. Version is tag-driven (e.g. "v0.3" or "v0.3.1"), so accept any
    // dotted version, not strictly 3-part semver.
    expect(text).toMatch(/^v\d+(\.\d+)+\s+·\s+[0-9a-f]{7}$/);
    expect(await pill.getAttribute('data-sha')).toMatch(/^[0-9a-f]{7}$/);

    await page.screenshot({
      path: join(SCREENSHOTS_DIR, `version-pill-${info.project.name}.png`),
    });

    // Open the build-info modal — must list the commit provenance.
    await pill.click();
    const build = page.getByTestId('version-pill-build');
    await expect(build).toBeVisible();
    await expect(build).toContainText(/Commit/);
    await expect(build).toContainText(/Built/);
  });
});
