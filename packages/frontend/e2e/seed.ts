/**
 * Seed fixtures (G21 cycle-21) — populate the isolated backend with
 * a deterministic dataset via the public REST API so the smoke spec
 * has rendered content to screenshot.
 *
 * Hard rules:
 * - Public REST API only. NO direct SQLite writes.
 * - Returned ids are persisted in `e2e/.state.json` for spec reuse.
 * - All POST bodies match the zod schemas exported from @he/shared.
 *
 * feat/auth-gate — every mutating request now requires the auth cookie.
 * `seedFixtures` does a one-shot login at the top and threads the cookie
 * through every `post()` call.
 */

type Json = Record<string, unknown> | unknown[];

// feat/auth-gate (sign-up flow) — pinned e2e credentials. The e2e
// user is created on every globalSetup run via POST /auth/signup
// against a fresh isolated backend.
export const E2E_USERNAME = 'e2e-user';
export const E2E_PASSWORD = 'e2e-password';

const extractCookie = (setCookie: string, label: string): string => {
  const m = setCookie.match(/he_auth=[^;]+/);
  if (m === null) {
    throw new Error(`[seed] ${label} succeeded but no he_auth cookie returned`);
  }
  return m[0];
};

/** Sign up the (one and only) e2e user. Returns the `he_auth=…` cookie
 *  value. globalSetup calls this against a brand-new isolated backend
 *  on every run — the app_users table starts empty, so this is the
 *  canonical "first-time setup" path the new flow expects. */
export const signupForSeed = async (baseUrl: string): Promise<string> => {
  const res = await fetch(`${baseUrl}/api/v1/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: E2E_USERNAME,
      password: E2E_PASSWORD,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `[seed] signup failed: ${res.status} ${res.statusText} — ${text}`
    );
  }
  return extractCookie(res.headers.get('set-cookie') ?? '', 'signup');
};

/** Login with the e2e credentials and return the cookie. Used by
 *  `seedFixtures` (which runs AFTER globalSetup's signup, when the
 *  user already exists). */
export const loginForSeed = async (baseUrl: string): Promise<string> => {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: E2E_USERNAME,
      password: E2E_PASSWORD,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `[seed] login failed: ${res.status} ${res.statusText} — ${text}`
    );
  }
  return extractCookie(res.headers.get('set-cookie') ?? '', 'login');
};

const post = async <T = unknown>(
  baseUrl: string,
  path: string,
  body: Json,
  cookie: string
): Promise<T> => {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `[seed] POST ${path} failed: ${res.status} ${res.statusText} — ${text}`
    );
  }
  const json = (await res.json()) as { data: T };
  return json.data;
};

export type SeededIds = {
  panelId: string;
  breakerIds: string[];
  floorId: string;
  roomIds: string[];
  wallIds: string[];
  componentIds: string[];
  /** id of the multi-gang switch component (for spec convenience). */
  switchId: string;
  /** ids of the two lights that the switch's gangs 0+1 control. */
  controlledLightIds: string[];
};

export const seedFixtures = async (baseUrl: string): Promise<SeededIds> => {
  // feat/auth-gate — every mutating request needs the cookie.
  const cookie = await loginForSeed(baseUrl);
  // 1) Panel
  const panel = await post<{ id: string }>(baseUrl, '/api/v1/panels', {
    name: 'Main Panel',
    orientation: 'vertical',
    slotCount: 24,
  }, cookie);
  const panelId = panel.id;

  // 2) Breakers — mix of single/double-pole with explicit slot positions
  const breakerSpecs = [
    { slot: '1', slotPosition: 1, amperage: 15, poles: 'single' as const, label: 'Kitchen lights' },
    { slot: '2', slotPosition: 2, amperage: 20, poles: 'single' as const, label: 'Kitchen outlets' },
    { slot: '3', slotPosition: 3, amperage: 30, poles: 'double' as const, label: 'Range' },
    { slot: '5', slotPosition: 5, amperage: 15, poles: 'single' as const, label: 'Living room' },
    { slot: '6', slotPosition: 6, amperage: 15, poles: 'single' as const, label: 'Bedroom' },
    { slot: '7', slotPosition: 7, amperage: 20, poles: 'single' as const, label: 'Bathroom GFCI' },
  ];
  const breakerIds: string[] = [];
  for (const spec of breakerSpecs) {
    const b = await post<{ id: string }>(
      baseUrl,
      `/api/v1/panels/${panelId}/breakers`,
      spec,
      cookie
    );
    breakerIds.push(b.id);
  }

  // 3) Floor
  const floor = await post<{ id: string }>(baseUrl, '/api/v1/floors', {
    name: 'Main Floor',
    displayOrder: 1,
  }, cookie);
  const floorId = floor.id;

  // 4) Rooms — 2 axis-aligned rectangles
  const roomSpecs = [
    { name: 'Kitchen', x: 500, y: 500, w: 3500, h: 3000 },
    { name: 'Living Room', x: 4500, y: 500, w: 4500, h: 4500 },
  ];
  const roomIds: string[] = [];
  for (const spec of roomSpecs) {
    const r = await post<{ id: string }>(
      baseUrl,
      `/api/v1/floors/${floorId}/rooms`,
      spec,
      cookie
    );
    roomIds.push(r.id);
  }

  // 5) Walls — perimeter of the two rooms (4 walls total)
  const wallSpecs = [
    { x1: 500, y1: 500, x2: 4000, y2: 500 }, // kitchen top
    { x1: 500, y1: 500, x2: 500, y2: 3500 }, // kitchen left
    { x1: 4500, y1: 500, x2: 9000, y2: 500 }, // living top
    { x1: 9000, y1: 500, x2: 9000, y2: 5000 }, // living right
  ];
  const wallIds: string[] = [];
  for (const spec of wallSpecs) {
    const w = await post<{ id: string }>(
      baseUrl,
      `/api/v1/floors/${floorId}/walls`,
      spec,
      cookie
    );
    wallIds.push(w.id);
  }

  // 6) Components — 8 total, mixing types incl. multi-gang switch
  const componentSpecs = [
    {
      type: 'outlet' as const,
      name: 'Kitchen Outlet 1',
      room: 'Kitchen',
      breakerId: breakerIds[1],
      floorId,
      posX: 1500,
      posY: 1500,
    },
    {
      type: 'outlet' as const,
      name: 'Kitchen Outlet 2',
      room: 'Kitchen',
      breakerId: breakerIds[1],
      floorId,
      posX: 2500,
      posY: 1500,
    },
    {
      type: 'light' as const,
      name: 'Kitchen Ceiling Light',
      room: 'Kitchen',
      breakerId: breakerIds[0],
      floorId,
      posX: 2000,
      posY: 2500,
    },
    {
      type: 'light' as const,
      name: 'Living Room Light',
      room: 'Living Room',
      breakerId: breakerIds[3],
      floorId,
      posX: 6500,
      posY: 2500,
    },
    {
      type: 'switch' as const,
      name: '2-Gang Switch',
      room: 'Living Room',
      breakerId: breakerIds[3],
      floorId,
      posX: 5000,
      posY: 1000,
      gangs: 2,
    },
    {
      type: 'appliance' as const,
      name: 'Range',
      room: 'Kitchen',
      breakerId: breakerIds[2],
      floorId,
      posX: 3000,
      posY: 2000,
    },
    {
      type: 'smoke_detector' as const,
      name: 'Hallway Smoke',
      room: 'Living Room',
      breakerId: breakerIds[4],
      floorId,
      posX: 7500,
      posY: 3500,
    },
    {
      type: 'junction_box' as const,
      name: 'Ceiling Junction',
      room: 'Living Room',
      breakerId: null,
      floorId,
      posX: 8000,
      posY: 1500,
    },
  ];
  const componentIds: string[] = [];
  for (const spec of componentSpecs) {
    const c = await post<{ id: string }>(baseUrl, '/api/v1/components', spec, cookie);
    componentIds.push(c.id);
  }

  // The 2-gang switch is index 4; the two lights are index 2 (kitchen) and 3 (living).
  const switchId = componentIds[4];
  const controlledLightIds = [componentIds[2], componentIds[3]];

  // 7) Switch controls: gang 0 → kitchen light, gang 1 → living room light
  await post(baseUrl, `/api/v1/components/${switchId}/controls`, {
    gangIndex: 0,
    controlledId: controlledLightIds[0],
  }, cookie);
  await post(baseUrl, `/api/v1/components/${switchId}/controls`, {
    gangIndex: 1,
    controlledId: controlledLightIds[1],
  }, cookie);

  return {
    panelId,
    breakerIds,
    floorId,
    roomIds,
    wallIds,
    componentIds,
    switchId,
    controlledLightIds,
  };
};
