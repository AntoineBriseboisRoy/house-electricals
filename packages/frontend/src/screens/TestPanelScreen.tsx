import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useRoute } from 'wouter';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  CornerDownRight,
  Layers,
} from 'lucide-react';
import type {
  Breaker,
  BreakerTest,
  ComponentInput,
  Floor,
  Panel,
  ResolvedComponent,
} from '@he/shared';
import {
  createBreakerTest,
  getPanel,
  latestBreakerTestsByIds,
  listAllBreakersGrouped,
  listBreakers,
  listComponents,
  listFloors,
  updateComponent,
} from '../api.js';
import { useModal } from '../hooks/useModal.js';
import { formatRelative } from '../lib/relativeTime.js';
import { ComponentTypeIcon, componentTypeLabel } from '../components/ComponentTypeIcon.js';
import { ProtectionBadge } from '../components/ProtectionBadge.js';
import { useOptimisticPatch } from '../hooks/useOptimisticPatch.js';
import { useToastSink } from '../hooks/useToastSink.js';
import { computeCascadeOff } from '../lib/subpanelRecursion.js';
import {
  Button,
  EmptyState,
  NoBreakers,
  NoComponents,
  ScreenHeader,
  Skeleton,
  toast,
  Tooltip,
} from '../ui/index.js';

const VISIBILITY_RESET_DELAY_MS = 10_000;

/** Sentinel for the "All floors" segmented-control option. */
const ALL_FLOORS = '__all__' as const;
type FloorSelection = string | typeof ALL_FLOORS;

const readFloorFromUrl = (): string | null => {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('floor');
};

const sortFloors = (a: Floor, b: Floor): number => {
  const aOrder = a.displayOrder;
  const bOrder = b.displayOrder;
  if (aOrder !== null && bOrder !== null) {
    if (aOrder !== bOrder) return aOrder - bOrder;
  } else if (aOrder !== null) {
    return -1;
  } else if (bOrder !== null) {
    return 1;
  }
  return a.createdAt - b.createdAt;
};

export const TestPanelScreen = (): JSX.Element => {
  // Refactor 2026-05 — dual-routable: the canonical entry is /test/:panelId
  // under the new Test tab; the legacy /panels/:id/test still works as a
  // back-compat alias. Whichever pattern matches wins; we also derive the
  // back-button target so navigation lands on whichever tab the user came
  // from instead of pinning to the panel detail.
  const [, oldParams] = useRoute<{ id: string }>('/panels/:id/test');
  const [, newParams] = useRoute<{ panelId: string }>('/test/:panelId');
  const panelId = oldParams?.id ?? newParams?.panelId ?? '';
  const [location, setLocation] = useLocation();
  const cameFromTestTab = location.startsWith('/test/');
  const backHref = cameFromTestTab ? '/test' : `/panels/${panelId}`;

  const [panel, setPanel] = useState<Panel | null>(null);
  const [breakers, setBreakers] = useState<Breaker[]>([]);
  const [components, setComponents] = useState<ResolvedComponent[]>([]);
  const [floors, setFloors] = useState<Floor[]>([]);
  // G39 Part 2 (cycle-57): the full house's panels + each panel's
  // breakers, fetched once at refresh time. The recursion walker
  // needs the whole tree to cascade an off feeder through subpanel
  // chains. See CLAUDE.md "Subpanel breaker-test recursion".
  const [allPanels, setAllPanels] = useState<Panel[]>([]);
  const [breakersByPanel, setBreakersByPanel] = useState<Map<string, Breaker[]>>(
    new Map()
  );
  const [loading, setLoading] = useState(true);

  // Verify-mode client state: which breaker ids are toggled "off".
  //
  // CRITICAL: this Set stays GLOBAL across floor selection. A breaker is a
  // physical device — its on/off state can't depend on which floor tab the
  // user is viewing. The floor switcher narrows the displayed component
  // list, NOT the off-set itself. See CLAUDE.md "Multi-floor model (G13)"
  // off-state-invariance note.
  const [offBreakers, setOffBreakers] = useState<Set<string>>(new Set());
  // Track mode: the single breaker we're currently assigning components to.
  const [trackingBreakerId, setTrackingBreakerId] = useState<string | null>(null);
  /** G14: floor switcher selection. null until floors load. */
  const [selection, setSelection] = useState<FloorSelection | null>(null);
  /** G36 cycle-61 — latest BreakerTest per breaker id (null = no test
   *  recorded yet). Refreshed by `refreshLastTests` after Mark verified
   *  POSTs so the UI reflects the new event without a full screen reload. */
  const [lastTestByBreakerId, setLastTestByBreakerId] = useState<
    Map<string, BreakerTest | null>
  >(new Map());
  const { confirm, prompt, modalNode } = useModal();

  const optimistic = useOptimisticPatch<Partial<ComponentInput>, unknown>(
    (id, body) => updateComponent(id, body)
  );
  // Drain transient PATCH failures to toasts instead of an inline banner.
  useToastSink(optimistic.errors);

  const refresh = useCallback(async () => {
    if (!panelId) return;
    setLoading(true);
    try {
      const [p, b, allComponents, allFloors, allBreakerGroups] = await Promise.all([
        getPanel(panelId),
        listBreakers(panelId),
        listComponents(),
        listFloors(),
        // G39 Part 2 (cycle-57): one round-trip to grab every panel +
        // its breakers, so the recursion walker has the full tree.
        listAllBreakersGrouped(),
      ]);
      setPanel(p);
      setBreakers(b);
      setComponents(allComponents);
      setFloors(allFloors.slice().sort(sortFloors));
      setAllPanels(allBreakerGroups.map((g) => g.panel));
      setBreakersByPanel(
        new Map(allBreakerGroups.map((g) => [g.panel.id, g.breakers]))
      );
      setOffBreakers(new Set());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load panel.');
    } finally {
      setLoading(false);
    }
  }, [panelId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** G36 cycle-61 — fetch latest BreakerTest per breaker (lazy after the
   *  critical-path refresh resolves). Re-runs whenever the breakers list
   *  changes; also called by `handleMarkVerified` to reflect a new event. */
  const refreshLastTests = useCallback(async (): Promise<void> => {
    if (breakers.length === 0) {
      setLastTestByBreakerId(new Map());
      return;
    }
    try {
      const map = await latestBreakerTestsByIds(breakers.map((b) => b.id));
      setLastTestByBreakerId(map);
    } catch {
      // best-effort — surface hides if this fails
    }
  }, [breakers]);

  useEffect(() => {
    void refreshLastTests();
  }, [refreshLastTests]);

  /** G36 cycle-61 — "Mark verified" action. Two-step UX so the user can
   *  EITHER record a no-notes verification (one tap → confirm) OR add
   *  free-form notes via the prompt (a second tap on the same path).
   *
   *  Step 1 — confirm modal: "Record verification for slot X?" with
   *    [Cancel] [Add notes] [Mark verified] choices. Confirm posts the
   *    bare event (no notes). The notes branch chains into PromptModal.
   *
   *  Since useModal's confirm() only exposes confirm/cancel, we model
   *  the "Add notes" branch via a pick() (PickerModal) with two options:
   *  "Mark verified (no notes)" vs "Add notes…". Picker fits the
   *  3-way choice and matches the existing modal vocabulary.
   *  POSTs to /api/v1/breakers/:id/breaker-tests, then optimistically
   *  updates the lastTest map without re-fetching. */
  const handleMarkVerified = useCallback(
    async (breaker: Breaker): Promise<void> => {
      const slotLabel = `slot ${breaker.slot}${breaker.tandemHalf ?? ''}`;
      const proceed = await confirm({
        title: `Mark verified: ${slotLabel}`,
        message:
          'Record that you tested this breaker and confirmed the circuit. You can add notes after confirming if you want.',
        confirmLabel: 'Mark verified',
      });
      if (!proceed) return;

      // Optional second step — let the user attach a note (cancel = no note).
      let notes: string | null = null;
      try {
        notes = await prompt({
          title: `Notes for ${slotLabel} (optional)`,
          message:
            'Add a short note about this verification (or cancel to record with no notes).',
          label: 'Notes',
          placeholder:
            'e.g. killed power, confirmed kitchen counter outlets dead',
          confirmLabel: 'Save notes',
          cancelLabel: 'Skip',
        });
      } catch {
        notes = null;
      }

      try {
        const created = await createBreakerTest(breaker.id, {
          notes: notes ?? null,
        });
        setLastTestByBreakerId((prev) => {
          const next = new Map(prev);
          next.set(breaker.id, created);
          return next;
        });
        toast.success('Marked verified');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to mark verified.');
      }
    },
    [confirm, prompt]
  );

  // Wake-lock during the test session (best-effort; ignored on browsers without support).
  useEffect(() => {
    type WakeLockSentinel = { release: () => Promise<void> };
    let sentinel: WakeLockSentinel | null = null;
    type NavigatorWithWakeLock = Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinel> };
    };
    const nav = navigator as NavigatorWithWakeLock;
    nav.wakeLock?.request('screen')
      .then((s) => {
        sentinel = s;
      })
      .catch(() => {
        // best-effort
      });
    return () => {
      sentinel?.release().catch(() => undefined);
    };
  }, []);

  // Lifecycle resets for the ephemeral offBreakers set: clear on visibilityState=hidden+10s.
  const hiddenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') {
        if (hiddenTimer.current) clearTimeout(hiddenTimer.current);
        hiddenTimer.current = setTimeout(() => {
          setOffBreakers(new Set());
        }, VISIBILITY_RESET_DELAY_MS);
      } else {
        if (hiddenTimer.current) {
          clearTimeout(hiddenTimer.current);
          hiddenTimer.current = null;
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (hiddenTimer.current) clearTimeout(hiddenTimer.current);
    };
  }, []);

  // G39 Part 2 (cycle-57): cascade-off breaker ids + attribution map.
  // A breaker is "cascade-off" when some feeder UPSTREAM is in the
  // direct-off set (the user flipped it). The walker recurses through
  // panels.parentBreakerId chains. Direct-off precedence is enforced
  // inside the helper.
  const cascade = useMemo(
    () => computeCascadeOff(offBreakers, allPanels, breakersByPanel),
    [offBreakers, allPanels, breakersByPanel]
  );

  const offComponentIds = useMemo(() => {
    if (offBreakers.size === 0 && cascade.cascadeBreakerIds.size === 0) {
      return new Set<string>();
    }
    const ids = new Set<string>();
    for (const c of components) {
      if (c.breakerId === null) continue;
      if (offBreakers.has(c.breakerId)) ids.add(c.id);
      else if (cascade.cascadeBreakerIds.has(c.breakerId)) ids.add(c.id);
    }
    return ids;
  }, [components, offBreakers, cascade]);

  // G14: components on this panel's breakers — used to compute which floors
  // qualify for the switcher.
  const componentsOnThisPanel = useMemo(() => {
    const breakerIds = new Set(breakers.map((b) => b.id));
    return components.filter(
      (c) => c.breakerId !== null && breakerIds.has(c.breakerId)
    );
  }, [breakers, components]);

  // Floors that have at least one component on THIS panel's breakers.
  const qualifyingFloors = useMemo(() => {
    const ids = new Set(
      componentsOnThisPanel
        .map((c) => c.floorId)
        .filter((id): id is string => id !== null)
    );
    return floors.filter((f) => ids.has(f.id));
  }, [componentsOnThisPanel, floors]);

  // Initialize selection from URL or default to first qualifying floor.
  useEffect(() => {
    if (loading) return;
    if (selection !== null) return;
    const fromUrl = readFloorFromUrl();
    if (
      fromUrl !== null &&
      (fromUrl === ALL_FLOORS || qualifyingFloors.some((f) => f.id === fromUrl))
    ) {
      setSelection(fromUrl);
      return;
    }
    const first = qualifyingFloors[0];
    setSelection(first ? first.id : null);
  }, [loading, qualifyingFloors, selection]);

  // Push selection into the URL via ?floor=<id>. Preserves whichever
  // pathname the user entered through (new /test/<id> or legacy
  // /panels/<id>/test) so refresh + history stay consistent.
  useEffect(() => {
    if (selection === null) return;
    const sp = new URLSearchParams(window.location.search);
    sp.set('floor', selection);
    const basePath = cameFromTestTab
      ? `/test/${panelId}`
      : `/panels/${panelId}/test`;
    setLocation(`${basePath}?${sp.toString()}`, { replace: true });
  }, [selection, panelId, setLocation, cameFromTestTab]);

  // The displayed component list filters by selected floor. The off-set
  // itself is NOT filtered — physical breakers don't have per-floor state.
  const visibleComponents = useMemo(() => {
    if (selection === null || selection === ALL_FLOORS) return components;
    return components.filter((c) => c.floorId === selection);
  }, [components, selection]);

  /** Legacy: toggle ephemeral off-set. Still used by the cascade walker.
   *  Kept as a building block — `toggleWalkThrough` calls it. */
  const toggleBreaker = (id: string): void => {
    setOffBreakers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** Refactor 2026-05 follow-up — single "Walk through" action.
   *  Combines the previously-separate "Mark off" (visual flip) + "Track"
   *  (tap-to-tag) into one button. Click → both off-state and track mode
   *  arm for this breaker. Click again → restore + stop tracking. The
   *  off-state itself is INTENTIONALLY ephemeral (mirrors a breaker the
   *  user just flipped IRL); what's persisted is the component-to-breaker
   *  assignment made by tapping each darkened component while tracking. */
  const toggleWalkThrough = (id: string): void => {
    const wasActive = trackingBreakerId === id && offBreakers.has(id);
    if (wasActive) {
      setOffBreakers((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setTrackingBreakerId(null);
    } else {
      setOffBreakers((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      setTrackingBreakerId(id);
    }
  };
  // Silence unused-import warnings now that toggleBreaker is internal only.
  void toggleBreaker;

  const tapComponent = async (component: ResolvedComponent): Promise<void> => {
    if (trackingBreakerId === null) return;
    if (component.breakerId === trackingBreakerId) return; // already assigned
    // Optimistic local update — flip the breakerId immediately so the UI reflects assignment.
    setComponents((prev) =>
      prev.map((c) =>
        c.id === component.id
          ? { ...c, breakerId: trackingBreakerId, breaker: c.breaker ?? null }
          : c
      )
    );
    const result = await optimistic.patch(component.id, { breakerId: trackingBreakerId });
    if (result === null) {
      // Roll back on failure (after retries exhausted).
      setComponents((prev) =>
        prev.map((c) => (c.id === component.id ? { ...c, breakerId: component.breakerId } : c))
      );
    } else {
      // Refresh to pick up the resolved breaker join (panel name etc.) for the row.
      void refresh();
    }
  };

  const breakerLabel = (b: Breaker): string =>
    `slot ${b.slot}${b.slotPosition !== null ? ` (#${b.slotPosition})` : ''} · ${b.label} · ${b.amperage}A`;

  return (
    <>
      <ScreenHeader
        title={panel ? `Test: ${panel.name}` : 'Test'}
        subtitle={
          trackingBreakerId === null
            ? 'Flip a breaker IRL → click Walk through → tap the components that lost power.'
            : 'Tap a component below to wire it to the breaker you\'re walking through.'
        }
        back={backHref}
      />

      <section className="section" aria-labelledby="breakers-heading">
        <h2 id="breakers-heading" className="section-title">
          Breakers
        </h2>
        {loading ? (
          <Skeleton variant="row" count={4} aria-label="Loading breakers" />
        ) : breakers.length === 0 ? (
          <EmptyState
            illustration={<NoBreakers />}
            title="No breakers yet"
            description="Go back to the panel and add some first."
            action={
              <Link href={`/panels/${panelId}`}>
                <Button>Back to panel</Button>
              </Link>
            }
          />
        ) : (
          <ul className="test-breaker-list">
            {breakers.map((b) => {
              const isOff = offBreakers.has(b.id);
              const isTracked = trackingBreakerId === b.id;
              const last = lastTestByBreakerId.get(b.id);
              const verifiedKnown = lastTestByBreakerId.has(b.id);
              return (
                <li
                  key={b.id}
                  className={
                    'test-breaker' +
                    (isOff ? ' test-breaker--off' : '') +
                    (isTracked ? ' test-breaker--tracked' : '')
                  }
                >
                  <div className="test-breaker__main">
                    <span className="test-breaker__label">{breakerLabel(b)}</span>
                    <span className="muted">
                      {(() => {
                        const count = components.filter((c) => c.breakerId === b.id).length;
                        return count === 0
                          ? 'no components yet'
                          : `${count} component${count === 1 ? '' : 's'}`;
                      })()}
                    </span>
                    {/* G36 cycle-61 — verified hint. Hidden while loading. */}
                    {verifiedKnown && (
                      <span
                        className="muted test-breaker__verified"
                        data-testid="test-breaker-verified"
                        data-breaker-id={b.id}
                      >
                        {last === null || last === undefined
                          ? 'Last verified: never'
                          : `Last verified: ${formatRelative(last.testedAt)}`}
                      </span>
                    )}
                  </div>
                  <div className="test-breaker__actions">
                    {/* Refactor 2026-05 follow-up — single "Walk through"
                       button replaces the cycle-70 Mark off + Track pair.
                       The two were almost always used together and the
                       split made "Mark off" feel like it did nothing (it
                       only updated the visual; persistence came from
                       Track + tap-component). Combined into one action
                       so the workflow is obvious: click → both off-state
                       AND track-mode arm; click again → restore + stop.
                       Active state uses 'danger' variant (the breaker is
                       in the OFF simulation), inactive uses 'secondary'. */}
                    <Button
                      variant={isOff || isTracked ? 'danger' : 'secondary'}
                      size="sm"
                      onClick={() => toggleWalkThrough(b.id)}
                      aria-pressed={isOff || isTracked}
                      data-testid="test-breaker-walk-through"
                      data-breaker-id={b.id}
                    >
                      {isOff || isTracked ? 'Stop walking' : 'Walk through'}
                    </Button>
                    {/* G36 cycle-61 — explicit verify action. NOT coupled
                       with the off-set toggle: a verification is a durable
                       event, independent of the ephemeral "currently off"
                       state used during the walk-through. */}
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        void handleMarkVerified(b);
                      }}
                      leadingIcon={
                        <CheckCircle2 size={16} strokeWidth={2.25} />
                      }
                      data-testid="test-breaker-mark-verified"
                      data-breaker-id={b.id}
                    >
                      Mark verified
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="section" aria-labelledby="components-heading">
        <h2 id="components-heading" className="section-title">
          Components
        </h2>
        {/* G14: floor switcher — renders only when ≥2 qualifying floors. */}
        {qualifyingFloors.length >= 2 && (
          <nav className="floor-switcher" aria-label="Floor switcher">
            <ul className="floor-switcher__list">
              {qualifyingFloors.map((f) => (
                <li key={f.id}>
                  <Button
                    variant={selection === f.id ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => setSelection(f.id)}
                  >
                    {f.name}
                  </Button>
                </li>
              ))}
              <li>
                <Button
                  variant={selection === ALL_FLOORS ? 'primary' : 'secondary'}
                  size="sm"
                  leadingIcon={<Layers size={16} strokeWidth={2.25} />}
                  onClick={() => setSelection(ALL_FLOORS)}
                >
                  All floors
                </Button>
              </li>
            </ul>
          </nav>
        )}
        {loading ? (
          <Skeleton variant="row" count={6} aria-label="Loading components" />
        ) : visibleComponents.length === 0 ? (
          (() => {
            const floorId =
              selection !== null && selection !== ALL_FLOORS ? selection : null;
            return (
              <EmptyState
                illustration={<NoComponents />}
                title={
                  components.length === 0
                    ? 'No components yet'
                    : 'No components on this floor'
                }
                description={
                  components.length === 0
                    ? 'Add some from the Library tab first.'
                    : 'Switch to another floor or "All floors" to see more.'
                }
                action={
                  floorId !== null ? (
                    <Link href={`/floors/${floorId}/edit`}>
                      <Button variant="secondary">Open floor map</Button>
                    </Link>
                  ) : undefined
                }
              />
            );
          })()
        ) : (
          <ul className="test-component-list">
            {visibleComponents.map((c) => {
              const isOff = offComponentIds.has(c.id);
              const isUnassigned = c.breakerId === null;
              const isPending = optimistic.pending.has(c.id);
              const isTappable = trackingBreakerId !== null && c.breakerId !== trackingBreakerId;
              // G39 Part 2 (cycle-57): "via <Subpanel>" attribution
              // — only when the component's breaker is cascade-off
              // (NOT direct-off). Direct-off precedence is what
              // suppresses the chip when the user already knows the
              // controlling breaker is off.
              const cascadeVia =
                !isUnassigned &&
                c.breakerId !== null &&
                !offBreakers.has(c.breakerId) &&
                cascade.cascadeBreakerIds.has(c.breakerId)
                  ? cascade.attribution.get(c.breakerId) ?? null
                  : null;
              return (
                <li
                  key={c.id}
                  className={
                    'test-component' +
                    (isOff ? ' test-component--off' : '') +
                    (isUnassigned ? ' test-component--unassigned' : '') +
                    (isPending ? ' test-component--pending' : '') +
                    (isTappable ? ' test-component--tappable' : '')
                  }
                >
                  <Button
                    variant="ghost"
                    block
                    className="test-component__btn"
                    onClick={() => {
                      void tapComponent(c);
                    }}
                    disabled={!isTappable}
                    aria-label={
                      isTappable
                        ? `Assign ${c.name} to the tracked breaker`
                        : `${c.name} (no action available)`
                    }
                  >
                    <span className="test-component__icon" aria-hidden="true">
                      <ComponentTypeIcon type={c.type} size={20} />
                    </span>
                    <span className="test-component__main">
                      <span className="test-component__name">
                        {c.name}
                        {c.critical && (
                          <Tooltip content="Marked as critical (priority for backup power)">
                            <span
                              className="badge badge--critical test-component__critical-badge"
                              data-testid="badge-critical"
                              tabIndex={0}
                            >
                              <AlertTriangle size={11} strokeWidth={2.5} aria-hidden="true" />
                              <span>Critical</span>
                            </span>
                          </Tooltip>
                        )}
                        {c.protection !== null && (
                          <ProtectionBadge kind={c.protection} />
                        )}
                      </span>
                      <span className="muted">
                        {componentTypeLabel(c.type)}
                        {c.room ? ` · ${c.room}` : ''}
                        {c.breaker
                          ? ` · on slot ${c.breaker.slot}${c.breaker.tandemHalf ?? ''}`
                          : ''}
                      </span>
                    </span>
                    <span className="test-component__state">
                      {isPending && <span className="badge badge--count">Saving…</span>}
                      {!isPending && isUnassigned && (
                        <span className="badge badge--warn">Unassigned</span>
                      )}
                      {!isPending && !isUnassigned && isOff && (
                        <span className="badge badge--warn">Currently off</span>
                      )}
                      {!isPending && !isUnassigned && cascadeVia !== null && (
                        <span
                          className="test-component__cascade-chip"
                          data-testid="cascade-via-chip"
                          data-via-panel={cascadeVia}
                        >
                          <CornerDownRight size={12} aria-hidden="true" />
                          <span>via {cascadeVia}</span>
                        </span>
                      )}
                    </span>
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {/* Refactor 2026-05 — points at the new /test/audit canonical (was
         the flat /audit). The flat route still works as a back-compat alias
         but new links should use the nested Test-tab path so the Test tab
         stays highlighted while the user reads the audit log. */}
      <section className="test-panel__audit-footer">
        <Link
          href="/test/audit"
          className="link-action link-action--footer"
          aria-label="Open the audit log"
          data-testid="open-audit-log"
        >
          <ClipboardList size={16} strokeWidth={2.25} aria-hidden="true" />
          <span className="link-action__label">
            <span>View audit log</span>
            <span className="link-action__hint">
              Every recorded test, filterable by date + outcome
            </span>
          </span>
        </Link>
      </section>
      {modalNode}
    </>
  );
};
