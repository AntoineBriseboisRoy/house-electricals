#!/usr/bin/env node
// =============================================================================
// House Electricals — dev seed
// =============================================================================
// Populates a LOCAL DEV backend with a realistic, coherent dataset so the app
// has sensible data to look at while developing. Talks to the public REST API
// only (never the DB directly), exactly like the e2e seed.
//
//   1. Start the dev Postgres:  docker compose -f docker-compose.dev.yml up -d
//   2. Start the app:           pnpm dev   (backend listens on 127.0.0.1:3000)
//   3. Seed:                    pnpm seed:dev
//
// Auth: the app is single-user. On a brand-new DB this script signs up the
// dev account; on an existing DB it logs in. Override the credentials or the
// target with env vars:
//
//   SEED_URL=http://127.0.0.1:3000           backend base URL
//   SEED_USERNAME=dev   SEED_PASSWORD=devdevdev   the (one) account
//
// What it seeds INTO: the ACTIVE building — i.e. the oldest building, which is
// what `pnpm dev` opens to (the backend auto-seeds "My House" on first boot).
// So after running this, the data shows IMMEDIATELY in the app — no manual
// building switch. If that active building is already populated, the script
// no-ops (idempotent). Pass --force to add a SEPARATE demo building instead.
//
//   node scripts/dev/seed.mjs --force
// =============================================================================

const BASE = process.env.SEED_URL ?? 'http://127.0.0.1:3000';
const USERNAME = process.env.SEED_USERNAME ?? 'dev';
const PASSWORD = process.env.SEED_PASSWORD ?? 'devdevdev';
const FORCE = process.argv.includes('--force');
const BUILDING_NAME = 'Maple Street House';

// ── tiny REST helper layer ──────────────────────────────────────────────────

let COOKIE = '';

const grabCookie = (res) => {
  const sc = res.headers.get('set-cookie') ?? '';
  const m = sc.match(/he_auth=[^;]+/);
  if (m) COOKIE = m[0];
};

const req = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(COOKIE ? { cookie: COOKIE } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  grabCookie(res);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`${method} ${path} → ${res.status} ${res.statusText} — ${text}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  const json = await res.json().catch(() => ({}));
  return json.data ?? json;
};

const post = (path, body) => req('POST', path, body);
const patch = (path, body) => req('PATCH', path, body);
const get = (path) => req('GET', path);

// ── auth: sign up on a fresh DB, else log in ────────────────────────────────

const authenticate = async () => {
  // setup-status tells us whether ANY user exists yet.
  let needsSetup = false;
  try {
    const status = await get('/api/v1/auth/setup-status');
    needsSetup = status?.needsSetup === true;
  } catch {
    // Older backends may not expose it; fall through to try login.
  }

  if (needsSetup) {
    await post('/api/v1/auth/signup', { username: USERNAME, password: PASSWORD });
    console.log(`[seed] signed up the dev account "${USERNAME}".`);
    return;
  }

  try {
    await post('/api/v1/auth/login', { username: USERNAME, password: PASSWORD });
    console.log(`[seed] logged in as "${USERNAME}".`);
  } catch (e) {
    if (e.status === 401) {
      throw new Error(
        `[seed] login failed for "${USERNAME}". An account already exists with ` +
          `different credentials. Set SEED_USERNAME / SEED_PASSWORD to match it, ` +
          `or wipe the dev DB and re-seed:\n` +
          `  docker compose -f docker-compose.dev.yml down -v && rm -rf ./data\n` +
          `  docker compose -f docker-compose.dev.yml up -d && pnpm dev   (then re-run)`
      );
    }
    throw e;
  }
};

// ── helpers ─────────────────────────────────────────────────────────────────

const ms = (daysAgo) => Date.now() - daysAgo * 24 * 60 * 60 * 1000;

// ── the seed ────────────────────────────────────────────────────────────────

const seed = async () => {
  console.log(`[seed] target ${BASE}`);
  await authenticate();

  // 1) Choose the building to seed INTO -------------------------------------
  // The running app opens on the OLDEST building (the backend's
  // resolveBuildingId picks `ORDER BY created_at ASC LIMIT 1`, and the
  // frontend defaults to that). So to make `pnpm dev` actually SHOW data on
  // first load, we seed into that active/default building (e.g. the
  // auto-seeded "My House") when it's still empty — NOT a separate building
  // the user would have to manually switch to.
  const buildings = await get('/api/v1/buildings');
  const list = Array.isArray(buildings) ? buildings : [];
  const sorted = [...list].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  const active = sorted[0] ?? null; // the building the app opens to

  // Is the active building already populated? (idempotency)
  let activePanels = [];
  if (active) {
    try {
      activePanels = await get(`/api/v1/panels?buildingId=${active.id}`);
    } catch {
      activePanels = [];
    }
  }
  const activeHasData = Array.isArray(activePanels) && activePanels.length > 0;

  let buildingId;
  let buildingName;
  if (FORCE) {
    // Explicit --force: always add a SEPARATE demo building (non-colliding name).
    const taken = new Set(list.map((b) => b.name));
    let name = BUILDING_NAME;
    let n = 2;
    while (taken.has(name)) name = `${BUILDING_NAME} (copy ${n++})`;
    const b = await post('/api/v1/buildings', { name });
    buildingId = b.id;
    buildingName = b.name;
    console.log(`[seed] --force: created a new demo building "${b.name}" (${buildingId})`);
  } else if (active && !activeHasData) {
    // Reuse the empty active building the app opens to.
    buildingId = active.id;
    buildingName = active.name;
    console.log(`[seed] seeding into the active building "${active.name}" (${buildingId})`);
  } else if (active && activeHasData) {
    console.log(
      `[seed] the active building "${active.name}" already has ` +
        `${activePanels.length} panel(s) — looks seeded already.\n` +
        `[seed] nothing to do. Pass --force to add a SEPARATE demo building.`
    );
    return;
  } else {
    // No building at all (the backend normally auto-seeds one, so this is a
    // belt-and-suspenders fallback).
    const b = await post('/api/v1/buildings', { name: BUILDING_NAME });
    buildingId = b.id;
    buildingName = b.name;
    console.log(`[seed] created building "${b.name}" (${buildingId})`);
  }

  const building = { id: buildingId, name: buildingName };
  const inB = (extra) => ({ buildingId, ...extra });

  // 2) Main panel + breakers -------------------------------------------------
  const mainPanel = await post(
    '/api/v1/panels',
    inB({ name: 'Main Panel', orientation: 'vertical', slotCount: 30 })
  );

  // slot, position, amps, poles, label, [tandemHalf], [protection]
  const mainBreakerSpecs = [
    { slot: '1', slotPosition: 1, amperage: 20, poles: 'single', label: 'Kitchen counter GFCI', protection: 'gfci' },
    { slot: '2', slotPosition: 2, amperage: 15, poles: 'single', label: 'Kitchen lights' },
    { slot: '3', slotPosition: 3, amperage: 40, poles: 'double', label: 'Electric range' },
    { slot: '5', slotPosition: 5, amperage: 15, poles: 'single', label: 'Living room', protection: 'afci' },
    { slot: '6', slotPosition: 6, amperage: 15, poles: 'single', label: 'Bedrooms', protection: 'afci' },
    { slot: '7', slotPosition: 7, amperage: 20, poles: 'single', label: 'Bathroom GFCI', protection: 'gfci' },
    { slot: '8', slotPosition: 8, amperage: 15, poles: 'tandem', tandemHalf: 'a', label: 'Hallway + stairs' },
    { slot: '8', slotPosition: 8, amperage: 15, poles: 'tandem', tandemHalf: 'b', label: 'Smoke detectors' },
    { slot: '9', slotPosition: 9, amperage: 20, poles: 'single', label: 'Washer' },
    { slot: '10', slotPosition: 10, amperage: 30, poles: 'double', label: 'Garage subpanel feeder' },
    { slot: '12', slotPosition: 12, amperage: 20, poles: 'single', label: 'Outdoor + deck GFCI', protection: 'gfci' },
  ];
  const mainBreakers = [];
  for (const spec of mainBreakerSpecs) {
    mainBreakers.push(await post(`/api/v1/panels/${mainPanel.id}/breakers`, spec));
  }
  const byLabel = (label) => mainBreakers.find((b) => b.label === label);
  console.log(`[seed] main panel: ${mainBreakers.length} breakers`);

  // 3) Garage subpanel, fed by the 30A double-pole feeder --------------------
  const feeder = byLabel('Garage subpanel feeder');
  const subPanel = await post(
    '/api/v1/panels',
    inB({
      name: 'Garage Subpanel',
      orientation: 'vertical',
      slotCount: 12,
      parentBreakerId: feeder.id,
    })
  );
  const subBreakerSpecs = [
    { slot: '1', slotPosition: 1, amperage: 20, poles: 'single', label: 'Garage outlets', protection: 'gfci' },
    { slot: '2', slotPosition: 2, amperage: 15, poles: 'single', label: 'Garage lights' },
    { slot: '3', slotPosition: 3, amperage: 20, poles: 'single', label: 'Workshop bench' },
  ];
  const subBreakers = [];
  for (const spec of subBreakerSpecs) {
    subBreakers.push(await post(`/api/v1/panels/${subPanel.id}/breakers`, spec));
  }
  const subByLabel = (label) => subBreakers.find((b) => b.label === label);
  console.log(`[seed] garage subpanel: ${subBreakers.length} breakers (fed by main slot ${feeder.slot})`);

  // 4) Floors ----------------------------------------------------------------
  const mainFloor = await post('/api/v1/floors', inB({ name: 'Main Floor', displayOrder: 1 }));
  const basement = await post('/api/v1/floors', inB({ name: 'Basement', displayOrder: 0 }));

  // 5) Rooms (axis-aligned rectangles) on the main floor ---------------------
  const roomSpecs = [
    { name: 'Kitchen', x: 600, y: 600, w: 3200, h: 2800 },
    { name: 'Living Room', x: 4200, y: 600, w: 4200, h: 4200 },
    { name: 'Bedroom', x: 600, y: 3800, w: 3200, h: 3000 },
    { name: 'Bathroom', x: 4200, y: 5200, w: 2000, h: 1600 },
  ];
  const rooms = {};
  for (const spec of roomSpecs) {
    const r = await post(`/api/v1/floors/${mainFloor.id}/rooms`, spec);
    rooms[spec.name] = r;
  }

  // 6) Walls — a simple perimeter sketch so the canvas isn't blank -----------
  const wallSpecs = [
    { x1: 600, y1: 600, x2: 8400, y2: 600 },
    { x1: 8400, y1: 600, x2: 8400, y2: 6800 },
    { x1: 8400, y1: 6800, x2: 600, y2: 6800 },
    { x1: 600, y1: 6800, x2: 600, y2: 600 },
    { x1: 3800, y1: 600, x2: 3800, y2: 3400 }, // kitchen/living divider
    { x1: 600, y1: 3800, x2: 3800, y2: 3800 }, // bedroom top
  ];
  for (const spec of wallSpecs) {
    await post(`/api/v1/floors/${mainFloor.id}/walls`, spec);
  }
  console.log(`[seed] main floor: ${roomSpecs.length} rooms, ${wallSpecs.length} walls`);

  // 7) Components — ALL 7 types, placed + wired ------------------------------
  // type, name, room, breaker(resolved), floor, x, y, [extras]
  const C = (spec) => post('/api/v1/components', inB(spec));
  const made = {};

  // Outlets
  made.kOut1 = await C({ type: 'outlet', name: 'Kitchen Counter Outlet', room: 'Kitchen', breakerId: byLabel('Kitchen counter GFCI').id, floorId: mainFloor.id, posX: 1400, posY: 1400, loadWatts: 180 });
  made.lvOut = await C({ type: 'outlet', name: 'Living Room Outlet', room: 'Living Room', breakerId: byLabel('Living room').id, floorId: mainFloor.id, posX: 5600, posY: 1600, loadWatts: 120 });
  made.bedOut = await C({ type: 'outlet', name: 'Bedroom Outlet', room: 'Bedroom', breakerId: byLabel('Bedrooms').id, floorId: mainFloor.id, posX: 1600, posY: 5000, loadWatts: 90 });

  // Lights
  made.kLight = await C({ type: 'light', name: 'Kitchen Ceiling Light', room: 'Kitchen', breakerId: byLabel('Kitchen lights').id, floorId: mainFloor.id, posX: 2200, posY: 2000, loadWatts: 60 });
  made.lvLight = await C({ type: 'light', name: 'Living Room Light', room: 'Living Room', breakerId: byLabel('Living room').id, floorId: mainFloor.id, posX: 6300, posY: 2600, loadWatts: 75 });
  made.hallLight = await C({ type: 'light', name: 'Hallway Light', room: 'Living Room', breakerId: byLabel('Hallway + stairs').id, floorId: mainFloor.id, posX: 4000, posY: 4400, loadWatts: 60 });

  // Switches (one single, one 2-gang that becomes a 3-way for the hall light)
  made.kSwitch = await C({ type: 'switch', name: 'Kitchen Light Switch', room: 'Kitchen', breakerId: byLabel('Kitchen lights').id, floorId: mainFloor.id, posX: 3400, posY: 900 });
  made.hallSwitchA = await C({ type: 'switch', name: 'Hall Switch (bottom)', room: 'Living Room', breakerId: byLabel('Hallway + stairs').id, floorId: mainFloor.id, posX: 4400, posY: 4900, gangs: 2 });
  made.hallSwitchB = await C({ type: 'switch', name: 'Hall Switch (top)', room: 'Living Room', breakerId: byLabel('Hallway + stairs').id, floorId: mainFloor.id, posX: 7200, posY: 4900 });

  // Appliance (critical)
  made.range = await C({ type: 'appliance', name: 'Electric Range', room: 'Kitchen', breakerId: byLabel('Electric range').id, floorId: mainFloor.id, posX: 3000, posY: 2600, critical: true, loadWatts: 8000 });
  made.fridge = await C({ type: 'appliance', name: 'Refrigerator', room: 'Kitchen', breakerId: byLabel('Kitchen counter GFCI').id, floorId: mainFloor.id, posX: 1000, posY: 2600, critical: true, loadWatts: 700 });

  // Junction box (unwired — common in real homes)
  made.jbox = await C({ type: 'junction_box', name: 'Ceiling Junction', room: 'Living Room', breakerId: null, floorId: mainFloor.id, posX: 6800, posY: 1400 });

  // Smoke detectors (on the tandem 'b' circuit; one critical)
  made.smoke1 = await C({ type: 'smoke_detector', name: 'Hallway Smoke', room: 'Living Room', breakerId: byLabel('Smoke detectors').id, floorId: mainFloor.id, posX: 5000, posY: 3400, critical: true, loadWatts: 5 });
  made.smoke2 = await C({ type: 'smoke_detector', name: 'Bedroom Smoke', room: 'Bedroom', breakerId: byLabel('Smoke detectors').id, floorId: mainFloor.id, posX: 2000, posY: 4400, loadWatts: 5 });

  // Other (a doorbell transformer — the catch-all type)
  made.other = await C({ type: 'other', name: 'Doorbell Transformer', room: 'Kitchen', breakerId: byLabel('Kitchen lights').id, floorId: mainFloor.id, posX: 600, posY: 900, loadWatts: 10 });

  // Garage components on the subpanel (unplaced — no floor pin)
  made.gOutlet = await C({ type: 'outlet', name: 'Garage Door Outlet', room: 'Garage', breakerId: subByLabel('Garage outlets').id, loadWatts: 250 });
  made.gLight = await C({ type: 'light', name: 'Garage Light', room: 'Garage', breakerId: subByLabel('Garage lights').id, loadWatts: 60 });
  made.bench = await C({ type: 'appliance', name: 'Workshop Bench Grinder', room: 'Garage', breakerId: subByLabel('Workshop bench').id, loadWatts: 1400 });

  const componentCount = Object.keys(made).length;
  console.log(`[seed] ${componentCount} components across all 7 types`);

  // 8) Switch controls — kitchen switch → kitchen light; the 2 hall switches
  //    (3-way) both control the hall light -----------------------------------
  await post(`/api/v1/components/${made.kSwitch.id}/controls`, { gangIndex: 0, controlledId: made.kLight.id });
  await post(`/api/v1/components/${made.hallSwitchA.id}/controls`, { gangIndex: 0, controlledId: made.hallLight.id });
  await post(`/api/v1/components/${made.hallSwitchB.id}/controls`, { gangIndex: 0, controlledId: made.hallLight.id });
  console.log('[seed] switch controls: kitchen + a 3-way hall pair');

  // 9) A couple of breaker tests so the audit/dashboard have history ----------
  await post(`/api/v1/breakers/${byLabel('Bathroom GFCI').id}/breaker-tests`, {
    testedAt: ms(10),
    outcome: 'monthly self-test',
    notes: 'GFCI tripped + reset OK',
  });
  await post(`/api/v1/breakers/${byLabel('Outdoor + deck GFCI').id}/breaker-tests`, {
    testedAt: ms(95),
    outcome: 'monthly self-test',
    notes: 'OK — but overdue, last tested >3 months ago',
  });
  console.log('[seed] 2 breaker tests (one recent, one overdue)');

  // 10) Service-log entries ---------------------------------------------------
  await post(`/api/v1/components/${made.kOut1.id}/service-entries`, {
    occurredAt: ms(400),
    note: 'Replaced this outlet — the old one was scorched. Now a 20A GFCI.',
  });
  await post(`/api/v1/breakers/${byLabel('Electric range').id}/service-entries`, {
    occurredAt: ms(30),
    note: 'Re-torqued the lugs during the panel inspection.',
  });
  console.log('[seed] 2 service-log entries');

  console.log('');
  console.log(`[seed] ✓ done. Open the app — "${building.name}" is the active building, so it shows immediately.`);
  console.log(`[seed]   - Main Panel (30 slots) + Garage Subpanel (fed by a feeder breaker)`);
  console.log(`[seed]   - Main Floor with 4 rooms + components of every type on the plan`);
  console.log(`[seed]   - an overloaded-ish range circuit, an overdue GFCI, a 3-way hall switch`);
};

seed().catch((e) => {
  console.error('\n[seed] FAILED:', e.message);
  console.error('[seed] Is the dev backend running? (pnpm dev → 127.0.0.1:3000)');
  console.error('[seed] Is the dev Postgres up? (docker compose -f docker-compose.dev.yml up -d)');
  process.exit(1);
});
