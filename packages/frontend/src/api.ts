import type {
  ApiEnvelope,
  Breaker,
  BreakerInput,
  BreakerTest,
  Component,
  ComponentInput,
  ComponentType,
  Floor,
  FloorInput,
  Panel,
  ResolvedComponent,
  ResolvedSwitchControl,
  Room,
  RoomInput,
  ServiceEntry,
  ServiceEntryParentType,
  SwitchControl,
  Wall,
  WallInput,
} from '@he/shared';

/**
 * G42(a) cycle-49 — Error subclass that carries the HTTP status so
 * callers can branch on 409 (UNIQUE name conflict) without parsing the
 * message string. `message` retains the historical format
 * ("HTTP <status>[: <detail>]") so any existing `instanceof Error` consumer
 * keeps working.
 */
export class ApiHttpError extends Error {
  readonly status: number;
  readonly detail: string;
  constructor(status: number, detail: string) {
    super(`HTTP ${status}${detail ? `: ${detail}` : ''}`);
    this.name = 'ApiHttpError';
    this.status = status;
    this.detail = detail;
  }
}

/**
 * feat/auth-gate — global 401 handler. AuthContext registers a callback
 * here so any expired-session response bubbles back to the React tree
 * and the user is redirected to the LoginScreen without losing the
 * current URL.
 */
let unauthorizedHandler: (() => void) | null = null;

export const setUnauthorizedHandler = (cb: (() => void) | null): void => {
  unauthorizedHandler = cb;
};

const unwrap = async <T,>(res: Response): Promise<T> => {
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      detail = body.error?.message ?? '';
    } catch {
      detail = await res.text().catch(() => '');
    }
    if (res.status === 401 && unauthorizedHandler !== null) {
      // Fire-and-forget — let the AuthContext flip user → null.
      try {
        unauthorizedHandler();
      } catch {
        // best-effort
      }
    }
    throw new ApiHttpError(res.status, detail);
  }
  const body = (await res.json()) as ApiEnvelope<T>;
  return body.data;
};

// ── feat/auth-gate — auth endpoints used by AuthContext ────────────────

export type AuthUser = { username: string };

export const fetchAuthMe = async (): Promise<AuthUser | null> => {
  const res = await fetch('/api/v1/auth/me');
  if (res.status === 401) return null;
  if (!res.ok) {
    throw new ApiHttpError(res.status, await res.text().catch(() => ''));
  }
  const body = (await res.json()) as ApiEnvelope<AuthUser>;
  return body.data;
};

export const submitLogin = async (
  username: string,
  password: string
): Promise<AuthUser> => {
  const res = await fetch('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (res.status === 401) {
    throw new ApiHttpError(401, 'Invalid username or password.');
  }
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      detail = body.error?.message ?? '';
    } catch {
      detail = await res.text().catch(() => '');
    }
    throw new ApiHttpError(res.status, detail);
  }
  const body = (await res.json()) as ApiEnvelope<AuthUser>;
  return body.data;
};

export const submitLogout = async (): Promise<void> => {
  await fetch('/api/v1/auth/logout', { method: 'POST' });
};

export const listPanels = async (): Promise<Panel[]> => {
  const res = await fetch('/api/v1/panels');
  return unwrap<Panel[]>(res);
};

export const createPanel = async (
  name: string,
  extra?: { parentBreakerId?: string | null }
): Promise<Panel> => {
  const res = await fetch('/api/v1/panels', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, ...extra }),
  });
  return unwrap<Panel>(res);
};

export const getPanel = async (id: string): Promise<Panel> => {
  const res = await fetch(`/api/v1/panels/${encodeURIComponent(id)}`);
  return unwrap<Panel>(res);
};

export const deletePanel = async (id: string): Promise<void> => {
  const res = await fetch(`/api/v1/panels/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`HTTP ${res.status}`);
  }
};

export const updatePanel = async (
  id: string,
  patch: {
    name?: string;
    orientation?: 'vertical' | 'horizontal';
    slotCount?: number;
    /** G39 cycle-56 — set to a breaker id to wire as subpanel; null to detach. */
    parentBreakerId?: string | null;
  }
): Promise<Panel> => {
  const res = await fetch(`/api/v1/panels/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return unwrap<Panel>(res);
};

/** G39 cycle-56 — convenience: which panels list `breakerId` as their
 *  feeder? Filters listPanels output client-side (no dedicated endpoint;
 *  panel count is tiny). Used by PanelDetailScreen + PanelVisualization to
 *  decorate feeder breaker slots with a subpanel badge. */
export const getPanelsFedByBreaker = async (
  breakerId: string
): Promise<Panel[]> => {
  const panels = await listPanels();
  return panels.filter((p) => p.parentBreakerId === breakerId);
};

// --- Floors (G13) ---

export const listFloors = async (): Promise<Floor[]> => {
  const res = await fetch('/api/v1/floors');
  return unwrap<Floor[]>(res);
};

export const createFloor = async (input: FloorInput): Promise<Floor> => {
  const res = await fetch('/api/v1/floors', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return unwrap<Floor>(res);
};

export const getFloor = async (id: string): Promise<Floor> => {
  const res = await fetch(`/api/v1/floors/${encodeURIComponent(id)}`);
  return unwrap<Floor>(res);
};

export const updateFloor = async (
  id: string,
  patch: Partial<FloorInput>
): Promise<Floor> => {
  const res = await fetch(`/api/v1/floors/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return unwrap<Floor>(res);
};

export const deleteFloor = async (id: string): Promise<void> => {
  const res = await fetch(`/api/v1/floors/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`HTTP ${res.status}`);
  }
};

export const uploadFloorPlan = async (floorId: string, file: File): Promise<Floor> => {
  const body = new FormData();
  body.append('file', file);
  const res = await fetch(`/api/v1/floors/${encodeURIComponent(floorId)}/floor-plan`, {
    method: 'POST',
    body,
  });
  return unwrap<Floor>(res);
};

export const deleteFloorPlan = async (floorId: string): Promise<Floor> => {
  const res = await fetch(`/api/v1/floors/${encodeURIComponent(floorId)}/floor-plan`, {
    method: 'DELETE',
  });
  return unwrap<Floor>(res);
};

export const floorPlanUrl = (filename: string): string =>
  `/files/floor-plans/${encodeURIComponent(filename)}`;

export const listBreakers = async (panelId: string): Promise<Breaker[]> => {
  const res = await fetch(`/api/v1/panels/${encodeURIComponent(panelId)}/breakers`);
  return unwrap<Breaker[]>(res);
};

export const createBreaker = async (
  panelId: string,
  input: BreakerInput
): Promise<Breaker> => {
  const res = await fetch(`/api/v1/panels/${encodeURIComponent(panelId)}/breakers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return unwrap<Breaker>(res);
};

export const updateBreaker = async (
  id: string,
  patch: Partial<BreakerInput>
): Promise<Breaker> => {
  const res = await fetch(`/api/v1/breakers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return unwrap<Breaker>(res);
};

export const deleteBreaker = async (id: string): Promise<void> => {
  const res = await fetch(`/api/v1/breakers/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`HTTP ${res.status}`);
  }
};

// --- Components ---

export const listComponents = async (filter?: {
  room?: string;
  type?: ComponentType;
  breakerId?: string;
  floorId?: string;
  search?: string;
}): Promise<ResolvedComponent[]> => {
  const params = new URLSearchParams();
  if (filter?.room) params.set('room', filter.room);
  if (filter?.type) params.set('type', filter.type);
  if (filter?.breakerId) params.set('breakerId', filter.breakerId);
  if (filter?.floorId) params.set('floorId', filter.floorId);
  if (filter?.search) params.set('search', filter.search);
  const qs = params.toString();
  const res = await fetch(`/api/v1/components${qs ? `?${qs}` : ''}`);
  return unwrap<ResolvedComponent[]>(res);
};

export type PanelWithBreakers = { panel: Panel; breakers: Breaker[] };

export const listAllBreakersGrouped = async (): Promise<PanelWithBreakers[]> => {
  const panels = await listPanels();
  return Promise.all(
    panels.map(async (panel) => ({
      panel,
      breakers: await listBreakers(panel.id),
    }))
  );
};

export const createComponent = async (input: ComponentInput): Promise<Component> => {
  const res = await fetch('/api/v1/components', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return unwrap<Component>(res);
};

export const getComponent = async (id: string): Promise<ResolvedComponent> => {
  const res = await fetch(`/api/v1/components/${encodeURIComponent(id)}`);
  return unwrap<ResolvedComponent>(res);
};

export const updateComponent = async (
  id: string,
  patch: Partial<ComponentInput>
): Promise<Component> => {
  const res = await fetch(`/api/v1/components/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return unwrap<Component>(res);
};

export const deleteComponent = async (id: string): Promise<void> => {
  const res = await fetch(`/api/v1/components/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`HTTP ${res.status}`);
  }
};

// --- Walls (G12) ---

export const listWalls = async (floorId: string): Promise<Wall[]> => {
  const res = await fetch(
    `/api/v1/floors/${encodeURIComponent(floorId)}/walls`
  );
  return unwrap<Wall[]>(res);
};

export const createWall = async (
  floorId: string,
  input: WallInput
): Promise<Wall> => {
  const res = await fetch(
    `/api/v1/floors/${encodeURIComponent(floorId)}/walls`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }
  );
  return unwrap<Wall>(res);
};

export const updateWall = async (
  id: string,
  patch: Partial<WallInput>
): Promise<Wall> => {
  const res = await fetch(`/api/v1/walls/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return unwrap<Wall>(res);
};

export const deleteWall = async (id: string): Promise<void> => {
  const res = await fetch(`/api/v1/walls/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`HTTP ${res.status}`);
  }
};

// --- Rooms (G12) ---

export const listRooms = async (floorId: string): Promise<Room[]> => {
  const res = await fetch(
    `/api/v1/floors/${encodeURIComponent(floorId)}/rooms`
  );
  return unwrap<Room[]>(res);
};

/** Cycle-85 — flat house-level read. Used by ComponentsScreen to power the
 *  ComponentForm Room datalist autocomplete: rooms drawn on a floor map
 *  appear as suggestions even if no component has been placed in them yet,
 *  AND rooms used on other components surface across the union (the
 *  consumer dedupes the two lists). */
export const listAllRooms = async (): Promise<Room[]> => {
  const res = await fetch('/api/v1/rooms');
  return unwrap<Room[]>(res);
};

export const createRoom = async (
  floorId: string,
  input: RoomInput
): Promise<Room> => {
  const res = await fetch(
    `/api/v1/floors/${encodeURIComponent(floorId)}/rooms`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }
  );
  return unwrap<Room>(res);
};

export const updateRoom = async (
  id: string,
  patch: Partial<RoomInput>
): Promise<Room> => {
  const res = await fetch(`/api/v1/rooms/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return unwrap<Room>(res);
};

// --- Switch controls (G19) ---

export const listSwitchControls = async (
  switchId: string
): Promise<ResolvedSwitchControl[]> => {
  const res = await fetch(
    `/api/v1/components/${encodeURIComponent(switchId)}/controls`
  );
  return unwrap<ResolvedSwitchControl[]>(res);
};

export const addSwitchControl = async (
  switchId: string,
  gangIndex: number,
  controlledId: string
): Promise<ResolvedSwitchControl> => {
  const res = await fetch(
    `/api/v1/components/${encodeURIComponent(switchId)}/controls`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gangIndex, controlledId }),
    }
  );
  return unwrap<ResolvedSwitchControl>(res);
};

export const removeSwitchControl = async (
  switchId: string,
  gangIndex: number,
  controlledId: string
): Promise<void> => {
  const res = await fetch(
    `/api/v1/components/${encodeURIComponent(switchId)}/controls/${gangIndex}/${encodeURIComponent(controlledId)}`,
    { method: 'DELETE' }
  );
  if (!res.ok && res.status !== 204) {
    throw new Error(`HTTP ${res.status}`);
  }
};

/**
 * G38 cycle-64 — flat per-floor list. Returns plain `SwitchControl` rows
 * (triples) for any link where either the switch OR the controlled
 * component lives on the given floor. Used by FloorEditScreen to power
 * the "3-way" badge + "Controlled by" sidebar list + inverse render
 * branch on light selection. See CLAUDE.md "Three-way / co-controlled
 * switches (G38 — cycle-64)".
 */
export const listSwitchControlsByFloor = async (
  floorId: string
): Promise<SwitchControl[]> => {
  const res = await fetch(
    `/api/v1/switch-controls?floorId=${encodeURIComponent(floorId)}`
  );
  return unwrap<SwitchControl[]>(res);
};

export const deleteRoom = async (id: string): Promise<void> => {
  const res = await fetch(`/api/v1/rooms/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`HTTP ${res.status}`);
  }
};

// --- Breaker tests (G36 cycle-61 — audit trail) ---
//
// Audit GETs intentionally NOT in the SWR allowlist (CLAUDE.md). They fall
// through to NetworkFirst so the user always sees a fresh "Last verified"
// hint.

export const createBreakerTest = async (
  breakerId: string,
  input: { outcome?: string | null; notes?: string | null; testedAt?: number } = {}
): Promise<BreakerTest> => {
  const res = await fetch(
    `/api/v1/breakers/${encodeURIComponent(breakerId)}/breaker-tests`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }
  );
  return unwrap<BreakerTest>(res);
};

/** G36 Part 2 (cycle-63) — paginated response. `data` is up to `limit`
 *  rows (server caps to 200); `totalCount` is the WHERE-filtered count
 *  before LIMIT was applied so callers can show "Showing N of M" hints. */
export type BreakerTestListResponse = {
  data: BreakerTest[];
  totalCount: number;
};

export const listBreakerTests = async (filter?: {
  breakerId?: string;
  since?: number;
  /** G36 Part 2 (cycle-63) — upper bound, inclusive epoch ms. */
  until?: number;
  outcome?: string;
  /** G36 Part 2 (cycle-63) — page size (server caps to 200). */
  limit?: number;
}): Promise<BreakerTestListResponse> => {
  const params = new URLSearchParams();
  if (filter?.breakerId) params.set('breakerId', filter.breakerId);
  if (filter?.since !== undefined) params.set('since', String(filter.since));
  if (filter?.until !== undefined) params.set('until', String(filter.until));
  if (filter?.outcome) params.set('outcome', filter.outcome);
  if (filter?.limit !== undefined) params.set('limit', String(filter.limit));
  const qs = params.toString();
  const res = await fetch(`/api/v1/breaker-tests${qs ? `?${qs}` : ''}`);
  // Bespoke unwrap — the response has BOTH `data` and `totalCount`, so we
  // can't use the generic ApiEnvelope<T> path (which only returns body.data).
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      detail = body.error?.message ?? '';
    } catch {
      detail = await res.text().catch(() => '');
    }
    throw new ApiHttpError(res.status, detail);
  }
  const body = (await res.json()) as BreakerTestListResponse;
  return body;
};

export const deleteBreakerTest = async (id: string): Promise<void> => {
  const res = await fetch(
    `/api/v1/breaker-tests/${encodeURIComponent(id)}`,
    { method: 'DELETE' }
  );
  if (!res.ok && res.status !== 204) {
    throw new Error(`HTTP ${res.status}`);
  }
};

/** Fetch the latest BreakerTest for each id. One round-trip per id —
 *  acceptable for typical residential panels (≤42 breakers). If a panel
 *  count grows large, swap to a bulk endpoint. Returns a Map keyed by
 *  breaker id; missing breakers → null. */
export const latestBreakerTestsByIds = async (
  breakerIds: readonly string[]
): Promise<Map<string, BreakerTest | null>> => {
  const out = new Map<string, BreakerTest | null>();
  if (breakerIds.length === 0) return out;
  await Promise.all(
    breakerIds.map(async (id) => {
      // G36 Part 2 (cycle-63) — listBreakerTests now returns
      // { data, totalCount }. We only need the most-recent row; the
      // server returns DESC-sorted so data[0] is still "latest".
      const { data } = await listBreakerTests({ breakerId: id, limit: 1 });
      out.set(id, data[0] ?? null);
    })
  );
  return out;
};

// --- Service entries (G40 Part 1 cycle-66 — dated service-log) ---
//
// Service-log GETs intentionally NOT in the SWR allowlist (CLAUDE.md). They
// fall through to NetworkFirst so the user always sees the durable record
// they care about. Polymorphism is URL-driven: createBreakerServiceEntry
// + createComponentServiceEntry hit different nested writers.

export const createBreakerServiceEntry = async (
  breakerId: string,
  input: { note: string; occurredAt?: number }
): Promise<ServiceEntry> => {
  const res = await fetch(
    `/api/v1/breakers/${encodeURIComponent(breakerId)}/service-entries`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }
  );
  return unwrap<ServiceEntry>(res);
};

export const createComponentServiceEntry = async (
  componentId: string,
  input: { note: string; occurredAt?: number }
): Promise<ServiceEntry> => {
  const res = await fetch(
    `/api/v1/components/${encodeURIComponent(componentId)}/service-entries`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }
  );
  return unwrap<ServiceEntry>(res);
};

/** Paginated response shape — same as the cycle-63 audit list. */
export type ServiceEntryListResponse = {
  data: ServiceEntry[];
  totalCount: number;
};

export const listServiceEntries = async (filter?: {
  parentType?: ServiceEntryParentType;
  parentId?: string;
  /** Comma-separated bulk parent-id fetch. PanelDetailScreen uses this
   *  to load entries for every breaker on a panel in one round-trip. */
  parentIds?: readonly string[];
  since?: number;
  until?: number;
  limit?: number;
}): Promise<ServiceEntryListResponse> => {
  const params = new URLSearchParams();
  if (filter?.parentType) params.set('parentType', filter.parentType);
  if (filter?.parentId) params.set('parentId', filter.parentId);
  if (filter?.parentIds && filter.parentIds.length > 0) {
    params.set('parentIds', filter.parentIds.join(','));
  }
  if (filter?.since !== undefined) params.set('since', String(filter.since));
  if (filter?.until !== undefined) params.set('until', String(filter.until));
  if (filter?.limit !== undefined) params.set('limit', String(filter.limit));
  const qs = params.toString();
  const res = await fetch(`/api/v1/service-entries${qs ? `?${qs}` : ''}`);
  // Bespoke unwrap — response has BOTH `data` and `totalCount` (same as
  // listBreakerTests).
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      detail = body.error?.message ?? '';
    } catch {
      detail = await res.text().catch(() => '');
    }
    throw new ApiHttpError(res.status, detail);
  }
  const body = (await res.json()) as ServiceEntryListResponse;
  return body;
};

export const deleteServiceEntry = async (id: string): Promise<void> => {
  const res = await fetch(
    `/api/v1/service-entries/${encodeURIComponent(id)}`,
    { method: 'DELETE' }
  );
  if (!res.ok && res.status !== 204) {
    throw new Error(`HTTP ${res.status}`);
  }
};
