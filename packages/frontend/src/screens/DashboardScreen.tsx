import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import {
  AlertTriangle,
  CheckCircle2,
  LayoutGrid,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import type { Breaker, Component, Floor, Panel } from '@he/shared';
import {
  latestBreakerTestsByIds,
  listAllBreakersGrouped,
  listComponents,
  listFloors,
  listPanels,
} from '../api.js';
import { computeBreakerLoad, type BreakerLoad } from '../lib/load.js';
import { startOfMonthEpoch } from '../lib/datetime.js';
import { filterUntestedProtected } from '../lib/protection.js';
import {
  Card,
  CardHeader,
  CardTitle,
  ScreenHeader,
  Skeleton,
  toast,
} from '../ui/index.js';

/**
 * G45 — Home status dashboard.
 *
 * A roll-up of signals the app ALREADY computes. It re-DISPLAYS them in four
 * count cards; it does NO new analysis (no code-compliance auditing, no load
 * math beyond the existing lib/load.ts helpers, no protection inference). Every
 * number comes from an existing helper/query, building-scoped via the active
 * building (the AppShell route Switch is keyed on currentBuildingId, so this
 * screen remounts on building switch).
 *
 * This is the app's heaviest mount (1 + P + 1 + K calls fired in ONE
 * Promise.all batch). Mount-time snapshot staleness is accepted, matching the
 * PanelListScreen / PanelDetailScreen precedent.
 */
export const DashboardScreen = (): JSX.Element => {
  const [panels, setPanels] = useState<Panel[]>([]);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [components, setComponents] = useState<Component[]>([]);
  /** All breakers across every panel, with the panel they belong to. */
  const [breakers, setBreakers] = useState<Breaker[]>([]);
  /** Protected (GFCI/AFCI/dual) breakers — the subset we test monthly. */
  const [protectedBreakers, setProtectedBreakers] = useState<Breaker[]>([]);
  /** latest breaker_test timestamp per protected breaker (null = never). */
  const [latestTestByBreaker, setLatestTestByBreaker] = useState<
    Map<string, number | null>
  >(new Map());
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // ONE batch — all independent fetches in parallel (heaviest mount).
      const [allPanels, allFloors, allComponents, grouped] = await Promise.all([
        listPanels(),
        listFloors(),
        listComponents(),
        listAllBreakersGrouped(),
      ]);
      setPanels(allPanels);
      setFloors(allFloors);
      setComponents(allComponents);

      const allBreakers: Breaker[] = [];
      const protBreakers: Breaker[] = [];
      for (const g of grouped) {
        for (const br of g.breakers) {
          allBreakers.push(br);
          if (br.protection !== null) protBreakers.push(br);
        }
      }
      setBreakers(allBreakers);
      setProtectedBreakers(protBreakers);

      if (protBreakers.length > 0) {
        const tests = await latestBreakerTestsByIds(
          protBreakers.map((b) => b.id)
        );
        const m = new Map<string, number | null>();
        for (const [id, t] of tests) m.set(id, t === null ? null : t.testedAt);
        setLatestTestByBreaker(m);
      } else {
        setLatestTestByBreaker(new Map());
      }
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'Failed to load the dashboard.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const monthStart = useMemo(() => startOfMonthEpoch(), []);

  /**
   * Per-circuit load — reuses lib/load.ts EXACTLY as PanelDetailScreen does:
   * group components by breakerId, then computeBreakerLoad per breaker. The
   * 'over' / 'warn' tiers are read straight off the resulting status; no new
   * load math happens here.
   */
  const loadByBreakerId = useMemo<Map<string, BreakerLoad>>(() => {
    const componentsByBreaker = new Map<string, Component[]>();
    for (const c of components) {
      if (c.breakerId !== null) {
        const arr = componentsByBreaker.get(c.breakerId);
        if (arr) arr.push(c);
        else componentsByBreaker.set(c.breakerId, [c]);
      }
    }
    const m = new Map<string, BreakerLoad>();
    for (const b of breakers) {
      const comps = componentsByBreaker.get(b.id) ?? [];
      m.set(b.id, computeBreakerLoad(b, comps));
    }
    return m;
  }, [components, breakers]);

  /** Card (a) — overloaded / over-80% circuits. */
  const overload = useMemo(() => {
    let over = 0;
    let warn = 0;
    const panelIdsWithOver = new Set<string>();
    for (const b of breakers) {
      const load = loadByBreakerId.get(b.id);
      if (!load) continue;
      if (load.status === 'over') {
        over += 1;
        panelIdsWithOver.add(b.panelId);
      } else if (load.status === 'warn') {
        warn += 1;
      }
    }
    return { over, warn, panelIdsWithOver };
  }, [breakers, loadByBreakerId]);

  /** Card (b) — GFCI/AFCI untested this month (pure lib/protection.ts). */
  const untestedProtected = useMemo<Breaker[]>(
    () =>
      filterUntestedProtected(protectedBreakers, latestTestByBreaker, monthStart),
    [protectedBreakers, latestTestByBreaker, monthStart]
  );

  /** Card (c) — components flagged critical (informational). */
  const criticalCount = useMemo(
    () => components.filter((c) => c.critical === true).length,
    [components]
  );

  // Where the overload card links: a single affected panel deep-links to it;
  // otherwise fall through to the Panels list.
  const overloadPanelId =
    overload.panelIdsWithOver.size === 1
      ? [...overload.panelIdsWithOver][0]
      : null;
  const overloadHref =
    overloadPanelId !== null ? `/panels/${overloadPanelId}` : '/';

  if (loading) {
    return (
      <>
        <ScreenHeader
          title="Status"
          subtitle="A roll-up of your home's electrical health"
        />
        <div className="dashboard__grid">
          <Skeleton variant="card" count={4} aria-label="Loading status" />
        </div>
      </>
    );
  }

  return (
    <div data-testid="dashboard-screen">
      <ScreenHeader
        title="Status"
        subtitle="A roll-up of your home's electrical health"
      />
      <div className="dashboard__grid">
        {/* (a) Overloaded circuits */}
        <Card
          className="dashboard-card"
          data-testid="dashboard-card-overload"
          data-count={overload.over}
          data-warn-count={overload.warn}
        >
          <CardHeader className="dashboard-card__head">
            <span
              className="dashboard-card__icon"
              data-status={overload.over > 0 ? 'over' : overload.warn > 0 ? 'warn' : 'ok'}
              aria-hidden="true"
            >
              {overload.over > 0 || overload.warn > 0 ? (
                <Zap size={20} strokeWidth={2} />
              ) : (
                <CheckCircle2 size={20} strokeWidth={2} />
              )}
            </span>
            <CardTitle as="h2" className="dashboard-card__title">
              Circuit load
            </CardTitle>
          </CardHeader>
          {overload.over > 0 || overload.warn > 0 ? (
            <>
              <p className="dashboard-card__metric">
                <span className="dashboard-card__count" data-tier="over">
                  {overload.over}
                </span>{' '}
                over capacity
                {overload.warn > 0 && (
                  <>
                    {' · '}
                    <span className="dashboard-card__count" data-tier="warn">
                      {overload.warn}
                    </span>{' '}
                    over 80%
                  </>
                )}
              </p>
              <Link
                href={overloadHref}
                className="dashboard-card__link"
                data-testid="dashboard-card-overload-link"
              >
                {overloadPanelId !== null
                  ? 'View affected panel →'
                  : 'View panels →'}
              </Link>
            </>
          ) : (
            <p className="dashboard-card__calm" data-testid="dashboard-card-overload-calm">
              All circuits within capacity.
            </p>
          )}
        </Card>

        {/* (b) GFCI/AFCI untested this month */}
        <Card
          className="dashboard-card"
          data-testid="dashboard-card-protection"
          data-count={untestedProtected.length}
        >
          <CardHeader className="dashboard-card__head">
            <span
              className="dashboard-card__icon"
              data-status={untestedProtected.length > 0 ? 'warn' : 'ok'}
              aria-hidden="true"
            >
              {untestedProtected.length > 0 ? (
                <AlertTriangle size={20} strokeWidth={2} />
              ) : (
                <ShieldCheck size={20} strokeWidth={2} />
              )}
            </span>
            <CardTitle as="h2" className="dashboard-card__title">
              GFCI/AFCI testing
            </CardTitle>
          </CardHeader>
          {untestedProtected.length > 0 ? (
            <>
              <p className="dashboard-card__metric">
                <span className="dashboard-card__count" data-tier="warn">
                  {untestedProtected.length}
                </span>{' '}
                untested this month
              </p>
              <Link
                href="/test"
                className="dashboard-card__link"
                data-testid="dashboard-card-protection-link"
              >
                Test protected devices →
              </Link>
            </>
          ) : (
            <p
              className="dashboard-card__calm"
              data-testid="dashboard-card-protection-calm"
            >
              {protectedBreakers.length === 0
                ? 'No protected devices yet.'
                : 'All protected devices tested this month.'}
            </p>
          )}
        </Card>

        {/* (c) Critical components (informational) */}
        <Card
          className="dashboard-card"
          data-testid="dashboard-card-critical"
          data-count={criticalCount}
        >
          <CardHeader className="dashboard-card__head">
            <span
              className="dashboard-card__icon"
              data-status="info"
              aria-hidden="true"
            >
              <AlertTriangle size={20} strokeWidth={2} />
            </span>
            <CardTitle as="h2" className="dashboard-card__title">
              Critical components
            </CardTitle>
          </CardHeader>
          {criticalCount > 0 ? (
            <>
              <p className="dashboard-card__metric">
                <span className="dashboard-card__count" data-tier="info">
                  {criticalCount}
                </span>{' '}
                flagged critical
              </p>
              <Link
                href="/library"
                className="dashboard-card__link"
                data-testid="dashboard-card-critical-link"
              >
                View in library →
              </Link>
            </>
          ) : (
            <p
              className="dashboard-card__calm"
              data-testid="dashboard-card-critical-calm"
            >
              No components flagged critical.
            </p>
          )}
        </Card>

        {/* (d) Per-building counts (always informational) */}
        <Card
          className="dashboard-card"
          data-testid="dashboard-card-counts"
          data-panels={panels.length}
          data-breakers={breakers.length}
          data-components={components.length}
          data-floors={floors.length}
        >
          <CardHeader className="dashboard-card__head">
            <span
              className="dashboard-card__icon"
              data-status="info"
              aria-hidden="true"
            >
              <LayoutGrid size={20} strokeWidth={2} />
            </span>
            <CardTitle as="h2" className="dashboard-card__title">
              This building
            </CardTitle>
          </CardHeader>
          <ul className="dashboard-card__counts">
            <li>
              <Link
                href="/"
                className="dashboard-card__count-row"
                data-testid="dashboard-card-counts-panels"
              >
                <span className="dashboard-card__count" data-tier="info">
                  {panels.length}
                </span>
                <span className="dashboard-card__count-label">Panels</span>
              </Link>
            </li>
            <li>
              <Link
                href="/"
                className="dashboard-card__count-row"
                data-testid="dashboard-card-counts-breakers"
              >
                <span className="dashboard-card__count" data-tier="info">
                  {breakers.length}
                </span>
                <span className="dashboard-card__count-label">Breakers</span>
              </Link>
            </li>
            <li>
              <Link
                href="/library"
                className="dashboard-card__count-row"
                data-testid="dashboard-card-counts-components"
              >
                <span className="dashboard-card__count" data-tier="info">
                  {components.length}
                </span>
                <span className="dashboard-card__count-label">Components</span>
              </Link>
            </li>
            <li>
              <Link
                href="/map"
                className="dashboard-card__count-row"
                data-testid="dashboard-card-counts-floors"
              >
                <span className="dashboard-card__count" data-tier="info">
                  {floors.length}
                </span>
                <span className="dashboard-card__count-label">Floors</span>
              </Link>
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
};
