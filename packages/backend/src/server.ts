import { Hono } from 'hono';
import type { DatabaseSync } from 'node:sqlite';
import type {
  BreakerRepository,
  BreakerTestRepository,
  ComponentRepository,
  FloorRepository,
  PanelRepository,
  RoomRepository,
  ServiceEntryRepository,
  WallRepository,
} from '@he/shared';
import { buildPanelRoutes } from './routes/panels.js';
import { buildBreakerRoutes } from './routes/breakers.js';
import { buildBreakerTestRoutes } from './routes/breaker-tests.js';
import { buildComponentRoutes } from './routes/components.js';
import { buildFloorPlanRoutes } from './routes/floor-plans.js';
import { buildFloorRoutes } from './routes/floors.js';
import { buildRoomRoutes } from './routes/rooms.js';
import { buildServiceEntryRoutes } from './routes/service-entries.js';
import { buildWallRoutes } from './routes/walls.js';
import { buildSwitchControlRoutes } from './routes/switch-controls.js';
import { devStaticRoutes } from './routes/dev-static.js';
import { healthRoutes } from './routes/health.js';
import { spaRoutes } from './routes/static-spa.js';

export type AppDeps = {
  panelRepository: PanelRepository;
  breakerRepository: BreakerRepository;
  /** G36 cycle-61 — audit-trail repo (breaker_tests). */
  breakerTestRepository: BreakerTestRepository;
  componentRepository: ComponentRepository;
  floorRepository: FloorRepository;
  wallRepository: WallRepository;
  roomRepository: RoomRepository;
  /** G40 cycle-66 — dated service-log repo (service_entries). */
  serviceEntryRepository: ServiceEntryRepository;
  /** Raw DB handle — switch_controls is a thin join table, easier to
   *  query directly than via a full repo class for G19 scope. */
  db: DatabaseSync;
};

export const buildApp = (deps: AppDeps): Hono => {
  const app = new Hono();
  app.route('/api/v1', healthRoutes);
  app.route(
    '/api/v1',
    buildPanelRoutes(deps.panelRepository, deps.breakerRepository)
  );
  app.route('/api/v1', buildBreakerRoutes(deps.panelRepository, deps.breakerRepository));
  app.route(
    '/api/v1',
    buildBreakerTestRoutes(deps.breakerRepository, deps.breakerTestRepository)
  );
  app.route(
    '/api/v1',
    buildComponentRoutes(deps.componentRepository, deps.breakerRepository)
  );
  app.route('/api/v1', buildFloorPlanRoutes(deps.floorRepository));
  app.route(
    '/api/v1',
    buildFloorRoutes(deps.floorRepository, deps.panelRepository)
  );
  app.route('/api/v1', buildWallRoutes(deps.wallRepository, deps.floorRepository));
  app.route('/api/v1', buildRoomRoutes(deps.roomRepository, deps.floorRepository));
  app.route(
    '/api/v1',
    buildServiceEntryRoutes(
      deps.breakerRepository,
      deps.componentRepository,
      deps.serviceEntryRepository
    )
  );
  app.route(
    '/api/v1',
    buildSwitchControlRoutes(deps.db, deps.componentRepository)
  );
  // Static serving for `/files/floor-plans/:filename`. After the single-
  // image consolidation this is the canonical floor-plan serving path in
  // BOTH dev and prod — no nginx in front anymore. The route file kept
  // its historical `devStaticRoutes` name; the logic was already
  // production-grade (path-traversal hardened, MIME-correct, immutable
  // cache header).
  app.route('/', devStaticRoutes);
  // SPA + static asset serving for the Vite-built frontend. MUST be
  // registered last so /api/v1/* and /files/floor-plans/* match first;
  // any GET that falls through here either serves the matching file
  // from PUBLIC_DIR or falls back to index.html (wouter takes over).
  // In dev (PUBLIC_DIR missing) this silently 404s; devs use Vite's
  // own port for the SPA.
  app.route('/', spaRoutes);
  return app;
};
