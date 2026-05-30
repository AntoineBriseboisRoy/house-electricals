import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  buildingExportSchema,
  newId,
  type ApiEnvelope,
  type ApiError,
  type Building,
  type BuildingExportParsed,
  type BuildingRepository,
} from '@he/shared';
import type { Db, Querier } from '../db.js';
import { isSafeFilename } from '../safe-path.js';

// Hard request-body ceiling enforced BEFORE the JSON body is buffered into
// memory (G46 FIX 1). An export of a real home is well under a megabyte; 25 MB
// is a generous ceiling that still stops a multi-GB POST from OOMing the
// process before zod ever sees it.
const MAX_IMPORT_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * Building import/restore (G43 — 2026-05). The inverse of the building EXPORT
 * (routes/export.ts): ingest a `house-electricals-building-export` v1 payload
 * and reconstruct the WHOLE tree as a NEW building with fresh ULIDs, preserving
 * every internal cross-reference.
 *
 *   POST /api/v1/buildings/import   { ...export payload }  → 201 { data: Building }
 *
 * Design pins (council-hardened):
 *
 * 1. ATOMIC SINGLE-TRANSACTION RECONSTRUCTION. Every row is inserted inside ONE
 *    `deps.db.transaction(...)`. New ULIDs are pre-minted up-front so the
 *    old→new id remap for each entity is a plain `Map<string,string>` built
 *    before any cross-referencing insert runs. RAW parameterized INSERTs are
 *    issued via the transactional `Querier` ($1,$2,… placeholders). This direct
 *    `db` restore path is EXPLICITLY ALLOWED (same precedent as routes/export.ts
 *    reading switch_controls/breaker_tests/service_entries via direct `db`
 *    subqueries) — it is NOT a normal write-path repo bypass: the repo
 *    `create()` methods each open their own pooled connection and mint their own
 *    ULID, so they can neither share one transaction nor accept explicit ids.
 *    Any throw inside the transaction rolls EVERYTHING back — no half-built
 *    orphan building is ever committed.
 *
 * 2. NO SLOT VALIDATION. The exported geometry was already validated when
 *    originally created; re-running validateSlotAssignment risks spuriously
 *    rejecting a valid exported layout (e.g. tandem halves). DB CHECK
 *    constraints are the only backstop on this path.
 *
 * 3. BUILDING-NAME COLLISION. Always create a NEW building (re-import yields a
 *    fresh copy). The only collision is the global-UNIQUE buildings.name; the
 *    name is suffixed `(imported)`, `(imported 2)`, … until free.
 *
 * 4. SHARED ENVELOPE SCHEMA. `buildingExportSchema` from @he/shared validates
 *    the payload — the same schema the export type derives from.
 */

type ImportDeps = {
  db: Db;
  buildingRepository: BuildingRepository;
};

/** Build the suffixed-name candidate for the Nth collision attempt.
 *  attempt 0 → the original name; 1 → "<name> (imported)"; 2 → "<name>
 *  (imported 2)"; … (matches the spec's progression). */
const importedNameCandidate = (base: string, attempt: number): string => {
  if (attempt === 0) return base;
  if (attempt === 1) return `${base} (imported)`;
  return `${base} (imported ${attempt})`;
};

/** Resolve a free building name by probing buildings.name inside the
 *  transaction. SELECT-precheck-then-insert (simpler than SAVEPOINT juggling);
 *  the single-user app makes a race negligible, and the INSERT below is still
 *  guarded against a 23505 by the caller. */
const resolveFreeBuildingName = async (
  tx: Querier,
  base: string
): Promise<string> => {
  for (let attempt = 0; attempt < 10000; attempt++) {
    const candidate = importedNameCandidate(base, attempt);
    const existing = await tx.queryOne<{ id: string }>(
      'SELECT id FROM buildings WHERE name = $1',
      [candidate]
    );
    if (existing === null) return candidate;
  }
  // Practically unreachable — bail rather than loop forever.
  throw new Error('Could not find a free building name.');
};

/** Remap an old id through a dict, THROWING if the reference dangles. Throwing
 *  inside the transaction rolls everything back (PIN 1 atomicity) AND prevents
 *  silently corrupting the import by inserting a NULL/undefined cross-ref. */
const remap = (
  dict: Map<string, string>,
  oldId: string,
  what: string
): string => {
  const next = dict.get(oldId);
  if (next === undefined) {
    throw new Error(
      `Import references an unknown ${what} id "${oldId}" — payload is inconsistent.`
    );
  }
  return next;
};

/** Same as remap but tolerates null (for nullable FKs like breaker_id /
 *  floor_id / parentBreakerId). A non-null id that doesn't resolve still
 *  throws (PIN 1 + atomicity test trigger). */
const remapNullable = (
  dict: Map<string, string>,
  oldId: string | null,
  what: string
): string | null => (oldId === null ? null : remap(dict, oldId, what));

/**
 * Reconstruct an exported building tree under a brand-new building. Runs
 * entirely inside ONE transaction; returns the new building id. Throws on any
 * inconsistency or DB error (rolls everything back).
 */
const reconstruct = async (
  tx: Querier,
  payload: BuildingExportParsed
): Promise<string> => {
  const now = Date.now();

  // Pre-mint every new ULID up-front so cross-references can be remapped
  // through plain dicts (NOT read back from any create() return). newId() is
  // the same monotonic factory the repositories use.
  const buildingId = newId();
  const floorIds = new Map<string, string>();
  for (const f of payload.floors) floorIds.set(f.id, newId());
  const panelIds = new Map<string, string>();
  for (const p of payload.panels) panelIds.set(p.id, newId());
  const breakerIds = new Map<string, string>();
  for (const b of payload.breakers) breakerIds.set(b.id, newId());
  const componentIds = new Map<string, string>();
  for (const c of payload.components) componentIds.set(c.id, newId());

  // 1. building — fresh id; name resolved to a free (collision-suffixed) value.
  const name = await resolveFreeBuildingName(tx, payload.building.name);
  await tx.execute(
    'INSERT INTO buildings (id, name, created_at) VALUES ($1, $2, $3)',
    [buildingId, name, now]
  );

  // 2. floors — building_id → new building.
  for (const f of payload.floors) {
    // G46 FIX 4: the floor-plan filename comes from an attacker-controlled
    // payload, and the image BYTES are not imported (G43 scope) — so a
    // filename that isn't a single safe segment is stored as NULL rather than
    // risking a later fs unlink/write escaping FLOOR_PLAN_DIR. A valid
    // filename has no matching file on disk after import anyway; the operator
    // re-uploads the plan. Width/height follow the filename (null → null).
    const rawFilename = f.floorPlan?.filename ?? null;
    const safeFilename =
      rawFilename !== null && isSafeFilename(rawFilename) ? rawFilename : null;
    const safeWidth = safeFilename !== null ? (f.floorPlan?.width ?? null) : null;
    const safeHeight =
      safeFilename !== null ? (f.floorPlan?.height ?? null) : null;
    await tx.execute(
      `INSERT INTO floors (id, name, display_order, floor_plan_filename,
         floor_plan_width, floor_plan_height, created_at, panel_id, building_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        floorIds.get(f.id),
        f.name,
        f.displayOrder,
        safeFilename,
        safeWidth,
        safeHeight,
        f.createdAt,
        // panel_id is remapped AFTER panels exist — set NULL for now, patched
        // in the panel second-pass below.
        null,
        buildingId,
      ]
    );
  }

  // 3. rooms — floor_id → floors dict. points stored as JSONB (mirrors
  //    PgRoomRepository.create's `$8::jsonb` + JSON.stringify serialization).
  for (const r of payload.rooms) {
    await tx.execute(
      `INSERT INTO rooms (id, floor_id, name, x, y, w, h, points, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
      [
        newId(),
        remap(floorIds, r.floorId, 'floor'),
        r.name,
        r.x,
        r.y,
        r.w,
        r.h,
        JSON.stringify(r.points),
        r.createdAt,
      ]
    );
  }

  // 4. walls — floor_id → floors dict.
  for (const w of payload.walls) {
    await tx.execute(
      `INSERT INTO walls (id, floor_id, x1, y1, x2, y2, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        newId(),
        remap(floorIds, w.floorId, 'floor'),
        w.x1,
        w.y1,
        w.x2,
        w.y2,
        w.createdAt,
      ]
    );
  }

  // 5. panels — building_id → new building; parent_breaker_id → NULL for now
  //    (breakers don't exist yet; patched in the second pass at step 7).
  for (const p of payload.panels) {
    await tx.execute(
      `INSERT INTO panels (id, name, created_at, orientation, slot_count,
         parent_breaker_id, building_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        panelIds.get(p.id),
        p.name,
        p.createdAt,
        p.orientation,
        p.slotCount,
        null,
        buildingId,
      ]
    );
  }

  // 6. breakers — panel_id → panels dict.
  for (const b of payload.breakers) {
    await tx.execute(
      `INSERT INTO breakers (id, panel_id, slot, slot_position, amperage, poles,
         label, tandem_half, protection, is_on, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        breakerIds.get(b.id),
        remap(panelIds, b.panelId, 'panel'),
        b.slot,
        b.slotPosition,
        b.amperage,
        b.poles,
        b.label,
        b.tandemHalf,
        b.protection,
        // 2026-05 — restore persisted on/off state (defaults ON for pre-2026-05
        // exports via breakerSchema's isOn default).
        b.isOn ? 1 : 0,
        b.createdAt,
      ]
    );
  }

  // 7. SECOND PASS — now that breakers exist, restore each subpanel's feeder
  //    link (panels.parent_breaker_id), remapping through the breakers dict.
  for (const p of payload.panels) {
    if (p.parentBreakerId === null) continue;
    await tx.execute('UPDATE panels SET parent_breaker_id = $1 WHERE id = $2', [
      remap(breakerIds, p.parentBreakerId, 'breaker'),
      remap(panelIds, p.id, 'panel'),
    ]);
  }

  // 7b. SECOND PASS — floors.panel_id (the cycle-85 floor→default-panel link).
  //     Inserted NULL above because panels are created AFTER floors; now that
  //     panels exist, remap + restore the link so it survives a round-trip.
  for (const f of payload.floors) {
    if (f.panelId === null) continue;
    await tx.execute('UPDATE floors SET panel_id = $1 WHERE id = $2', [
      remap(panelIds, f.panelId, 'panel'),
      remap(floorIds, f.id, 'floor'),
    ]);
  }

  // 8. components — building_id → new building; breaker_id → breakers dict or
  //    NULL; floor_id → floors dict or NULL. critical stored as 0/1 SMALLINT
  //    (mirrors PgComponentRepository.create's `component.critical ? 1 : 0`).
  for (const c of payload.components) {
    await tx.execute(
      `INSERT INTO components (id, type, name, room, notes, breaker_id, floor_id,
         pos_x, pos_y, gangs, critical, protection, load_watts, created_at,
         building_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        componentIds.get(c.id),
        c.type,
        c.name,
        c.room,
        c.notes,
        remapNullable(breakerIds, c.breakerId, 'breaker'),
        remapNullable(floorIds, c.floorId, 'floor'),
        c.posX,
        c.posY,
        c.gangs,
        c.critical ? 1 : 0,
        c.protection,
        c.loadWatts,
        c.createdAt,
        buildingId,
      ]
    );
  }

  // 9. switch_controls — switch_id + controlled_id → components dict.
  //    gang_index unchanged. No id column (composite PK). ON CONFLICT DO
  //    NOTHING mirrors the repo's idempotent write contract, so a payload that
  //    happens to carry a duplicate triple doesn't abort the whole import.
  for (const sc of payload.switchControls) {
    await tx.execute(
      `INSERT INTO switch_controls (switch_id, gang_index, controlled_id)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [
        remap(componentIds, sc.switchId, 'component'),
        sc.gangIndex,
        remap(componentIds, sc.controlledId, 'component'),
      ]
    );
  }

  // 10. service_entries — POLYMORPHIC: parent_type decides the dict.
  //     'breaker' → breakers dict; 'component' → components dict. A wrong dict
  //     here silently corrupts the import, so this branch is unit-tested both
  //     ways. A dangling parent_id throws (atomicity).
  for (const se of payload.serviceEntries) {
    const dict = se.parentType === 'breaker' ? breakerIds : componentIds;
    await tx.execute(
      `INSERT INTO service_entries (id, parent_type, parent_id, occurred_at,
         note, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        newId(),
        se.parentType,
        remap(dict, se.parentId, se.parentType),
        se.occurredAt,
        se.note,
        se.createdAt,
      ]
    );
  }

  // 11. breaker_tests — breaker_id → breakers dict.
  for (const bt of payload.breakerTests) {
    await tx.execute(
      `INSERT INTO breaker_tests (id, breaker_id, tested_at, outcome, notes,
         created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        newId(),
        remap(breakerIds, bt.breakerId, 'breaker'),
        bt.testedAt,
        bt.outcome,
        bt.notes,
        bt.createdAt,
      ]
    );
  }

  return buildingId;
};

export const buildImportRoutes = (deps: ImportDeps): Hono => {
  const router = new Hono();

  router.post(
    '/buildings/import',
    bodyLimit({
      maxSize: MAX_IMPORT_BYTES,
      onError: (c) => {
        const err: ApiError = {
          error: { message: 'Import file too large (max 25 MB).' },
        };
        return c.json(err, 413);
      },
    }),
    async (c) => {
    // Parse the raw body first so we can produce SPECIFIC envelope-rejection
    // messages from the format/version fields before the full safeParse.
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      const err: ApiError = { error: { message: 'Invalid export file.' } };
      return c.json(err, 400);
    }

    const raw = body as { format?: unknown; version?: unknown };
    if (raw !== null && typeof raw === 'object') {
      if (
        raw.format !== undefined &&
        raw.format !== 'house-electricals-building-export'
      ) {
        const err: ApiError = {
          error: { message: 'Not a House Electricals building export.' },
        };
        return c.json(err, 400);
      }
      if (raw.version !== undefined && raw.version !== 1) {
        const err: ApiError = {
          error: { message: `Unsupported export version ${String(raw.version)}.` },
        };
        return c.json(err, 400);
      }
    }

    const parsed = buildingExportSchema.safeParse(body);
    if (!parsed.success) {
      const err: ApiError = { error: { message: 'Invalid export file.' } };
      return c.json(err, 400);
    }

    // Reconstruct atomically; any throw inside rolls the whole transaction
    // back. A dangling cross-ref (reconstruct throws) or a DB integrity
    // violation (SQLSTATE class 23 — CHECK / UNIQUE / FK) is a PAYLOAD fault →
    // 400 with a readable { error: { message } } the frontend can show; a bare
    // 500 (Hono's default, plain-text) would otherwise leak through with no
    // envelope. Anything else is a genuine server fault → 500.
    let newBuildingId: string;
    try {
      newBuildingId = await deps.db.transaction((tx) =>
        reconstruct(tx, parsed.data)
      );
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      const message = e instanceof Error ? e.message : 'Import failed.';
      const isPayloadFault =
        (typeof code === 'string' && code.startsWith('23')) ||
        /payload is inconsistent|references an unknown/.test(message);
      if (isPayloadFault) {
        const err: ApiError = {
          error: { message: `Could not import this file: ${message}` },
        };
        return c.json(err, 400);
      }
      const err: ApiError = {
        error: { message: 'Import failed due to a server error.' },
      };
      return c.json(err, 500);
    }

    const building = await deps.buildingRepository.get(newBuildingId);
    if (building === null) {
      // Should never happen — the row was just committed.
      const err: ApiError = {
        error: { message: 'Imported building could not be read back.' },
      };
      return c.json(err, 500);
    }
    const out: ApiEnvelope<Building> = { data: building };
    return c.json(out, 201);
  }
  );

  return router;
};
