/**
 * G37 Part 2 (cycle-69) — PanelListScreen aggregate card + Print chip.
 *
 * Seeds protected breakers via REST, then asserts:
 *   - "untested this month" aggregate card renders with N=2 (initial)
 *   - "Test all now" → confirm → N breaker_tests written → card hides
 *   - Print view renders monochrome chips for BOTH breaker-level AND
 *     component-level protection (when both are set)
 *
 * Hard rules (per CLAUDE.md):
 *   - REST seeding only, no direct SQLite writes
 *   - Deterministic waits only (auto-waiting locators)
 *   - Desktop-only (the aggregate card + confirm modal interact better
 *     at the wider viewport, mirroring cycle-63 audit-screen pattern)
 */

import { test, expect, type APIRequestContext } from '@playwright/test';

type Json = Record<string, unknown> | unknown[];

const post = async <T = { id: string }>(
  api: APIRequestContext,
  path: string,
  body: Json
): Promise<T> => {
  const res = await api.post(path, { data: body });
  if (!res.ok()) {
    const text = await res.text();
    throw new Error(`POST ${path} → ${res.status()}: ${text}`);
  }
  const json = (await res.json()) as { data: T };
  return json.data;
};

const seedProtectedFixture = async (
  api: APIRequestContext
): Promise<{ panelId: string; breakerIds: string[]; outletId: string }> => {
  // Fresh isolated panel; doesn't disturb the global seed (which has no
  // protection-marked rows so the aggregate card is normally hidden).
  const panel = await post<{ id: string }>(api, '/api/v1/panels', {
    name: `Protected Panel ${Date.now()}`,
    orientation: 'vertical',
    slotCount: 12,
  });

  const gfci = await post(api, `/api/v1/panels/${panel.id}/breakers`, {
    slot: '1',
    slotPosition: 1,
    amperage: 20,
    poles: 'single',
    label: 'Kitchen GFCI',
    protection: 'gfci',
  });
  const afci = await post(api, `/api/v1/panels/${panel.id}/breakers`, {
    slot: '2',
    slotPosition: 2,
    amperage: 15,
    poles: 'single',
    label: 'Bedroom AFCI',
    protection: 'afci',
  });
  // One non-protected breaker as a control: MUST NOT count.
  const plain = await post(api, `/api/v1/panels/${panel.id}/breakers`, {
    slot: '3',
    slotPosition: 3,
    amperage: 15,
    poles: 'single',
    label: 'Hall lights',
  });

  // Component on the GFCI breaker that ALSO carries its OWN protection —
  // both chips must render on the print view.
  const outlet = await post(api, '/api/v1/components', {
    type: 'outlet',
    name: 'GFCI Outlet (downstream)',
    room: 'Kitchen',
    breakerId: gfci.id,
    floorId: null,
    posX: 1000,
    posY: 1000,
    protection: 'gfci',
  });

  return {
    panelId: panel.id,
    breakerIds: [gfci.id, afci.id, plain.id],
    outletId: outlet.id,
  };
};

test.describe('G37 Part 2 protection aggregate + print chip @cycle-69', () => {
  test('aggregate card renders count, fan-out hides card', async ({
    page,
    request,
  }, info) => {
    // Desktop-only — the confirm modal + click-through interactions
    // need the wider viewport (mirrors cycle-63 audit-screen pattern).
    test.skip(
      info.project.name !== 'desktop-1440x900',
      'desktop-only spec'
    );
    const seeded = await seedProtectedFixture(request);

    await page.goto('/');

    // Card is visible with count=2 (GFCI + AFCI breakers untested).
    const card = page.getByTestId('panel-list-protection-aggregate-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText(/2 GFCI\/AFCI devices untested this month/i);

    // One-tap Test-all → confirm → write 2 breaker_tests rows.
    await page.getByTestId('test-all-protected').click();
    await page.getByTestId('confirm-modal-confirm').click();

    // After refresh the card hides entirely (no chrome eaten).
    await expect(
      page.getByTestId('panel-list-protection-aggregate-card')
    ).toHaveCount(0);

    // Sanity: backend recorded 2 breaker_tests (one per protected breaker).
    const gfciTests = await request.get(
      `/api/v1/breaker-tests?breakerId=${seeded.breakerIds[0]}`
    );
    expect(gfciTests.ok()).toBeTruthy();
    const gfciBody = (await gfciTests.json()) as {
      data: Array<{ outcome: string | null }>;
      totalCount: number;
    };
    expect(gfciBody.totalCount).toBeGreaterThanOrEqual(1);
    expect(gfciBody.data[0]?.outcome).toBe('monthly self-test');

    const afciTests = await request.get(
      `/api/v1/breaker-tests?breakerId=${seeded.breakerIds[1]}`
    );
    const afciBody = (await afciTests.json()) as {
      data: Array<{ outcome: string | null }>;
      totalCount: number;
    };
    expect(afciBody.totalCount).toBeGreaterThanOrEqual(1);
    expect(afciBody.data[0]?.outcome).toBe('monthly self-test');

    // Plain (non-protected) breaker should NOT have a self-test row.
    const plainTests = await request.get(
      `/api/v1/breaker-tests?breakerId=${seeded.breakerIds[2]}`
    );
    const plainBody = (await plainTests.json()) as {
      data: unknown[];
      totalCount: number;
    };
    expect(plainBody.totalCount).toBe(0);
  });

  test('print view renders monochrome chips for breaker AND component protection', async ({
    page,
    request,
  }, info) => {
    test.skip(
      info.project.name !== 'desktop-1440x900',
      'desktop-only spec'
    );
    const seeded = await seedProtectedFixture(request);

    await page.goto(`/panels/${seeded.panelId}/print`);
    await expect(page.getByTestId('printable-page')).toBeVisible();

    // Expect chips for the GFCI breaker, the AFCI breaker, AND the GFCI
    // outlet (downstream component). That's 3 chips total on this fixture.
    const chips = page.getByTestId('printable-protection-chip');
    await expect(chips).toHaveCount(3);

    // GFCI chip (breaker) and GFCI chip (component) and AFCI chip (breaker)
    // — assert each label appears at least once.
    const labels = await chips.allInnerTexts();
    expect(labels.filter((l) => l === 'GFCI').length).toBe(2);
    expect(labels.filter((l) => l === 'AFCI').length).toBe(1);

    // Monochrome-on-paper assertion: the chip's computed color must NOT
    // match the screen-amber warning token. We use literal hex (#333 on
    // text, #555 border) per the cycle-27 print-tokens rule — the chip
    // computed style should land in a black-to-mid-gray range.
    const firstChip = chips.first();
    const computed = await firstChip.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        borderTopColor: cs.borderTopColor,
      };
    });
    // Plain hex translates to "rgb(R, G, B)" in computed style.
    // #333 → rgb(51, 51, 51); #555 → rgb(85, 85, 85).
    expect(computed.color).toMatch(/rgb\(51, 51, 51\)/);
    expect(computed.borderTopColor).toMatch(/rgb\(85, 85, 85\)/);
    // Background must be transparent (no warning-subtle fill).
    expect(computed.backgroundColor).toMatch(
      /rgba\(0, 0, 0, 0\)|transparent/
    );
  });
});
